import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { autoFixSortOrder, invalidateSortOrderCache } from '../utils/sort.js';
import { getNextSortOrder, buildUpdateData } from '../utils/sort-helper.js';

export async function listCourses(req, res, next) {
  try {
    const { type } = req.query;
    const where = type ? { type } : {};
    await autoFixSortOrder('courses', type ? { type } : {});
    const courses = await prisma.courses.findMany({ where, orderBy: { sort_order: 'asc' } });
    success(res, courses);
  } catch (e) { next(e); }
}

export async function createCourse(req, res, next) {
  try {
    const { name, code, type, description, sort_order } = req.body;
    if (!name) return fail(res, '课程名称不能为空');
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
  } catch (e) { next(e); }
}

export async function deleteCourse(req, res, next) {
  try {
    const { id } = req.params;
    const planCount = await prisma.plan_courses.count({ where: { course_id: Number(id) } });
    if (planCount > 0) return fail(res, '该课程已被培养方案使用，无法删除');
    try {
      const course = await prisma.courses.findUnique({ where: { id: Number(id) } });
      await prisma.courses.delete({ where: { id: Number(id) } });

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
  } catch (e) { next(e); }
}
