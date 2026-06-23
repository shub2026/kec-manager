import { prisma } from '../../lib/prisma.js';
import { TEXTBOOK_COHESION } from '../../constants/index.js';
import { isClassMatchPlan } from '../plan.service.js';

/**
 * 计算班级在指定学期下的相对学期序号
 */
function calcClassSemester(cls, semesterInfo) {
  const grade = semesterInfo.startYear - cls.enrollment_year + 1;
  if (grade < 1 || grade > cls.duration_years) return null;
  const currentSemesterNum = (grade - 1) * 2 + semesterInfo.semesterIndex;
  return { grade, currentSemesterNum };
}

/**
 * 解析学期字符串 "2025-2026-1" → { startYear, endYear, semesterIndex, label }
 * 仅支持学期索引：1（秋季）、2（春季）；calcClassSemester 按 2 学期/年计算
 */
export function parseSemester(semesterStr) {
  if (!semesterStr) return null;
  const parts = semesterStr.split('-');
  if (parts.length !== 3) return null;
  const startYear = parseInt(parts[0]);
  const endYear = parseInt(parts[1]);
  const semesterIndex = parseInt(parts[2]);
  if (isNaN(startYear) || isNaN(endYear) || semesterIndex < 1 || semesterIndex > 2) return null;
  return {
    startYear,
    endYear,
    semesterIndex,
    label: semesterStr,
  };
}

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

  const durations = await prisma.classes.findMany({
    select: { duration_years: true },
    distinct: ['duration_years'],
  });
  const durationValues = durations.map((d) => d.duration_years).filter((d) => d != null);

  // 构建班级查询条件
  const classWhere = {
    OR: durationValues.map((d) => ({
      duration_years: d,
      is_left_school: false,
      enrollment_year: { gte: semesterInfo.startYear - d + 1 },
    })),
  };
  
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
    classWhere.OR = classWhere.OR.filter(o => o.enrollment_year.gte <= enrollmentYear && o.enrollment_year.gte >= enrollmentYear);
  }

  const allClasses = await prisma.classes.findMany({
    where: classWhere,
    include: {
      majors: { select: { id: true, name: true } },
      colleges: { select: { id: true, name: true } },
      training_levels: { select: { id: true, name: true } },
    },
  });

  const results = [];
  const addedClassIds = new Set();

  const classesByYear = new Map();
  for (const cls of allClasses) {
    if (!classesByYear.has(cls.enrollment_year)) {
      classesByYear.set(cls.enrollment_year, []);
    }
    classesByYear.get(cls.enrollment_year).push(cls);
  }

  for (const pc of planCourses) {
    const plan = pc.training_plans;

    const semRecords = pc.plan_course_semesters.filter(
      (s) => s.semester >= pc.start_semester && s.semester <= pc.end_semester
    );

    for (const sem of semRecords) {
      const gradeForThisSemester = Math.ceil(sem.semester / 2);
      const enrollmentYear = semesterInfo.startYear - gradeForThisSemester + 1;

      const yearClasses = classesByYear.get(enrollmentYear) || [];
      for (const cls of yearClasses) {
        if (addedClassIds.has(cls.id)) continue;

        // 使用统一的三级互斥匹配，避免 null===null 误匹配
        if (!isClassMatchPlan(cls, plan)) continue;

        const calc = calcClassSemester(cls, semesterInfo);
        if (!calc || calc.currentSemesterNum !== sem.semester) continue;

        addedClassIds.add(cls.id);

        const weeklyHours = sem.weekly_hours ?? pc.weekly_hours;
        const weeksCount = sem.weeks_count ?? pc.weeks_per_semester;
        const textbooks = sem.plan_textbooks.map((pt) => pt.textbooks);

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
          currentSemester: sem.semester,
          weeklyHours,
          weeksCount,
          totalHours: weeklyHours * weeksCount,
          textbooks,
        });
      }
    }
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

  // 查询每个教师实际授课学院（从授课安排中提取，去重）
  // H-6: 添加 teacher_id 过滤，避免拉取整个学期的排课数据
  const relevantTeacherIds = teachers.map((t) => t.id);
  const teacherAssignmentsWithCollege = await prisma.teaching_assignments.findMany({
    where: { semester: semesterStr, teacher_id: { in: relevantTeacherIds } },
    select: {
      teacher_id: true,
      class: { select: { colleges: { select: { id: true, name: true } } } },
    },
  });
  const teacherCollegeMap = new Map();
  for (const a of teacherAssignmentsWithCollege) {
    if (a.class?.colleges) {
      if (!teacherCollegeMap.has(a.teacher_id)) {
        teacherCollegeMap.set(a.teacher_id, new Map());
      }
      teacherCollegeMap.get(a.teacher_id).set(a.class.colleges.id, a.class.colleges);
    }
  }

  // 查询每个教师实际授课层次（从授课安排中提取，去重）
  // H-6: 添加 teacher_id 过滤，避免拉取整个学期的排课数据
  const teacherAssignmentsWithLevel = await prisma.teaching_assignments.findMany({
    where: { semester: semesterStr, teacher_id: { in: relevantTeacherIds } },
    select: {
      teacher_id: true,
      class: { select: { training_level_id: true } },
    },
  });
  const teacherLevelMap = new Map();
  for (const a of teacherAssignmentsWithLevel) {
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

  // 获取教师的教材数据（基于当前学期实际授课安排，仅当前课程）
  const teacherTextbookMap = new Map();

  const currentAssignments = await prisma.teaching_assignments.findMany({
    where: {
      course_id: Number(courseId),
      semester: semesterStr,
    },
    include: {
      class: {
        select: { id: true },
      },
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

  if (currentAssignments.length > 0) {
    const classIds = currentAssignments.map((a) => a.class_id);

    // 解析学期信息，用于 calcClassSemester 计算每个班级的程序学期号
    const semesterInfo = parseSemester(semesterStr);

    // 加载所有培养方案课程的学期教材（不在 SQL 层按日历学期号过滤，
    // 而是在 JS 层按每个班级的实际程序学期号过滤，与 getClassesWithCourse 保持一致）
    const planCoursesForClasses = await prisma.plan_courses.findMany({
      where: { course_id: Number(courseId) },
      include: {
        training_plans: { select: { id: true, major_id: true, training_level_id: true } },
        plan_course_semesters: {
          include: {
            plan_textbooks: { select: { textbook_id: true } },
          },
        },
      },
    });

    const classTextbookMap = new Map();
    const allClassesForTextbooks = await prisma.classes.findMany({
      where: { id: { in: classIds } },
      select: {
        id: true,
        custom_plan_id: true,
        major_id: true,
        training_level_id: true,
        enrollment_year: true,
        duration_years: true,
      },
    });

    for (const cls of allClassesForTextbooks) {
      // 计算班级在当前学期的程序学期号（如大二下=4），替代之前错误的日历学期号
      const calc = semesterInfo ? calcClassSemester(cls, semesterInfo) : null;
      const clsSemesterNum = calc?.currentSemesterNum;

      const textbookIds = new Set();
      for (const pc of planCoursesForClasses) {
        const plan = pc.training_plans;
        // 使用统一的三级互斥匹配，避免 null===null 误匹配
        if (!isClassMatchPlan(cls, plan)) continue;
        for (const sem of pc.plan_course_semesters) {
          // 按班级程序学期号精确匹配（与 getClassesWithCourse 的 calc.currentSemesterNum !== sem.semester 对应）
          if (clsSemesterNum == null || sem.semester !== clsSemesterNum) continue;
          // 同时在 start_semester/end_semester 范围内（与 getClassesWithCourse 的区间过滤对应）
          if (sem.semester < pc.start_semester || sem.semester > pc.end_semester) continue;
          for (const pt of sem.plan_textbooks) {
            textbookIds.add(pt.textbook_id);
          }
        }
      }
      classTextbookMap.set(cls.id, [...textbookIds]);
    }

    for (const a of currentAssignments) {
      if (!teacherTextbookMap.has(a.teacher_id)) {
        teacherTextbookMap.set(a.teacher_id, new Set());
      }
      const classTextbooks = classTextbookMap.get(a.class_id);
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
    const assignedIds = [...(assignedOnlyTextbookMap.get(t.id) || [])];
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
