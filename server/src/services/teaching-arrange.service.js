import { prisma } from '../lib/prisma.js';

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
 */
export function parseSemester(semesterStr) {
  if (!semesterStr) return null;
  const parts = semesterStr.split('-');
  if (parts.length !== 3) return null;
  const startYear = parseInt(parts[0]);
  const endYear = parseInt(parts[1]);
  const semesterIndex = parseInt(parts[2]);
  if (isNaN(startYear) || isNaN(endYear) || (semesterIndex !== 1 && semesterIndex !== 2)) return null;
  return {
    startYear,
    endYear,
    semesterIndex,
    label: semesterStr,
  };
}

/**
 * 获取指定学期下开设某课程的班级列表（含课时、教材、学院等完整信息）
 */
export async function getClassesWithCourse(courseId, semesterStr) {
  const semesterInfo = parseSemester(semesterStr);
  if (!semesterInfo) throw new Error('学期格式错误');

  // 查找包含该课程的所有培养方案课程
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
  });

  // 获取所有在读班级
  const durations = await prisma.classes.findMany({
    select: { duration_years: true },
    distinct: ['duration_years'],
  });
  const durationValues = durations.map(d => d.duration_years).filter(d => d != null);

  const allClasses = await prisma.classes.findMany({
    where: {
      OR: durationValues.map(d => ({
        duration_years: d,
        is_left_school: false,
        enrollment_year: { gte: semesterInfo.startYear - d + 1 },
      })),
    },
    include: {
      majors: { select: { id: true, name: true } },
      colleges: { select: { id: true, name: true } },
      training_levels: { select: { id: true, name: true } },
    },
  });

  const results = [];
  const addedClassIds = new Set();

  // 按入学年份建立索引，避免内层 O(C) 遍历
  const classesByYear = new Map();
  for (const cls of allClasses) {
    if (!classesByYear.has(cls.enrollment_year)) {
      classesByYear.set(cls.enrollment_year, []);
    }
    classesByYear.get(cls.enrollment_year).push(cls);
  }

  for (const pc of planCourses) {
    const plan = pc.training_plans;

    const semRecords = pc.plan_course_semesters.filter(s =>
      s.semester >= pc.start_semester && s.semester <= pc.end_semester
    );

    for (const sem of semRecords) {
      const gradeForThisSemester = Math.ceil(sem.semester / 2);
      const enrollmentYear = semesterInfo.startYear - gradeForThisSemester + 1;

      const yearClasses = classesByYear.get(enrollmentYear) || [];
      for (const cls of yearClasses) {
        if (addedClassIds.has(cls.id)) continue;

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

        addedClassIds.add(cls.id);

        const weeklyHours = sem.weekly_hours ?? pc.weekly_hours;
        const weeksCount = sem.weeks_count ?? pc.weeks_per_semester;
        const textbooks = sem.plan_textbooks.map(pt => pt.textbooks);

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
  const workloadMap = new Map(teacherWorkloadStats.map(w => [w.teacher_id, w._sum.weekly_hours || 0]));
  const classCountMap = new Map(teacherWorkloadStats.map(w => [w.teacher_id, w._count.id || 0]));

  // 查询每个教师在当前课程下的安排
  const courseAssignments = await prisma.teaching_assignments.groupBy({
    by: ['teacher_id'],
    where: { semester: semesterStr, course_id: Number(courseId) },
    _sum: { weekly_hours: true },
    _count: { id: true },
  });
  const courseAssignmentMap = new Map(courseAssignments.map(w => [
    w.teacher_id,
    { hours: w._sum.weekly_hours || 0, classCount: w._count.id || 0 },
  ]));

  // 查询每个教师实际授课学院（从授课安排中提取，去重）
  const teacherAssignmentsWithCollege = await prisma.teaching_assignments.findMany({
    where: { semester: semesterStr },
    select: {
      teacher_id: true,
      class: { select: { colleges: { select: { id: true, name: true } } } },
    },
  });
  const teacherCollegeMap = new Map(); // teacherId -> Map<collegeId, college>
  for (const a of teacherAssignmentsWithCollege) {
    if (a.class?.colleges) {
      if (!teacherCollegeMap.has(a.teacher_id)) {
        teacherCollegeMap.set(a.teacher_id, new Map());
      }
      teacherCollegeMap.get(a.teacher_id).set(a.class.colleges.id, a.class.colleges);
    }
  }

  // 获取教师的教材数据（基于当前学期实际授课安排，仅当前课程）
  // 从已有的教学安排中提取教师正在使用的教材，比从培养方案静态推导更准确
  const teacherTextbookMap = new Map(); // teacherId -> textbookIds[]

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

  // 查询每个安排对应的班级使用了哪些教材
  if (currentAssignments.length > 0) {
    const classIds = currentAssignments.map(a => a.class_id);
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

    // 为每个班级匹配其培养方案，提取对应的教材
    const classTextbookMap = new Map(); // classId -> textbookIds[]
    const allClassesForTextbooks = await prisma.classes.findMany({
      where: { id: { in: classIds } },
      select: { id: true, custom_plan_id: true, major_id: true, training_level_id: true },
    });

    for (const cls of allClassesForTextbooks) {
      const textbookIds = new Set();
      for (const pc of planCoursesForClasses) {
        const plan = pc.training_plans;
        let isMatch = false;
        if (cls.custom_plan_id === plan.id) {
          isMatch = true;
        } else if (!cls.custom_plan_id && cls.major_id === plan.major_id) {
          isMatch = true;
        } else if (!cls.custom_plan_id && cls.training_level_id === plan.training_level_id) {
          isMatch = true;
        }
        if (!isMatch) continue;
        for (const sem of pc.plan_course_semesters) {
          for (const pt of sem.plan_textbooks) {
            textbookIds.add(pt.textbook_id);
          }
        }
      }
      classTextbookMap.set(cls.id, [...textbookIds]);
    }

    // 按教师聚合其已授课班级的教材
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

  // 生成最终的教材映射：有授课安排的教师用实际教材，无安排的用培养方案兜底
  const fallbackTextbookIds = [...fallbackTextbookSet];
  for (const t of teachers) {
    if (!teacherTextbookMap.has(t.id)) {
      teacherTextbookMap.set(t.id, new Set(fallbackTextbookIds));
    }
  }

  return teachers.map(t => ({
    id: t.id,
    name: t.name,
    gender: t.gender,
    personnelType: t.personnel_type,
    qualificationType: t.qualification_type,
    defaultWeeklyHours: t.default_weekly_hours,
    courseList: t.courses.map(tc => tc.course),
    collegeList: [...(teacherCollegeMap.get(t.id)?.values() || [])],
    schedulingCollegeIds: t.scheduling_colleges.map(sc => sc.college_id),
    schedulingLevelIds: t.scheduling_levels.map(sl => sl.training_level.id),
    trainingLevelList: t.scheduling_levels.map(sl => sl.training_level),
    textbookIds: [...(teacherTextbookMap.get(t.id) || [])],
    totalWeeklyHours: workloadMap.get(t.id) || 0,
    totalClassCount: classCountMap.get(t.id) || 0,
    courseHours: courseAssignmentMap.get(t.id)?.hours || 0,
    courseClassCount: courseAssignmentMap.get(t.id)?.classCount || 0,
  }));
}

/**
 * 计算教师-班级匹配分数（软约束优先级）
 * @param {object} teacher - 教师对象（含 schedulingCollegeIds, textbookIds）
 * @param {object} classInfo - 班级对象（含 collegeId, textbookIds）
 * @param {string[]} conditions - 排课条件（预留扩展）
 */
function calcMatchScore(teacher, classInfo, conditions = []) {
  let score = 0;

  // 指定学院匹配：始终生效，教师配置的任课学院优先安排
  if (teacher.schedulingCollegeIds?.length && teacher.schedulingCollegeIds.includes(classInfo.collegeId)) {
    score += 1;
  }

  // 指定层次匹配：始终生效，教师配置的任课层次优先安排
  if (teacher.schedulingLevelIds?.length && classInfo.trainingLevelId && teacher.schedulingLevelIds.includes(classInfo.trainingLevelId)) {
    score += 1;
  }

  // 同教材匹配：始终生效，尽量避免跨教材教学
  if (teacher.textbookIds?.length && classInfo.textbookIds?.length) {
    const hasSameTextbook = teacher.textbookIds.some(tid => classInfo.textbookIds.includes(tid));
    if (hasSameTextbook) {
      score += 3;
    }
  }

  return score;
}

/**
 * 自动排课核心算法
 * @param {number} courseId - 课程ID
 * @param {string} semesterStr - 学期字符串
 * @param {string} mode - 'full' | 'standard'
 * @param {object} hourSettings - { full_time: { standard, max }, part_time: { standard, max }, external: { standard, max } }
 * @param {string[]} scheduleConditions - 排课条件（预留扩展）
 * @param {object} [options] - 可选参数
 * @param {boolean} [options.preview=false] - 预览模式（只计算不写库）
 */
export async function autoArrange(courseId, semesterStr, mode, hourSettings, scheduleConditions, options = {}) {
  const { preview = false } = options;

  // === 数据加载 ===
  const teachers = await getTeachersForCourse(courseId, semesterStr);
  if (!teachers.length) return buildResult([], [], [], 0, '该课程没有可用教师', preview);

  const classes = await getClassesWithCourse(courseId, semesterStr);
  if (!classes.length) return buildResult([], [], [], 0, '当前学期没有开设该课程的班级', preview);

  const manualAssignments = await prisma.teaching_assignments.findMany({
    where: { course_id: Number(courseId), semester: semesterStr, is_auto: false },
  });
  const manualClassIds = new Set(manualAssignments.map(a => a.class_id));

  const currentAutoHours = await prisma.teaching_assignments.groupBy({
    by: ['teacher_id'],
    where: { course_id: Number(courseId), semester: semesterStr, is_auto: true },
    _sum: { weekly_hours: true },
  });
  const autoHoursMap = new Map(currentAutoHours.map(w => [w.teacher_id, w._sum.weekly_hours || 0]));

  const classesToAssign = classes
    .filter(c => !manualClassIds.has(c.classId))
    .map(c => ({ ...c, textbookIds: (c.textbooks || []).map(tb => tb.id) }));

  // === 约束计算 ===
  const teacherConstraints = buildTeacherConstraints(teachers, hourSettings, autoHoursMap, mode);

  // === 容量可行性预检 ===
  const totalClassHours = classesToAssign.reduce((s, c) => s + c.weeklyHours, 0);
  const totalTeacherCapacity = teacherConstraints.reduce((s, t) =>
    s + (mode === 'standard' ? t.standardCap : t.fullCap), 0);
  const warnings = [];
  if (totalClassHours > totalTeacherCapacity) {
    warnings.push(`班级总课时(${totalClassHours})超过教师总容量(${totalTeacherCapacity})，部分班级可能无法分配`);
  }

  // === 分配算法 ===
  const assignments = [];
  const unassigned = [];

  function selectBestTeacher(candidates) {
    const collegeMatched = candidates.filter(c =>
      c.teacher.schedulingCollegeIds?.length &&
      c.teacher.schedulingCollegeIds.includes(c.cls.collegeId)
    );
    if (collegeMatched.length > 0) {
      return [...collegeMatched].sort((a, b) => b.score - a.score || a.loadRate - b.loadRate)[0];
    }

    const levelMatched = candidates.filter(c =>
      c.teacher.schedulingLevelIds?.length &&
      c.cls.trainingLevelId &&
      c.teacher.schedulingLevelIds.includes(c.cls.trainingLevelId)
    );
    if (levelMatched.length > 0) {
      return [...levelMatched].sort((a, b) => b.score - a.score || a.loadRate - b.loadRate)[0];
    }

    const textbookMatched = candidates.filter(c => {
      if (!c.teacher.textbookIds?.length || !c.cls.textbookIds?.length) return false;
      return c.teacher.textbookIds.some(tid => c.cls.textbookIds.includes(tid));
    });
    if (textbookMatched.length > 0) {
      return [...textbookMatched].sort((a, b) => b.score - a.score || a.loadRate - b.loadRate)[0];
    }

    return [...candidates].sort((a, b) => b.score - a.score || a.loadRate - b.loadRate)[0];
  }

  function countEligibleTeachers(cls, eligibilityFilter) {
    return teacherConstraints.filter(t => {
      if (eligibilityFilter && !eligibilityFilter(t, cls)) return false;
      return isTeacherEligible(t, cls, mode);
    }).length;
  }

  function assignRound(classList, eligibilityFilter = null) {
    const sorted = [...classList].sort((a, b) =>
      countEligibleTeachers(a, eligibilityFilter) - countEligibleTeachers(b, eligibilityFilter)
    );

    const remaining = [];
    for (const cls of sorted) {
      const maxCap = mode === 'standard'
        ? t => t.standardCap
        : t => t.fullCap;

      const candidates = teacherConstraints
        .filter(t => {
          if (eligibilityFilter && !eligibilityFilter(t, cls)) return false;
          return isTeacherEligible(t, cls, mode);
        })
        .map(t => ({
          teacher: t,
          score: calcMatchScore(t, cls),
          loadRate: (t.effectiveTotal + t.assignedHours) / Math.max(1, maxCap(t) + t.effectiveTotal),
          cls,
        }));

      if (candidates.length === 0) {
        remaining.push(cls);
        continue;
      }

      const selected = selectBestTeacher(candidates).teacher;
      selected.assignedHours += cls.weeklyHours;

      for (const tid of cls.textbookIds || []) {
        if (!selected.textbookIds.includes(tid)) {
          selected.textbookIds.push(tid);
        }
      }

      assignments.push({
        teacher_id: selected.id,
        teacher_name: selected.name,
        class_id: cls.classId,
        class_name: cls.className,
        course_id: Number(courseId),
        semester: semesterStr,
        weekly_hours: cls.weeklyHours,
        is_auto: true,
      });
    }
    return remaining;
  }

  // === 三阶段分配 ===
  const collegePairs = (t, cls) =>
    t.schedulingCollegeIds?.length > 0 && t.schedulingCollegeIds.includes(cls.collegeId);
  const levelPairs = (t, cls) =>
    t.schedulingLevelIds?.length > 0 && cls.trainingLevelId &&
    t.schedulingLevelIds.includes(cls.trainingLevelId);

  const round1Remaining = assignRound(classesToAssign, collegePairs);
  const round2Remaining = assignRound(round1Remaining, levelPairs);
  const round3Remaining = assignRound(round2Remaining);
  unassigned.push(...round3Remaining);

  // === 预览模式：只返回结果不写库 ===
  if (preview) {
    return buildResult(assignments, unassigned, classesToAssign, manualAssignments.length, null, true, warnings, teacherConstraints, mode);
  }

  // === 持久化：批量写入 ===
  if (assignments.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.teaching_assignments.deleteMany({
        where: { course_id: Number(courseId), semester: semesterStr, is_auto: true },
      });
      if (assignments.length > 0) {
        await tx.teaching_assignments.createMany({
          data: assignments.map(a => ({
            teacher_id: a.teacher_id,
            class_id: a.class_id,
            course_id: a.course_id,
            semester: a.semester,
            weekly_hours: a.weekly_hours,
            is_auto: true,
          })),
        });
      }
    });
  }

  return buildResult(assignments, unassigned, classesToAssign, manualAssignments.length, null, false, warnings, teacherConstraints, mode);
}

function isTeacherEligible(t, cls, mode) {
  const cap = mode === 'standard' ? t.standardCap : t.fullCap;
  if (t.assignedHours + cls.weeklyHours > cap) return false;
  if (t.defaultWeeklyHours != null) {
    return t.courseExistingHours + t.assignedHours + cls.weeklyHours <= t.defaultWeeklyHours;
  }
  return true;
}

function buildTeacherConstraints(teachers, hourSettings, autoHoursMap, mode) {
  return teachers.map(t => {
    const personnelType = t.personnelType || 'full_time';
    const setting = hourSettings[personnelType] || { standard: 16, max: 20 };
    const autoHoursForCourse = autoHoursMap.get(t.id) || 0;
    const effectiveTotal = t.totalWeeklyHours - autoHoursForCourse;
    const courseExistingHours = t.courseHours - autoHoursForCourse;

    return {
      ...t,
      standardHours: setting.standard,
      maxHours: setting.max,
      effectiveTotal,
      courseExistingHours,
      standardCap: Math.max(0, setting.standard - effectiveTotal),
      fullCap: Math.max(0, setting.max - effectiveTotal),
      assignedHours: 0,
    };
  });
}

function diagnoseFailure(cls, teacherConstraints, mode) {
  const allTeachers = teacherConstraints;
  if (allTeachers.length === 0) return '没有可教此课程的教师';

  const afterEligibility = allTeachers.filter(t => isTeacherEligible(t, cls, mode));
  if (afterEligibility.length === 0) {
    const capFull = allTeachers.every(t => {
      const cap = mode === 'standard' ? t.standardCap : t.fullCap;
      return t.assignedHours + cls.weeklyHours > cap;
    });
    if (capFull) return '所有候选教师课时容量已满';

    const courseLimit = allTeachers.every(t =>
      t.defaultWeeklyHours != null &&
      t.courseExistingHours + t.assignedHours + cls.weeklyHours > t.defaultWeeklyHours
    );
    if (courseLimit) return '所有候选教师本课程课时已达上限';
  }

  return '无匹配的教师（学院/层次偏好筛选后无候选）';
}

function buildResult(assignments, unassigned, classesToAssign, manualCount, message, preview, warnings, teacherConstraints, mode) {
  const result = {
    assigned: assignments,
    unassigned: unassigned.map(c => ({
      classId: c.classId,
      className: c.className,
      weeklyHours: c.weeklyHours,
      reason: teacherConstraints ? diagnoseFailure(c, teacherConstraints, mode || 'standard') : undefined,
    })),
    totalClasses: classesToAssign?.length || 0,
    manualCount,
    autoCount: assignments.length,
    unassignedCount: unassigned.length,
    preview: !!preview,
    warnings: warnings || [],
  };
  if (message) result.message = message;
  return result;
}

/**
 * 批量自动排课：为指定学期下所有课程依次执行自动排课
 */
export async function batchAutoArrange(semesterStr, mode, hourSettings, scheduleConditions, options = {}) {
  const courses = await prisma.courses.findMany({
    where: {
      plan_courses: {
        plan_course_semesters: { some: {} },
      },
    },
    select: { id: true, name: true, code: true },
  });

  const results = [];
  let totalAssigned = 0;
  let totalUnassigned = 0;
  let totalWarnings = 0;

  for (const course of courses) {
    try {
      const result = await autoArrange(
        course.id, semesterStr, mode, hourSettings, scheduleConditions, options,
      );
      results.push({ courseId: course.id, courseName: course.name, ...result });
      totalAssigned += result.autoCount;
      totalUnassigned += result.unassignedCount;
      if (result.warnings?.length) totalWarnings += result.warnings.length;
    } catch (e) {
      results.push({
        courseId: course.id,
        courseName: course.name,
        error: e.message,
        autoCount: 0,
        unassignedCount: 0,
      });
    }
  }

  return {
    semester: semesterStr,
    mode,
    preview: !!options.preview,
    courseResults: results,
    summary: {
      totalCourses: courses.length,
      successCount: results.filter(r => !r.error).length,
      errorCount: results.filter(r => r.error).length,
      totalAssigned,
      totalUnassigned,
      totalWarnings,
    },
  };
}
