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
  if (!teacher.textbookIds?.length || !cls.textbookIds?.length) return false;
  return teacher.textbookIds.some(tid => cls.textbookIds.includes(tid));
}

function isCollegeEligible(t, cls) {
  return t.schedulingCollegeIds?.length > 0 && t.schedulingCollegeIds.includes(cls.collegeId);
}

function isLevelEligible(t, cls) {
  return t.schedulingLevelIds?.length > 0 && cls.trainingLevelId &&
    t.schedulingLevelIds.includes(cls.trainingLevelId);
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
 */
function calcMatchScore(teacher, classInfo, conditions = []) {
  let score = 0;

  if (isCollegeEligible(teacher, classInfo)) {
    score += 1;
  }

  if (isLevelEligible(teacher, classInfo)) {
    score += 1;
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

  const assignments = [];
  const unassigned = [];

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
   * 分层选择最佳教师（含工作量平衡约束）
   * 优先级：(学院+教材) > 学院 > (教材) > (层次+教材) > 层次 > 兜底
   */
  function selectBestTeacher(candidates) {
    const byScore = (a, b) => {
      if (Math.abs(b.score - a.score) >= WORKLOAD_BALANCE.SCORE_THRESHOLD) return b.score - a.score;
      if (Math.abs(a.loadRate - b.loadRate) > WORKLOAD_BALANCE.LOAD_RATE_THRESHOLD) return a.loadRate - b.loadRate;
      return b.score - a.score || a.loadRate - b.loadRate;
    };

    // 1. 学院+教材 双匹配（最优解）
    const collegeAndTextbook = candidates.filter(c =>
      isCollegeEligible(c.teacher, c.cls) && isTextbookMatch(c.teacher, c.cls)
    );
    if (collegeAndTextbook.length > 0) {
      return [...collegeAndTextbook].sort(byScore)[0];
    }

    // 2. 学院匹配
    const collegeOnly = candidates.filter(c => isCollegeEligible(c.teacher, c.cls));
    if (collegeOnly.length > 0) {
      return [...collegeOnly].sort(byScore)[0];
    }

    // 3. 教材匹配（不要求学院）
    const textbookOnly = candidates.filter(c => isTextbookMatch(c.teacher, c.cls));
    if (textbookOnly.length > 0) {
      return [...textbookOnly].sort(byScore)[0];
    }

    // 4. 层次+教材 双匹配
    const levelAndTextbook = candidates.filter(c =>
      isLevelEligible(c.teacher, c.cls) && isTextbookMatch(c.teacher, c.cls)
    );
    if (levelAndTextbook.length > 0) {
      return [...levelAndTextbook].sort(byScore)[0];
    }

    // 5. 层次匹配
    const levelOnly = candidates.filter(c => isLevelEligible(c.teacher, c.cls));
    if (levelOnly.length > 0) {
      return [...levelOnly].sort(byScore)[0];
    }

    // 6. 兜底：无偏好匹配，按分数和负载率排序
    return [...candidates].sort(byScore)[0];
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

  // 阶段1：学院偏好匹配 + 教材兼容二级筛选
  const collegePairs = (t, cls) => {
    if (!isCollegeEligible(t, cls)) return false;
    if (cls.textbookIds?.length > 0) {
      const hasBetter = collegeTextbookMatchCount.get(cls.classId) > 0;
      if (hasBetter && !isTextbookMatch(t, cls)) return false;
    }
    return true;
  };
  const round1Remaining = assignRound(validClassesToAssign, collegePairs);

  // 阶段2：层次偏好匹配 + 教材兼容二级筛选
  const levelPairs = (t, cls) => {
    if (!isLevelEligible(t, cls)) return false;
    if (cls.textbookIds?.length > 0) {
      const hasBetter = levelTextbookMatchCount.get(cls.classId) > 0;
      if (hasBetter && !isTextbookMatch(t, cls)) return false;
    }
    return true;
  };
  const round2Remaining = assignRound(round1Remaining, levelPairs);

  // 阶段3：同教材硬过滤
  const textbookPairs = (t, cls) =>
    t.textbookIds?.length > 0 && cls.textbookIds?.length > 0 &&
    t.textbookIds.some(tid => cls.textbookIds.includes(tid));
  const round3Remaining = assignRound(round2Remaining, textbookPairs);

  // 阶段4：所有剩余班级，不限教师
  const round4Remaining = assignRound(round3Remaining);
  unassigned.push(...round4Remaining);

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

function isTeacherEligible(t, cls, mode) {
  const cap = mode === 'standard' ? t.standardCap : t.fullCap;
  if (t.assignedHours + cls.weeklyHours > cap) return false;
  if (t.defaultWeeklyHours != null) {
    return t.courseExistingHours + t.assignedHours + cls.weeklyHours <= t.defaultWeeklyHours;
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

  // 班级数通过 plan_courses 关联估算
  const coursePriorities = courses.map(course => {
    const teacherCount = teacherCountMap.get(course.id) || 0;
    // 优先级：教师少的课程优先处理（教师数为0时排最前）；用 MAX_SAFE_INTEGER 替代 Infinity 避免 NaN 排序
    const priority = teacherCount === 0 ? Number.MAX_SAFE_INTEGER : 1 / teacherCount;
    return { courseId: course.id, courseName: course.name, priority };
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
