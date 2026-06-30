import { prisma } from '../../lib/prisma.js';
import { TEXTBOOK_COHESION } from '../../constants/index.js';
import { isClassMatchPlan, findBestMatchPlan } from '../plan.service.js';
// 学期相关函数统一收敛至 semester.service.js
import { parseSemester, calcClassSemester, getActiveClassFilter } from '../semester.service.js';

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
  return cls.trainingLevelId && t.schedulingLevelIds.includes(cls.trainingLevelId);
}

/**
 * 获取指定学期下开设某课程的班级列表（含课时、教材、学院等完整信息）
 */
export async function getClassesWithCourse(courseId, semesterStr, filters = {}) {
  const semesterInfo = parseSemester(semesterStr);
  if (!semesterInfo) throw new Error('学期格式错误');

  const planCourses = await prisma.plan_courses.findMany({
    where: { course_id: Number(courseId) },
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

  // 高-5修复：对每个班级使用 findBestMatchPlan 选定唯一最佳方案
  // 原实现按 sort_order 迭代+去重取首个匹配，可能与 findBestMatchPlan 的 major>level 优先级不一致
  const candidatePlans = planCourses.map((pc) => pc.training_plans).filter(Boolean);
  const planCourseByPlanId = new Map(planCourses.map((pc) => [pc.training_plans.id, pc]));

  // 构建自定义方案映射表（供 findBestMatchPlan 使用）
  const classPlanMap = new Map();
  for (const cls of allClasses) {
    if (cls.custom_plan_id) {
      const customPlan = candidatePlans.find((p) => p.id === cls.custom_plan_id);
      if (customPlan) classPlanMap.set(cls.id, customPlan);
    }
  }

  const results = [];

  for (const cls of allClasses) {
    const bestPlan = findBestMatchPlan(cls, candidatePlans, classPlanMap);
    if (!bestPlan) continue;

    const pc = planCourseByPlanId.get(bestPlan.id);
    if (!pc) continue;

    const calc = calcClassSemester(cls, semesterInfo);
    if (!calc) continue;

    // 找到班级当前学期的学期记录
    const semRecord = pc.plan_course_semesters.find(
      (s) =>
        s.semester === calc.currentSemesterNum &&
        s.semester >= pc.start_semester &&
        s.semester <= pc.end_semester
    );
    if (!semRecord) continue;

    const weeklyHours = semRecord.weekly_hours ?? pc.weekly_hours;
    const weeksCount = semRecord.weeks_count ?? pc.weeks_per_semester;
    const textbooks = semRecord.plan_textbooks.map((pt) => pt.textbooks);

    results.push({
      classId: cls.id,
      className: cls.name,
      collegeId: cls.college_id,
      collegeName: cls.colleges?.name || null,
      majorId: cls.major_id,
      majorName: cls.majors?.name || null,
      trainingLevelId: cls.training_level_id,
      trainingLevelName: cls.training_levels?.name || null,
      grade: calc.grade,
      enrollmentYear: cls.enrollment_year,
      studentCount: cls.student_count || 0,
      currentSemester: semRecord.semester,
      weeklyHours,
      weeksCount,
      totalHours: weeklyHours * weeksCount,
      textbooks,
    });
  }

  return results;
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

  // 查询每个教师当前学期已安排的总课时和班级数（合并查询）
  const teacherWorkloadStats = await prisma.teaching_assignments.groupBy({
    by: ['teacher_id'],
    where: { semester: semesterStr },
    _sum: { weekly_hours: true },
    _count: { id: true },
  });
  const workloadMap = new Map(
    teacherWorkloadStats.map((w) => [w.teacher_id, w._sum.weekly_hours || 0])
  );
  const classCountMap = new Map(teacherWorkloadStats.map((w) => [w.teacher_id, w._count.id || 0]));

  // 查询每个教师在当前课程下的安排
  const courseAssignments = await prisma.teaching_assignments.groupBy({
    by: ['teacher_id'],
    where: { semester: semesterStr, course_id: Number(courseId) },
    _sum: { weekly_hours: true },
    _count: { id: true },
  });
  const courseAssignmentMap = new Map(
    courseAssignments.map((w) => [
      w.teacher_id,
      { hours: w._sum.weekly_hours || 0, classCount: w._count.id || 0 },
    ])
  );

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
    where: { course_id: Number(courseId) },
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
    const allPlanCourses = await prisma.plan_courses.findMany({
      where: { course_id: { in: courseIdsInAssignments } },
      include: {
        training_plans: { select: { id: true, major_id: true, training_level_id: true } },
        plan_course_semesters: {
          include: {
            plan_textbooks: { select: { textbook_id: true } },
          },
        },
      },
      // P1-6 修复：补 orderBy，保证多方案匹配时教材取值确定、与 getClassesWithCourse 口径一致
      orderBy: [{ training_plans: { sort_order: 'asc' } }, { id: 'asc' }],
    });
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
      qualificationType: t.qualification_type,
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
      assignedTextbookIds: new Set(),
      assignedCollegeIds: new Set(),
      totalWeeklyHours: workloadMap.get(t.id) || 0,
      totalClassCount: classCountMap.get(t.id) || 0,
      courseHours: courseAssignmentMap.get(t.id)?.hours || 0,
      courseClassCount: courseAssignmentMap.get(t.id)?.classCount || 0,
    };
  });
}
