import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { autoFixSortOrder, invalidateSortOrderCache } from '../utils/sort.js';
import { getNextSortOrder, buildUpdateData } from '../utils/sort-helper.js';

export async function listTextbooks(req, res, next) {
  try {
    await autoFixSortOrder('textbooks');
    const textbooks = await prisma.textbooks.findMany({ orderBy: { sort_order: 'asc' } });
    success(res, textbooks);
  } catch (e) { next(e); }
}

export async function createTextbook(req, res, next) {
  try {
    const { title, isbn, publisher, author, edition, publish_date, price, category, description, is_active, sort_order } = req.body;
    if (!title) return fail(res, '书名不能为空');
    const newSortOrder = await getNextSortOrder(prisma, 'textbooks');
    const finalSortOrder = sort_order !== undefined ? Number(sort_order) : newSortOrder;
    const textbook = await prisma.textbooks.create({
      data: {
        title, isbn, publisher, author, edition,
        publish_date: publish_date || null,
        price: price ? Number(price) : null,
        category: category || null,
        description,
        is_active: is_active !== undefined ? is_active : true,
        sort_order: finalSortOrder,
      },
    });

    await createAuditLog({
      action: 'create',
      module: 'textbook',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: textbook.id, name: title },
      result: 'success',
      message: `创建教材：${title}`,
    });

    invalidateSortOrderCache('textbooks');
    success(res, textbook, '创建成功');
  } catch (e) {
    await createAuditLog({
      action: 'create',
      module: 'textbook',
      userId: req.user?.id,
      ip: req.ip,
      details: req.body,
      result: 'failed',
      message: `创建教材失败：${e.message}`,
    });
    next(e);
  }
}

export async function updateTextbook(req, res, next) {
  try {
    const { id } = req.params;
    const updateData = buildUpdateData(req.body, [
      'title', 'isbn', 'publisher', 'author', 'edition', 
      'publish_date', 'price', 'category', 'description', 
      'is_active', 'sort_order'
    ]);
    // 特殊处理：确保 price 和 publish_date 的正确转换
    if (req.body.price !== undefined) updateData.price = req.body.price ? Number(req.body.price) : null;
    if (req.body.publish_date !== undefined) updateData.publish_date = req.body.publish_date || null;
    
    try {
      const textbook = await prisma.textbooks.update({ where: { id: Number(id) }, data: updateData });

      await createAuditLog({
        action: 'update',
        module: 'textbook',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: textbook.id, name: updateData.title || textbook.title },
        result: 'success',
        message: `更新教材：${updateData.title || textbook.title}`,
      });

      invalidateSortOrderCache('textbooks');
      success(res, textbook, '更新成功');
    } catch (e) {
      await createAuditLog({
        action: 'update',
        module: 'textbook',
        userId: req.user?.id,
        ip: req.ip,
        details: { id, ...req.body },
        result: 'failed',
        message: `更新教材失败：${e.message}`,
      });
      if (e.code === 'P2025') return fail(res, '教材不存在', 404);
      throw e;
    }
  } catch (e) { next(e); }
}

export async function deleteTextbook(req, res, next) {
  try {
    const { id } = req.params;
    const usageCount = await prisma.plan_textbooks.count({ where: { textbook_id: Number(id) } });
    if (usageCount > 0) return fail(res, '该教材已被培养方案引用，无法删除');
    try {
      const textbook = await prisma.textbooks.findUnique({ where: { id: Number(id) } });
      await prisma.textbooks.delete({ where: { id: Number(id) } });

      await createAuditLog({
        action: 'delete',
        module: 'textbook',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id), name: textbook?.title },
        result: 'success',
        message: `删除教材：${textbook?.title}`,
      });

      invalidateSortOrderCache('textbooks');
      success(res, null, '删除成功');
    } catch (e) {
      await createAuditLog({
        action: 'delete',
        module: 'textbook',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id) },
        result: 'failed',
        message: `删除教材失败：${e.message}`,
      });
      if (e.code === 'P2025') return fail(res, '教材不存在', 404);
      throw e;
    }
  } catch (e) { next(e); }
}

export async function toggleTextbookStatus(req, res, next) {
  try {
    const { id } = req.params;
    try {
      const current = await prisma.textbooks.findUnique({ 
        where: { id: Number(id) }, 
        select: { is_active: true, title: true } 
      });
      if (!current) return fail(res, '教材不存在', 404);
      const updated = await prisma.textbooks.update({
        where: { id: Number(id) },
        data: { is_active: !current.is_active },
      });

      await createAuditLog({
        action: 'update',
        module: 'textbook',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: updated.id, name: current.title, is_active: updated.is_active },
        result: 'success',
        message: `${updated.is_active ? '启用' : '停用'}教材：${current.title}`,
      });

      invalidateSortOrderCache('textbooks');
      success(res, updated, updated.is_active ? '已启用' : '已停用');
    } catch (e) {
      await createAuditLog({
        action: 'update',
        module: 'textbook',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id), action: 'toggle-status' },
        result: 'failed',
        message: `切换教材状态失败：${e.message}`,
      });
      if (e.code === 'P2025') return fail(res, '教材不存在', 404);
      throw e;
    }
  } catch (e) { next(e); }
}
