import { prisma } from '../../lib/prisma.js';
import { DEFAULT_HOUR_SETTINGS, BATCH_CONFIG } from '../../constants/index.js';
import { validateHourSettings } from './validate.js';
import { autoArrange, batchLocks } from './auto-arrange.js';
import logger from '../../utils/logger.js';

// M-13: 批量排课超时上限（5分钟）
const BATCH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 批量自动排课：为指定学期下所有课程依次执行自动排课
 * 优先处理"可选教师少"的课程，避免这些课程因容量耗尽而无法分配
 */
export async function batchAutoArrange(
  semesterStr,
  mode,
  hourSettings,
  scheduleConditions,
  options = {}
) {
  const onProgress = options.onProgress;
  validateHourSettings(hourSettings);

  // M-12 / P1-12: 并发保护——按学期锁定整个学期，扩大锁范围避免单课程排课插入
  // 原先按 semesterStr:mode 锁定，导致同 semester 不同 mode 仍可与单课程排课并发
  const lockKey = semesterStr;
  if (batchLocks.has(lockKey)) {
    throw new Error(`学期 ${semesterStr} 的批量排课正在进行中，请稍后再试`);
  }
  batchLocks.add(lockKey);

  // M-13: 超时保护
  const startTime = Date.now();
  logger.info(`[批量排课] 开始 semester=${semesterStr} mode=${mode} preview=${!!options.preview}`);

  try {
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

    const teacherCounts = await prisma.teacher_courses.groupBy({
      by: ['course_id'],
      where: { teacher: { status: 'active' } },
      _count: { teacher_id: true },
    });
    const teacherCountMap = new Map(teacherCounts.map((r) => [r.course_id, r._count.teacher_id]));

    const courseHourDemands = await prisma.plan_course_semesters.groupBy({
      by: ['plan_course_id'],
      where: { plan_courses: { course_id: { in: courses.map((c) => c.id) } } },
      _sum: { weekly_hours: true },
    });
    const planCourseToCourse = await prisma.plan_courses.findMany({
      where: { course_id: { in: courses.map((c) => c.id) } },
      select: { id: true, course_id: true },
    });
    const courseDemandMap = new Map();
    for (const pc of planCourseToCourse) {
      const demand = courseHourDemands.find((d) => d.plan_course_id === pc.id);
      if (demand) {
        courseDemandMap.set(
          pc.course_id,
          (courseDemandMap.get(pc.course_id) || 0) + (demand._sum.weekly_hours || 0)
        );
      }
    }

    const defaultStandard =
      hourSettings.full_time?.standard || DEFAULT_HOUR_SETTINGS.full_time.standard;

    const coursePriorities = courses.map((course) => {
      const teacherCount = teacherCountMap.get(course.id) || 0;
      const demand = courseDemandMap.get(course.id) || 0;
      const supplyCapacity = teacherCount * defaultStandard;
      const supplyDemandRatio =
        teacherCount === 0
          ? Number.MAX_SAFE_INTEGER
          : supplyCapacity > 0
            ? demand / supplyCapacity
            : demand > 0
              ? Number.MAX_SAFE_INTEGER
              : 0;
      return { courseId: course.id, courseName: course.name, priority: supplyDemandRatio };
    });

    coursePriorities.sort((a, b) => b.priority - a.priority);

    const results = [];
    let totalAssigned = 0;
    let totalUnassigned = 0;
    let totalWarnings = 0;
    let timeoutReached = false;

    const virtualTeacherHours = options.preview ? new Map() : null;
    // S-13 修复：预览模式下跨课程累计教材负载
    const globalTextbookMap = options.preview ? new Map() : null;

    for (let idx = 0; idx < coursePriorities.length; idx++) {
      const { courseId, courseName } = coursePriorities[idx];
      // M-13: 超时检查——每门课程排课前检查是否已超过时限
      if (Date.now() - startTime > BATCH_TIMEOUT_MS) {
        logger.warn(
          `批量排课超时(${BATCH_TIMEOUT_MS / 1000}s)，已处理${results.length}/${courses.length}门课程`
        );
        timeoutReached = true;
        break;
      }

      const courseStart = Date.now();
      try {
        const result = await autoArrange(
          courseId,
          semesterStr,
          mode,
          hourSettings,
          scheduleConditions,
          {
            ...options,
            extraTeacherHours: virtualTeacherHours,
            globalTextbookMap,
            // P1-12 修复：批量内部调用绕过 batchLocks 检查，由 batch.js 持有学期锁
            skipBatchLockCheck: true,
            // P0-2 修复：批量排课容量预留，避免先处理课程耗尽教师容量
            capacityReserveRatio: BATCH_CONFIG.RESERVE_RATIO,
          }
        );
        if (options.preview && virtualTeacherHours) {
          for (const a of result.assigned) {
            virtualTeacherHours.set(
              a.teacher_id,
              (virtualTeacherHours.get(a.teacher_id) || 0) + a.weekly_hours
            );
          }
          // S-13 修复：累计每位教师的教材 ID 集合
          if (result.classTextbookMap) {
            for (const a of result.assigned) {
              if (!globalTextbookMap.has(a.teacher_id))
                globalTextbookMap.set(a.teacher_id, new Set());
              const tbs = result.classTextbookMap.get(a.class_id) || [];
              for (const tid of tbs) globalTextbookMap.get(a.teacher_id).add(tid);
            }
          }
        }
        results.push({ courseId, courseName, ...result });
        totalAssigned += result.autoCount;
        totalUnassigned += result.unassignedCount;
        if (result.warnings?.length) totalWarnings += result.warnings.length;
        logger.info(
          `[批量排课] 课程 ${courseId}(${courseName}) 完成，耗时 ${Date.now() - courseStart}ms，安排 ${result.autoCount} 个班级`
        );
      } catch (e) {
        results.push({
          courseId,
          courseName,
          error: e.message,
          autoCount: 0,
          unassignedCount: 0,
        });
        logger.error(
          `[批量排课] 课程 ${courseId}(${courseName}) 失败，耗时 ${Date.now() - courseStart}ms：${e.message}`
        );
      }

      // 进度回调：每完成一门课程推送一次
      if (onProgress) {
        try {
          onProgress({
            processed: idx + 1,
            total: coursePriorities.length,
            currentCourseId: courseId,
            currentCourseName: courseName,
            currentResult: results[results.length - 1],
            cumulativeAssigned: totalAssigned,
            cumulativeUnassigned: totalUnassigned,
          });
        } catch (_) {
          /* 回调失败不影响主流程 */
        }
      }
    }

    const skippedCount = courses.length - results.length;
    const totalElapsed = Date.now() - startTime;
    logger.info(
      `[批量排课] 完成 semester=${semesterStr}，共 ${results.length}/${courses.length} 门课程，安排 ${totalAssigned} 个班级，总耗时 ${totalElapsed}ms`
    );

    return {
      semester: semesterStr,
      mode,
      preview: !!options.preview,
      courseResults: results,
      summary: {
        totalCourses: courses.length,
        successCount: results.filter((r) => !r.error).length,
        errorCount: results.filter((r) => r.error).length,
        totalAssigned,
        totalUnassigned,
        totalWarnings,
        timeoutReached,
        skippedCourses: skippedCount > 0 ? skippedCount : undefined,
      },
    };
  } finally {
    // M-12: 无论成功或异常，始终释放锁
    batchLocks.delete(lockKey);
  }
}
