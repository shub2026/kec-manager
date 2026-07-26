/**
 * 排课优化服务 - 跨课程全局禁忌搜索优化
 * 对当前学期所有已排课的教师进行全局优化，提升排课质量
 */

import prisma from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/AppError.js';
import { tabuOptimize } from './tabu-search.js';
import { createAuditLog } from '../../middleware/audit.middleware.js';

/**
 * 检查是否满足最小改进阈值
 * @param {Object} before - 优化前指标
 * @param {Object} after - 优化后指标
 * @returns {boolean} 是否满足阈值
 */
function meetsMinimumThreshold(before, after) {
  const changesCount = after.changesCount || 0;
  const scoreImprovement = before.score > 0
    ? ((before.score - after.score) / before.score) * 100
    : 0;

  // 至少需要3个班级变更且分数改进>5%
  return changesCount >= 3 && scoreImprovement > 5;
}

/**
 * 计算排课质量指标
 */
function calculateMetrics(allAssignments, teacherConstraints, mode) {
  // 1. 计算教师负载状态
  const teacherStates = new Map();
  for (const t of teacherConstraints) {
    teacherStates.set(t.id, {
      assignedHours: 0,
      textbooks: new Set(),
      classes: [],
    });
  }

  for (const a of allAssignments) {
    const state = teacherStates.get(a.teacher_id);
    if (state) {
      state.assignedHours += a.weekly_hours || 0;
      if (a.textbook_id) state.textbooks.add(a.textbook_id);
      state.classes.push(a.class_id);
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
  const teacherTextbookCounts = new Map();
  for (const state of teacherStates.values()) {
    teacherTextbookCounts.set(state.textbooks.size, (teacherTextbookCounts.get(state.textbooks.size) || 0) + 1);
  }

  const totalTeachers = teacherStates.size;
  const singleTextbookTeachers = teacherTextbookCounts.get(1) || 0;
  const cohesionScore = totalTeachers > 0 ? singleTextbookTeachers / totalTeachers : 0;

  // 4. 综合评分（越低越好）
  const score = loadVariance * 100 + (1 - cohesionScore) * 50;

  return {
    score: Math.round(score * 100) / 100,
    loadVariance: Math.round(loadVariance * 10000) / 10000,
    avgLoadRate: Math.round(avgLoadRate * 100) / 100,
    cohesionScore: Math.round(cohesionScore * 100) / 100,
    totalAssignments: allAssignments.length,
    affectedTeachers: teacherConstraints.length,
  };
}

/**
 * 构建教师约束对象
 */
function buildTeacherConstraints(teachers, classes, mode) {
  const constraints = [];
  const classMap = new Map(classes.map((c) => [c.id, c]));

  for (const t of teachers) {
    const baseHours = t.default_weekly_hours || 16;
    const standardCap = mode === 'standard' ? baseHours : baseHours * 1.2;
    const fullCap = baseHours * 1.5;

    constraints.push({
      id: t.id,
      name: t.name,
      personnelType: t.personnel_type,
      standardCap,
      fullCap,
      assignedHours: 0,
      assignedTextbookIds: new Set(),
      assignedCollegeIds: new Set(),
      preferences: new Map(
        (t.teacher_textbook_preferences || []).map((p) => [p.textbook_id, p.preference_level])
      ),
    });
  }

  return constraints;
}

/**
 * 运行排课优化（预览模式）
 * @param {number} semesterId - 学期ID
 * @param {string} mode - 排课模式 'standard' | 'full'
 * @param {Object} options - 选项
 * @param {Function} [options.onProgress] - 进度回调函数
 * @returns {Object} 优化预览结果
 */
export async function runOptimizeSchedule(semesterId, mode = 'standard', options = {}) {
  const onProgress = options.onProgress || null;
  const progress = (phase, message, percent) => {
    if (onProgress) {
      onProgress({ phase, message, percent });
    }
    logger.info(`[Optimize] ${message}`);
  };

  try {
    progress('init', '正在加载当前排课数据...', 5);

    // 1. 加载学期内所有未锁定的自动排课记录
    const currentAssignments = await prisma.teaching_assignments.findMany({
      where: {
        semester_id: semesterId,
        is_locked: false,
        is_auto: true,
      },
      include: {
        course_classes: {
          select: {
            id: true,
            course_id: true,
            textbook_id: true,
            class_name: true,
            weekly_hours: true,
          },
        },
        teachers: {
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
      throw new AppError('没有可优化的自动排课记录', 400);
    }

    progress('init', `已加载${currentAssignments.length}条排课记录`, 10);

    // 2. 按课程分组
    const courseMap = new Map();
    for (const a of currentAssignments) {
      const courseId = a.course_classes.course_id;
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

    // 3. 收集所有涉及的教师
    const allTeacherIds = new Set();
    for (const course of courseMap.values()) {
      for (const tid of course.teacherIds) {
        allTeacherIds.add(tid);
      }
    }

    // 4. 加载教师完整信息
    const teachers = await prisma.teachers.findMany({
      where: { id: { in: [...allTeacherIds] } },
      include: {
        teacher_textbook_preferences: {
          select: { textbook_id: true, preference_level: true },
        },
      },
    });

    // 5. 加载所有相关班级
    const allClassIds = new Set();
    for (const course of courseMap.values()) {
      for (const cid of course.classIds) {
        allClassIds.add(cid);
      }
    }

    const classes = await prisma.course_classes.findMany({
      where: { id: { in: [...allClassIds] } },
      select: {
        id: true,
        course_id: true,
        textbook_id: true,
        weekly_hours: true,
        class_name: true,
        college_id: true,
        training_level_id: true,
      },
    });

    progress('prepare', '正在构建约束条件...', 25);

    // 6. 构建全局教师约束（跨课程共享）
    const teacherConstraints = buildTeacherConstraints(teachers, classes, mode);

    // 7. 计算优化前指标
    const beforeMetrics = calculateMetrics(currentAssignments, teacherConstraints, mode);
    beforeMetrics.changesCount = 0;

    // 8. 准备学期字符串
    const semesterStr = `${semesterId}`;

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
        const cls = classes.find((c) => c.id === classId);
        if (cls) {
          classMap.set(classId, {
            classId: cls.id,
            className: cls.class_name || `班级${cls.id}`,
            weeklyHours: cls.weekly_hours,
            textbookIds: cls.textbook_id ? [cls.textbook_id] : [],
            collegeId: cls.college_id,
            trainingLevelId: cls.training_level_id,
          });
        }
      }

      // 构建该课程的 assignments 数组
      const courseAssignments = course.assignments.map((a) => ({
        teacher_id: a.teacher_id,
        teacher_name: a.teachers.name,
        class_id: a.class_id,
        class_name: a.course_classes.class_name || `班级${a.class_id}`,
        course_id: Number(courseId),
        semester: semesterStr,
        weekly_hours: a.weekly_hours || a.course_classes.weekly_hours,
        is_auto: true,
        memberClassIds: null,
      }));

      // unassigned 为空（所有班级都已排课）
      const courseUnassigned = [];

      // 运行禁忌搜索（会原地修改 assignments、unassigned 和 teacherConstraints）
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

        // 将优化后的 assignments 写回 course.assignments（用于后续指标计算）
        course.assignments = courseAssignments.map((a, idx) => ({
          ...course.assignments[idx],
          teacher_id: a.teacher_id,
        }));
      } catch (tsErr) {
        logger.warn(`[Optimize] 课程${courseId}优化异常，已跳过: ${tsErr.message}`);
      }
    }

    progress('validate', '正在验证优化结果...', 80);

    // 10. 构建优化后的全局排课方案
    const optimizedAssignments = [];
    for (const course of courseMap.values()) {
      for (const a of course.assignments) {
        optimizedAssignments.push({
          teacher_id: a.teacher_id,
          class_id: a.class_id,
          textbook_id: a.course_classes.textbook_id,
          weekly_hours: a.weekly_hours || a.course_classes.weekly_hours,
        });
      }
    }

    // 11. 计算优化后指标
    const afterMetrics = calculateMetrics(optimizedAssignments, teacherConstraints, mode);
    afterMetrics.changesCount = totalIterations;

    // 12. 计算改进幅度
    const improvements = {
      scoreImprovement: beforeMetrics.score > 0
        ? Math.round(((beforeMetrics.score - afterMetrics.score) / beforeMetrics.score) * 10000) / 100
        : 0,
      loadVarianceImprovement: beforeMetrics.loadVariance > 0
        ? Math.round(((beforeMetrics.loadVariance - afterMetrics.loadVariance) / beforeMetrics.loadVariance) * 10000) / 100
        : 0,
      cohesionImprovement: beforeMetrics.cohesionScore > 0
        ? Math.round(((afterMetrics.cohesionScore - beforeMetrics.cohesionScore) / beforeMetrics.cohesionScore) * 10000) / 100
        : 0,
    };

    // 13. 检查是否满足最小改进阈值
    const meetsThreshold = meetsMinimumThreshold(beforeMetrics, afterMetrics);

    // 14. 构建变更详情
    const changes = [];
    for (const original of currentAssignments) {
      const optimized = optimizedAssignments.find((a) => a.class_id === original.class_id);
      if (optimized && optimized.teacher_id !== original.teacher_id) {
        changes.push({
          classId: original.class_id,
          courseId: original.course_classes.course_id,
          fromTeacher: {
            id: original.teacher_id,
            name: original.teachers.name,
          },
          toTeacher: {
            id: optimized.teacher_id,
            name: teachers.find((t) => t.id === optimized.teacher_id)?.name || '未知',
          },
        });
      }
    }

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
  try {
    // 使用事务批量更新
    await prisma.$transaction(async (tx) => {
      for (const change of changes) {
        await tx.teaching_assignments.updateMany({
          where: {
            semester_id: semesterId,
            class_id: change.classId,
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

    // 记录审计日志
    await createAuditLog({
      userId,
      action: 'optimize_schedule',
      targetType: 'semester',
      targetId: semesterId,
      details: `应用排课优化结果，变更${changes.length}个班级的教师分配`,
    });

    logger.info(`[Optimize] 已应用优化结果，变更${changes.length}个班级`);

    return {
      success: true,
      appliedChanges: changes.length,
    };
  } catch (error) {
    logger.error('应用优化结果失败:', error);
    throw new AppError('应用优化结果失败', 500);
  }
}
