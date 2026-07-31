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
    // 注：major 删除检查项仅 classes 和 training_plans，与上面 _count 完全对应
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

    const newSortOrder = await getNextSortOrder('majors');
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

    try {
      // TOCTOU 修复：前置检查与删除包入同一事务，防止检查后并发插入班级/方案
      // 穿透检查触发 onDelete:SetNull 静默置空
      const result = await prisma.$transaction(async (tx) => {
        const classCount = await tx.classes.count({ where: { major_id: numId } });
        if (classCount > 0) return { blocked: '该专业下存在班级，无法删除' };

        // S-06 修复：检查培养方案关联，防止 onDelete:SetNull 静默破坏方案专业匹配
        const planCount = await tx.training_plans.count({ where: { major_id: numId } });
        if (planCount > 0) {
          return { blocked: `该专业仍被${planCount}个培养方案引用，请先解除关联` };
        }

        const deleted = await tx.majors.delete({ where: { id: numId } });
        return { deleted };
      });
      if (result.blocked) return fail(res, result.blocked);
      const deleted = result.deleted;

      await createAuditLog({
        action: 'delete',
        module: 'major',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id), name: deleted.name },
        result: 'success',
        message: `删除专业：${deleted.name}`,
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
