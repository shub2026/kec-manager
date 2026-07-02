import { prisma } from '../../lib/prisma.js';
import { success, fail } from '../../utils/response.js';
import { createAuditLog } from '../../services/audit.service.js';

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
    if (!course_id || start_semester === undefined || end_semester === undefined || !weekly_hours) {
      return fail(res, '课程、开课学期、周课时为必填项');
    }
    if (Number(start_semester) > Number(end_semester)) {
      return fail(res, '开始学期不能大于结束学期', 400);
    }
    const weeks = weeks_per_semester ? Number(weeks_per_semester) : 18;

    const pc = await prisma.$transaction(async (tx) => {
      const created = await tx.plan_courses.create({
        data: {
          plan_id: Number(id),
          course_id: Number(course_id),
          start_semester: Number(start_semester),
          end_semester: Number(end_semester),
          weekly_hours: Number(weekly_hours),
          weeks_per_semester: weeks,
        },
        include: { courses: true },
      });

      for (let s = Number(start_semester); s <= Number(end_semester); s++) {
        await tx.plan_course_semesters.create({
          data: {
            plan_course_id: created.id,
            semester: s,
            weekly_hours: Number(weekly_hours),
            weeks_count: weeks,
          },
        });
      }

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

    if (newStart > newEnd) {
      return fail(res, '开始学期不能大于结束学期', 400);
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
        // 范围变更时，同步区间内保留的学期记录的 weekly_hours（仅更新仍等于旧默认值的记录）
        if (newWeeklyHours !== currentPc.weekly_hours) {
          const retainedSemesters = [...existingSemesterSet].filter((s) => newSemesterSet.has(s));
          if (retainedSemesters.length > 0) {
            await tx.plan_course_semesters.updateMany({
              where: {
                plan_course_id: Number(id),
                semester: { in: retainedSemesters },
                weekly_hours: currentPc.weekly_hours,
              },
              data: { weekly_hours: newWeeklyHours },
            });
          }
        }
      } else {
        // M2 修复：学期范围未变时，如果 weekly_hours 或 weeks_per_semester 发生变化，
        // 仅同步仍等于旧默认值的学期记录，保留用户对特定学期的单独设置
        if (newWeeklyHours !== currentPc.weekly_hours) {
          await tx.plan_course_semesters.updateMany({
            where: {
              plan_course_id: Number(id),
              weekly_hours: currentPc.weekly_hours,
            },
            data: { weekly_hours: newWeeklyHours },
          });
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

    success(res, pc, '更新成功');
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
 * 仅更新课程排序序号（不触发学期记录重建，避免教材关联丢失）
 *
 * 严重-1 修复配套：拖拽排序是高频操作，走轻量端点避免无谓的学期记录 diff。
 */
export async function updatePlanCourseSortOrder(req, res, next) {
  try {
    const { id } = req.params;
    const { sort_order } = req.body;

    if (sort_order === undefined || sort_order === null) {
      return fail(res, '排序序号为必填项');
    }

    const updated = await prisma.plan_courses.update({
      where: { id: Number(id) },
      data: { sort_order: Number(sort_order) },
      select: { id: true, sort_order: true },
    });

    await createAuditLog({
      module: 'trainingPlan',
      action: 'update',
      userId: req.user?.id,
      ip: req.ip,
      result: 'success',
      message: '更新课程排序',
      details: { course_id: Number(id), sort_order: Number(sort_order) },
    });

    success(res, updated, '排序已更新');
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'update',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: '更新课程排序失败',
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
    try {
      await prisma.plan_courses.delete({ where: { id: Number(id) } });

      await createAuditLog({
        module: 'trainingPlan',
        action: 'delete',
        userId: req.user?.id,
        ip: req.ip,
        result: 'success',
        message: '删除培养方案课程',
        details: { course_id: Number(id) },
      });

      success(res, null, '删除成功');
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

    await createAuditLog({
      module: 'trainingPlan',
      action: 'update',
      userId: req.user?.id,
      ip: req.ip,
      result: 'success',
      message: '更新学期安排',
      details: { semester_id: Number(id) },
    });

    success(res, sem, '更新成功');
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
 * 关联教材到学期
 *
 * 替换语义：每次调用都会先删除该学期的所有已有教材关联，再创建新关联。
 * 如果需要追加教材，请使用单独的 create 接口而非此接口。
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
 * 删除教材关联记录
 */
export async function deletePlanTextbook(req, res, next) {
  try {
    const { id } = req.params;
    try {
      await prisma.plan_textbooks.delete({ where: { id: Number(id) } });

      await createAuditLog({
        module: 'trainingPlan',
        action: 'delete',
        userId: req.user?.id,
        ip: req.ip,
        result: 'success',
        message: '删除培养方案教材',
        details: { id: Number(id) },
      });

      success(res, null, '取消关联成功');
    } catch (e) {
      if (e.code === 'P2025') return fail(res, '教材关联不存在', 404);
      throw e;
    }
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'delete',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: '删除培养方案教材失败',
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
