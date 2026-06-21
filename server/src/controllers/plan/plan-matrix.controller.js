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
 * 更新培养方案课程信息（同步更新学期记录）
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

    const pc = await prisma.$transaction(async (tx) => {
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

      await tx.plan_course_semesters.deleteMany({
        where: { plan_course_id: Number(id) },
      });

      for (let s = newStart; s <= newEnd; s++) {
        await tx.plan_course_semesters.create({
          data: {
            plan_course_id: Number(id),
            semester: s,
            weekly_hours: newWeeklyHours,
            weeks_count: newWeeksPerSemester,
          },
        });
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
    const semesters = await prisma.plan_course_semesters.findMany({
      where: { plan_courses: { plan_id: Number(id) } },
      select: { semester: true, weeks_count: true },
      distinct: ['semester'],
      orderBy: { semester: 'asc' },
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
 * 关联教材到学期（先删后增）
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
