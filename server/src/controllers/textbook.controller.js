import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import {
  autoFixSortOrder,
  invalidateSortOrderCache,
  getNextSortOrder,
  buildUpdateData,
} from '../utils/sort.js';

export async function listTextbooks(req, res, next) {
  try {
    await autoFixSortOrder('textbooks');

    const { page, page_size, title, category, publisher, sort_by, sort_dir } = req.query;

    // 服务端筛选：书名模糊、类别精确、出版社精确
    const where = {};
    if (title) where.title = { contains: title };
    if (category) where.category = category;
    if (publisher) where.publisher = publisher;

    // 排序：默认按 sort_order 升序；支持指定列与方向（白名单防注入）
    const ALLOWED_SORT = [
      'title',
      'publisher',
      'category',
      'price',
      'publish_date',
      'sort_order',
      'created_at',
      'updated_at',
    ];
    let orderBy = { sort_order: 'asc' };
    if (sort_by && ALLOWED_SORT.includes(sort_by)) {
      const dir = sort_dir === 'desc' ? 'desc' : 'asc';
      orderBy = { [sort_by]: dir };
    }

    // 分页：仅当显式传入 page/page_size 时分页；否则返回全部（兼容查询页/方案页取全量）
    const usePagination = page !== undefined || page_size !== undefined;
    const pageNum = page ? Number(page) : 1;
    const pageSizeNum = page_size ? Number(page_size) : 20;

    const baseQuery = {
      where,
      include: { _count: { select: { plan_textbooks: true } } },
      orderBy,
    };
    if (usePagination) {
      baseQuery.skip = (pageNum - 1) * pageSizeNum;
      baseQuery.take = pageSizeNum;
    }

    // 聚合全部出版社（不随筛选变化），用于前端筛选下拉；与列表查询并发执行
    const [textbooks, total, publisherRows] = await Promise.all([
      prisma.textbooks.findMany(baseQuery),
      prisma.textbooks.count({ where }),
      prisma.textbooks.findMany({
        where: { publisher: { not: null } },
        select: { publisher: true },
        distinct: ['publisher'],
        orderBy: { publisher: 'asc' },
      }),
    ]);

    const formattedTextbooks = textbooks.map((textbook) => ({
      ...textbook,
      usageCount: textbook._count?.plan_textbooks || 0,
    }));

    const publishers = publisherRows.map((r) => r.publisher).filter(Boolean).sort();

    success(res, { items: formattedTextbooks, total, publishers });
  } catch (e) {
    next(e);
  }
}

export async function createTextbook(req, res, next) {
  try {
    const {
      title,
      isbn,
      publisher,
      author,
      edition,
      publish_date,
      price,
      category,
      description,
      is_active,
      sort_order,
    } = req.body;
    if (!title) return fail(res, '书名不能为空');
    const existing = await prisma.textbooks.findFirst({ where: { title } });
    if (existing) return fail(res, '该教材名称已存在', 409);
    const newSortOrder = await getNextSortOrder('textbooks');
    const finalSortOrder = sort_order !== undefined ? Number(sort_order) : newSortOrder;
    const textbook = await prisma.textbooks.create({
      data: {
        title,
        isbn,
        publisher,
        author,
        edition,
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
    if (e.code === 'P2002') return fail(res, '该书名的教材已存在', 409);
    next(e);
  }
}

export async function updateTextbook(req, res, next) {
  try {
    const { id } = req.params;
    const updateData = buildUpdateData(req.body, [
      'title',
      'isbn',
      'publisher',
      'author',
      'edition',
      'publish_date',
      'price',
      'category',
      'description',
      'is_active',
      'sort_order',
    ]);
    // 特殊处理：确保 price 和 publish_date 的正确转换
    if (req.body.price !== undefined)
      updateData.price = req.body.price ? Number(req.body.price) : null;
    if (req.body.publish_date !== undefined)
      updateData.publish_date = req.body.publish_date || null;

    if (updateData.title) {
      const duplicate = await prisma.textbooks.findFirst({
        where: { title: updateData.title, NOT: { id: Number(id) } },
      });
      if (duplicate) return fail(res, '该教材名称已存在', 409);
    }

    try {
      const textbook = await prisma.textbooks.update({
        where: { id: Number(id) },
        data: updateData,
      });

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
      if (e.code === 'P2002') return fail(res, '该书名的教材已存在', 409);
      throw e;
    }
  } catch (e) {
    next(e);
  }
}

export async function deleteTextbook(req, res, next) {
  try {
    const { id } = req.params;
    const usageCount = await prisma.plan_textbooks.count({ where: { textbook_id: Number(id) } });
    if (usageCount > 0) return fail(res, '该教材已被培养方案引用，无法删除');
    try {
      const deleted = await prisma.textbooks.delete({ where: { id: Number(id) } });

      await createAuditLog({
        action: 'delete',
        module: 'textbook',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id), name: deleted.title },
        result: 'success',
        message: `删除教材：${deleted.title}`,
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
  } catch (e) {
    next(e);
  }
}

export async function toggleTextbookStatus(req, res, next) {
  try {
    const { id } = req.params;
    try {
      const current = await prisma.textbooks.findUnique({
        where: { id: Number(id) },
        select: { is_active: true, title: true },
      });
      if (!current) return fail(res, '教材不存在', 404);
      // H-4: 接受前端传入的目标状态，而非盲目 toggle
      const targetActive =
        req.body?.is_active !== undefined ? !!req.body.is_active : !current.is_active;
      const updated = await prisma.textbooks.update({
        where: { id: Number(id) },
        data: { is_active: targetActive },
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
  } catch (e) {
    next(e);
  }
}

/**
 * POST /api/textbooks/batch-update — 批量更新教材
 * Body: { ids: number[], updates: object }
 * 在单个事务中完成所有更新，避免逐条请求触发 429 限流和 SQLite 锁冲突
 */
export async function batchUpdateTextbooks(req, res, next) {
  try {
    const { ids, updates } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return fail(res, 'ids 不能为空');
    }
    if (ids.length > 500) {
      return fail(res, '单次批量更新最多 500 个教材');
    }
    if (!updates || typeof updates !== 'object') {
      return fail(res, 'updates 不能为空');
    }

    const textbookIds = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (textbookIds.length === 0) {
      return fail(res, 'ids 中没有有效的教材 ID');
    }

    // 只允许更新安全字段，防止前端传入不允许修改的字段
    const safeFields = ['status', 'sort_order', 'category', 'publisher', 'author'];
    const updateData = {};
    for (const field of safeFields) {
      if (updates[field] !== undefined) {
        updateData[field] = updates[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return fail(res, '没有可更新的字段');
    }

    // 数值字段转换
    if (updateData.sort_order !== undefined) updateData.sort_order = Number(updateData.sort_order);

    // 批量查询目标教材（用于结果构造）
    const textbooks = await prisma.textbooks.findMany({
      where: { id: { in: textbookIds } },
      select: { id: true, title: true },
    });
    const textbookMap = new Map(textbooks.map((t) => [t.id, t]));

    // 在单个事务中执行所有更新
    const succeeded = [];
    const failed = [];

    await prisma.$transaction(async (tx) => {
      for (const id of textbookIds) {
        try {
          await tx.textbooks.update({
            where: { id },
            data: updateData,
          });
          const tb = textbookMap.get(id);
          succeeded.push({ id, title: tb?.title || `ID:${id}` });
        } catch (e) {
          const tb = textbookMap.get(id);
          failed.push({
            id,
            title: tb?.title || `ID:${id}`,
            reason: e.code === 'P2025' ? '教材不存在' : e.message,
          });
        }
      }
    });

    // 审计日志
    await createAuditLog({
      action: 'batch_update',
      module: 'textbook',
      userId: req.user?.id,
      ip: req.ip,
      details: {
        requested: textbookIds.length,
        succeeded: succeeded.length,
        failed: failed.length,
        fields: Object.keys(updateData),
      },
      result: succeeded.length > 0 ? 'success' : 'failed',
      message: `批量更新教材：成功 ${succeeded.length} 个，失败 ${failed.length} 个`,
    });

    invalidateSortOrderCache('textbooks');

    success(res, {
      total: textbookIds.length,
      succeeded,
      failed,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /api/textbooks/batch-delete — 批量删除教材
 * Body: { ids: number[] }
 * 在单个事务中完成所有删除，检查 plan_textbooks 引用，被引用的教材跳过
 */
export async function batchDeleteTextbooks(req, res, next) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return fail(res, 'ids 不能为空');
    }
    if (ids.length > 500) {
      return fail(res, '单次批量删除最多 500 个教材');
    }

    const textbookIds = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (textbookIds.length === 0) {
      return fail(res, 'ids 中没有有效的教材 ID');
    }

    // 1) 批量查询目标教材名称
    const textbooks = await prisma.textbooks.findMany({
      where: { id: { in: textbookIds } },
      select: { id: true, title: true },
    });
    const textbookMap = new Map(textbooks.map((t) => [t.id, t]));

    // 2) 批量查询哪些教材被培养方案引用（阻碍删除）
    const referencedTextbooks = await prisma.plan_textbooks.groupBy({
      by: ['textbook_id'],
      where: { textbook_id: { in: textbookIds } },
      _count: true,
    });
    const referencedMap = new Map(referencedTextbooks.map((r) => [r.textbook_id, r._count]));

    // 3) 可删除的 ID（未被引用且在数据库中存在）
    const deletableIds = textbookIds.filter((id) => !referencedMap.has(id) && textbookMap.has(id));

    // 4) 在单个事务中批量删除
    let deletedCount = 0;
    if (deletableIds.length > 0) {
      deletedCount = await prisma.$transaction(async (tx) => {
        const result = await tx.textbooks.deleteMany({
          where: { id: { in: deletableIds } },
        });
        return result.count;
      });
      invalidateSortOrderCache('textbooks');
    }

    // 5) 构造逐项结果
    const succeeded = [];
    const failed = [];
    const skippedIds = [];

    for (const id of textbookIds) {
      const tb = textbookMap.get(id);
      if (!tb) {
        failed.push({ id, title: `ID:${id}`, reason: '教材不存在' });
      } else if (referencedMap.has(id)) {
        const count = referencedMap.get(id);
        skippedIds.push(id);
        failed.push({
          id,
          title: tb.title,
          reason: `已被 ${count} 个培养方案引用，无法删除`,
        });
      } else {
        succeeded.push({ id, title: tb.title });
      }
    }

    // 6) 审计日志
    await createAuditLog({
      action: 'batch_delete',
      module: 'textbook',
      userId: req.user?.id,
      ip: req.ip,
      details: {
        requested: textbookIds.length,
        deleted: deletedCount,
        skipped: skippedIds.length,
      },
      result: deletedCount > 0 ? 'success' : 'failed',
      message: `批量删除教材：成功 ${deletedCount} 个，跳过 ${skippedIds.length} 个`,
    });

    success(res, {
      total: textbookIds.length,
      succeeded,
      failed,
      skippedIds,
      deletedCount,
    });
  } catch (e) {
    next(e);
  }
}
