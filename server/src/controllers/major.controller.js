import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import {
  autoFixSortOrder,
  invalidateSortOrderCache,
  getNextSortOrder,
  buildUpdateData,
} from '../utils/sort.js';

/**
 * 获取专业列表
 */
export async function listMajors(req, res, next) {
  try {
    await autoFixSortOrder('majors');
    const majors = await prisma.majors.findMany({
      include: { _count: { select: { classes: true, training_plans: true } } },
      orderBy: { sort_order: 'asc' },
    });

    const formattedMajors = majors.map((major) => ({
      ...major,
      classCount: major._count?.classes || 0,
      planCount: major._count?.training_plans || 0,
    }));
    success(res, formattedMajors);
  } catch (e) {
    next(e);
  }
}

/**
 * 创建专业
 */
export async function createMajor(req, res, next) {
  try {
    const { name, code, description, sort_order } = req.body;
    if (!name) return fail(res, '专业名称不能为空');

    const newSortOrder = await getNextSortOrder(prisma, 'majors');
    const finalSortOrder = sort_order !== undefined ? Number(sort_order) : newSortOrder;

    const major = await prisma.majors.create({
      data: { name, code, description, sort_order: finalSortOrder },
    });

    await createAuditLog({
      action: 'create',
      module: 'major',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: major.id, name, code },
      result: 'success',
      message: `创建专业：${name}`,
    });

    invalidateSortOrderCache('majors');
    success(res, major, '创建成功');
  } catch (e) {
    await createAuditLog({
      action: 'create',
      module: 'major',
      userId: req.user?.id,
      ip: req.ip,
      details: req.body,
      result: 'failed',
      message: `创建专业失败：${e.message}`,
    });
    next(e);
  }
}

/**
 * 更新专业
 */
export async function updateMajor(req, res, next) {
  try {
    const { id } = req.params;

    const data = buildUpdateData(req.body, ['name', 'code', 'description', 'sort_order']);

    try {
      const major = await prisma.majors.update({
        where: { id: Number(id) },
        data,
      });

      await createAuditLog({
        action: 'update',
        module: 'major',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: major.id, name: data.name || major.name, code: data.code },
        result: 'success',
        message: `更新专业：${data.name || major.name}`,
      });

      invalidateSortOrderCache('majors');
      success(res, major, '更新成功');
    } catch (e) {
      await createAuditLog({
        action: 'update',
        module: 'major',
        userId: req.user?.id,
        ip: req.ip,
        details: { id, ...req.body },
        result: 'failed',
        message: `更新专业失败：${e.message}`,
      });
      if (e.code === 'P2025') return fail(res, '专业不存在', 404);
      throw e;
    }
  } catch (e) {
    next(e);
  }
}

/**
 * 删除专业
 */
export async function deleteMajor(req, res, next) {
  try {
    const { id } = req.params;
    const numId = Number(id);

    const classCount = await prisma.classes.count({ where: { major_id: numId } });
    if (classCount > 0) return fail(res, '该专业下存在班级，无法删除');

    // S-06 修复：检查培养方案关联，防止 onDelete:SetNull 静默破坏方案专业匹配
    const planCount = await prisma.training_plans.count({ where: { major_id: numId } });
    if (planCount > 0) {
      return fail(res, `该专业仍被${planCount}个培养方案引用，请先解除关联`);
    }

    try {
      const major = await prisma.majors.findUnique({ where: { id: numId } });
      await prisma.majors.delete({ where: { id: numId } });

      await createAuditLog({
        action: 'delete',
        module: 'major',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id), name: major?.name },
        result: 'success',
        message: `删除专业：${major?.name}`,
      });

      invalidateSortOrderCache('majors');
      success(res, null, '删除成功');
    } catch (e) {
      await createAuditLog({
        action: 'delete',
        module: 'major',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id) },
        result: 'failed',
        message: `删除专业失败：${e.message}`,
      });
      if (e.code === 'P2025') return fail(res, '专业不存在', 404);
      throw e;
    }
  } catch (e) {
    next(e);
  }
}
