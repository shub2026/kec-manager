import { prisma } from '../../lib/prisma.js';
import { TEXTBOOK_COHESION } from '../../constants/index.js';
import { isClassMatchPlan, findBestMatchPlan } from '../plan.service.js';
// 学期相关函数统一收敛至 semester.service.js
import { parseSemester, calcClassSemester, getActiveClassFilter } from '../semester.service.js';
import { dedupeTeachingUnits, dedupeClassUnits } from '../teaching-statistics.service.js';

// 重新导出 parseSemester，保持 `export { parseSemester, ... } from './arrange/queries.js'` 链路
export { parseSemester };

// === 模块级匹配工具函数 ===

export function isTextbookMatch(teacher, cls) {
  // P1-A 修复：教材匹配始终使用教师固有教材快照，不受本次分配累加污染
  const inherentIds = teacher.inherentTextbookIds ?? teacher.textbookIds;
  // 修复九轮：inherentIds 为空时返回 true（无教材约束 = 能教任何教材）
  // 根因：FALLBACK_EMPTY=true 让无排课记录教师 inherentTextbookIds=[]
  //       原逻辑 !inherentIds?.length → true → return false → Phase 1-3 全部屏蔽
  if (!cls.textbookIds?.length) return false; // 班级无教材，不需要匹配
  if (!inherentIds?.length) return true; // 教师无固有教材约束，能教任何教材
  return inherentIds.some((tid) => cls.textbookIds.includes(tid));
}

export function isCollegeEligible(t, cls) {
  if (!t.schedulingCollegeIds || t.schedulingCollegeIds.length === 0) return true;
  return t.schedulingCollegeIds.includes(cls.collegeId);
}

export function isLevelEligible(t, cls) {
  if (!t.schedulingLevelIds || t.schedulingLevelIds.length === 0) return true;
  // C-3 修复：教师有层次约束但班级无层次 → 不匹配（与 isTeacherEligible 语义对齐）
  if (!cls.trainingLevelId) return false;
  return t.schedulingLevelIds.includes(cls.trainingLevelId);
}

/**
 * 获取指定学期下开设某课程的班级列表（含课时、教材、学院等完整信息）
 */
export async function getClassesWithCourse(courseId, semesterStr, filters = {}) {
  const semesterInfo = parseSemester(semesterStr);
  if (!semesterInfo) throw new Error('学期格式错误');

  const planCourses = await prisma.plan_courses.findMany({
    // is_active：禁用课程不参与开课推导（周课时/教材），数据保留可在方案明细页恢复
    where: { course_id: Number(courseId), is_active: true },
    include: {
      training_plans: { include: { majors: true, training_levels: true, colleges: true } },
      courses: { select: { id: true, name: true, code: true, type: true } },
      plan_course_semesters: {
        include: {
          plan_textbooks: { include: { textbooks: { select: { id: true, title: true } } } },
        },
      },
    },
    // 显式排序，保证多方案匹配时周课时/教材取值确定，结果可复现
    orderBy: [{ training_plans: { sort_order: 'asc' } }, { id: 'asc' }],
  });

  // 使用统一的 getActiveClassFilter，传入查询学期（替代内部读取全局学期）
  // 注意：getActiveClassFilter 内部已自带 duration 缓存
  const classWhere = await getActiveClassFilter(semesterInfo);

  // 添加筛选条件
  if (filters.college) {
    classWhere.colleges = { name: filters.college };
  }
  if (filters.major) {
    classWhere.majors = { name: filters.major };
  }
  if (filters.training_level) {
    classWhere.training_levels = { name: filters.training_level };
  }
  if (filters.grade) {
    const gradeNum = parseInt(filters.grade);
    const enrollmentYear = semesterInfo.startYear - gradeNum + 1;
    // S-03 修复：改为范围匹配，保留所有 gte <= enrollmentYear 的学制条件
    // 原精确匹配(gte === enrollmentYear)会漏掉多学制场景下的合法班级
    if (Array.isArray(classWhere.OR)) {
      classWhere.OR = classWhere.OR.filter((o) => o.enrollment_year?.gte <= enrollmentYear);
    }
  }

  const allClasses = await prisma.classes.findMany({
    where: classWhere,
    include: {
      majors: { select: { id: true, name: true } },
      colleges: { select: { id: true, name: true } },
      training_levels: { select: { id: true, name: true } },
    },
  });

  // 口径统一修复：班级先做"全局最佳方案"匹配（与首页 computeOfferedCourses 同源），
  // 再看该方案是否包含本课程。原实现将候选限定为"含本课程的方案"，
  // 当最佳方案不含本课程时会回落到次优方案，导致班级开课推导与其适用方案脱节、
  // 跨页面课时汇总不一致（如转段-特例方案只开大学语文，查语文时回落五年制人培虚增课时）。
  const allPlans = await prisma.training_plans.findMany({
    where: { status: { not: 'archived' } }, // 归档方案不参与排课匹配
    select: {
      id: true,
      major_id: true,
      training_level_id: true,
      apply_from_year: true,
      apply_to_year: true,
      created_at: true,
    },
  });
  const planCourseByPlanId = new Map(planCourses.map((pc) => [pc.training_plans.id, pc]));

  // 构建自定义方案映射表（全局方案范围，与 computeOfferedCourses 一致）
  const classPlanMap = new Map();
  for (const cls of allClasses) {
    if (cls.custom_plan_id) {
      const customPlan = allPlans.find((p) => p.id === cls.custom_plan_id);
      if (customPlan) classPlanMap.set(cls.id, customPlan);
    }
  }

  const results = [];

  for (const cls of allClasses) {
    const bestPlan = findBestMatchPlan(cls, allPlans, classPlanMap);
    if (!bestPlan) continue;

    // 适用方案不含本课程 → 该班本学期不开设本课程（不再回落其他方案）
    const pc = planCourseByPlanId.get(bestPlan.id);
    if (!pc) continue;

    const calc = calcClassSemester(cls, semesterInfo);
    if (!calc) continue;
    // B2 修复：DB 层按学制范围筛选只卡下界，可能把非目标年级但学制更长/入学年更早的班误纳入。
    // 循环内按实际年级精确复核，确保只返回目标 grade 的班级（结果变少且正确）。
    if (filters.grade && calc.grade !== Number(filters.grade)) continue;

    // 与开课查询/首页口径一致：先判 start/end 覆盖，学期记录可缺省
    // （缺省时回退方案课程默认周课时/周数），避免"开课查询显示开课、排课页却不视为应排"的分歧
    if (pc.start_semester > calc.currentSemesterNum || pc.end_semester < calc.currentSemesterNum) {
      continue;
    }
    const semRecord = pc.plan_course_semesters.find((s) => s.semester === calc.currentSemesterNum);

    const weeklyHours = semRecord?.weekly_hours ?? pc.weekly_hours;
    // 过滤周课时为 0 的课程（本学期暂不开课）
    if (weeklyHours <= 0) continue;
    // B5 修复：weekly_hours 存在而 weeks_count 与 weeks_per_semester 同时缺失时，
    // 原 `weeklyHours * null` 会得到 NaN。补充 18 周兜底默认值，消除 NaN。
    const weeksCount = semRecord?.weeks_count ?? pc.weeks_per_semester ?? 18;
    const textbooks = (semRecord?.plan_textbooks || []).map((pt) => pt.textbooks);

    results.push({
      classId: cls.id,
      className: cls.name,
      collegeId: cls.college_id,
      collegeName: cls.colleges?.name || null,
      majorId: cls.major_id,
      majorName: cls.majors?.name || null,
      trainingLevelId: cls.training_level_id,
      trainingLevelName: cls.training_levels?.name || null,
      combinationId: cls.combination_id,
      grade: calc.grade,
      enrollmentYear: cls.enrollment_year,
      studentCount: cls.student_count || 0,
      // 回退语义：semRecord 缺失时回退到当前学期编号（与 planHasOfferedCourses 谓词一致）
      currentSemester: semRecord?.semester ?? calc.currentSemesterNum,
      weeklyHours,
      weeksCount,
      totalHours: weeklyHours * weeksCount,
      textbooks,
    });
  }

  return results;
}

/**
 * 全部课程的教学安排概览聚合（按课程维度）
 *
 * 一次查询全部安排并按课程分组，仅对当前应排班级内的安排做聚合；
 * 课时一律以当前培养方案 weeklyHours 为准（非安排行快照），避免方案调整后快照过期。
 * 供教学安排页概览卡片（getCourseOverview）与首页课时概览（getDashboardInsights courseStats）共用，
 * 保证两处"总课时/班级数/教师数"口径完全一致。
 *
 * @param {string} semester 学期字符串 YYYY-YYYY-N
 * @param {Function} [getClassesFn=getClassesWithCourse] 应排班级查询函数，默认用真实实现；测试可注入 mock
 */
export async function getCourseOverviewAggregate(semester, getClassesFn = getClassesWithCourse) {
  const courses = await prisma.courses.findMany({
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, type: true },
  });

  // 一次性查询本学期全部安排，按课程分组，后续仅对当前应排班级内的安排做聚合
  const assignments = await prisma.teaching_assignments.findMany({
    where: { semester },
    select: {
      course_id: true,
      class_id: true,
      teacher_id: true,
      weekly_hours: true,
      is_locked: true,
      is_inherent: true,
    },
  });
  const assignmentsByCourse = new Map();
  for (const a of assignments) {
    if (!assignmentsByCourse.has(a.course_id)) assignmentsByCourse.set(a.course_id, []);
    assignmentsByCourse.get(a.course_id).push(a);
  }

  // 逐课程计算应排班级与总课时（与 getCourseClasses 同一链路，口径一致）
  // 修复：assignedHours 不再取安排行的快照 weekly_hours 求和——
  // 培养方案周课时调整后快照会过期，导致概览剩余课时变负而明细页正常；
  // 现仅统计当前应排班级内的安排，课时一律以当前方案 weeklyHours 为准。
  // 合班去重：应排班级与安排行均逐班展开（成员班各带一份课时），
  // 课时聚合按逻辑教学单元去重（dedupeClassUnits），合班单元只计 1 次；
  // 班级计数字段维持逐班口径，服务"已安排 X/Y 个班级"的排课工作流展示。
  const overview = [];
  for (const course of courses) {
    const classes = await getClassesFn(course.id, semester);
    const { units, classUnitMap } = dedupeClassUnits(classes);
    const totalCourseHours = units.reduce((sum, u) => sum + u.weeklyHours, 0);
    const classHourMap = new Map(classes.map((c) => [c.classId, c.weeklyHours]));
    const validAssignments = (assignmentsByCourse.get(course.id) || []).filter((a) =>
      classHourMap.has(a.class_id)
    );
    const teacherIds = new Set(validAssignments.map((a) => a.teacher_id));
    // 已排课时按单元去重：合班单元的 N 行展开安排只计 1 次单元课时
    const assignedUnitKeys = new Set(
      validAssignments.map((a) => classUnitMap.get(a.class_id)).filter(Boolean)
    );
    const assignedHours = units
      .filter((u) => assignedUnitKeys.has(u.key))
      .reduce((sum, u) => sum + u.weeklyHours, 0);
    overview.push({
      courseId: course.id,
      courseName: course.name,
      courseType: course.type,
      teacherCount: teacherIds.size,
      totalClasses: classes.length,
      assignedCount: validAssignments.length,
      lockedCount: validAssignments.filter((a) => a.is_locked).length,
      inherentCount: validAssignments.filter((a) => a.is_inherent).length,
      totalCourseHours,
      assignedHours,
      remainingHours: totalCourseHours - assignedHours,
    });
  }

  return overview;
}

/**
 * 获取教师列表（含当前学期已安排课时统计）
 */
export async function getTeachersForCourse(courseId, semesterStr) {
  const teachers = await prisma.teachers.findMany({
    where: {
      status: 'active',
      courses: { some: { course_id: Number(courseId) } },
    },
    include: {
      courses: { include: { course: { select: { id: true, name: true } } } },
      scheduling_colleges: { select: { college_id: true } },
      scheduling_levels: { include: { training_level: { select: { id: true, name: true } } } },
    },
    orderBy: { sort_order: 'asc' },
  });

  // B1 修复（High）：合班教学时同一节合班课在每个成员班各存一行 teaching_assignments，
  // 若直接对全部行 groupBy 求和，会把同一节合班课计 N 次 → 教师周课时虚高 N 倍，
  // 引发超限告警误报、错误拒绝合理排课，且与 dashboard/导出统计口径打架。
  // 改用 dedupeTeachingUnits 按 (combination_id??class_id, course_id, teacher_id) 去重后再聚合，
  // 使排课界面与 dashboard/导出对齐。
  // 审计修复：classCount 统一为“逻辑教学班”口径（合班计 1），
  // 与 getArrangeList/教学统计页的 totalClassCount 一致，消除双口径。
  const allSemesterAssignments = await prisma.teaching_assignments.findMany({
    where: { semester: semesterStr },
    select: {
      teacher_id: true,
      course_id: true,
      weekly_hours: true,
      class_id: true,
      class: { select: { combination_id: true } },
    },
  });
  const dedupedUnits = dedupeTeachingUnits(allSemesterAssignments);
  const workloadMap = new Map();
  const classCountMap = new Map();
  const courseAssignmentMap = new Map();
  const targetCourseId = Number(courseId);
  for (const u of dedupedUnits) {
    const tid = u.representative.teacher_id;
    const weekly = u.weeklyHours || 0;
    workloadMap.set(tid, (workloadMap.get(tid) || 0) + weekly);
    // 审计修复：每个逻辑教学单元计 1（合班=1 个逻辑教学班），不再按成员班数累加
    classCountMap.set(tid, (classCountMap.get(tid) || 0) + 1);
    if (u.representative.course_id === targetCourseId) {
      const cur = courseAssignmentMap.get(tid) || { hours: 0, classCount: 0 };
      cur.hours += weekly;
      cur.classCount += 1;
      courseAssignmentMap.set(tid, cur);
    }
  }

  // 查询每个教师实际授课学院和授课层次（合并为单次查询，避免重复扫描 teaching_assignments）
  // H-6: 添加 teacher_id 过滤，避免拉取整个学期的排课数据
  const relevantTeacherIds = teachers.map((t) => t.id);
  const teacherAssignmentsWithCollegeAndLevel = await prisma.teaching_assignments.findMany({
    where: { semester: semesterStr, teacher_id: { in: relevantTeacherIds } },
    select: {
      teacher_id: true,
      class: {
        select: {
          colleges: { select: { id: true, name: true } },
          training_level_id: true,
        },
      },
    },
  });
  const teacherCollegeMap = new Map();
  const teacherLevelMap = new Map();
  for (const a of teacherAssignmentsWithCollegeAndLevel) {
    // 构建学院映射
    if (a.class?.colleges) {
      if (!teacherCollegeMap.has(a.teacher_id)) {
        teacherCollegeMap.set(a.teacher_id, new Map());
      }
      teacherCollegeMap.get(a.teacher_id).set(a.class.colleges.id, a.class.colleges);
    }
    // 构建培养层次映射
    if (a.class?.training_level_id) {
      if (!teacherLevelMap.has(a.teacher_id)) {
        teacherLevelMap.set(a.teacher_id, new Set());
      }
      teacherLevelMap.get(a.teacher_id).add(a.class.training_level_id);
    }
  }

  // 批量获取培养层次名称
  const allLevelIds = new Set();
  for (const levelSet of teacherLevelMap.values()) {
    for (const lid of levelSet) allLevelIds.add(lid);
  }
  const levelRows =
    allLevelIds.size > 0
      ? await prisma.training_levels.findMany({
          where: { id: { in: [...allLevelIds] } },
          select: { id: true, name: true },
        })
      : [];
  const levelNameMap = new Map(levelRows.map((l) => [l.id, l.name]));

  // 高-4修复：查询教师在该学期的全部排课记录（含其他课程），构建完整教材上下文
  // 原实现仅查当前课程的 assignments，导致非预览模式下跨课程教材内聚失效
  // 修复后：非预览模式从 DB 读取全部课程安排（已写入 DB），预览模式由 globalTextbookMap 补充
  const teacherTextbookMap = new Map();

  // 查询相关教师在该学期的全部排课记录（跨课程）
  const allTeacherAssignments = await prisma.teaching_assignments.findMany({
    where: {
      semester: semesterStr,
      teacher_id: { in: relevantTeacherIds },
    },
    select: {
      teacher_id: true,
      class_id: true,
      course_id: true,
    },
  });

  // 获取当前课程在培养方案中的教材（作为未分配教师的兜底数据）
  const planCoursesForTextbooks = await prisma.plan_courses.findMany({
    where: { course_id: Number(courseId), is_active: true },
    include: {
      plan_course_semesters: {
        include: {
          plan_textbooks: { select: { textbook_id: true } },
        },
      },
    },
  });
  const fallbackTextbookSet = new Set();
  for (const pc of planCoursesForTextbooks) {
    for (const sem of pc.plan_course_semesters) {
      for (const pt of sem.plan_textbooks) {
        fallbackTextbookSet.add(pt.textbook_id);
      }
    }
  }

  if (allTeacherAssignments.length > 0) {
    const semesterInfo = parseSemester(semesterStr);

    // 收集所有涉及的课程 ID 和班级 ID
    const courseIdsInAssignments = [...new Set(allTeacherAssignments.map((a) => a.course_id))];
    const classIdsInAssignments = [...new Set(allTeacherAssignments.map((a) => a.class_id))];

    // 批量查询所有涉及课程的 plan_courses（含方案和学期教材）
    const allPlanCoursesRaw = await prisma.plan_courses.findMany({
      where: { course_id: { in: courseIdsInAssignments }, is_active: true },
      include: {
        training_plans: {
          select: {
            id: true,
            major_id: true,
            training_level_id: true,
            status: true, // 供归档方案过滤（一对一 include 无法查询层过滤）
            // 供 findBestMatchPlan 按班级入学年份过滤同维度多版本方案
            apply_from_year: true,
            apply_to_year: true,
          },
        },
        plan_course_semesters: {
          include: {
            plan_textbooks: { select: { textbook_id: true } },
          },
        },
      },
      // P1-6 修复：补 orderBy，保证多方案匹配时教材取值确定、与 getClassesWithCourse 口径一致
      orderBy: [{ training_plans: { sort_order: 'asc' } }, { id: 'asc' }],
    });
    // 归档方案不参与排课教材推导
    const allPlanCourses = allPlanCoursesRaw.filter(
      (pc) => pc.training_plans?.status !== 'archived'
    );
    // 按 course_id 分组
    const planCoursesByCourse = new Map();
    for (const pc of allPlanCourses) {
      if (!planCoursesByCourse.has(pc.course_id)) {
        planCoursesByCourse.set(pc.course_id, []);
      }
      planCoursesByCourse.get(pc.course_id).push(pc);
    }

    // 查询所有涉及的班级信息
    const allClassesForTextbooks = await prisma.classes.findMany({
      where: { id: { in: classIdsInAssignments } },
      select: {
        id: true,
        custom_plan_id: true,
        major_id: true,
        training_level_id: true,
        enrollment_year: true,
        duration_years: true,
      },
    });
    const classInfoMap = new Map(allClassesForTextbooks.map((c) => [c.id, c]));

    // 构建 (class_id, course_id) → [textbook_ids] 缓存
    const classCourseTextbookMap = new Map();

    for (const a of allTeacherAssignments) {
      const key = `${a.class_id}:${a.course_id}`;
      if (classCourseTextbookMap.has(key)) continue;

      const cls = classInfoMap.get(a.class_id);
      if (!cls) continue;

      const calc = semesterInfo ? calcClassSemester(cls, semesterInfo) : null;
      const clsSemesterNum = calc?.currentSemesterNum;

      const textbookIds = new Set();
      const pcs = planCoursesByCourse.get(a.course_id) || [];

      // 高-5修复：使用 findBestMatchPlan 选定最佳方案，与 getClassesWithCourse 口径一致
      const candidatePlans = pcs.map((pc) => pc.training_plans).filter(Boolean);
      // P1-1-派生修复：构建 classPlanMap 并传给 findBestMatchPlan，与 getClassesWithCourse 口径一致
      const classPlanMap = new Map();
      if (cls.custom_plan_id) {
        const customPlan = candidatePlans.find((p) => p.id === cls.custom_plan_id);
        if (customPlan) classPlanMap.set(cls.id, customPlan);
      }
      const bestPlan = findBestMatchPlan(cls, candidatePlans, classPlanMap);

      for (const pc of pcs) {
        const plan = pc.training_plans;
        if (bestPlan && plan.id !== bestPlan.id) continue;
        if (!isClassMatchPlan(cls, plan)) continue;
        for (const sem of pc.plan_course_semesters) {
          if (clsSemesterNum == null || sem.semester !== clsSemesterNum) continue;
          if (sem.semester < pc.start_semester || sem.semester > pc.end_semester) continue;
          for (const pt of sem.plan_textbooks) {
            textbookIds.add(pt.textbook_id);
          }
        }
      }
      classCourseTextbookMap.set(key, [...textbookIds]);
    }

    // 构建 teacherTextbookMap（跨课程累计）
    for (const a of allTeacherAssignments) {
      if (!teacherTextbookMap.has(a.teacher_id)) {
        teacherTextbookMap.set(a.teacher_id, new Set());
      }
      const key = `${a.class_id}:${a.course_id}`;
      const classTextbooks = classCourseTextbookMap.get(key);
      if (classTextbooks) {
        for (const tid of classTextbooks) {
          teacherTextbookMap.get(a.teacher_id).add(tid);
        }
      }
    }
  }

  // 快照：仅含实际已安排教师的教材（fallback 之前）
  const assignedOnlyTextbookMap = new Map();
  for (const [tid, idSet] of teacherTextbookMap) {
    assignedOnlyTextbookMap.set(tid, new Set(idSet));
  }

  // 批量获取已安排教材的标题
  const allAssignedTextbookIds = new Set();
  for (const idSet of assignedOnlyTextbookMap.values()) {
    for (const id of idSet) allAssignedTextbookIds.add(id);
  }
  const assignedTextbookRows =
    allAssignedTextbookIds.size > 0
      ? await prisma.textbooks.findMany({
          where: { id: { in: [...allAssignedTextbookIds] } },
          select: { id: true, title: true },
        })
      : [];
  const textbookTitleMap = new Map(assignedTextbookRows.map((t) => [t.id, t.title]));

  const fallbackTextbookIds = TEXTBOOK_COHESION.FALLBACK_EMPTY
    ? [] // 修复1：收紧兜底推导 —— 无排课记录教师教材为空，避免 isTextbookMatch 对新教师全通过
    : [...fallbackTextbookSet];
  for (const t of teachers) {
    if (!teacherTextbookMap.has(t.id)) {
      teacherTextbookMap.set(t.id, new Set(fallbackTextbookIds));
    }
  }

  return teachers.map((t) => {
    const inherentTextbookIds = [...(teacherTextbookMap.get(t.id) || [])];
    const assignedIds = [...new Set(assignedOnlyTextbookMap.get(t.id) || [])];
    const assignedTextbooks = assignedIds.map((id) => ({
      id,
      title: textbookTitleMap.get(id) || `教材#${id}`,
    }));

    return {
      id: t.id,
      name: t.name,
      gender: t.gender,
      personnelType: t.personnel_type,
      remark: t.remark,
      defaultWeeklyHours: t.default_weekly_hours,
      courseList: t.courses.map((tc) => tc.course),
      collegeList: [...(teacherCollegeMap.get(t.id)?.values() || [])],
      schedulingCollegeIds: t.scheduling_colleges.map((sc) => sc.college_id),
      schedulingLevelIds: t.scheduling_levels.map((sl) => sl.training_level.id),
      // 优先使用实际授课层次，如果为空则使用意向设置
      trainingLevelList: (() => {
        const actualLevelIds = teacherLevelMap.get(t.id);
        if (actualLevelIds && actualLevelIds.size > 0) {
          return [...actualLevelIds].map((lid) => ({ id: lid, name: levelNameMap.get(lid) }));
        }
        return t.scheduling_levels.map((sl) => sl.training_level);
      })(),
      textbookIds: [...inherentTextbookIds],
      inherentTextbookIds,
      assignedTextbooks,
      // F1 修复：以 DB 已落库安排（assignedOnlyTextbookMap）作为种子，
      // 使 H4 教材硬上限从排课开始即计入跨课程教材，对齐全学期累计口径。
      // 预览批量模式下 globalTextbookMap 会在 autoArrange 内覆盖此值（含前序课程虚拟累计）；
      // 非预览批量模式下 DB 已在每门课程落库后更新，种子天然生效。
      assignedTextbookIds: new Set(assignedOnlyTextbookMap.get(t.id) || []),
      assignedCollegeIds: new Set(),
      totalWeeklyHours: workloadMap.get(t.id) || 0,
      totalClassCount: classCountMap.get(t.id) || 0,
      courseHours: courseAssignmentMap.get(t.id)?.hours || 0,
      courseClassCount: courseAssignmentMap.get(t.id)?.classCount || 0,
      // 只带一本教材开关（教师个人维度硬约束，供排课链路覆写教材上限）
      singleTextbookOnly: !!t.single_textbook_only,
    };
  });
}
