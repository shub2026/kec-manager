import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import {
  autoFixSortOrder,
  invalidateSortOrderCache,
  getNextSortOrder,
  buildUpdateData,
} from '../utils/sort.js';

export async function listCourses(req, res, next) {
  try {
    const { type } = req.query;
    const where = type ? { type } : {};
    await autoFixSortOrder('courses', type ? { type } : {});
    const courses = await prisma.courses.findMany({
      where,
      include: {
        _count: {
          select: {
            plan_courses: true,
            teaching_assignments: true,
            teacher_courses: true,
          },
        },
      },
      orderBy: { sort_order: 'asc' },
    });
    const formattedCourses = courses.map((course) => ({
      ...course,
      planCount: course._count?.plan_courses || 0,
      assignmentCount: course._count?.teaching_assignments || 0,
      teacherCourseCount: course._count?.teacher_courses || 0,
    }));
    success(res, formattedCourses);
  } catch (e) {
    next(e);
  }
}

export async function createCourse(req, res, next) {
  try {
    const { name, code, type, description, sort_order } = req.body;
    if (!name) return fail(res, '课程名称不能为空');
    const existing = await prisma.courses.findFirst({ where: { name } });
    if (existing) return fail(res, '该课程名称已存在', 409);
    const newSortOrder = await getNextSortOrder(prisma, 'courses');
    const finalSortOrder = sort_order !== undefined ? Number(sort_order) : newSortOrder;
    const course = await prisma.courses.create({
      data: { name, code, type: type || 'public', description, sort_order: finalSortOrder },
    });

    await createAuditLog({
      action: 'create',
      module: 'course',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: course.id, name, code },
      result: 'success',
      message: `创建课程：${name}`,
    });

    invalidateSortOrderCache('courses');
    success(res, course, '创建成功');
  } catch (e) {
    await createAuditLog({
      action: 'create',
      module: 'course',
      userId: req.user?.id,
      ip: req.ip,
      details: req.body,
      result: 'failed',
      message: `创建课程失败：${e.message}`,
    });
    next(e);
  }
}

export async function updateCourse(req, res, next) {
  try {
    const { id } = req.params;
    const data = buildUpdateData(req.body, ['name', 'code', 'type', 'description', 'sort_order']);
    if (data.name) {
      const duplicate = await prisma.courses.findFirst({
        where: { name: data.name, NOT: { id: Number(id) } },
      });
      if (duplicate) return fail(res, '该课程名称已存在', 409);
    }
    try {
      const course = await prisma.courses.update({ where: { id: Number(id) }, data });

      await createAuditLog({
        action: 'update',
        module: 'course',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: course.id, name: data.name || course.name, code: data.code },
        result: 'success',
        message: `更新课程：${data.name || course.name}`,
      });

      invalidateSortOrderCache('courses');
      success(res, course, '更新成功');
    } catch (e) {
      await createAuditLog({
        action: 'update',
        module: 'course',
        userId: req.user?.id,
        ip: req.ip,
        details: { id, ...req.body },
        result: 'failed',
        message: `更新课程失败：${e.message}`,
      });
      if (e.code === 'P2025') return fail(res, '课程不存在', 404);
      throw e;
    }
  } catch (e) {
    next(e);
  }
}

export async function deleteCourse(req, res, next) {
  try {
    const { id } = req.params;
    const courseId = Number(id);
    // H-5: 补全关联检查 — 培养方案 + 排课记录 + 教师关联
    // P2-10: 以下 count 检查为 UX 软阻拦，提示用户先清理关联数据；
    // DB 层 teacher_courses / teaching_assignments 等为 onDelete: Cascade，
    // 即使绕过此处检查，Prisma 也会级联删除。此处保留软阻拦以避免误删导致数据丢失。
    const [planCount, assignmentCount, teacherCourseCount] = await Promise.all([
      prisma.plan_courses.count({ where: { course_id: courseId } }),
      prisma.teaching_assignments.count({ where: { course_id: courseId } }),
      prisma.teacher_courses.count({ where: { course_id: courseId } }),
    ]);
    if (planCount > 0) return fail(res, '该课程已被培养方案使用，无法删除');
    if (assignmentCount > 0) return fail(res, '该课程已有排课记录，请先删除排课后再删除课程');
    if (teacherCourseCount > 0) return fail(res, '该课程已关联教师，请先解除教师关联后再删除课程');
    try {
      const course = await prisma.courses.findUnique({ where: { id: courseId } });
      await prisma.courses.delete({ where: { id: courseId } });

      await createAuditLog({
        action: 'delete',
        module: 'course',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id), name: course?.name },
        result: 'success',
        message: `删除课程：${course?.name}`,
      });

      invalidateSortOrderCache('courses');
      success(res, null, '删除成功');
    } catch (e) {
      await createAuditLog({
        action: 'delete',
        module: 'course',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id) },
        result: 'failed',
        message: `删除课程失败：${e.message}`,
      });
      if (e.code === 'P2025') return fail(res, '课程不存在', 404);
      throw e;
    }
  } catch (e) {
    next(e);
  }
}
