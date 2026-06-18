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

  for (const pc of planCourses) {
    const plan = pc.training_plans;

    // 找到该课程在当前学期的学期记录
    const semRecords = pc.plan_course_semesters.filter(s =>
      s.semester >= pc.start_semester && s.semester <= pc.end_semester
    );

    for (const sem of semRecords) {
      // 计算对应入学年份
      const gradeForThisSemester = Math.ceil(sem.semester / 2);
      const enrollmentYear = semesterInfo.startYear - gradeForThisSemester + 1;

      for (const cls of allClasses) {
        if (cls.enrollment_year !== enrollmentYear) continue;

        // 方案匹配逻辑（三级优先）
        let isMatch = false;
        if (cls.custom_plan_id === plan.id) {
          isMatch = true;
        } else if (!cls.custom_plan_id && cls.major_id === plan.major_id) {
          isMatch = true;
        } else if (!cls.custom_plan_id && cls.training_level_id === plan.training_level_id) {
          isMatch = true;
        }
        if (!isMatch) continue;

        // 验证学期号
        const calc = calcClassSemester(cls, semesterInfo);
        if (!calc || calc.currentSemesterNum !== sem.semester) continue;

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
      courses: { some: { course_id: Number(courseId) } },
    },
    include: {
      courses: { include: { course: { select: { id: true, name: true } } } },
      scheduling_colleges: { select: { college_id: true } },
      scheduling_levels: { include: { training_level: { select: { id: true, name: true } } } },
    },
    orderBy: { sort_order: 'asc' },
  });

  // 查询每个教师当前学期已安排的总课时
  const teacherWorkloads = await prisma.teaching_assignments.groupBy({
    by: ['teacher_id'],
    where: { semester: semesterStr },
    _sum: { weekly_hours: true },
  });
  const workloadMap = new Map(teacherWorkloads.map(w => [w.teacher_id, w._sum.weekly_hours || 0]));

  // 查询每个教师当前学期安排的班级数
  const teacherClassCounts = await prisma.teaching_assignments.groupBy({
    by: ['teacher_id'],
    where: { semester: semesterStr },
    _count: { id: true },
  });
  const classCountMap = new Map(teacherClassCounts.map(w => [w.teacher_id, w._count.id || 0]));

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

  // 获取教师的教材数据（用于同教材匹配）
  const allCourseIds = [...new Set(teachers.flatMap(t => t.courses.map(tc => tc.course_id)))];
  const teacherTextbookMap = new Map(); // teacherId -> textbookIds[]

  if (allCourseIds.length > 0) {
    const planCourses = await prisma.plan_courses.findMany({
      where: { course_id: { in: allCourseIds } },
      include: {
        plan_course_semesters: {
          include: {
            plan_textbooks: { select: { textbook_id: true } },
          },
        },
      },
    });

    // courseId -> Set of textbookIds
    const courseTextbookMap = new Map();
    for (const pc of planCourses) {
      if (!courseTextbookMap.has(pc.course_id)) {
        courseTextbookMap.set(pc.course_id, new Set());
      }
      const set = courseTextbookMap.get(pc.course_id);
      for (const sem of pc.plan_course_semesters) {
        for (const pt of sem.plan_textbooks) {
          set.add(pt.textbook_id);
        }
      }
    }

    // 为每个教师聚合教材ID
    for (const t of teachers) {
      const textbookIds = new Set();
      for (const tc of t.courses) {
        const set = courseTextbookMap.get(tc.course_id);
        if (set) {
          for (const tid of set) textbookIds.add(tid);
        }
      }
      teacherTextbookMap.set(t.id, [...textbookIds]);
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
    textbookIds: teacherTextbookMap.get(t.id) || [],
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
 * @param {string[]} conditions - 排课条件 ['same_textbook']
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

  // 同教材匹配：仅当勾选了"同教材"条件时才生效
  if (conditions.includes('same_textbook') && teacher.textbookIds?.length && classInfo.textbookIds?.length) {
    const hasSameTextbook = teacher.textbookIds.some(tid => classInfo.textbookIds.includes(tid));
    if (hasSameTextbook) {
      score += 2;
    }
  }

  return score;
}

/**
 * 自动排课核心算法
 * @param {number} courseId - 课程ID
 * @param {string} semesterStr - 学期字符串
 * @param {object} settings - 排课设置
 * @param {string} mode - 'full' | 'standard'
 * @param {object} hourSettings - { full_time: { standard, max }, part_time: { standard, max }, external: { standard, max } }
 * @param {string[]} scheduleConditions - 排课条件 ['same_textbook', 'same_college']
 */
export async function autoArrange(courseId, semesterStr, mode, hourSettings, scheduleConditions) {
  // 1. 获取合格教师
  const teachers = await getTeachersForCourse(courseId, semesterStr);
  if (!teachers.length) return { assigned: [], unassigned: [], message: '该课程没有可用教师' };

  // 2. 获取班级列表
  const classes = await getClassesWithCourse(courseId, semesterStr);
  if (!classes.length) return { assigned: [], unassigned: [], message: '当前学期没有开设该课程的班级' };

  // 3. 获取当前已有的手动安排（不覆盖）
  const manualAssignments = await prisma.teaching_assignments.findMany({
    where: {
      course_id: Number(courseId),
      semester: semesterStr,
      is_auto: false,
    },
  });
  const manualClassIds = new Set(manualAssignments.map(a => a.class_id));

  // 4. 查询当前课程已有的自动安排课时（这些将被替换，需要从 currentTotal 中扣除）
  const currentAutoHours = await prisma.teaching_assignments.groupBy({
    by: ['teacher_id'],
    where: {
      course_id: Number(courseId),
      semester: semesterStr,
      is_auto: true,
    },
    _sum: { weekly_hours: true },
  });
  const autoHoursMap = new Map(currentAutoHours.map(w => [w.teacher_id, w._sum.weekly_hours || 0]));

  // 5. 过滤出需要自动安排的班级，并预计算 textbookIds
  const classesToAssign = classes
    .filter(c => !manualClassIds.has(c.classId))
    .map(c => ({
      ...c,
      textbookIds: (c.textbooks || []).map(tb => tb.id),
    }));

  // 6. 计算每个教师的课时约束
  const conditions = scheduleConditions || [];
  const teacherConstraints = teachers.map(t => {
    const personnelType = t.personnelType || 'full_time';
    const setting = hourSettings[personnelType] || { standard: 16, max: 20 };
    const standardHours = setting.standard;
    const maxHours = setting.max;
    const currentTotal = t.totalWeeklyHours;

    // 扣除当前课程已有的自动安排课时（将被替换）
    const autoHoursForCourse = autoHoursMap.get(t.id) || 0;
    const effectiveTotal = currentTotal - autoHoursForCourse;

    // 当前课程已有课时（含手动安排，不会被自动替换）
    const courseExistingHours = t.courseHours - autoHoursForCourse;

    // 总体容量天花板：由人员类别决定，不受 defaultWeeklyHours 影响
    const standardCap = Math.max(0, standardHours - effectiveTotal);
    const fullCap = Math.max(0, maxHours - effectiveTotal);

    return {
      ...t,
      standardHours,
      maxHours,
      currentTotal,
      effectiveTotal,
      courseExistingHours,
      standardCap,
      fullCap,
      assignedHours: 0, // 本次自动安排已分配的课时
    };
  });

  // 7. 两轮贪心分配
  const assignments = [];
  const unassigned = [];

  /**
   * 尝试为班级列表分配教师
   * @param {Array} classList - 待分配的班级
   * @returns {Array} 未能分配的班级
   */
  function assignRound(classList) {
    const remaining = [];
    for (const cls of classList) {
      const candidates = teacherConstraints
        .filter(t => {
          // 总体容量检查：不超过人员类别的课时上限
          const overallOk = mode === 'standard'
            ? t.assignedHours + cls.weeklyHours <= t.standardCap
            : t.assignedHours + cls.weeklyHours <= t.fullCap;
          if (!overallOk) return false;

          // 本课程课时检查：有默认周课时的，不超过该值
          if (t.defaultWeeklyHours != null) {
            return t.courseExistingHours + t.assignedHours + cls.weeklyHours <= t.defaultWeeklyHours;
          }
          return true;
        })
        .map(t => ({
          teacher: t,
          score: calcMatchScore(t, cls, conditions),
          currentLoad: t.effectiveTotal + t.assignedHours,
        }))
        .sort((a, b) => {
          // 先按匹配分数降序
          if (b.score !== a.score) return b.score - a.score;
          // 再按当前负载升序（选最空闲的）
          return a.currentLoad - b.currentLoad;
        });

      if (candidates.length === 0) {
        remaining.push(cls);
        continue;
      }

      const selected = candidates[0].teacher;
      selected.assignedHours += cls.weeklyHours;

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

  // 第一轮：优先处理有指定学院或层次匹配的班级（确保教师优先安排到匹配的班级）
  const isMatched = (cls) => teacherConstraints.some(t =>
    (t.schedulingCollegeIds?.length && t.schedulingCollegeIds.includes(cls.collegeId)) ||
    (t.schedulingLevelIds?.length && cls.trainingLevelId && t.schedulingLevelIds.includes(cls.trainingLevelId))
  );
  const matchedClasses = classesToAssign.filter(isMatched);
  const otherClasses = classesToAssign.filter(cls => !isMatched(cls));

  const round1Remaining = assignRound(matchedClasses);
  // 第二轮：处理剩余班级（含第一轮未成功分配的）
  const round2Remaining = assignRound([...otherClasses, ...round1Remaining]);
  unassigned.push(...round2Remaining);

  // 8. 写入数据库（事务 + 串行）
  if (assignments.length > 0) {
    await prisma.$transaction(async (tx) => {
      // 先删除该课程+学期的自动安排记录
      await tx.teaching_assignments.deleteMany({
        where: {
          course_id: Number(courseId),
          semester: semesterStr,
          is_auto: true,
        },
      });

      // 串行写入新安排
      for (const a of assignments) {
        await tx.teaching_assignments.upsert({
          where: {
            class_id_course_id_semester: {
              class_id: a.class_id,
              course_id: a.course_id,
              semester: a.semester,
            },
          },
          update: {
            teacher_id: a.teacher_id,
            weekly_hours: a.weekly_hours,
            is_auto: true,
          },
          create: {
            teacher_id: a.teacher_id,
            class_id: a.class_id,
            course_id: a.course_id,
            semester: a.semester,
            weekly_hours: a.weekly_hours,
            is_auto: true,
          },
        });
      }
    });
  }

  return {
    assigned: assignments,
    unassigned: unassigned.map(c => ({
      classId: c.classId,
      className: c.className,
      weeklyHours: c.weeklyHours,
    })),
    totalClasses: classesToAssign.length,
    manualCount: manualAssignments.length,
    autoCount: assignments.length,
    unassignedCount: unassigned.length,
  };
}
