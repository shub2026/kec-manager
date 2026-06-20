import { prisma } from '../lib/prisma.js';
import { DEFAULT_HOUR_SETTINGS, WORKLOAD_BALANCE } from '../constants/index.js';

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
 * 验证课时设置参数
 */
export function validateHourSettings(hourSettings) {
  const requiredTypes = ['full_time', 'part_time', 'external'];
  for (const type of requiredTypes) {
    if (!hourSettings[type]) {
      throw new Error(`缺少 ${type} 的课时设置`);
    }
    const { standard, max } = hourSettings[type];
    if (!Number.isFinite(standard) || !Number.isFinite(max)) {
      throw new Error(`${type} 的课时设置必须是有效数字`);
    }
    if (standard < 0 || max < 0) {
      throw new Error(`${type} 的课时设置不能为负数`);
    }
    if (standard > max) {
      throw new Error(`${type} 的标准课时不能超过最大课时`);
    }
  }
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

/**
 * 班级与培养方案的三级互斥匹配（与 plan.service.isClassMatchPlan 保持一致）
 * 优先级：自定义方案 > 按专业 > 按培养层次
 * 注意：major_id/training_level_id 为可空字段，必须做真值守卫，避免 null===null 误匹配
 */
function isClassMatchPlan(cls, plan) {
  // 1. 自定义方案优先
  if (cls.custom_plan_id === plan.id) return true;
  // 未设置自定义方案的班级才走通用匹配
  if (!cls.custom_plan_id) {
    // 2. 按专业匹配（要求班级和方案都有专业且相同）
    if (cls.major_id && plan.major_id && cls.major_id === plan.major_id) return true;
    // 3. 按培养层次匹配（仅当班级未按专业命中、且班级和方案都有层次时）
    if (!cls.major_id && cls.training_level_id && plan.training_level_id &&
        cls.training_level_id === plan.training_level_id) return true;
  }
  return false;
}

function isTextbookMatch(teacher, cls) {
  // P1-A 修复：教材匹配始终使用教师固有教材快照，不受本次分配累加污染
  const inherentIds = teacher.inherentTextbookIds ?? teacher.textbookIds;
  if (!inherentIds?.length || !cls.textbookIds?.length) return false;
  return inherentIds.some(tid => cls.textbookIds.includes(tid));
}

function isCollegeEligible(t, cls) {
  if (!t.schedulingCollegeIds || t.schedulingCollegeIds.length === 0) return true;
  return t.schedulingCollegeIds.includes(cls.collegeId);
}

function isLevelEligible(t, cls) {
  if (!t.schedulingLevelIds || t.schedulingLevelIds.length === 0) return true;
  return cls.trainingLevelId && t.schedulingLevelIds.includes(cls.trainingLevelId);
}

/**
 * 获取指定学期下开设某课程的班级列表（含课时、教材、学院等完整信息）
 */
export async function getClassesWithCourse(courseId, semesterStr) {
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
    orderBy: [
      { training_plans: { sort_order: 'asc' } },
      { id: 'asc' },
    ],
  });

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

        // 使用统一的三级互斥匹配，避免 null===null 误匹配
        if (!isClassMatchPlan(cls, plan)) continue;

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
  const teacherCollegeMap = new Map();
  for (const a of teacherAssignmentsWithCollege) {
    if (a.class?.colleges) {
      if (!teacherCollegeMap.has(a.teacher_id)) {
        teacherCollegeMap.set(a.teacher_id, new Map());
      }
      teacherCollegeMap.get(a.teacher_id).set(a.class.colleges.id, a.class.colleges);
    }
  }

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

    const classTextbookMap = new Map();
    const allClassesForTextbooks = await prisma.classes.findMany({
      where: { id: { in: classIds } },
      select: { id: true, custom_plan_id: true, major_id: true, training_level_id: true },
    });

    for (const cls of allClassesForTextbooks) {
      const textbookIds = new Set();
      for (const pc of planCoursesForClasses) {
        const plan = pc.training_plans;
        // 使用统一的三级互斥匹配，避免 null===null 误匹配
        if (!isClassMatchPlan(cls, plan)) continue;
        for (const sem of pc.plan_course_semesters) {
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

  const fallbackTextbookIds = [...fallbackTextbookSet];
  for (const t of teachers) {
    if (!teacherTextbookMap.has(t.id)) {
      teacherTextbookMap.set(t.id, new Set(fallbackTextbookIds));
    }
  }

  return teachers.map(t => {
    const inherentTextbookIds = [...(teacherTextbookMap.get(t.id) || [])];
    return {
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
    textbookIds: [...inherentTextbookIds],
    inherentTextbookIds,
    assignedTextbookIds: new Set(),
    totalWeeklyHours: workloadMap.get(t.id) || 0,
    totalClassCount: classCountMap.get(t.id) || 0,
    courseHours: courseAssignmentMap.get(t.id)?.hours || 0,
    courseClassCount: courseAssignmentMap.get(t.id)?.classCount || 0,
    };
  });
}

/**
 * 计算教师-班级匹配分数（优先级 + 教材内聚）
 * 权重: 学院匹配 +5, 层次匹配 +5, 本轮已分配教材 +6, 固有教材 +3
 */
function calcMatchScore(teacher, classInfo, conditions = []) {
  let score = 0;

  if (teacher.schedulingCollegeIds && teacher.schedulingCollegeIds.length > 0) {
    if (teacher.schedulingCollegeIds.includes(classInfo.collegeId)) {
      score += 5;
    }
  }

  if (teacher.schedulingLevelIds && teacher.schedulingLevelIds.length > 0) {
    if (classInfo.trainingLevelId && teacher.schedulingLevelIds.includes(classInfo.trainingLevelId)) {
      score += 5;
    }
  }

  if (classInfo.textbookIds && classInfo.textbookIds.length > 0 && teacher.assignedTextbookIds) {
    const hasAssigned = classInfo.textbookIds.some(tid => teacher.assignedTextbookIds.has(tid));
    if (hasAssigned) {
      score += 6;
    }
  }

  if (isTextbookMatch(teacher, classInfo)) {
    score += 3;
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
  const { preview = false, extraTeacherHours = null } = options;

  validateHourSettings(hourSettings);

  const teachers = await getTeachersForCourse(courseId, semesterStr);
  if (!teachers.length) {
    // 提前返回前查询手动安排数，避免 manualCount 误报为 0（M-1 修复）
    const manualCount = await prisma.teaching_assignments.count({
      where: { course_id: Number(courseId), semester: semesterStr, is_auto: false },
    });
    return buildResult([], [], [], manualCount, '该课程没有可用教师', preview);
  }

  const classes = await getClassesWithCourse(courseId, semesterStr);
  if (!classes.length) {
    const manualCount = await prisma.teaching_assignments.count({
      where: { course_id: Number(courseId), semester: semesterStr, is_auto: false },
    });
    return buildResult([], [], [], manualCount, '当前学期没有开设该课程的班级', preview);
  }

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

  const assignments = [];
  const unassigned = [];

  // 校验周课时合法性：0 或负数的班级不参与排课，避免污染容量统计（M-10 修复）
  const invalidHourClasses = classesToAssign.filter(c => !c.weeklyHours || c.weeklyHours <= 0);
  for (const c of invalidHourClasses) {
    unassigned.push({
      classId: c.classId,
      className: c.className,
      weeklyHours: c.weeklyHours,
      reason: '课时配置异常（周课时为0或负数）',
    });
  }
  const validClassesToAssign = classesToAssign.filter(c => c.weeklyHours && c.weeklyHours > 0);

  const teacherConstraints = buildTeacherConstraints(teachers, hourSettings, autoHoursMap, mode, extraTeacherHours);

  const totalClassHours = validClassesToAssign.reduce((s, c) => s + c.weeklyHours, 0);
  const totalTeacherCapacity = teacherConstraints.reduce((s, t) =>
    s + (mode === 'standard' ? t.standardCap : t.fullCap), 0);
  const warnings = [];
  if (totalClassHours > totalTeacherCapacity) {
    warnings.push(`班级总课时(${totalClassHours})超过教师总容量(${totalTeacherCapacity})，部分班级可能无法分配`);
  }

  // 预计算每个班级的"学院+教材"和"层次+教材"匹配教师数量，优化二次筛选
  const collegeTextbookMatchCount = new Map();
  const levelTextbookMatchCount = new Map();

  for (const cls of validClassesToAssign) {
    let collegeTextbookCount = 0;
    let levelTextbookCount = 0;
    for (const t of teacherConstraints) {
      if (isCollegeEligible(t, cls) && isTextbookMatch(t, cls)) collegeTextbookCount++;
      if (isLevelEligible(t, cls) && isTextbookMatch(t, cls)) levelTextbookCount++;
    }
    collegeTextbookMatchCount.set(cls.classId, collegeTextbookCount);
    levelTextbookMatchCount.set(cls.classId, levelTextbookCount);
  }

  /**
   * 选择最佳教师（综合评分制）
   * 综合考虑：优先级分数（高优）+ 负载率（低优）
   */
  function selectBestTeacher(candidates) {
    // 对所有候选教师排序：分数降序 > 负载率升序
    const sorted = [...candidates].sort((a, b) => {
      // 1. 分数差异大于阈值，按分数降序
      if (Math.abs(b.score - a.score) >= WORKLOAD_BALANCE.SCORE_THRESHOLD) {
        return b.score - a.score;
      }
      // 2. 负载率差异大于阈值，按负载率升序（低负载优先）
      if (Math.abs(a.loadRate - b.loadRate) > WORKLOAD_BALANCE.LOAD_RATE_THRESHOLD) {
        return a.loadRate - b.loadRate;
      }
      // 3. 综合排序：分数降序 > 负载率升序
      return (b.score - a.score) || (a.loadRate - b.loadRate);
    });

    return sorted[0];
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
        selected.assignedTextbookIds.add(tid);
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

  const hasCollegePref = t => t.schedulingCollegeIds && t.schedulingCollegeIds.length > 0;
  const hasLevelPref = t => t.schedulingLevelIds && t.schedulingLevelIds.length > 0;
  const hasAnyPref = t => hasCollegePref(t) || hasLevelPref(t);

  const hasAssignedTextbook = (t, cls) =>
    cls.textbookIds?.length > 0 && t.assignedTextbookIds &&
    cls.textbookIds.some(tid => t.assignedTextbookIds.has(tid));

  const prefMatch = (t, cls) => {
    if (hasCollegePref(t) && !t.schedulingCollegeIds.includes(cls.collegeId)) return false;
    if (hasLevelPref(t) && cls.trainingLevelId &&
        !t.schedulingLevelIds.includes(cls.trainingLevelId)) return false;
    return true;
  };

  const phase1Filter = (t, cls) => hasAnyPref(t) && prefMatch(t, cls) && isTextbookMatch(t, cls);
  const phase1Remaining = assignRound(validClassesToAssign, phase1Filter);

  const phase2Filter = (t, cls) => hasAnyPref(t) && prefMatch(t, cls) && hasAssignedTextbook(t, cls);
  const phase2Remaining = assignRound(phase1Remaining, phase2Filter);

  const phase3Filter = (t, cls) => hasAnyPref(t) && prefMatch(t, cls);
  const phase3Remaining = assignRound(phase2Remaining, phase3Filter);

  const phase4Filter = (t, cls) => !hasAnyPref(t) && (isTextbookMatch(t, cls) || hasAssignedTextbook(t, cls));
  const phase4Remaining = assignRound(phase3Remaining, phase4Filter);

  const phase5Filter = (t, cls) => !hasAnyPref(t);
  const phase5Remaining = assignRound(phase4Remaining, phase5Filter);

  const phase6Remaining = assignRound(phase5Remaining);
  unassigned.push(...phase6Remaining);

  // P2 修复：阶段4 后置换回溯
  // 对未分配班级尝试"置换"：若某教师 T 已满，但 T 当前某班级 V 能被其他教师 T'' 接管，
  // 且 T 腾出容量后能容纳未分配班级 U，则执行置换，提升全局分配率
  trySwapUnassigned(unassigned, assignments, teacherConstraints, mode, courseId, semesterStr);

  if (preview) {
    return buildResult(assignments, unassigned, validClassesToAssign, manualAssignments.length, null, true, warnings, teacherConstraints, mode);
  }

  // 非预览模式：删除旧自动安排 + 写入新安排，统一在事务内执行
  // 无论是否有新分配都执行 deleteMany，保证"全量替换"语义与幂等性（C-3 修复）
  // 事务内重新校验教师实际课时，避免并发排课导致超载（C-2 修复）
  await prisma.$transaction(async (tx) => {
    // 事务内重新查询教师当前学期实际总课时（扣除即将删除的本课程自动安排）
    await tx.teaching_assignments.deleteMany({
      where: { course_id: Number(courseId), semester: semesterStr, is_auto: true },
    });

    if (assignments.length > 0) {
      // 重新聚合各教师当前实际总课时（已扣除本课程旧自动安排）
      const reassigned = await tx.teaching_assignments.groupBy({
        by: ['teacher_id'],
        where: { semester: semesterStr },
        _sum: { weekly_hours: true },
      });
      const reassignedMap = new Map(reassigned.map(r => [r.teacher_id, r._sum.weekly_hours || 0]));

      // 容量二次校验：超载的分配降级跳过，写入通过校验的部分
      const safeAssignments = [];
      const overloadSkipped = [];
      const constraintMap = new Map(teacherConstraints.map(t => [t.id, t]));
      for (const a of assignments) {
        const t = constraintMap.get(a.teacher_id);
        if (!t) { overloadSkipped.push(a); continue; }
        const currentTotal = reassignedMap.get(a.teacher_id) || 0;
        const cap = mode === 'standard' ? t.standardCap : t.fullCap;
        // currentTotal 已扣除旧自动安排，加上本课程其他已写入的新安排
        const alreadyWritten = safeAssignments.filter(s => s.teacher_id === a.teacher_id)
          .reduce((s, x) => s + x.weekly_hours, 0);
        if (currentTotal + alreadyWritten + a.weekly_hours > cap + t.effectiveTotal) {
          // 超载，跳过该分配（并发导致容量已变）
          overloadSkipped.push(a);
          continue;
        }
        safeAssignments.push(a);
      }

      if (safeAssignments.length > 0) {
        await tx.teaching_assignments.createMany({
          data: safeAssignments.map(a => ({
            teacher_id: a.teacher_id,
            class_id: a.class_id,
            course_id: a.course_id,
            semester: a.semester,
            weekly_hours: a.weekly_hours,
            is_auto: true,
          })),
        });
      }

      // 超载跳过的班级归入 unassigned
      for (const a of overloadSkipped) {
        unassigned.push({
          classId: a.class_id,
          className: a.class_name,
          weeklyHours: a.weekly_hours,
          reason: '并发排课导致教师容量已满，已跳过',
        });
      }
      // 更新 assignments 为实际写入的部分，保证返回结果准确
      assignments.length = 0;
      assignments.push(...safeAssignments);
    }
  });

  return buildResult(assignments, unassigned, validClassesToAssign, manualAssignments.length, null, false, warnings, teacherConstraints, mode);
}

/**
 * P2 修复：置换回溯
 * 对未分配班级尝试置换已分配教师，腾出容量接纳未分配班级，提升全局分配率
 * 单轮置换（不递归），复杂度 O(U × T × A)，U=未分配数，T=教师数，A=分配数
 */
function trySwapUnassigned(unassigned, assignments, teacherConstraints, mode, courseId, semesterStr) {
  if (!unassigned.length || !assignments.length) return;

  const teacherMap = new Map(teacherConstraints.map(t => [t.id, t]));
  // 按教师分组已分配记录，便于查找可置换的班级
  const assignmentsByTeacher = new Map();
  for (const a of assignments) {
    if (!assignmentsByTeacher.has(a.teacher_id)) assignmentsByTeacher.set(a.teacher_id, []);
    assignmentsByTeacher.get(a.teacher_id).push(a);
  }

  const stillUnassigned = [];
  for (const u of unassigned) {
    if (trySwapOne(u, assignments, assignmentsByTeacher, teacherMap, teacherConstraints, mode, courseId, semesterStr)) {
      // 置换成功，u 已移入 assignments，不加入 stillUnassigned
    } else {
      stillUnassigned.push(u);
    }
  }

  // 用剩余未分配替换原 unassigned
  unassigned.length = 0;
  unassigned.push(...stillUnassigned);
}

/**
 * 尝试为单个未分配班级 U 执行一次置换
 * @returns {boolean} 是否置换成功
 */
function trySwapOne(u, assignments, assignmentsByTeacher, teacherMap, teacherConstraints, mode, courseId, semesterStr) {
  const uHours = u.weeklyHours;

  // 遍历所有教师 T（含已满的），找能教 U 且置换后可容纳的场景
  for (const t of teacherConstraints) {
    // T 必须能教 U（基本资格：本课程上限未因 defaultWeeklyHours 卡死）
    // 容量不足没关系，置换后可能腾出空间
    if (t.defaultWeeklyHours != null && t.courseExistingHours + uHours > t.defaultWeeklyHours) {
      continue; // 即使置换也超本课程上限
    }

    // T 当前已分配的班级记录
    const tAssignments = assignmentsByTeacher.get(t.id) || [];
    if (!tAssignments.length) continue; // T 无已分配班级，无需置换

    // T 当前已用课时（含 effectiveTotal 之外的本次新增）
    const tCurrentNew = t.assignedHours;

    // 遍历 T 的已分配班级 V，找能被其他教师 T'' 接管的
    for (const vAssign of tAssignments) {
      const vHours = vAssign.weekly_hours;
      // T 移除 V 后剩余本次新增课时
      const tAfterRemove = tCurrentNew - vHours;
      // T 加上 U 后
      const tAfterAdd = tAfterRemove + uHours;
      const tCap = mode === 'standard' ? t.standardCap : t.fullCap;
      if (tAfterAdd > tCap) continue; // 置换后 T 仍超载

      // 找接管 V 的教师 T''
      for (const t2 of teacherConstraints) {
        if (t2.id === t.id) continue;
        // T'' 需有剩余容量接纳 V
        const t2Cap = mode === 'standard' ? t2.standardCap : t2.fullCap;
        if (t2.assignedHours + vHours > t2Cap) continue;
        // T'' 的本课程上限
        if (t2.defaultWeeklyHours != null && t2.courseExistingHours + t2.assignedHours + vHours > t2.defaultWeeklyHours) continue;
        // T'' 需能教 V：由于 assignment 不含完整 class 偏好信息，
        // 此处用容量允许作为接管条件（兜底性质，匹配质量降级可接受，
        // 因阶段1-4 已尽力匹配，置换仅用于提升分配率）
        // 如需更严格匹配质量，可在此处通过 classId 反查 class 偏好做判断

        // === 执行置换 ===
        // 1. T 减 V、加 U
        t.assignedHours = tAfterAdd;
        // 2. T'' 加 V
        t2.assignedHours += vHours;
        // 3. 更新 assignments：V 的 teacher_id 改为 T''
        vAssign.teacher_id = t2.id;
        vAssign.teacher_name = t2.name;
        // 4. 维护 assignedTextbookIds（U 的教材加入 T）
        if (u.textbookIds) {
          for (const tid of u.textbookIds) t.assignedTextbookIds.add(tid);
        }
        // 4. 维护 assignmentsByTeacher
        assignmentsByTeacher.set(t.id, tAssignments.filter(a => a !== vAssign));
        if (!assignmentsByTeacher.has(t2.id)) assignmentsByTeacher.set(t2.id, []);
        assignmentsByTeacher.get(t2.id).push(vAssign);
        // 5. U 移入 assignments
        assignments.push({
          teacher_id: t.id,
          teacher_name: t.name,
          class_id: u.classId,
          class_name: u.className,
          course_id: Number(courseId),
          semester: semesterStr,
          weekly_hours: uHours,
          is_auto: true,
        });
        if (!assignmentsByTeacher.has(t.id)) assignmentsByTeacher.set(t.id, []);
        assignmentsByTeacher.get(t.id).push(assignments[assignments.length - 1]);

        return true; // 置换成功
      }
    }
  }
  return false; // 无可行置换
}

function isTeacherEligible(t, cls, mode) {
  const cap = mode === 'standard' ? t.standardCap : t.fullCap;
  if (t.assignedHours + cls.weeklyHours > cap) return false;
  if (t.defaultWeeklyHours != null) {
    if (t.courseExistingHours + t.assignedHours + cls.weeklyHours > t.defaultWeeklyHours) return false;
  }
  if (t.schedulingCollegeIds && t.schedulingCollegeIds.length > 0 &&
      !t.schedulingCollegeIds.includes(cls.collegeId)) {
    return false;
  }
  if (t.schedulingLevelIds && t.schedulingLevelIds.length > 0 &&
      cls.trainingLevelId &&
      !t.schedulingLevelIds.includes(cls.trainingLevelId)) {
    return false;
  }
  return true;
}

function buildTeacherConstraints(teachers, hourSettings, autoHoursMap, mode, extraTeacherHours = null) {
  return teachers.map(t => {
    const personnelType = t.personnelType || 'full_time';
    const setting = hourSettings[personnelType] || DEFAULT_HOUR_SETTINGS[personnelType] || DEFAULT_HOUR_SETTINGS.full_time;
    const autoHoursForCourse = autoHoursMap.get(t.id) || 0;
    // 批量预览时叠加前序课程的虚拟分配课时，保证容量计算累积（H-11 修复）
    const extraHours = extraTeacherHours?.get(t.id) || 0;
    const effectiveTotal = t.totalWeeklyHours - autoHoursForCourse + extraHours;
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
      // P1-A 修复：固化固有教材快照，运行时累加不污染匹配判断
      inherentTextbookIds: [...(t.textbookIds || [])],
    };
  });
}

function diagnoseFailure(cls, teacherConstraints, mode) {
  const allTeachers = teacherConstraints;
  if (allTeachers.length === 0) {
    return { reason: '没有可教此课程的教师', details: null };
  }

  const capFullTeachers = allTeachers.filter(t => {
    const cap = mode === 'standard' ? t.standardCap : t.fullCap;
    return t.assignedHours + cls.weeklyHours > cap;
  });

  if (capFullTeachers.length === allTeachers.length) {
    return {
      reason: '所有候选教师课时容量已满',
      details: capFullTeachers.slice(0, 5).map(t => ({
        teacherName: t.name,
        assignedHours: t.effectiveTotal + t.assignedHours,
        cap: mode === 'standard' ? t.standardHours : t.maxHours,
      })),
    };
  }

  const courseLimitTeachers = allTeachers.filter(t =>
    t.defaultWeeklyHours != null &&
    t.courseExistingHours + t.assignedHours + cls.weeklyHours > t.defaultWeeklyHours
  );

  if (courseLimitTeachers.length === allTeachers.length) {
    return {
      reason: '所有候选教师本课程课时已达上限',
      details: courseLimitTeachers.slice(0, 5).map(t => ({
        teacherName: t.name,
        courseHours: t.courseExistingHours + t.assignedHours,
        limit: t.defaultWeeklyHours,
      })),
    };
  }

  const eligibleTeachers = allTeachers.filter(t => isTeacherEligible(t, cls, mode));
  if (eligibleTeachers.length > 0) {
    const afterCapacity = eligibleTeachers.filter(t => {
      const cap = mode === 'standard' ? t.standardCap : t.fullCap;
      return t.assignedHours + cls.weeklyHours <= cap;
    });
    if (afterCapacity.length === 0) {
      return {
        reason: '有资格的教师课时容量已满',
        details: eligibleTeachers.slice(0, 5).map(t => ({
          teacherName: t.name,
          assignedHours: t.effectiveTotal + t.assignedHours,
          cap: mode === 'standard' ? t.standardHours : t.maxHours,
        })),
      };
    }
  }

  return {
    reason: '无匹配的教师（学院/层次偏好筛选后无候选）',
    details: {
      totalTeachers: allTeachers.length,
      collegeMatchCount: allTeachers.filter(t => t.schedulingCollegeIds?.includes(cls.collegeId)).length,
      levelMatchCount: allTeachers.filter(t => t.schedulingLevelIds?.includes(cls.trainingLevelId)).length,
      textbookMatchCount: allTeachers.filter(t => isTextbookMatch(t, cls)).length,
    },
  };
}

function buildResult(assignments, unassigned, classesToAssign, manualCount, message, preview, warnings, teacherConstraints, mode) {
  const result = {
    assigned: assignments,
    unassigned: unassigned.map(c => {
      const diagnosis = teacherConstraints ? diagnoseFailure(c, teacherConstraints, mode || 'standard') : null;
      return {
        classId: c.classId,
        className: c.className,
        weeklyHours: c.weeklyHours,
        reason: diagnosis?.reason || '未知原因',
        details: diagnosis?.details || null,
      };
    }),
    totalClasses: classesToAssign?.length || 0,
    manualCount,
    autoCount: assignments.length,
    unassignedCount: unassigned.length,
    preview: !!preview,
    warnings: warnings || [],
  };

  if (preview && teacherConstraints && assignments.length > 0) {
    const teacherMap = new Map(teacherConstraints.map(t => [t.id, t]));

    // 预构建教师班级计数，避免 O(T*A) 嵌套
    const classCountByTeacher = new Map();
    for (const a of assignments) {
      classCountByTeacher.set(a.teacher_id, (classCountByTeacher.get(a.teacher_id) || 0) + 1);
    }

    result.statistics = {
      teacherWorkload: teacherConstraints
        .filter(t => t.assignedHours > 0 || t.effectiveTotal > 0)
        .map(t => {
          const cap = mode === 'standard' ? t.standardCap : t.fullCap;
          return {
            teacherId: t.id,
            teacherName: t.name,
            personnelType: t.personnelType,
            totalHours: t.effectiveTotal + t.assignedHours,
            newAssignedHours: t.assignedHours,
            cap: cap + t.effectiveTotal,
            loadRate: Math.round((t.effectiveTotal + t.assignedHours) / Math.max(1, cap + t.effectiveTotal) * 100),
            classCount: classCountByTeacher.get(t.id) || 0,
          };
        })
        .sort((a, b) => b.totalHours - a.totalHours),

      ...calcAllMatchRates(assignments, classesToAssign, teacherMap),
    };
  }

  if (message) result.message = message;
  return result;
}

/**
 * 单次遍历计算所有匹配率（学院/教材/层次）
 */
function calcAllMatchRates(assignments, classes, teacherMap) {
  const classMap = new Map(classes.map(c => [c.classId, c]));
  let collegeMatched = 0;
  let textbookMatched = 0;
  let levelMatched = 0;

  for (const a of assignments) {
    const teacher = teacherMap.get(a.teacher_id);
    const cls = classMap.get(a.class_id);
    if (!teacher || !cls) continue;

    if (teacher.schedulingCollegeIds?.includes(cls.collegeId)) collegeMatched++;
    if (isTextbookMatch(teacher, cls)) textbookMatched++;
    if (teacher.schedulingLevelIds?.includes(cls.trainingLevelId)) levelMatched++;
  }

  const total = assignments.length || 1;
  return {
    collegeMatchRate: Math.round(collegeMatched / total * 100),
    textbookMatchRate: Math.round(textbookMatched / total * 100),
    levelMatchRate: Math.round(levelMatched / total * 100),
  };
}

/**
 * 批量自动排课：为指定学期下所有课程依次执行自动排课
 * 优先处理"可选教师少"的课程，避免这些课程因容量耗尽而无法分配
 */
export async function batchAutoArrange(semesterStr, mode, hourSettings, scheduleConditions, options = {}) {
  validateHourSettings(hourSettings);

  const courses = await prisma.courses.findMany({
    where: {
      plan_courses: {
        some: {
          plan_course_semesters: { some: {} },
        },
      },
    },
    select: { id: true, name: true, code: true },
  });

  // 使用轻量级聚合查询计算优先级，避免为每门课程调用完整的 getTeachersForCourse/getClassesWithCourse
  // 仅统计启用状态教师的关联，与实际可用教师一致（H-5 修复）
  const teacherCounts = await prisma.teacher_courses.groupBy({
    by: ['course_id'],
    where: { teacher: { status: 'active' } },
    _count: { teacher_id: true },
  });
  const teacherCountMap = new Map(teacherCounts.map(r => [r.course_id, r._count.teacher_id]));

  // P1-B 修复：优先级改用"供需比"（班级总课时需求 / 可用教师剩余容量）
  // 比值大的课程资源更紧张，应优先处理，避免因靠后排队而容量耗尽
  // 班级总课时：聚合该课程所有 plan_course_semesters 的 weekly_hours（粗略估算，作相对优先级足够）
  const courseHourDemands = await prisma.plan_course_semesters.groupBy({
    by: ['plan_course_id'],
    where: { plan_courses: { course_id: { in: courses.map(c => c.id) } } },
    _sum: { weekly_hours: true },
  });
  // plan_course_id → course_id 映射
  const planCourseToCourse = await prisma.plan_courses.findMany({
    where: { course_id: { in: courses.map(c => c.id) } },
    select: { id: true, course_id: true },
  });
  const courseDemandMap = new Map(); // course_id → 总课时需求
  for (const pc of planCourseToCourse) {
    const demand = courseHourDemands.find(d => d.plan_course_id === pc.id);
    if (demand) {
      courseDemandMap.set(pc.course_id, (courseDemandMap.get(pc.course_id) || 0) + (demand._sum.weekly_hours || 0));
    }
  }

  // 默认标准课时（full_time=16），用于估算剩余容量
  const defaultStandard = hourSettings.full_time?.standard || DEFAULT_HOUR_SETTINGS.full_time.standard;

  const coursePriorities = courses.map(course => {
    const teacherCount = teacherCountMap.get(course.id) || 0;
    const demand = courseDemandMap.get(course.id) || 0;
    // 可用教师剩余容量估算 = 教师数 × 标准课时
    const supplyCapacity = teacherCount * defaultStandard;
    // 供需比：需求/容量。教师数为0时供需比无穷大（最优先）；否则比值越大越紧张
    const supplyDemandRatio = teacherCount === 0
      ? Number.MAX_SAFE_INTEGER
      : (supplyCapacity > 0 ? demand / supplyCapacity : demand > 0 ? Number.MAX_SAFE_INTEGER : 0);
    return { courseId: course.id, courseName: course.name, priority: supplyDemandRatio };
  });

  coursePriorities.sort((a, b) => b.priority - a.priority);

  const results = [];
  let totalAssigned = 0;
  let totalUnassigned = 0;
  let totalWarnings = 0;

  // 预览模式下维护跨课程教师工作量累积快照，保证容量计算顺序依赖（H-11 修复）
  const virtualTeacherHours = options.preview ? new Map() : null;

  for (const { courseId, courseName } of coursePriorities) {
    try {
      const result = await autoArrange(
        courseId, semesterStr, mode, hourSettings, scheduleConditions,
        { ...options, extraTeacherHours: virtualTeacherHours },
      );
      // 预览模式下，将本课程虚拟分配的课时累积到快照，供后续课程容量计算
      if (options.preview && virtualTeacherHours) {
        for (const a of result.assigned) {
          virtualTeacherHours.set(a.teacher_id, (virtualTeacherHours.get(a.teacher_id) || 0) + a.weekly_hours);
        }
      }
      results.push({ courseId, courseName, ...result });
      totalAssigned += result.autoCount;
      totalUnassigned += result.unassignedCount;
      if (result.warnings?.length) totalWarnings += result.warnings.length;
    } catch (e) {
      results.push({
        courseId,
        courseName,
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
