import { prisma } from '../../lib/prisma.js';
import { success, fail } from '../../utils/response.js';
import { createAuditLog } from '../../services/audit.service.js';
import { MAX_PLAN_SEMESTER } from '../../constants/index.js';
import { parseSemester, calcClassSemester } from '../../services/semester.service.js';

/**
 * 审计修复：校验学期窗口合法性（整数、start>=1、end<=MAX_PLAN_SEMESTER、start<=end）
 * @returns {string|null} 错误消息，合法时返回 null
 */
function validateSemesterWindow(start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return '开课学期必须为整数';
  }
  if (start < 1) {
    return '开始学期不能小于 1';
  }
  if (end > MAX_PLAN_SEMESTER) {
    return `结束学期不能超过 ${MAX_PLAN_SEMESTER}`;
  }
  if (start > end) {
    return '开始学期不能大于结束学期';
  }
  return null;
}

/**
 * B3 辅助：查找"可能成为孤儿"的教学安排。
 * teaching_assignments 仅引用 class_id+course_id+semester，不引用 plan_courses；
 * 当方案窗口收缩/删除后，落在该课程 [startSemester, endSemester] 窗口之外的安排，
 * 对应的课程在本学期可能不再开课，导致排课清单/导出与方案矩阵不一致。
 * 仅用于「提示」，默认不删除——避免误删仍有效的历史安排（同一课程可能属于多个方案）。
 * 注意：teaching_assignments.semester 是 "YYYY-YYYY-N" 学年字符串，而方案窗口是相对学期号（第N学期），
 * 必须结合班级 enrollment_year 换算为相对学期号后再比较，不能直接对字符串做 lt/gt。
 * @param {number} courseId 课程 ID
 * @param {number} startSemester 新窗口起始学期号
 * @param {number} endSemester 新窗口结束学期号
 * @returns {Promise<Array>} 悬空安排列表（含班级/教师信息，最多 200 条）
 */
async function findDanglingAssignments(courseId, startSemester, endSemester) {
  const assignments = await prisma.teaching_assignments.findMany({
    where: { course_id: courseId },
    include: {
      class: { select: { id: true, name: true, enrollment_year: true, duration_years: true } },
      teacher: { select: { id: true, name: true } },
    },
    orderBy: [{ class_id: 'asc' }, { semester: 'asc' }],
  });

  const dangling = [];
  for (const a of assignments || []) {
    const semInfo = parseSemester(a.semester);
    const calc = calcClassSemester(a.class, semInfo);
    // 无法换算（学期字符串非法或班级学制信息缺失/越界）时跳过，避免误报
    if (!calc) continue;
    if (calc.currentSemesterNum < startSemester || calc.currentSemesterNum > endSemester) {
      dangling.push(a);
      if (dangling.length >= 200) break;
    }
  }
  return dangling;
}

/**
 * 获取培养方案的课程列表（含学期和教材）
 */
export async function listPlanCourses(req, res, next) {
  try {
    const { id } = req.params;
    const courses = await prisma.plan_courses.findMany({
      where: { plan_id: Number(id) },
      include: {
        courses: { select: { id: true, name: true, code: true, type: true } },
        plan_course_semesters: {
          include: {
            plan_textbooks: {
              include: {
                textbooks: {
                  select: { id: true, title: true, isbn: true, publisher: true, is_active: true },
                },
              },
            },
          },
          orderBy: { semester: 'asc' },
        },
      },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    });

    success(res, courses);
  } catch (e) {
    next(e);
  }
}

/**
 * 添加课程到培养方案（自动创建学期记录）
 */
export async function addCourseToPlan(req, res, next) {
  try {
    const { id } = req.params;
    const { course_id, start_semester, end_semester, weekly_hours, weeks_per_semester } = req.body;
    // 校验口径与单元格编辑（upsertSemester）统一：允许 0 课时，仅拒绝缺失与越界
    if (
      !course_id ||
      start_semester === undefined ||
      end_semester === undefined ||
      weekly_hours === undefined ||
      weekly_hours === null
    ) {
      return fail(res, '课程、开课学期、周课时为必填项');
    }
    const whNum = Number(weekly_hours);
    if (isNaN(whNum) || whNum < 0 || whNum > 100) {
      return fail(res, '周课时必须在 0~100 之间');
    }
    const semesterError = validateSemesterWindow(Number(start_semester), Number(end_semester));
    if (semesterError) {
      return fail(res, semesterError, 400);
    }
    const weeks = weeks_per_semester ? Number(weeks_per_semester) : 18;

    const pc = await prisma.$transaction(async (tx) => {
      const created = await tx.plan_courses.create({
        data: {
          plan_id: Number(id),
          course_id: Number(course_id),
          start_semester: Number(start_semester),
          end_semester: Number(end_semester),
          weekly_hours: whNum,
          weeks_per_semester: weeks,
        },
        include: { courses: true },
      });

      // 批量创建学期记录：createMany 一次插入，替代逐条 create 的 N 次往返
      const semesterRows = [];
      for (let s = Number(start_semester); s <= Number(end_semester); s++) {
        semesterRows.push({
          plan_course_id: created.id,
          semester: s,
          weekly_hours: whNum,
          weeks_count: weeks,
        });
      }
      await tx.plan_course_semesters.createMany({ data: semesterRows });

      return created;
    });

    await createAuditLog({
      module: 'trainingPlan',
      action: 'create',
      userId: req.user?.id,
      ip: req.ip,
      result: 'success',
      message: '为培养方案添加课程',
      details: { course_id: pc.course_id },
    });

    success(res, pc, '添加成功');
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'create',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: '为培养方案添加课程失败',
      details: { error: e.message },
    });
    if (e.code === 'P2002') {
      return fail(res, '该课程已在该方案中存在', 400);
    }
    next(e);
  }
}

/**
 * 更新培养方案课程信息（按需增删学期记录，保留区间内教材关联）
 *
 * 修复严重-1：原实现无论改什么字段都先 deleteMany 全部学期记录再重建空记录，
 * 因 plan_textbooks 对 plan_course_semesters 是 onDelete: Cascade，
 * 导致教材关联全部静默丢失。
 *
 * 新逻辑：
 * - 更新 plan_courses 表本身字段（start/end_semester, weekly_hours, weeks_per_semester, sort_order）
 * - 仅当学期范围变化时，按需增删学期记录（diff 新旧区间）
 *   - 删除超出新区间的学期记录（其 plan_textbooks 级联删除）
 *   - 新增缺失的学期记录（无教材，用默认值）
 *   - 保留区间内已存在的学期记录及其 plan_textbooks（不动）
 * - 学期范围未变时，完全不碰学期记录
 */
export async function updatePlanCourse(req, res, next) {
  try {
    const { id } = req.params;
    const { start_semester, end_semester, weekly_hours, weeks_per_semester, sort_order } = req.body;

    const currentPc = await prisma.plan_courses.findUnique({
      where: { id: Number(id) },
      include: { plan_course_semesters: true },
    });

    if (!currentPc) {
      return fail(res, '方案课程不存在', 404);
    }

    const newStart =
      start_semester !== undefined ? Number(start_semester) : currentPc.start_semester;
    const newEnd = end_semester !== undefined ? Number(end_semester) : currentPc.end_semester;
    const newWeeklyHours =
      weekly_hours !== undefined ? Number(weekly_hours) : currentPc.weekly_hours;
    const newWeeksPerSemester =
      weeks_per_semester !== undefined ? Number(weeks_per_semester) : currentPc.weeks_per_semester;
    const newSortOrder = sort_order !== undefined ? Number(sort_order) : currentPc.sort_order;

    const semesterWindowError = validateSemesterWindow(newStart, newEnd);
    if (semesterWindowError) {
      return fail(res, semesterWindowError, 400);
    }

    const pc = await prisma.$transaction(async (tx) => {
      // 1. 更新 plan_courses 表本身字段
      const updated = await tx.plan_courses.update({
        where: { id: Number(id) },
        data: {
          start_semester: newStart,
          end_semester: newEnd,
          weekly_hours: newWeeklyHours,
          weeks_per_semester: newWeeksPerSemester,
          sort_order: newSortOrder,
        },
        include: { courses: true },
      });

      // 2. 仅当学期范围变化时，按需增删学期记录（保留区间内教材关联）
      const oldStart = currentPc.start_semester;
      const oldEnd = currentPc.end_semester;

      if (newStart !== oldStart || newEnd !== oldEnd) {
        const existingSemesterSet = new Set(currentPc.plan_course_semesters.map((s) => s.semester));

        // 计算新区间内的学期集合
        const newSemesterSet = new Set();
        for (let s = newStart; s <= newEnd; s++) {
          newSemesterSet.add(s);
        }

        // 删除不在新区间内的学期记录（plan_textbooks 会级联删除）
        const toDelete = [...existingSemesterSet].filter((s) => !newSemesterSet.has(s));
        if (toDelete.length > 0) {
          await tx.plan_course_semesters.deleteMany({
            where: {
              plan_course_id: Number(id),
              semester: { in: toDelete },
            },
          });
        }

        // 新增新区间内但之前不存在的学期记录（无教材，用默认值初始化）
        const toCreate = [...newSemesterSet].filter((s) => !existingSemesterSet.has(s));
        for (const s of toCreate) {
          await tx.plan_course_semesters.create({
            data: {
              plan_course_id: Number(id),
              semester: s,
              weekly_hours: newWeeklyHours,
              weeks_count: newWeeksPerSemester,
            },
          });
        }
        // 保留区间内已存在的学期记录及其 plan_textbooks（不动）
        // B-08 设计说明：周课时同步采用启发式策略——仅更新仍等于旧默认值的学期记录，
        // 用户对特定学期做过的单独调整（weekly_hours 已不等于旧默认值）会被保留。
        // 范围变更时，同步区间内保留的学期记录的 weekly_hours（仅更新仍等于旧默认值的记录）
        if (newWeeklyHours !== currentPc.weekly_hours) {
          const retainedSemesters = [...existingSemesterSet].filter((s) => newSemesterSet.has(s));
          if (retainedSemesters.length > 0) {
            const updateResult = await tx.plan_course_semesters.updateMany({
              where: {
                plan_course_id: Number(id),
                semester: { in: retainedSemesters },
                weekly_hours: currentPc.weekly_hours,
              },
              data: { weekly_hours: newWeeklyHours },
            });
            updated.affectedSemesterCount = updateResult.count;
          }
        }
      } else {
        // M2 修复：学期范围未变时，如果 weekly_hours 或 weeks_per_semester 发生变化，
        // 仅同步仍等于旧默认值的学期记录，保留用户对特定学期的单独设置
        if (newWeeklyHours !== currentPc.weekly_hours) {
          const updateResult = await tx.plan_course_semesters.updateMany({
            where: {
              plan_course_id: Number(id),
              weekly_hours: currentPc.weekly_hours,
            },
            data: { weekly_hours: newWeeklyHours },
          });
          updated.affectedSemesterCount = updateResult.count;
        }
        if (newWeeksPerSemester !== currentPc.weeks_per_semester) {
          await tx.plan_course_semesters.updateMany({
            where: {
              plan_course_id: Number(id),
              weeks_count: currentPc.weeks_per_semester,
            },
            data: { weeks_count: newWeeksPerSemester },
          });
        }
      }

      return updated;
    });

    await createAuditLog({
      module: 'trainingPlan',
      action: 'update',
      userId: req.user?.id,
      ip: req.ip,
      result: 'success',
      message: '更新培养方案课程',
      details: { course_id: pc.id },
    });

    // B3 修复（提示，不静默删除）：仅当方案窗口收缩（起始后移或结束前移）时，
    // 计算该课程落在窗口外的教学安排，作为「可能孤儿」提示返回，供前端确认是否需要清理。
    const windowShrunk = newStart > currentPc.start_semester || newEnd < currentPc.end_semester;
    const danglingAssignments = windowShrunk
      ? await findDanglingAssignments(pc.course_id, newStart, newEnd)
      : [];

    success(res, { ...pc, danglingAssignments }, '更新成功');
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'update',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: '更新培养方案课程失败',
      details: { error: e.message },
    });
    if (e.code === 'P2025') return fail(res, '方案课程不存在', 404);
    next(e);
  }
}

/**
 * 删除培养方案课程
 */
export async function deletePlanCourse(req, res, next) {
  try {
    const { id } = req.params;

    // BIZ-M1修复：删除前先读取 plan_courses 取其真实 course_id（plan_courses.id 与 courses.id 是不同命名空间）
    // 原实现用 plan_courses.id 查询 teaching_assignments.course_id，导致悬空检测永远返回空
    const planCourse = await prisma.plan_courses.findUnique({
      where: { id: Number(id) },
      select: {
        id: true,
        course_id: true,
        start_semester: true,
        end_semester: true,
        courses: { select: { id: true, name: true } },
      },
    });

    if (!planCourse) {
      return fail(res, '方案课程不存在', 404);
    }

    try {
      await prisma.plan_courses.delete({ where: { id: Number(id) } });

      await createAuditLog({
        module: 'trainingPlan',
        action: 'delete',
        userId: req.user?.id,
        ip: req.ip,
        result: 'success',
        message: `删除培养方案课程：${planCourse.courses?.name || planCourse.course_id}`,
        // BIZ-M1修复：审计字段同时记录 plan_course_id 与真实 course_id，避免命名混淆
        details: {
          plan_course_id: Number(id),
          course_id: planCourse.course_id,
          course_name: planCourse.courses?.name,
        },
      });

      // B3 修复（提示，不静默删除）：方案课程删除后，该课程下所有教学安排不再有开课窗口约束，
      // 可能成为孤儿。返回候选清单供前端提示用户确认是否清理（同一课程可能属于多个方案，故默认仅提示）。
      // BIZ-M1修复：用真实 course_id 查询悬空排课，复用 findDanglingAssignments 统一口径
      const danglingAssignments = await findDanglingAssignments(
        planCourse.course_id,
        planCourse.start_semester,
        planCourse.end_semester
      );

      success(res, { danglingAssignments }, '删除成功');
    } catch (e) {
      if (e.code === 'P2025') return fail(res, '方案课程不存在', 404);
      throw e;
    }
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'delete',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: '删除培养方案课程失败',
      details: { error: e.message },
    });
    next(e);
  }
}

/**
 * 添加或更新学期安排（upsert）
 */
export async function upsertSemester(req, res, next) {
  try {
    const { planId, courseId } = req.params;
    const { semester, weekly_hours, weeks_count } = req.body;

    if (!semester || weekly_hours === undefined || weekly_hours === null) {
      return fail(res, '学期和周课时为必填项');
    }
    const whNum = Number(weekly_hours);
    if (isNaN(whNum) || whNum < 0 || whNum > 100) {
      return fail(res, '周课时必须在 0~100 之间');
    }

    const planCourse = await prisma.plan_courses.findFirst({
      where: {
        id: Number(courseId),
        plan_id: Number(planId),
      },
    });

    if (!planCourse) {
      return fail(res, '方案课程不存在', 404);
    }

    // 校验学期在 plan_courses 的开课范围内，避免创建孤立学期记录
    const semValue = Number(semester);
    if (semValue < planCourse.start_semester || semValue > planCourse.end_semester) {
      return fail(
        res,
        `学期必须在 ${planCourse.start_semester}~${planCourse.end_semester} 范围内`,
        400
      );
    }

    const sem = await prisma.plan_course_semesters.upsert({
      where: {
        plan_course_id_semester: {
          plan_course_id: Number(courseId),
          semester: Number(semester),
        },
      },
      update: {
        weekly_hours: Number(weekly_hours),
        weeks_count: weeks_count ? Number(weeks_count) : planCourse.weeks_per_semester,
      },
      create: {
        plan_course_id: Number(courseId),
        semester: Number(semester),
        weekly_hours: Number(weekly_hours),
        weeks_count: weeks_count ? Number(weeks_count) : planCourse.weeks_per_semester,
      },
    });

    await createAuditLog({
      module: 'trainingPlan',
      action: 'create',
      userId: req.user?.id,
      ip: req.ip,
      result: 'success',
      message: '添加学期安排',
      details: { course_id: Number(courseId), semester },
    });

    success(res, sem, '创建成功');
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'create',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: '添加学期安排失败',
      details: { error: e.message },
    });
    next(e);
  }
}

/**
 * 更新学期安排
 *
 * BIZ-M2修复：当 weekly_hours 变更时，同步更新该课程同学期未锁定的 teaching_assignments
 * 的 weekly_hours 快照，避免方案矩阵与排课清单课时长期不一致。
 * 已锁定（is_locked=true）的排课记录跳过更新，避免破坏锁定语义，
 * 返回 skippedLockedCount 供前端提示用户手动处理。
 */
export async function updateSemester(req, res, next) {
  try {
    const { id } = req.params;
    const { weekly_hours, weeks_count } = req.body;
    const data = {};
    if (weekly_hours !== undefined) data.weekly_hours = Number(weekly_hours);
    if (weeks_count !== undefined) data.weeks_count = Number(weeks_count);

    const sem = await prisma.plan_course_semesters.update({
      where: { id: Number(id) },
      data,
    });

    // BIZ-M2: 同步未锁定的排课记录快照
    let syncedAssignments = 0;
    let skippedLockedCount = 0;
    if (weekly_hours !== undefined) {
      // 查询该学期对应的 course_id + semester，用于定位排课记录
      const planCourse = await prisma.plan_courses.findUnique({
        where: { id: sem.plan_course_id },
        select: { course_id: true },
      });
      if (planCourse) {
        // 同步未锁定的排课记录
        const updateResult = await prisma.teaching_assignments.updateMany({
          where: {
            course_id: planCourse.course_id,
            semester: String(sem.semester),
            is_locked: false,
          },
          data: { weekly_hours: Number(weekly_hours) },
        });
        syncedAssignments = updateResult.count;

        // 统计被跳过的锁定记录数，供前端提示
        const lockedCount = await prisma.teaching_assignments.count({
          where: {
            course_id: planCourse.course_id,
            semester: String(sem.semester),
            is_locked: true,
          },
        });
        skippedLockedCount = lockedCount;
      }
    }

    await createAuditLog({
      module: 'trainingPlan',
      action: 'update',
      userId: req.user?.id,
      ip: req.ip,
      result: 'success',
      message: '更新学期安排',
      details: {
        semester_id: Number(id),
        synced_assignments: syncedAssignments,
        skipped_locked: skippedLockedCount,
      },
    });

    const message =
      skippedLockedCount > 0
        ? `更新成功，已同步 ${syncedAssignments} 条排课，${skippedLockedCount} 条锁定记录需手动处理`
        : '更新成功';
    success(res, { ...sem, syncedAssignments, skippedLockedCount }, message);
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'update',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: '更新学期安排失败',
      details: { error: e.message },
    });
    if (e.code === 'P2025') return fail(res, '学期记录不存在', 404);
    next(e);
  }
}

/**
 * 获取培养方案的所有学期信息（去重）
 */
export async function listPlanSemesters(req, res, next) {
  try {
    const { id } = req.params;
    // H-5 修复：移除 distinct，由 JS 层完整聚合取最大 weeks_count
    // 原 distinct: ['semester'] 在不同课程 weeks_count 不同时可能漏掉较大值
    const semesters = await prisma.plan_course_semesters.findMany({
      where: { plan_courses: { plan_id: Number(id) } },
      select: { semester: true, weeks_count: true },
    });

    const map = {};
    semesters.forEach((s) => {
      if (!map[s.semester] || map[s.semester] < s.weeks_count) {
        map[s.semester] = s.weeks_count;
      }
    });

    success(
      res,
      Object.entries(map).map(([semester, weeks_count]) => ({
        semester: Number(semester),
        weeks_count,
      }))
    );
  } catch (e) {
    next(e);
  }
}

/**
 * 替换学期教材关联（REPLACE语义，非追加）
 * 注意：此操作会先删除该学期的所有现有教材关联，再创建新关联。
 * 如需追加模式，请使用独立的追加接口。
 * B-05修复：明确文档化替换语义
 */
export async function assignTextbookToSemester(req, res, next) {
  try {
    const { id } = req.params;
    const { textbook_id, is_required } = req.body;
    if (!textbook_id) return fail(res, '教材为必填项');

    const textbook = await prisma.textbooks.findUnique({ where: { id: Number(textbook_id) } });
    if (!textbook) return fail(res, '教材不存在');
    if (!textbook.is_active) return fail(res, `教材"${textbook.title}"已停用，无法关联`);

    const pt = await prisma.$transaction(async (tx) => {
      await tx.plan_textbooks.deleteMany({
        where: { semester_id: Number(id) },
      });

      return tx.plan_textbooks.create({
        data: {
          semester_id: Number(id),
          textbook_id: Number(textbook_id),
          is_required: is_required !== false,
        },
        include: { textbooks: true },
      });
    });

    await createAuditLog({
      module: 'trainingPlan',
      action: 'create',
      userId: req.user?.id,
      ip: req.ip,
      result: 'success',
      message: '添加教材',
      details: { semester_id: Number(id), textbook_id: Number(textbook_id) },
    });

    success(res, pt, '关联成功');
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'create',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: '添加教材失败',
      details: { error: e.message },
    });
    next(e);
  }
}

/**
 * 取消学期的教材关联（批量删除）
 */
export async function removeSemesterTextbooks(req, res, next) {
  try {
    const { id } = req.params;
    await prisma.plan_textbooks.deleteMany({
      where: { semester_id: Number(id) },
    });

    await createAuditLog({
      module: 'trainingPlan',
      action: 'delete',
      userId: req.user?.id,
      ip: req.ip,
      result: 'success',
      message: '删除教材',
      details: { semester_id: Number(id) },
    });

    success(res, null, '取消关联成功');
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'delete',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: '删除教材失败',
      details: { error: e.message },
    });
    next(e);
  }
}

/**
 * H-3 修复：批量更新学期周数（单事务）
 * PATCH /api/plans/semesters/batch-weeks
 * Body: { ids: [1,2,3,...], weeks_count: 18 }
 */
export async function batchUpdateSemesterWeeks(req, res, next) {
  try {
    const { ids, weeks_count } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return fail(res, 'ids 必须为非空数组', 400);
    }
    if (weeks_count == null || weeks_count < 1 || weeks_count > 52) {
      return fail(res, 'weeks_count 必须在 1-52 之间', 400);
    }

    const numericIds = ids.map(Number);

    await prisma.$transaction(
      numericIds.map((id) =>
        prisma.plan_course_semesters.update({
          where: { id },
          data: { weeks_count: Number(weeks_count) },
        })
      )
    );

    await createAuditLog({
      module: 'trainingPlan',
      action: 'update',
      userId: req.user?.id,
      ip: req.ip,
      result: 'success',
      message: `批量更新学期周数：${numericIds.length}条记录`,
      details: { count: numericIds.length, weeks_count: Number(weeks_count) },
    });

    success(res, { updated: numericIds.length }, '批量更新成功');
  } catch (e) {
    next(e);
  }
}

/**
 * H-7 修复：批量更新课程排序（单事务）
 * PATCH /api/plans/courses/batch-sort
 * Body: { items: [{id: 1, sort_order: 0}, {id: 2, sort_order: 1}, ...] }
 */
export async function batchUpdateCourseSortOrder(req, res, next) {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return fail(res, 'items 必须为非空数组', 400);
    }

    await prisma.$transaction(
      items.map((item) =>
        prisma.plan_courses.update({
          where: { id: Number(item.id) },
          data: { sort_order: Number(item.sort_order) },
        })
      )
    );

    success(res, { updated: items.length }, '排序更新成功');
  } catch (e) {
    next(e);
  }
}
