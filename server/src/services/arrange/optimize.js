/**
 * 排课优化服务 - 跨课程全局禁忌搜索优化
 * 对当前学期所有已排课的教师进行全局优化，提升排课质量
 */

import { prisma } from '../../lib/prisma.js';
import logger from '../../utils/logger.js';
import { DEFAULT_HOUR_SETTINGS, TEXTBOOK_COHESION } from '../../constants/index.js';
import { tabuOptimize } from './tabu-search.js';
import { calcMatchScore } from './auto-arrange.js';
import { createAuditLog } from '../../services/audit.service.js';

/**
 * 检查是否满足最小改进阈值
 */
function meetsMinimumThreshold(before, after) {
  const changesCount = after.changesCount || 0;
  const scoreImprovement = before.score > 0
    ? ((after.score - before.score) / Math.abs(before.score)) * 100
    : 0;

  return changesCount >= 3 && scoreImprovement > 5;
}

/**
 * 计算排课质量指标 - 使用 calcMatchScore 统一评分
 */
function calculateMetrics(allAssignments, teacherConstraints, classMap, mode) {
  const teacherMap = new Map(teacherConstraints.map((t) => [t.id, t]));

  // 1. 计算教师负载状态
  const teacherStates = new Map();
  for (const t of teacherConstraints) {
    teacherStates.set(t.id, {
      assignedHours: 0,
      textbooks: new Set(),
      colleges: new Set(),
      classes: [],
    });
  }

  // 计算总匹配分数
  let totalMatchScore = 0;
  let matchCount = 0;

  for (const a of allAssignments) {
    const state = teacherStates.get(a.teacher_id);
    const cls = classMap.get(a.class_id);
    if (state) {
      state.assignedHours += a.weekly_hours || 0;
      state.classes.push(a.class_id);
      if (cls) {
        for (const tid of cls.textbookIds || []) state.textbooks.add(tid);
        if (cls.collegeId != null) state.colleges.add(cls.collegeId);
      }
    }

    // 使用 calcMatchScore 计算实际匹配分数
    const teacher = teacherMap.get(a.teacher_id);
    if (teacher && cls) {
      const proxy = {
        ...teacher,
        assignedTextbookIds: state?.textbooks || new Set(),
        assignedCollegeIds: state?.colleges || new Set(),
        assignedHours: state?.assignedHours || 0,
      };
      totalMatchScore += calcMatchScore(proxy, cls);
      matchCount++;
    }
  }

  // 2. 计算负载均衡度
  const loadRates = [];
  for (const t of teacherConstraints) {
    const state = teacherStates.get(t.id);
    if (!state) continue;
    const cap = mode === 'standard' ? t.standardCap : t.fullCap;
    if (cap > 0) {
      loadRates.push(state.assignedHours / cap);
    }
  }

  const avgLoadRate = loadRates.length > 0
    ? loadRates.reduce((s, r) => s + r, 0) / loadRates.length
    : 0;

  const loadVariance = loadRates.length > 1
    ? loadRates.reduce((s, r) => s + (r - avgLoadRate) ** 2, 0) / loadRates.length
    : 0;

  // 3. 计算教材内聚度
  let cohesionSum = 0;
  let teacherCount = 0;
  for (const [tid, state] of teacherStates) {
    if (state.classes.length === 0) continue;
    const tbSize = state.textbooks.size;
    const classCount = state.classes.length;
    const cohesion = classCount > 0 ? Math.max(0, 1 - (tbSize - 1) / classCount) : 1;
    cohesionSum += cohesion;
    teacherCount++;
  }

  const textbookCohesionRate = teacherCount > 0
    ? Math.round((cohesionSum / teacherCount) * 100)
    : 100;

  // 4. 综合评分 = 总匹配分数（越高越好）
  const score = Math.round(totalMatchScore * 100) / 100;

  return {
    score,
    avgMatchScore: matchCount > 0 ? Math.round((totalMatchScore / matchCount) * 100) / 100 : 0,
    loadVariance: Math.round(loadVariance * 10000) / 10000,
    avgLoadRate: Math.round(avgLoadRate * 100) / 100,
    textbookCohesionRate,
    totalAssignments: allAssignments.length,
    affectedTeachers: teacherConstraints.length,
  };
}

/**
 * 构建教师约束对象 - 与 auto-arrange.js 的 buildTeacherConstraints 对齐
 * 确保包含 calcMatchScore、canAccept、buildTeacherStates 所需的全部字段
 */
function buildTeacherConstraints(teachers, allAssignments, classMap, mode) {
  // 构建教师现有分配统计
  const teacherHoursMap = new Map();
  const teacherTextbookMap = new Map();
  const teacherCollegeMap = new Map();

  for (const a of allAssignments) {
    const tid = a.teacher_id;
    teacherHoursMap.set(tid, (teacherHoursMap.get(tid) || 0) + (a.weekly_hours || 0));

    const cls = classMap.get(a.class_id);
    if (cls) {
      if (!teacherTextbookMap.has(tid)) teacherTextbookMap.set(tid, new Set());
      for (const tbId of cls.textbookIds || []) {
        teacherTextbookMap.get(tid).add(tbId);
      }
      if (!teacherCollegeMap.has(tid)) teacherCollegeMap.set(tid, new Set());
      if (cls.collegeId != null) teacherCollegeMap.get(tid).add(cls.collegeId);
    }
  }

  return teachers.map((t) => {
    const personnelType = t.personnel_type || 'full_time';
    const setting = DEFAULT_HOUR_SETTINGS[personnelType] || DEFAULT_HOUR_SETTINGS.full_time;

    const existingHours = teacherHoursMap.get(t.id) || 0;
    const baseHours = t.default_weekly_hours || setting.standard;

    // 容量计算：与 auto-arrange 对齐
    const teacherHourCap = t.default_weekly_hours != null
      ? Math.max(0, t.default_weekly_hours - existingHours)
      : null;
    const rawStandardCap = teacherHourCap != null
      ? Math.min(teacherHourCap, Math.max(0, setting.standard - existingHours))
      : Math.max(0, setting.standard - existingHours);
    const rawFullCap = teacherHourCap != null
      ? Math.min(teacherHourCap, Math.max(0, setting.max - existingHours))
      : Math.max(0, setting.max - existingHours);

    const standardCap = Math.floor(rawStandardCap);
    const fullCap = Math.floor(rawFullCap);

    // 提取 schedulingCollegeIds 和 schedulingLevelIds
    const schedulingCollegeIds = (t.scheduling_colleges || []).map((sc) => sc.college_id);
    const schedulingLevelIds = (t.scheduling_levels || []).map((sl) => sl.training_level?.id).filter(Boolean);

    // 已分配教材和学院（从现有排课记录）
    const assignedTextbookIds = teacherTextbookMap.get(t.id) || new Set();
    const assignedCollegeIds = teacherCollegeMap.get(t.id) || new Set();

    // 固有教材快照（与 auto-arrange 的 P1-A 修复对齐）
    const inherentTextbookIds = [...assignedTextbookIds];

    return {
      // 展开保留所有教师字段（与 auto-arrange 一致）
      id: t.id,
      name: t.name,
      personnelType,
      defaultWeeklyHours: t.default_weekly_hours,
      gender: t.gender,

      // 意向约束 - 关键字段
      schedulingCollegeIds,
      schedulingLevelIds,

      // 教材相关 - 关键字段
      inherentTextbookIds,
      textbookIds: [...inherentTextbookIds],
      assignedTextbookIds: new Set(assignedTextbookIds),
      assignedCollegeIds: new Set(assignedCollegeIds),

      // 容量
      standardHours: setting.standard,
      maxHours: setting.max,
      standardCap,
      fullCap,
      teacherHourCap,
      effectiveTotal: existingHours,
      assignedHours: 0, // tabuOptimize 会从 assignments 重建

      // 偏好
      // Schema 对齐修复：teachers 模型无 teacher_textbook_preferences 关系，
      // 教材偏好已通过 plan_textbooks 体现到 classMap.textbookIds，此处留空 Map 保持字段存在
      preferences: new Map(),
    };
  });
}

/**
 * 运行排课优化（预览模式）
 */
export async function runOptimizeSchedule(semesterId, mode = 'standard', options = {}) {
  const onProgress = options.onProgress || null;
  const progress = (phase, message, percent) => {
    if (onProgress) {
      onProgress({ phase, message, percent });
    }
    logger.info(`[Optimize] ${message}`);
  };

  const semesterStr = `${semesterId}`;

  try {
    progress('init', '正在加载当前排课数据...', 5);

    // 1. 加载学期内所有未锁定的自动排课记录
    // Schema 对齐修复：teaching_assignments 用 semester（非 semester_id），
    // 关系为 class/teacher/course（非 course_classes/teachers）
    const currentAssignments = await prisma.teaching_assignments.findMany({
      where: {
        semester: semesterStr,
        is_locked: false,
        is_auto: true,
      },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            college_id: true,
            training_level_id: true,
            combination_id: true,
          },
        },
        teacher: {
          select: {
            id: true,
            name: true,
            personnel_type: true,
            default_weekly_hours: true,
          },
        },
      },
    });

    if (currentAssignments.length === 0) {
      throw new Error('没有可优化的自动排课记录');
    }

    progress('init', `已加载${currentAssignments.length}条排课记录`, 10);

    // 2. 按课程分组（course_id 直接在 teaching_assignments 上）
    const courseMap = new Map();
    for (const a of currentAssignments) {
      const courseId = a.course_id;
      if (!courseMap.has(courseId)) {
        courseMap.set(courseId, {
          courseId,
          assignments: [],
          classIds: new Set(),
          teacherIds: new Set(),
        });
      }
      const course = courseMap.get(courseId);
      course.assignments.push(a);
      course.classIds.add(a.class_id);
      course.teacherIds.add(a.teacher_id);
    }

    progress('init', `涉及${courseMap.size}门课程`, 15);

    // 3. 收集所有涉及的教师和班级
    const allTeacherIds = new Set();
    const allClassIds = new Set();
    for (const course of courseMap.values()) {
      for (const tid of course.teacherIds) allTeacherIds.add(tid);
      for (const cid of course.classIds) allClassIds.add(cid);
    }

    // 4. 加载教师完整信息（含 scheduling_colleges、scheduling_levels）
    // Schema 对齐修复：teachers 模型无 teacher_textbook_preferences 关系
    const teachers = await prisma.teachers.findMany({
      where: { id: { in: [...allTeacherIds] } },
      include: {
        scheduling_colleges: { select: { college_id: true } },
        scheduling_levels: {
          include: { training_level: { select: { id: true, name: true } } },
        },
      },
    });

    // 5. 加载所有相关班级的教材信息
    // Schema 对齐修复：classes 模型无 textbook_id/weekly_hours/class_name 字段，
    // 教材需通过 plan_courses → plan_course_semesters → plan_textbooks 关联获取。
    // 课时取自 teaching_assignments.weekly_hours（已落库）。
    // 按 courseId 分组查询每门课程的教材映射（一个 courseId 可能对应多个 plan_course + semester 记录）。
    const courseTextbookMap = new Map(); // courseId → Map(classId → textbookIds[])
    for (const [courseId] of courseMap) {
      const planCourses = await prisma.plan_courses.findMany({
        where: { course_id: courseId },
        include: {
          training_plans: { select: { id: true, sort_order: true } },
          plan_course_semesters: {
            include: {
              plan_textbooks: { include: { textbooks: { select: { id: true } } } },
            },
          },
        },
        orderBy: [{ training_plans: { sort_order: 'asc' } }, { id: 'asc' }],
      });

      // 为该课程的每个班级匹配教材（取首个匹配方案的教材，与 getClassesWithCourse 的简化版）
      // 优化场景只需教材 ID 用于内聚评分，不需课时（课时已从 assignments 获取）
      const classTbMap = new Map();
      for (const cls of currentAssignments.filter((a) => a.course_id === courseId)) {
        const clsData = await prisma.classes.findUnique({
          where: { id: cls.class_id },
          select: {
            id: true,
            major_id: true,
            training_level_id: true,
            enrollment_year: true,
            custom_plan_id: true,
          },
        });
        if (!clsData) continue;

        // 找匹配的 plan_course（按 major/training_level 简化匹配）
        const matchedPc = planCourses.find(
          (pc) =>
            pc.training_plans.major_id === clsData.major_id ||
            pc.training_plans.training_level_id === clsData.training_level_id
        );
        const textbooks = matchedPc?.plan_course_semesters?.flatMap(
          (s) => s.plan_textbooks?.map((pt) => pt.textbooks?.id).filter(Boolean) || []
        ) || [];
        classTbMap.set(cls.class_id, textbooks);
      }
      courseTextbookMap.set(courseId, classTbMap);
    }

    progress('prepare', '正在构建约束条件...', 25);

    // 6. 构建全局班级映射（含 textbookIds 数组）
    // Schema 对齐修复：class_name → name，weekly_hours 取自 assignments，textbookIds 取自 courseTextbookMap
    const globalClassMap = new Map();
    for (const a of currentAssignments) {
      if (globalClassMap.has(a.class_id)) continue;
      const cls = a.class;
      const tbIds = courseTextbookMap.get(a.course_id)?.get(a.class_id) || [];
      globalClassMap.set(a.class_id, {
        classId: a.class_id,
        className: cls?.name || `班级${a.class_id}`,
        weeklyHours: a.weekly_hours || 0,
        textbookIds: tbIds,
        collegeId: cls?.college_id,
        trainingLevelId: cls?.training_level_id,
      });
    }

    // 7. 构建全局教师约束（含完整字段）
    const teacherConstraints = buildTeacherConstraints(
      teachers,
      currentAssignments,
      globalClassMap,
      mode
    );

    // 8. 计算优化前指标（使用 calcMatchScore）
    const beforeMetrics = calculateMetrics(
      currentAssignments.map((a) => ({
        teacher_id: a.teacher_id,
        class_id: a.class_id,
        weekly_hours: a.weekly_hours || 0,
      })),
      teacherConstraints,
      globalClassMap,
      mode
    );
    beforeMetrics.changesCount = 0;

    // 9. 逐课程运行禁忌搜索（共享教师约束）
    progress('optimize', '正在运行全局优化算法...', 35);

    let totalIterations = 0;
    let improvedCourses = 0;
    const courseResults = [];

    const courseEntries = [...courseMap.entries()];
    const totalCourses = courseEntries.length;

    for (let i = 0; i < courseEntries.length; i++) {
      const [courseId, course] = courseEntries[i];
      const progressPercent = 35 + Math.floor((i / totalCourses) * 40);
      progress('optimize', `正在优化课程 ${i + 1}/${totalCourses}...`, progressPercent);

      // 构建该课程的班级映射
      const classMap = new Map();
      for (const classId of course.classIds) {
        const cls = globalClassMap.get(classId);
        if (cls) classMap.set(classId, cls);
      }

      // 构建该课程的 assignments 数组
      const courseAssignments = course.assignments.map((a) => ({
        teacher_id: a.teacher_id,
        teacher_name: a.teacher.name,
        class_id: a.class_id,
        class_name: a.class?.name || `班级${a.class_id}`,
        course_id: Number(courseId),
        semester: semesterStr,
        weekly_hours: a.weekly_hours || 0,
        is_auto: true,
        memberClassIds: null,
      }));

      const courseUnassigned = [];

      try {
        const tsResult = tabuOptimize(
          courseAssignments,
          courseUnassigned,
          teacherConstraints,
          mode,
          classMap,
          courseId,
          semesterStr
        );

        totalIterations += tsResult.iterations;

        if (tsResult.improved) {
          improvedCourses++;
          courseResults.push({
            courseId,
            improved: true,
            scoreBefore: tsResult.scoreBefore,
            scoreAfter: tsResult.scoreAfter,
            delta: tsResult.delta,
            iterations: tsResult.iterations,
          });

          logger.info(
            `[Optimize] 课程${courseId}优化成功: 评分 ${tsResult.scoreBefore}→${tsResult.scoreAfter} ` +
              `(+${tsResult.delta}), 迭代 ${tsResult.iterations}次, 耗时 ${tsResult.elapsed}ms`
          );
        }

        // 将优化后的 assignments 写回 course.assignments
        course.assignments = courseAssignments.map((a, idx) => ({
          ...course.assignments[idx],
          teacher_id: a.teacher_id,
        }));
      } catch (tsErr) {
        logger.warn(`[Optimize] 课程${courseId}优化异常，已跳过: ${tsErr.message}`);
      }
    }

    progress('validate', '正在验证优化结果...', 80);

    // 11. 构建优化后的全局排课方案
    const optimizedAssignments = [];
    for (const course of courseMap.values()) {
      for (const a of course.assignments) {
        optimizedAssignments.push({
          teacher_id: a.teacher_id,
          class_id: a.class_id,
          course_id: a.course_id,
          weekly_hours: a.weekly_hours || 0,
        });
      }
    }

    // 12. 计算优化后指标
    const afterMetrics = calculateMetrics(
      optimizedAssignments,
      teacherConstraints,
      globalClassMap,
      mode
    );

    // 13. 构建变更详情（先于阈值判定，changesCount 需基于真实变更数）
    // Schema 对齐修复：courseId 取自 original.course_id（非 original.course_classes.course_id）
    // 匹配同时校验 class_id + course_id，避免跨课程误配（teaching_assignments 唯一约束为 [class_id, course_id, semester]）
    const changes = [];
    for (const original of currentAssignments) {
      const optimized = optimizedAssignments.find(
        (a) => a.class_id === original.class_id && a.course_id === original.course_id
      );
      if (optimized && optimized.teacher_id !== original.teacher_id) {
        const clsInfo = globalClassMap.get(original.class_id);
        changes.push({
          classId: original.class_id,
          courseId: original.course_id,
          className: clsInfo?.className || original.class?.name || `班级${original.class_id}`,
          fromTeacher: {
            id: original.teacher_id,
            name: original.teacher.name,
          },
          toTeacher: {
            id: optimized.teacher_id,
            name: teachers.find((t) => t.id === optimized.teacher_id)?.name || '未知',
          },
        });
      }
    }
    afterMetrics.changesCount = changes.length;

    // 14. 计算改进幅度
    const improvements = {
      scoreImprovement: beforeMetrics.score !== 0
        ? Math.round(((afterMetrics.score - beforeMetrics.score) / Math.abs(beforeMetrics.score)) * 10000) / 100
        : 0,
      loadVarianceImprovement: beforeMetrics.loadVariance > 0
        ? Math.round(((beforeMetrics.loadVariance - afterMetrics.loadVariance) / beforeMetrics.loadVariance) * 10000) / 100
        : 0,
      cohesionImprovement: beforeMetrics.textbookCohesionRate > 0
        ? Math.round(((afterMetrics.textbookCohesionRate - beforeMetrics.textbookCohesionRate) / beforeMetrics.textbookCohesionRate) * 10000) / 100
        : 0,
    };

    // 15. 检查是否满足最小改进阈值
    const meetsThreshold = meetsMinimumThreshold(beforeMetrics, afterMetrics);

    progress('complete', '优化分析完成', 100);

    return {
      semesterId,
      mode,
      before: beforeMetrics,
      after: afterMetrics,
      improvements,
      meetsThreshold,
      changes,
      courseResults,
      summary: {
        totalClasses: currentAssignments.length,
        changedClasses: changes.length,
        affectedTeachers: teacherConstraints.length,
        affectedCourses: courseMap.size,
        improvedCourses,
        totalIterations,
      },
    };
  } catch (error) {
    logger.error('排课优化失败:', error);
    throw error;
  }
}

/**
 * 应用优化结果到数据库
 */
export async function applyOptimizeResult(semesterId, changes, userId) {
  const semesterStr = `${semesterId}`;
  try {
    await prisma.$transaction(async (tx) => {
      for (const change of changes) {
        // Schema 对齐修复：teaching_assignments 用 semester（非 semester_id）
        // where 同时匹配 class_id + course_id + semester，对齐唯一约束
        await tx.teaching_assignments.updateMany({
          where: {
            semester: semesterStr,
            class_id: change.classId,
            course_id: change.courseId,
            teacher_id: change.fromTeacher.id,
            is_locked: false,
          },
          data: {
            teacher_id: change.toTeacher.id,
            updated_at: new Date(),
          },
        });
      }
    });

    await createAuditLog({
      userId,
      action: 'update',
      module: 'teachingArrange',
      details: { semester: semesterStr, changesCount: changes.length },
      result: 'success',
      message: `应用排课优化结果，变更${changes.length}个班级的教师分配`,
    }).catch(() => {});

    logger.info(`[Optimize] 已应用优化结果，变更${changes.length}个班级`);

    return {
      success: true,
      appliedChanges: changes.length,
    };
  } catch (error) {
    logger.error('应用优化结果失败:', error);
    throw new Error('应用优化结果失败', { cause: error });
  }
}
