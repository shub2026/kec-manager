import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import {
  autoFixSortOrder,
  invalidateSortOrderCache,
  getNextSortOrder,
  buildUpdateData,
} from '../utils/sort.js';

export async function listTrainingLevels(req, res, next) {
  try {
    await autoFixSortOrder('training_levels');
    const levels = await prisma.training_levels.findMany({
      include: {
        _count: {
          select: {
            classes: true,
            training_plans: true,
            scheduling_teachers: true,
          },
        },
      },
      orderBy: { sort_order: 'asc' },
    });

    const formattedLevels = levels.map((level) => ({
      ...level,
      classCount: level._count?.classes || 0,
      planCount: level._count?.training_plans || 0,
      schedulingCount: level._count?.scheduling_teachers || 0,
    }));
    success(res, formattedLevels);
  } catch (e) {
    next(e);
  }
}

export async function createTrainingLevel(req, res, next) {
  try {
    const { name, code, description, sort_order } = req.body;
    if (!name) return fail(res, '层次名称不能为空');
    const newSortOrder = await getNextSortOrder('training_levels');
    const finalSortOrder = sort_order !== undefined ? Number(sort_order) : newSortOrder;
    const level = await prisma.training_levels.create({
      data: { name, code, description, sort_order: finalSortOrder },
    });
    await createAuditLog({
      action: 'create',
      module: 'training_level',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: level.id, name },
      result: 'success',
      message: `创建培养层次：${name}`,
    });
    invalidateSortOrderCache('training_levels');
    success(res, level, '创建成功');
  } catch (e) {
    await createAuditLog({
      action: 'create',
      module: 'training_level',
      userId: req.user?.id,
      ip: req.ip,
      details: { name },
      result: 'failed',
      message:
        e.code === 'P2002' ? `创建培养层次失败：${name} 已存在` : `创建培养层次失败: ${e.message}`,
    });
    if (e.code === 'P2002') return fail(res, '该层次名称已存在');
    next(e);
  }
}

export async function updateTrainingLevel(req, res, next) {
  try {
    const { id } = req.params;
    const data = buildUpdateData(req.body, ['name', 'code', 'description', 'sort_order']);
    try {
      const level = await prisma.training_levels.update({ where: { id: Number(id) }, data });
      await createAuditLog({
        action: 'update',
        module: 'training_level',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id), name: data.name || level.name },
        result: 'success',
        message: `更新培养层次：${data.name || level.name}`,
      });
      invalidateSortOrderCache('training_levels');
      success(res, level, '更新成功');
    } catch (e) {
      if (e.code === 'P2025') return fail(res, '层次不存在', 404);
      if (e.code === 'P2002') return fail(res, '该层次名称已存在');
      throw e;
    }
  } catch (e) {
    await createAuditLog({
      action: 'update',
      module: 'training_level',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: Number(req.params.id) },
      result: 'failed',
      message: `更新培养层次失败: ${e.message}`,
    });
    next(e);
  }
}

export async function deleteTrainingLevel(req, res, next) {
  try {
    const { id } = req.params;
    const numId = Number(id);

    const classCount = await prisma.classes.count({ where: { training_level_id: numId } });
    if (classCount > 0) return fail(res, '该层次下存在班级，无法删除');

    // S-01 修复：检查教师排课层次偏好和培养方案关联，防止级联静默清除
    const [schedulingCount, planCount] = await Promise.all([
      prisma.teacher_training_levels.count({ where: { training_level_id: numId } }),
      prisma.training_plans.count({ where: { training_level_id: numId } }),
    ]);
    if (schedulingCount > 0 || planCount > 0) {
      const parts = [];
      if (schedulingCount > 0) parts.push(`${schedulingCount}位教师排课偏好`);
      if (planCount > 0) parts.push(`${planCount}个培养方案`);
      return fail(res, `该层次仍被引用（${parts.join('、')}），请先解除关联`);
    }

    try {
      await prisma.training_levels.delete({ where: { id: numId } });
      await createAuditLog({
        action: 'delete',
        module: 'training_level',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id) },
        result: 'success',
        message: `删除培养层次 ID: ${id}`,
      });
      invalidateSortOrderCache('training_levels');
      success(res, null, '删除成功');
    } catch (e) {
      if (e.code === 'P2025') return fail(res, '层次不存在', 404);
      throw e;
    }
  } catch (e) {
    await createAuditLog({
      action: 'delete',
      module: 'training_level',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: Number(req.params.id) },
      result: 'failed',
      message: `删除培养层次失败: ${e.message}`,
    });
    next(e);
  }
}
