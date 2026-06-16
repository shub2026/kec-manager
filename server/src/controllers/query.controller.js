import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { getCurrentSemesterInfo, getSemesterInfoFromRequest } from '../services/settings.service.js';
import { getActiveClassFilter } from '../services/class.service.js';
import { findBestMatchPlan } from '../services/plan.service.js';

/**
 * 计算班级在当前全局学期下的相对学期序号
 */
function calcClassSemester(cls, semesterInfo) {
  const grade = semesterInfo.startYear - cls.enrollment_year + 1;
  if (grade < 1 || grade > cls.duration_years) return null;
  const currentSemesterNum = (grade - 1) * 2 + semesterInfo.semesterIndex;
  return { grade, currentSemesterNum };
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

    const { majorId, collegeId, trainingLevelId, enrollmentYear, grade, page, pageSize } = req.query;
    const pageNum = page ? Number(page) : 1;
    const pageSizeNum = pageSize ? Number(pageSize) : 50;
    
    // 第一步：获取所有培养方案，确定哪些班级可以关联到方案
    const allPlans = await prisma.training_plans.findMany({
      select: {
        id: true,
        major_id: true,
        college_id: true,
        training_level_id: true,
      },
    });

    // 构建可匹配的班级条件：必须能关联到至少一个培养方案
    const classWithPlanConditions = [];
    
    // 条件1：班级有自定义方案
    classWithPlanConditions.push({ custom_plan_id: { not: null } });
    
    // 条件2：班级的专业ID能匹配某个方案
    const majorIdsWithPlans = [...new Set(allPlans.filter(p => p.major_id).map(p => p.major_id))];
    if (majorIdsWithPlans.length > 0) {
      classWithPlanConditions.push({ major_id: { in: majorIdsWithPlans } });
    }
    
    // 条件3：班级的培养层次ID能匹配某个方案
    const levelIdsWithPlans = [...new Set(allPlans.filter(p => p.training_level_id).map(p => p.training_level_id))];
    if (levelIdsWithPlans.length > 0) {
      classWithPlanConditions.push({ training_level_id: { in: levelIdsWithPlans } });
    }

    // 基础过滤：在读班级 + 能关联到培养方案
    const activeFilter = await getActiveClassFilter();
    const baseWhere = {
      AND: [
        activeFilter,
        { OR: classWithPlanConditions },
      ],
    };

    // 添加额外的筛选条件
    const extraConditions = {};
    if (majorId) extraConditions.major_id = Number(majorId);
    if (collegeId) extraConditions.college_id = Number(collegeId);
    if (trainingLevelId) extraConditions.training_level_id = Number(trainingLevelId);
    if (enrollmentYear) extraConditions.enrollment_year = Number(enrollmentYear);

    const classWhere = Object.keys(extraConditions).length > 0
      ? { AND: [baseWhere, extraConditions] }
      : baseWhere;

    const totalClassesCount = await prisma.classes.count({ where: classWhere });

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
                      include: { textbooks: { select: { id: true, title: true, isbn: true, publisher: true } } },
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
    const classPlanMap = new Map();

    for (const cls of classes) {
      const calc = calcClassSemester(cls, semesterInfo);
      if (!calc) continue;
      if (cls.custom_plan_id) {
        classPlanMap.set(cls.id, cls.training_plans);
      } else {
        if (cls.major_id) majorPlanIds.add(cls.major_id);
        if (cls.training_level_id) levelPlanIds.add(cls.training_level_id);
      }
    }

    const matchingPlans = await prisma.training_plans.findMany({
      where: {
        OR: [
          { major_id: { in: [...majorPlanIds] } },
          { training_level_id: { in: [...levelPlanIds] } },
        ],
      },
      include: {
        plan_courses: {
          include: {
            courses: { select: { id: true, name: true, type: true } },
            plan_course_semesters: {
              include: {
                plan_textbooks: {
                  include: { textbooks: { select: { id: true, title: true, isbn: true, publisher: true } } },
                },
              },
            },
          },
        },
      },
    });

    const results = [];

    for (const cls of classes) {
      const calc = calcClassSemester(cls, semesterInfo);
      if (!calc) continue;

      if (grade && calc.grade !== Number(grade)) continue;

      const plan = findBestMatchPlan(cls, matchingPlans, classPlanMap);
      if (!plan) {
        // 理论上不应该到这里，因为前面已经过滤了
        console.log(`[WARN] 班级 ${cls.name} 虽满足前置条件但无匹配方案, major_id=${cls.major_id}, level_id=${cls.training_level_id}`);
        continue;
      }

      const planCourses = plan.plan_courses.filter(
        (pc) => pc.start_semester <= calc.currentSemesterNum && pc.end_semester >= calc.currentSemesterNum
      );

      if (planCourses.length === 0) {
        console.log(`[DEBUG] 班级 ${cls.name} 方案 ${plan.name} 无当前学期课程, 当前学期=${calc.currentSemesterNum}`);
        continue;
      }

      const courses = planCourses.map((pc) => {
        const semRecord = pc.plan_course_semesters?.find(s => s.semester === calc.currentSemesterNum);
        return {
          course_id: pc.courses.id,
          courseName: pc.courses.name,
          courseType: pc.courses.type,
          weekly_hours: semRecord?.weekly_hours || pc.weekly_hours,
          weeks_per_semester: semRecord?.weeks_count || pc.weeks_per_semester,
          totalHoursThisSemester: (semRecord?.weekly_hours || pc.weekly_hours) * (semRecord?.weeks_count || pc.weeks_per_semester),
          textbooks: (semRecord?.plan_textbooks || []).map((pt) => ({
            id: pt.textbooks.id,
            title: pt.textbooks.title,
            isbn: pt.textbooks.isbn,
            publisher: pt.textbooks.publisher,
            isRequired: pt.is_required,
          })),
        };
      });

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

    console.log(`[DEBUG] querySemester 最终返回 ${results.length} 个班级（总计符合条件的班级数：${totalClassesCount}）`);

    success(res, {
      semesterInfo: {
        label: semesterInfo.label,
        ...semesterInfo,
      },
      totalClasses: results.length,
      total: totalClassesCount,
      page: pageNum,
      pageSize: pageSizeNum,
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

    const activeFilter = await getActiveClassFilter();
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
          majors: { select: { name: true } },
          training_levels: true,
        },
      }),
    ]);

    const classResults = [];

    for (const pt of planTextbooks) {
      const sem = pt.plan_course_semesters;
      const pc = sem.plan_courses;
      const plan = pc.training_plans;
      if (sem.semester < pc.start_semester || sem.semester > pc.end_semester) continue;

      const gradeForThisSemester = Math.ceil(sem.semester / 2);
      const enrollmentYear = semesterInfo.startYear - gradeForThisSemester + 1;

      for (const cls of allClasses) {
        if (cls.enrollment_year !== enrollmentYear) continue;
        
        // 使用统一的方案匹配逻辑
        let isMatch = false;
        if (cls.custom_plan_id === plan.id) {
          isMatch = true;
        } else if (!cls.custom_plan_id && cls.major_id === plan.major_id) {
          isMatch = true;
        } else if (!cls.custom_plan_id && cls.training_level_id === plan.training_level_id) {
          isMatch = true;
        }
        
        if (!isMatch) continue;
        
        const calc = calcClassSemester(cls, semesterInfo);
        if (!calc || calc.currentSemesterNum !== sem.semester) continue;

        classResults.push({
          classId: cls.id,
          className: cls.name,
          majorName: cls.majors?.name || null,
          trainingLevelName: cls.training_levels?.name || null,
          student_count: cls.student_count,
          grade: calc.grade,
          semester: sem.semester,
          courseName: pc.courses.name,
          is_required: pt.is_required,
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

/**
 * GET /api/query/textbooks - 所有教材使用情况概览
 */
export async function queryAllTextbooksUsage(req, res, next) {
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

    const activeFilter = await getActiveClassFilter();
    const [textbooks, allClasses] = await Promise.all([
      prisma.textbooks.findMany({
        include: {
          plan_textbooks: {
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
          },
        },
        orderBy: { id: 'asc' },
      }),
      prisma.classes.findMany({ where: activeFilter }),
    ]);

    const results = [];

    for (const tb of textbooks) {
      const usedClasses = new Set();

      for (const pt of tb.plan_textbooks) {
        const sem = pt.plan_course_semesters;
        const pc = sem.plan_courses;
        const plan = pc.training_plans;
        if (sem.semester < pc.start_semester || sem.semester > pc.end_semester) continue;

        const gradeForThisSemester = Math.ceil(sem.semester / 2);
        const enrollmentYear = semesterInfo.startYear - gradeForThisSemester + 1;

        for (const c of allClasses) {
          if (c.enrollment_year !== enrollmentYear) continue;
          
          // 判断班级是否匹配培养方案
          let isMatch = false;
          if (c.custom_plan_id === plan.id) {
            isMatch = true;
          } else if (!c.custom_plan_id && c.major_id === plan.major_id) {
            isMatch = true;
          } else if (!c.custom_plan_id && c.training_level_id === plan.training_level_id) {
            isMatch = true;
          }
          
          if (isMatch) {
            usedClasses.add(c.id);
          }
        }
      }

      let totalStudents = 0;
      for (const classId of usedClasses) {
        const cls = allClasses.find(c => c.id === classId);
        if (cls) {
          totalStudents += cls.student_count;
        }
      }

      results.push({
        id: tb.id,
        title: tb.title,
        isbn: tb.isbn,
        publisher: tb.publisher,
        classCount: usedClasses.size,
        totalStudents,
      });
    }

    success(res, results);
  } catch (e) { 
    next(e); 
  }
}
