import { prisma } from '../../lib/prisma.js';
import { BATCH_CONFIG, DEFAULT_HOUR_SETTINGS, HOUR_SETTINGS_PREFIX } from '../../constants/index.js';
import { validateHourSettings } from './validate.js';
import { autoArrange, batchLocks } from './auto-arrange.js';
import logger from '../../utils/logger.js';
// B-01 修复：基于数据库的排课并发锁，支持多进程/多实例部署
import { acquireLock, releaseLock } from './lock.js';
// F7 修复：导入 parseSemester 用于供需测算的学期过滤
import { parseSemester } from './queries.js';

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
  // B-01 修复：在进程内存锁之外，额外获取数据库锁以支持多实例部署
  const dbLockKey = `batch:${lockKey}`;
  const dbLocked = await acquireLock(dbLockKey);
  if (!dbLocked) {
    throw new Error(`学期 ${semesterStr} 的批量排课正在进行中（其他实例），请稍后重试`);
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
            plan_course_semesters: { some: { weekly_hours: { gt: 0 } } },
          },
        },
      },
      select: { id: true, name: true, code: true },
    });

    // 批量修复：预加载按课程保存的课时配置与全局配置。
    // 批量场景下请求传入的 hourSettings 仅作兜底，每门课程实际生效配置按优先级解析：
    //   课程级 DB 配置 > 请求传入 hourSettings > 全局 DB 配置 > DEFAULT_HOUR_SETTINGS
    const courseSettingsRows = await prisma.system_settings.findMany({
      where: { key: { startsWith: `${HOUR_SETTINGS_PREFIX}_` } },
    });
    const courseHourSettingsMap = new Map();
    for (const row of courseSettingsRows) {
      const settingsCourseId = Number(row.key.slice(HOUR_SETTINGS_PREFIX.length + 1));
      if (!Number.isFinite(settingsCourseId)) continue;
      try {
        const parsed = JSON.parse(row.value);
        if (parsed && typeof parsed === 'object') {
          courseHourSettingsMap.set(settingsCourseId, parsed);
        }
      } catch (_e) {
        logger.warn(`[批量排课] 课时配置 ${row.key} 解析失败，已忽略`);
      }
    }
    let globalDbHourSettings = null;
    const globalSettingsRow = await prisma.system_settings.findUnique({
      where: { key: HOUR_SETTINGS_PREFIX },
    });
    if (globalSettingsRow?.value) {
      try {
        const parsed = JSON.parse(globalSettingsRow.value);
        if (parsed && typeof parsed === 'object') globalDbHourSettings = parsed;
      } catch (_e) {
        globalDbHourSettings = null;
      }
    }
    const resolveCourseHourSettings = (courseId) =>
      courseHourSettingsMap.get(Number(courseId)) ||
      hourSettings ||
      globalDbHourSettings ||
      DEFAULT_HOUR_SETTINGS;

    const teacherCounts = await prisma.teacher_courses.groupBy({
      by: ['course_id'],
      where: { teacher: { status: 'active' } },
      _count: { teacher_id: true },
    });
    const teacherCountMap = new Map(teacherCounts.map((r) => [r.course_id, r._count.teacher_id]));

    // P0-2 深化：预留只对"后续课程还会用到该教师"时有意义。
    // 拉取教师-课程关系，用于计算每门课程中"不出现在任何后续课程"的教师，
    // 这些教师（典型如只教一门课的教师、最后一门课的全部教师）不打预留折扣，
    // 避免"容量未满却欠分配"的预留浪费。
    const teacherCourseRows = await prisma.teacher_courses.findMany({
      where: { teacher: { status: 'active' }, course_id: { in: courses.map((c) => c.id) } },
      select: { teacher_id: true, course_id: true },
    });
    const courseTeacherMap = new Map();
    for (const row of teacherCourseRows) {
      if (!courseTeacherMap.has(row.course_id)) courseTeacherMap.set(row.course_id, []);
      courseTeacherMap.get(row.course_id).push(row.teacher_id);
    }

    // F7 修复：需求测算过滤当前学期，避免跨学期 weekly_hours 求和导致优先级失真
    const semesterInfo = parseSemester(semesterStr);
    const courseHourDemands = await prisma.plan_course_semesters.groupBy({
      by: ['plan_course_id'],
      where: {
        plan_courses: {
          course_id: { in: courses.map((c) => c.id) },
          // 仅统计当前学期有效的课时记录（含 start/end 范围校验）
          ...(semesterInfo
            ? {
                start_semester: { lte: semesterInfo.semester },
                end_semester: { gte: semesterInfo.semester },
              }
            : {}),
        },
        ...(semesterInfo ? { semester: semesterInfo.semester } : {}),
      },
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

    // F7 完整修复：供给侧测算改为实际剩余容量估算（考虑教师类型差异与既有负载）
    // 原实现：teacherCount × defaultStandard（未考虑人员类型差异与既有负载）
    // 新实现：复用 courseTeacherMap 收集所有相关教师 ID，一次性查询教师信息与当前学期已排课时，
    // 按教师实际剩余 capacity 估算各课程的供给量，更准确反映供给能力。
    const allTeacherIds = new Set();
    for (const tids of courseTeacherMap.values()) for (const tid of tids) allTeacherIds.add(tid);

    // 一次性拉取所有相关教师的类型、自定义课时上限、本学期已排课时
    const teacherInfoRows =
      allTeacherIds.size > 0
        ? await prisma.teachers.findMany({
            where: { id: { in: [...allTeacherIds] } },
            select: {
              id: true,
              personnel_type: true,
              default_weekly_hours: true,
            },
          })
        : [];
    const teacherInfoMap = new Map(teacherInfoRows.map((t) => [t.id, t]));

    // 按教师聚合本学期已排课时（跨课程，去重合班）
    const workloadByTeacher = await prisma.teaching_assignments.groupBy({
      by: ['teacher_id'],
      where: { semester: semesterStr, teacher_id: { in: [...allTeacherIds] } },
      _sum: { weekly_hours: true },
    });
    const workloadMap = new Map(
      workloadByTeacher.map((r) => [r.teacher_id, r._sum.weekly_hours || 0])
    );

    // 预计算每位教师的实际剩余 standardCap（考虑 personnelType / defaultWeeklyHours / 既有负载）
    // 批量修复：供需估算采用保守口径——按教师所授各课程的解析配置取最小 standard，
    // 避免课程级配置比兜底配置更严时高估供给，导致紧缺课程优先级失真（仅影响排序，不影响上限正确性）
    const teacherCoursesMap = new Map();
    for (const [cid, tids] of courseTeacherMap) {
      for (const tid of tids) {
        if (!teacherCoursesMap.has(tid)) teacherCoursesMap.set(tid, []);
        teacherCoursesMap.get(tid).push(cid);
      }
    }
    const teacherRemainingCap = new Map();
    for (const [tid, info] of teacherInfoMap) {
      let minStandard = null;
      for (const cid of teacherCoursesMap.get(tid) || []) {
        const resolved = resolveCourseHourSettings(cid);
        const typeSetting =
          resolved[info.personnel_type] ||
          DEFAULT_HOUR_SETTINGS[info.personnel_type] ||
          DEFAULT_HOUR_SETTINGS.full_time;
        minStandard =
          minStandard == null ? typeSetting.standard : Math.min(minStandard, typeSetting.standard);
      }
      const setting =
        minStandard != null
          ? { standard: minStandard }
          : hourSettings[info.personnel_type] ||
            DEFAULT_HOUR_SETTINGS[info.personnel_type] ||
            DEFAULT_HOUR_SETTINGS.full_time;
      const effectiveTotal = Math.max(0, workloadMap.get(tid) || 0);
      const teacherHourCap =
        info.default_weekly_hours != null
          ? Math.max(0, info.default_weekly_hours - effectiveTotal)
          : null;
      const rawStandardCap =
        teacherHourCap != null
          ? Math.min(teacherHourCap, Math.max(0, setting.standard - effectiveTotal))
          : Math.max(0, setting.standard - effectiveTotal);
      teacherRemainingCap.set(tid, rawStandardCap);
    }

    // 按课程聚合每位教师的实际剩余容量（复用 courseTeacherMap，避免重复查询）
    const courseSupplyMap = new Map();
    for (const course of courses) {
      const tids = courseTeacherMap.get(course.id) || [];
      let totalSupply = 0;
      for (const tid of tids) totalSupply += teacherRemainingCap.get(tid) || 0;
      courseSupplyMap.set(course.id, totalSupply);
    }

    const coursePriorities = courses.map((course) => {
      const demand = courseDemandMap.get(course.id) || 0;
      const supplyCapacity = courseSupplyMap.get(course.id) || 0;
      const supplyDemandRatio =
        supplyCapacity > 0 ? demand / supplyCapacity : demand > 0 ? Number.MAX_SAFE_INTEGER : 0;
      return { courseId: course.id, courseName: course.name, priority: supplyDemandRatio };
    });

    coursePriorities.sort((a, b) => b.priority - a.priority);

    // P0-2 深化：预计算每个位置之后（仅计有课时需求的课程）出现的教师集合，
    // 用于判断当前课程的每位教师是否还需要为后续课程预留容量
    const laterTeacherSets = new Array(coursePriorities.length);
    let laterAcc = new Set();
    for (let i = coursePriorities.length - 1; i >= 0; i--) {
      laterTeacherSets[i] = laterAcc;
      const cid = coursePriorities[i].courseId;
      if ((courseDemandMap.get(cid) || 0) > 0) {
        laterAcc = new Set(laterAcc);
        for (const tid of courseTeacherMap.get(cid) || []) laterAcc.add(tid);
      }
    }

    const results = [];
    let totalAssigned = 0;
    let totalUnassigned = 0;
    let totalWarnings = 0;
    let timeoutReached = false;

    // F1 修复：globalTextbookMap 预览与非预览均启用（Set.add 幂等，不产生双重计算），
    // 保证批量内跨课程教材累计与预览路径行为完全一致。
    // virtualTeacherHours 仍仅预览模式启用：非预览模式下 DB 在每门课程落库后已更新，
    // getTeachersForCourse 的 totalWeeklyHours 已含前序课程课时，若再叠加会加法翻倍。
    const virtualTeacherHours = options.preview ? new Map() : null;
    // S-13 + F1 修复：跨课程累计教材负载（预览与非预览均启用）
    const globalTextbookMap = new Map();

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
      // B-03 修复：预览模式下，单课程失败时回滚累积的虚拟工时和教材状态
      // F1 修复：教材快照不再限于预览模式（globalTextbookMap 双模式启用）
      let snapshotTeacherHours = null;
      let snapshotTextbookMap = null;
      if (options.preview) {
        snapshotTeacherHours = virtualTeacherHours ? new Map(virtualTeacherHours) : null;
      }
      snapshotTextbookMap = new Map([...globalTextbookMap].map(([k, v]) => [k, new Set(v)]));
      try {
        // P0-2 深化：不出现在任何后续课程的教师免预留（预留对其无保护对象，纯属浪费）
        const reserveExemptTeacherIds = new Set(
          (courseTeacherMap.get(courseId) || []).filter((tid) => !laterTeacherSets[idx].has(tid))
        );
        const result = await autoArrange(
          courseId,
          semesterStr,
          mode,
          resolveCourseHourSettings(courseId),
          scheduleConditions,
          {
            ...options,
            extraTeacherHours: virtualTeacherHours,
            globalTextbookMap,
            // P0-2 修复：批量排课传容量预留比例（当前 RESERVE_RATIO=1.0 不预留，
            // 批量已按供需比排序优先级；比例 < 1 时可为后续课程预留容量）
            capacityReserveRatio: BATCH_CONFIG.RESERVE_RATIO,
            reserveExemptTeacherIds,
            // P1-12 修复：批量内部调用绕过 batchLocks 检查，由 batch.js 持有学期锁
            skipBatchLockCheck: true,
          }
        );
        if (options.preview && virtualTeacherHours) {
          for (const a of result.assigned) {
            virtualTeacherHours.set(
              a.teacher_id,
              (virtualTeacherHours.get(a.teacher_id) || 0) + a.weekly_hours
            );
          }
        }
        // S-13 + F1 修复：累计每位教师的教材 ID 集合（预览与非预览均执行）
        if (result.classTextbookMap) {
          for (const a of result.assigned) {
            if (!globalTextbookMap.has(a.teacher_id))
              globalTextbookMap.set(a.teacher_id, new Set());
            const tbs = result.classTextbookMap.get(a.class_id) || [];
            for (const tid of tbs) globalTextbookMap.get(a.teacher_id).add(tid);
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
        // B-03 修复：失败时回滚预览状态，防止错误累积影响后续课程
        if (options.preview && snapshotTeacherHours) {
          virtualTeacherHours.clear();
          for (const [k, v] of snapshotTeacherHours) virtualTeacherHours.set(k, v);
        }
        // F1 修复：教材回滚不再限于预览模式
        if (snapshotTextbookMap) {
          globalTextbookMap.clear();
          for (const [k, v] of snapshotTextbookMap) globalTextbookMap.set(k, new Set(v));
        }
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

    // ── P0-2 深化：补漏轮 ──
    // 主轮结束后，各教师被预留但未被后续课程用掉的容量应回收：
    // 对仍有未分配班级的课程按原优先级用全量容量（不预留）重排一次，
    // 避免"教师容量未满却欠分配"。重排容量只增不减，结果理论上不劣于主轮。
    const rebuildPreviewState = (excludeCourseId) => {
      // F1 修复：globalTextbookMap 双模式均需重建（补漏轮 autoArrange 依赖它做教材上限检查）
      // virtualTeacherHours 仅预览模式重建（非预览 DB 已含前序课时）
      if (options.preview && virtualTeacherHours) virtualTeacherHours.clear();
      globalTextbookMap.clear();
      for (const r of results) {
        if (r.error || r.courseId === excludeCourseId) continue;
        for (const a of r.assigned || []) {
          if (options.preview && virtualTeacherHours) {
            virtualTeacherHours.set(
              a.teacher_id,
              (virtualTeacherHours.get(a.teacher_id) || 0) + a.weekly_hours
            );
          }
          if (r.classTextbookMap) {
            if (!globalTextbookMap.has(a.teacher_id))
              globalTextbookMap.set(a.teacher_id, new Set());
            const tbs = r.classTextbookMap.get(a.class_id) || [];
            for (const tid of tbs) globalTextbookMap.get(a.teacher_id).add(tid);
          }
        }
      }
    };

    if (!timeoutReached) {
      for (const { courseId, courseName } of coursePriorities) {
        const prevIdx = results.findIndex((r) => r.courseId === courseId);
        if (prevIdx < 0) continue;
        const prev = results[prevIdx];
        if (prev.error || !(prev.unassignedCount > 0)) continue;
        if (Date.now() - startTime > BATCH_TIMEOUT_MS) {
          logger.warn(`[批量排课][补漏轮] 超时，停止补漏`);
          timeoutReached = true;
          break;
        }
        // 预览模式：先从累计状态中扣除本课程主轮贡献，避免自身课时被重复计入
        rebuildPreviewState(courseId);
        try {
          // F8 修复：非预览补漏轮先跑一次 preview 评估，仅当不劣于主轮才执行真实重排。
          // 成本为多一次内存计算，换来"补漏只增不减"的落库保证。
          if (!options.preview) {
            const previewRefill = await autoArrange(
              courseId,
              semesterStr,
              mode,
              resolveCourseHourSettings(courseId),
              scheduleConditions,
              {
                ...options,
                preview: true,
                extraTeacherHours: virtualTeacherHours,
                globalTextbookMap,
                capacityReserveRatio: 1.0,
                skipBatchLockCheck: true,
              }
            );
            if (previewRefill.autoCount < prev.autoCount) {
              logger.warn(
                `[批量排课][补漏轮] 课程 ${courseId}(${courseName}) 预览回退 ${prev.autoCount} → ${previewRefill.autoCount}，跳过非预览重排`
              );
              rebuildPreviewState(null);
              continue;
            }
          }

          const refill = await autoArrange(
            courseId,
            semesterStr,
            mode,
            resolveCourseHourSettings(courseId),
            scheduleConditions,
            {
              ...options,
              extraTeacherHours: virtualTeacherHours,
              globalTextbookMap,
              capacityReserveRatio: 1.0,
              skipBatchLockCheck: true,
            }
          );
          if (refill.autoCount < prev.autoCount) {
            // 容量放宽后理论上不应回退，如实记录以便排查
            logger.warn(
              `[批量排课][补漏轮] 课程 ${courseId}(${courseName}) 重排回退：${prev.autoCount} → ${refill.autoCount}`
            );
            if (options.preview) {
              // 预览未落库，保留更优的主轮结果
              rebuildPreviewState(null);
              continue;
            }
          } else if (refill.autoCount > prev.autoCount) {
            logger.info(
              `[批量排课][补漏轮] 课程 ${courseId}(${courseName}) 安排 ${prev.autoCount} → ${refill.autoCount}`
            );
          }
          totalAssigned += refill.autoCount - prev.autoCount;
          totalUnassigned += refill.unassignedCount - prev.unassignedCount;
          totalWarnings += (refill.warnings?.length || 0) - (prev.warnings?.length || 0);
          results[prevIdx] = { courseId, courseName, ...refill };
        } catch (e) {
          // 补漏轮失败保留主轮结果，不影响整体
          logger.error(`[批量排课][补漏轮] 课程 ${courseId}(${courseName}) 失败：${e.message}`);
        } finally {
          // 以最新 results 重建累计状态（成功含新结果，失败回填主轮贡献）
          rebuildPreviewState(null);
        }
        if (onProgress) {
          try {
            onProgress({
              processed: coursePriorities.length,
              total: coursePriorities.length,
              currentCourseId: courseId,
              currentCourseName: `${courseName}（补漏）`,
              currentResult: results[prevIdx],
              cumulativeAssigned: totalAssigned,
              cumulativeUnassigned: totalUnassigned,
              fillRound: true,
            });
          } catch (_) {
            /* 回调失败不影响主流程 */
          }
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
    // B-01 修复：释放数据库锁
    await releaseLock(dbLockKey);
  }
}
