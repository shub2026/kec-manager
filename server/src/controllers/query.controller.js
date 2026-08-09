import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { getSemesterInfoFromRequest } from '../services/settings.service.js';
import { getActiveClassFilter } from '../services/class.service.js';
import { calcClassSemester, buildConsecutiveTextbookMap } from '../services/semester.service.js';
import {
  findBestMatchPlan,
  buildClassWithPlanFilter,
  isClassMatchPlan,
} from '../services/plan.service.js';
import { log } from '../utils/logger.js';

// ── 开课查询筛选器选项缓存（优化2）──
// 筛选器下拉选项仅依赖学期（不随用户选择的筛选条件变化），
// 按学期 key 缓存，避免每次请求重复全量查询。
const QUERY_FILTER_TTL = 5 * 60 * 1000;
const queryFilterCache = new Map();

export function invalidateQueryFilterCache() {
  queryFilterCache.clear();
}

async function getQueryFilterOptions(semesterInfo, activeFilter, planFilter) {
  const cacheKey = semesterInfo.raw;
  const cached = queryFilterCache.get(cacheKey);
  if (cached && Date.now() - cached.at < QUERY_FILTER_TTL) {
    return cached.data;
  }

  // 使用不含用户筛选条件的基础 where，保证下拉选项稳定
  const baseWhere = { AND: [activeFilter, planFilter] };

  const allMatchingClasses = await prisma.classes.findMany({
    where: baseWhere,
    select: {
      enrollment_year: true,
      duration_years: true,
      college_id: true,
      major_id: true,
      training_level_id: true,
    },
  });

  const enrollmentYearSet = new Set();
  const gradeSet = new Set();
  const collegeIdSet = new Set();
  const majorIdSet = new Set();
  const levelIdSet = new Set();
  const collegeMajorMap = new Map();
  const collegeLevelMap = new Map();
  const majorLevelMap = new Map();

  for (const c of allMatchingClasses) {
    enrollmentYearSet.add(c.enrollment_year);
    const g = semesterInfo.startYear - c.enrollment_year + 1;
    if (g >= 1 && g <= c.duration_years) gradeSet.add(g);

    if (c.college_id != null) collegeIdSet.add(c.college_id);
    if (c.major_id != null) majorIdSet.add(c.major_id);
    if (c.training_level_id != null) levelIdSet.add(c.training_level_id);

    if (c.college_id != null && c.major_id != null) {
      if (!collegeMajorMap.has(c.college_id)) collegeMajorMap.set(c.college_id, new Set());
      collegeMajorMap.get(c.college_id).add(c.major_id);
    }
    if (c.college_id != null && c.training_level_id != null) {
      if (!collegeLevelMap.has(c.college_id)) collegeLevelMap.set(c.college_id, new Set());
      collegeLevelMap.get(c.college_id).add(c.training_level_id);
    }
    if (c.major_id != null && c.training_level_id != null) {
      if (!majorLevelMap.has(c.major_id)) majorLevelMap.set(c.major_id, new Set());
      majorLevelMap.get(c.major_id).add(c.training_level_id);
    }
  }

  const mapToObj = (map) => {
    const obj = {};
    for (const [k, s] of map) obj[k] = Array.from(s);
    return obj;
  };

  const data = {
    enrollmentYears: [...enrollmentYearSet].sort((a, b) => b - a),
    grades: [...gradeSet].sort((a, b) => a - b),
    collegeIds: Array.from(collegeIdSet),
    majorIds: Array.from(majorIdSet),
    levelIds: Array.from(levelIdSet),
    collegeMajorRelation: mapToObj(collegeMajorMap),
    collegeLevelRelation: mapToObj(collegeLevelMap),
    majorLevelRelation: mapToObj(majorLevelMap),
  };

  queryFilterCache.set(cacheKey, { data, at: Date.now() });
  return data;
}

/**
 * GET /api/query/semester - 当前学期开课查询
 */
export async function querySemester(req, res, next) {
  try {
    let semesterInfo = await getSemesterInfoFromRequest(req);

    if (!semesterInfo) {
      const { semester } = req.query;
      if (semester) {
        return fail(res, '学期格式错误，应为 YYYY-YYYY-N');
      } else {
        return fail(res, '请先设置当前学期');
      }
    }

    // 注意：naming 中间件已将 req.query 中的 camelCase 转为 snake_case
    // 因此这里必须用 snake_case 变量名解构
    const {
      major_id,
      college_id,
      training_level_id,
      enrollment_year,
      grade,
      page,
      page_size,
    } = req.query;
    // 安全解析数字参数，非数字时回退到默认值，避免 NaN 致 500
    const safeInt = (v, def = undefined) => {
      if (v == null || v === '') return def;
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    };
    const pageNum = safeInt(page, 1) || 1;
    // H-5修复：分页上限保护，防止 pageSize 过大导致 OOM
    const requestedPageSize = safeInt(page_size, 50) || 50;
    const pageSizeNum = Math.min(Math.max(requestedPageSize, 1), 100);

    // 构建"能关联到培养方案"的过滤条件
    const planFilter = await buildClassWithPlanFilter();

    // 基础过滤：在读班级 + 能关联到培养方案（传入查询学期，避免学期错位）
    const activeFilter = await getActiveClassFilter(semesterInfo);
    const baseWhere = {
      AND: [activeFilter, planFilter],
    };

    // 添加额外的筛选条件
    const extraConditions = {};
    const majorIdNum = safeInt(major_id);
    const collegeIdNum = safeInt(college_id);
    const trainingLevelIdNum = safeInt(training_level_id);
    const enrollmentYearNum = safeInt(enrollment_year);
    if (majorIdNum != null) extraConditions.major_id = majorIdNum;
    if (collegeIdNum != null) extraConditions.college_id = collegeIdNum;
    if (trainingLevelIdNum != null) extraConditions.training_level_id = trainingLevelIdNum;
    if (enrollmentYearNum != null) extraConditions.enrollment_year = enrollmentYearNum;

    // M-19: 年级筛选下推到数据库层，修正分页总数不准问题
    const gradeNum = safeInt(grade);
    // B-2修复：grade 和 enrollment_year 互斥校验，防止后者被静默覆盖
    if (gradeNum != null && enrollmentYearNum != null) {
      return fail(res, '年级和入学年份不能同时筛选', 400);
    }
    if (gradeNum != null && gradeNum >= 1) {
      // 年级 grade 对应入学年份 enrollment_year = startYear - grade + 1
      const targetEnrollmentYear = semesterInfo.startYear - gradeNum + 1;
      extraConditions.enrollment_year = targetEnrollmentYear;
    }

    const classWhere =
      Object.keys(extraConditions).length > 0 ? { AND: [baseWhere, extraConditions] } : baseWhere;

    // 修复A：分页总数与 DB 取数基准(classWhere)完全一致，
    // 保证所有在读+有方案班级均可通过分页到达。
    // 原实现多加了 teaching_assignments.some 条件，导致 total < 实际班级数，
    // 多出来的页永远无法被前端请求，部分班级永久不可见。
    const totalClassesCount = await prisma.classes.count({ where: classWhere });

    // 优化2：筛选器下拉选项使用按学期缓存（TTL 5分钟），避免每次请求重复全量查询。
    // 选项仅依赖学期（不随用户筛选条件变化），保证下拉稳定且缓存命中率高。
    const filterOptions = await getQueryFilterOptions(semesterInfo, activeFilter, planFilter);
    const availableEnrollmentYears = filterOptions.enrollmentYears;
    const availableGrades = filterOptions.grades;
    const availableCollegeIds = filterOptions.collegeIds;
    const availableMajorIds = filterOptions.majorIds;
    const availableLevelIds = filterOptions.levelIds;
    const collegeMajorRelation = filterOptions.collegeMajorRelation;
    const collegeLevelRelation = filterOptions.collegeLevelRelation;
    const majorLevelRelation = filterOptions.majorLevelRelation;

    const classes = await prisma.classes.findMany({
      where: classWhere,
      include: {
        majors: { select: { id: true, name: true } },
        colleges: { select: { id: true, name: true } },
        training_levels: { select: { id: true, name: true } },
        training_plans: {
          include: {
            plan_courses: {
              include: {
                courses: { select: { id: true, name: true, type: true } },
                plan_course_semesters: {
                  include: {
                    plan_textbooks: {
                      include: {
                        textbooks: {
                          select: { id: true, title: true, isbn: true, publisher: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { enrollment_year: 'desc' },
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    });

    // 第二步：预加载相关培养方案
    const majorPlanIds = new Set();
    const levelPlanIds = new Set();
    const customPlanIds = new Set();
    const classPlanMap = new Map();

    for (const cls of classes) {
      const calc = calcClassSemester(cls, semesterInfo);
      if (!calc) continue;
      if (cls.custom_plan_id) {
        classPlanMap.set(cls.id, cls.training_plans);
        customPlanIds.add(cls.custom_plan_id);
      }
      // 始终收集 major/level（即使有 custom_plan_id 也收集，用于兜底匹配）
      if (cls.major_id) majorPlanIds.add(cls.major_id);
      if (cls.training_level_id) levelPlanIds.add(cls.training_level_id);
    }

    // 构建匹配方案的 OR 条件
    const planOrConditions = [];
    if (majorPlanIds.size > 0) {
      planOrConditions.push({ major_id: { in: [...majorPlanIds] } });
    }
    if (levelPlanIds.size > 0) {
      planOrConditions.push({ training_level_id: { in: [...levelPlanIds] } });
    }
    // 修复：将 custom_plan_id 引用的方案也纳入匹配列表，
    // 避免自定义方案因无 major_id/training_level_id 匹配而缺失
    if (customPlanIds.size > 0) {
      planOrConditions.push({ id: { in: [...customPlanIds] } });
    }

    const matchingPlans =
      planOrConditions.length > 0
        ? await prisma.training_plans.findMany({
            where: { OR: planOrConditions },
            include: {
              plan_courses: {
                include: {
                  courses: { select: { id: true, name: true, type: true } },
                  plan_course_semesters: {
                    include: {
                      plan_textbooks: {
                        include: {
                          textbooks: {
                            select: { id: true, title: true, isbn: true, publisher: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          })
        : [];

    // 构建连续使用教材检测集合：从所有已加载方案中提取教材记录
    const textbookRecords = [];
    const seenPlanIds = new Set();
    const collectTextbooks = (plans) => {
      for (const plan of plans) {
        if (seenPlanIds.has(plan.id)) continue;
        seenPlanIds.add(plan.id);
        for (const pc of plan.plan_courses || []) {
          for (const pcs of pc.plan_course_semesters || []) {
            for (const pt of pcs.plan_textbooks || []) {
              textbookRecords.push({
                plan_course_id: pcs.plan_course_id,
                textbook_id: pt.textbook_id,
                semester: pcs.semester,
              });
            }
          }
        }
      }
    };
    collectTextbooks(matchingPlans);
    for (const cls of classes) {
      if (cls.training_plans) collectTextbooks([cls.training_plans]);
    }
    const consecutiveMap = await buildConsecutiveTextbookMap(textbookRecords);

    const results = [];
    // 修复C：收集无匹配方案的班级（如 custom_plan_id 指向已删除方案），
    // 暴露给前端提示用户重新关联，避免静默跳过
    const unmatchedClasses = [];

    for (const cls of classes) {
      const calc = calcClassSemester(cls, semesterInfo);
      if (!calc) continue;

      const plan = findBestMatchPlan(cls, matchingPlans, classPlanMap);
      if (!plan) {
        // 修复C：保持 findBestMatchPlan 匹配语义不变（有 custom_plan_id 时不回退到 major/level，
        // 避免自定义方案被删除后误匹配到通用方案），但收集到 unmatchedClasses 暴露给前端，
        // 避免"静默跳过导致班级不可见"的问题。
        log.warn('班级无匹配方案', {
          className: cls.name,
          major_id: cls.major_id,
          level_id: cls.training_level_id,
        });
        unmatchedClasses.push({
          classId: cls.id,
          className: cls.name,
          major_id: cls.major_id,
          training_level_id: cls.training_level_id,
          custom_plan_id: cls.custom_plan_id,
          reason: cls.custom_plan_id ? '自定义方案已失效，请重新关联' : '无匹配培养方案',
        });
        continue;
      }

      const planCourses = plan.plan_courses.filter(
        (pc) =>
          pc.start_semester <= calc.currentSemesterNum && pc.end_semester >= calc.currentSemesterNum
      );

      // 构造课程列表，同时过滤周课时为 0 的课程（本学期暂不开课）
      const courses = planCourses
        .filter((pc) => {
          const semRecord = pc.plan_course_semesters?.find(
            (s) => s.semester === calc.currentSemesterNum
          );
          const weeklyHours = semRecord?.weekly_hours ?? pc.weekly_hours;
          return weeklyHours > 0;
        })
        .map((pc) => {
          const semRecord = pc.plan_course_semesters?.find(
            (s) => s.semester === calc.currentSemesterNum
          );
          return {
            course_id: pc.courses.id,
            courseName: pc.courses.name,
            courseType: pc.courses.type,
            weekly_hours: semRecord?.weekly_hours ?? pc.weekly_hours,
            weeks_per_semester: semRecord?.weeks_count ?? pc.weeks_per_semester,
            totalHoursThisSemester:
              (semRecord?.weekly_hours ?? pc.weekly_hours) *
              (semRecord?.weeks_count ?? pc.weeks_per_semester),
            textbooks: (semRecord?.plan_textbooks || []).map((pt) => ({
              id: pt.textbooks.id,
              title: pt.textbooks.title,
              isbn: pt.textbooks.isbn,
              publisher: pt.textbooks.publisher,
              isRequired: pt.is_required,
              isConsecutive:
                consecutiveMap.get(`${pc.id}_${pt.textbook_id}`)?.has(semRecord.semester) ?? false,
            })),
          };
        });

      // 修复B：本学期无有效课程的班级也展示（courses=[]，开课数显示 0），
      // 使 results 与 total 口径一致，用户能看到全部在读+有方案班级。
      // 原实现 continue 跳过，导致"所有班级都关联了方案但只显示部分"的观感。
      if (courses.length === 0) {
        log.debug('方案无当前学期有效课程', {
          className: cls.name,
          planName: plan.name,
          currentSemester: calc.currentSemesterNum,
          totalPlanCourses: planCourses.length,
        });
      }

      results.push({
        classId: cls.id,
        className: cls.name,
        collegeName: cls.colleges?.name || null,
        majorName: cls.majors?.name || null,
        trainingLevelName: cls.training_levels?.name || null,
        enrollment_year: cls.enrollment_year,
        grade: calc.grade,
        currentSemester: calc.currentSemesterNum,
        student_count: cls.student_count,
        planName: plan.name,
        courses,
      });
    }

    log.debug('查询学期返回班级数量', { resultCount: results.length, totalClassesCount });

    success(res, {
      semesterInfo: {
        label: semesterInfo.label,
        ...semesterInfo,
      },
      totalClasses: totalClassesCount, // 全部班级数（跨所有页），用于前端"共X个班级"汇总展示
      total: totalClassesCount,
      totalWithCourses: totalClassesCount, // 修复A：与分页基准一致，展示全部在读+有方案班级
      unmatchedClasses, // 修复C：无匹配方案的班级列表，供前端提示用户重新关联
      page: pageNum,
      pageSize: pageSizeNum,
      enrollmentYears: availableEnrollmentYears,
      grades: availableGrades,
      collegeIds: availableCollegeIds, // 当前学期实际开课的学院ID
      majorIds: availableMajorIds, // 当前学期实际开课的专业ID
      levelIds: availableLevelIds, // 当前学期实际开课的层次ID
      collegeMajorRelation, // 学院-专业关联
      collegeLevelRelation, // 学院-层次关联
      majorLevelRelation, // 专业-层次关联
      data: results,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/query/textbook/:id - 教材使用情况查询
 */
export async function queryTextbookUsage(req, res, next) {
  try {
    const { id } = req.params;
    let semesterInfo = await getSemesterInfoFromRequest(req);

    if (!semesterInfo) {
      const { semester } = req.query;
      if (semester) {
        return fail(res, '学期格式错误，应为 YYYY-YYYY-N');
      } else {
        return fail(res, '请先设置当前学期');
      }
    }

    const textbook = await prisma.textbooks.findUnique({ where: { id: Number(id) } });
    if (!textbook) return fail(res, '教材不存在', 404);

    const activeFilter = await getActiveClassFilter(semesterInfo);
    const [planTextbooks, allClasses] = await Promise.all([
      prisma.plan_textbooks.findMany({
        where: { textbook_id: Number(id) },
        include: {
          plan_course_semesters: {
            include: {
              plan_courses: {
                include: {
                  training_plans: { include: { majors: true, training_levels: true } },
                  courses: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      prisma.classes.findMany({
        where: activeFilter,
        include: {
          colleges: { select: { name: true } },
          majors: { select: { name: true } },
          training_levels: true,
        },
      }),
    ]);

    const consecutiveMap = await buildConsecutiveTextbookMap(
      planTextbooks.map((pt) => ({
        plan_course_id: pt.plan_course_semesters.plan_course_id,
        textbook_id: pt.textbook_id,
        semester: pt.plan_course_semesters.semester,
      }))
    );

    const classResults = [];
    // B-14修复：使用复合去重键 (classId, courseId)，允许同一班级在不同课程中出现
    const addedClassCourseIds = new Set();

    for (const pt of planTextbooks) {
      const sem = pt.plan_course_semesters;
      const pc = sem.plan_courses;
      const plan = pc.training_plans;
      if (sem.semester < pc.start_semester || sem.semester > pc.end_semester) continue;

      const gradeForThisSemester = Math.ceil(sem.semester / 2);
      const enrollmentYear = semesterInfo.startYear - gradeForThisSemester + 1;
      const isConsecutive =
        consecutiveMap.get(`${pc.id}_${pt.textbook_id}`)?.has(sem.semester) ?? false;

      for (const cls of allClasses) {
        if (cls.enrollment_year !== enrollmentYear) continue;
        const compositeKey = `${cls.id}_${pc.course_id}`;
        if (addedClassCourseIds.has(compositeKey)) continue;

        // 使用统一的方案匹配逻辑（三级互斥，null-safe）
        if (!isClassMatchPlan(cls, plan)) continue;

        const calc = calcClassSemester(cls, semesterInfo);
        if (!calc || calc.currentSemesterNum !== sem.semester) continue;

        addedClassCourseIds.add(compositeKey);

        classResults.push({
          classId: cls.id,
          className: cls.name,
          collegeName: cls.colleges?.name || null,
          majorName: cls.majors?.name || null,
          trainingLevelName: cls.training_levels?.name || null,
          student_count: cls.student_count,
          grade: calc.grade,
          semester: sem.semester,
          courseName: pc.courses.name,
          is_required: pt.is_required,
          is_consecutive: isConsecutive,
        });
      }
    }

    const totalStudents = classResults.reduce((sum, c) => sum + c.student_count, 0);

    success(res, {
      textbook: {
        id: textbook.id,
        title: textbook.title,
        isbn: textbook.isbn,
        publisher: textbook.publisher,
        author: textbook.author,
        publish_date: textbook.publish_date,
      },
      semesterInfo: {
        label: semesterInfo.label,
      },
      classes: classResults,
      totalClasses: classResults.length,
      totalStudents,
    });
  } catch (e) {
    next(e);
  }
}
