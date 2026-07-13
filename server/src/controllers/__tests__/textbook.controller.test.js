/**
 * textbook.controller.js 单元测试
 *
 * 覆盖函数：
 * - listTextbooks：列表查询含 usageCount、autoFixSortOrder 调用
 * - createTextbook：创建、重复检查、sort_order、审计日志、P2002 错误
 * - updateTextbook：字段更新、重复标题检查、price/publish_date 处理、P2025/P2002 错误
 * - deleteTextbook：删除、引用检查、P2025 错误
 * - toggleTextbookStatus：状态切换、is_active 传入 vs 盲目 toggle、P2025 错误
 * - batchUpdateTextbooks：批量更新、安全字段过滤、事务错误、校验
 * - batchDeleteTextbooks：批量删除、引用检查、不存在教材处理、校验
 *
 * Mock 策略：mock prisma 和依赖服务，直接调用控制器函数验证行为。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockTx = {
  textbooks: {
    update: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
};

const mockPrisma = {
  textbooks: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({ id: 1 }),
    update: vi.fn().mockResolvedValue({ id: 1 }),
    delete: vi.fn().mockResolvedValue({ id: 1, title: '测试教材' }),
  },
  plan_textbooks: {
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
  },
  $transaction: vi.fn(async (fn) => fn(mockTx)),
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖服务
// ──────────────────────────────────────────────
vi.mock('../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/sort.js', () => ({
  autoFixSortOrder: vi.fn().mockResolvedValue(false),
  invalidateSortOrderCache: vi.fn(),
  getNextSortOrder: vi.fn().mockResolvedValue(1),
  buildUpdateData: vi.fn((data, allowedFields) => {
    const updateData = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }
    return updateData;
  }),
}));

// ──────────────────────────────────────────────
// 导入被测模块（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const {
  listTextbooks,
  createTextbook,
  updateTextbook,
  deleteTextbook,
  toggleTextbookStatus,
  batchUpdateTextbooks,
  batchDeleteTextbooks,
} = await import('../textbook.controller.js');
const { createAuditLog } = await import('../../services/audit.service.js');
const { autoFixSortOrder, invalidateSortOrderCache, getNextSortOrder } =
  await import('../../utils/sort.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(params, body) {
  return {
    params: { id: String(params.id) },
    body,
    user: { id: 1 },
    ip: '127.0.0.1',
  };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

// ════════════════════════════════════════════════
// listTextbooks 测试
// ════════════════════════════════════════════════
describe('listTextbooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 区分两次 findMany：带 distinct 的是出版社聚合查询
  function mockFindMany(textbooks) {
    mockPrisma.textbooks.findMany.mockImplementation((args) =>
      args && args.distinct ? Promise.resolve([]) : Promise.resolve(textbooks)
    );
  }

  it('应返回 {items,total,publishers} 且含 usageCount 字段', async () => {
    mockFindMany([
      { id: 1, title: '教材A', _count: { plan_textbooks: 3 } },
      { id: 2, title: '教材B', _count: { plan_textbooks: 0 } },
    ]);
    mockPrisma.textbooks.count.mockResolvedValue(2);

    const req = { params: {}, query: {}, body: {}, user: { id: 1 }, ip: '127.0.0.1' };
    const res = mockRes();
    const next = vi.fn();

    await listTextbooks(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(autoFixSortOrder).toHaveBeenCalledWith('textbooks');
    expect(mockPrisma.textbooks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        include: { _count: { select: { plan_textbooks: true } } },
        orderBy: { sort_order: 'asc' },
      })
    );
    const data = res.json.mock.calls[0][0].data;
    expect(data.items).toHaveLength(2);
    expect(data.items[0]).toMatchObject({ id: 1, title: '教材A', usageCount: 3 });
    expect(data.items[1]).toMatchObject({ id: 2, title: '教材B', usageCount: 0 });
    expect(data.total).toBe(2);
    expect(data.publishers).toEqual([]);
  });

  it('_count 缺失时 usageCount 应为 0', async () => {
    mockFindMany([{ id: 1, title: '教材A' }]);
    mockPrisma.textbooks.count.mockResolvedValue(1);

    const req = { params: {}, query: {}, body: {}, user: { id: 1 }, ip: '127.0.0.1' };
    const res = mockRes();
    const next = vi.fn();

    await listTextbooks(req, res, next);

    const responseCall = res.json.mock.calls[0][0];
    expect(responseCall.data.items[0].usageCount).toBe(0);
  });

  it('分页参数应生效（skip/take 来自 page/page_size，total 取自 count）', async () => {
    mockFindMany([{ id: 5, title: 'P2' }]);
    mockPrisma.textbooks.count.mockResolvedValue(42);

    const req = {
      params: {},
      query: { page: '2', page_size: '20' },
      body: {},
      user: { id: 1 },
      ip: '127.0.0.1',
    };
    const res = mockRes();
    const next = vi.fn();

    await listTextbooks(req, res, next);

    expect(mockPrisma.textbooks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 })
    );
    expect(res.json.mock.calls[0][0].data.total).toBe(42);
  });

  it('筛选参数应构建 where（title 模糊 / category / publisher 精确）', async () => {
    mockFindMany([]);
    mockPrisma.textbooks.count.mockResolvedValue(0);

    const req = {
      params: {},
      query: { title: '高数', category: '技工', publisher: '高教社' },
      body: {},
      user: { id: 1 },
      ip: '127.0.0.1',
    };
    const res = mockRes();
    const next = vi.fn();

    await listTextbooks(req, res, next);

    expect(mockPrisma.textbooks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { title: { contains: '高数' }, category: '技工', publisher: '高教社' },
      })
    );
  });

  it('排序参数应在白名单内才生效，否则回退默认 sort_order', async () => {
    mockFindMany([]);
    mockPrisma.textbooks.count.mockResolvedValue(0);

    const req1 = {
      params: {},
      query: { sort_by: 'title', sort_dir: 'desc' },
      body: {},
      user: { id: 1 },
      ip: '127.0.0.1',
    };
    const res1 = mockRes();
    await listTextbooks(req1, res1, vi.fn());
    expect(mockPrisma.textbooks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { title: 'desc' } })
    );

    const req2 = {
      params: {},
      query: { sort_by: 'evil', sort_dir: 'desc' },
      body: {},
      user: { id: 1 },
      ip: '127.0.0.1',
    };
    const res2 = mockRes();
    await listTextbooks(req2, res2, vi.fn());
    expect(mockPrisma.textbooks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { sort_order: 'asc' } })
    );
  });

  it('数据库错误应通过 next(e) 传递', async () => {
    const error = new Error('DB error');
    mockPrisma.textbooks.findMany.mockRejectedValue(error);

    const req = { params: {}, query: {}, body: {}, user: { id: 1 }, ip: '127.0.0.1' };
    const res = mockRes();
    const next = vi.fn();

    await listTextbooks(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ════════════════════════════════════════════════
// createTextbook 测试
// ════════════════════════════════════════════════
describe('createTextbook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.textbooks.findFirst.mockResolvedValue(null);
    mockPrisma.textbooks.create.mockResolvedValue({
      id: 1,
      title: '新教材',
      sort_order: 1,
    });
  });

  describe('基本创建', () => {
    it('有效数据应创建教材并返回 success', async () => {
      const req = mockReq({}, { title: '新教材', isbn: '978-0-123', price: '45.5' });
      const res = mockRes();
      const next = vi.fn();

      await createTextbook(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockPrisma.textbooks.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: '新教材',
          isbn: '978-0-123',
          price: 45.5,
          is_active: true,
          sort_order: 1,
        }),
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: '创建成功',
        })
      );
    });

    it('创建成功后应调用审计日志和 invalidateSortOrderCache', async () => {
      const req = mockReq({}, { title: '新教材' });
      const res = mockRes();
      const next = vi.fn();

      await createTextbook(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create',
          module: 'textbook',
          result: 'success',
        })
      );
      expect(invalidateSortOrderCache).toHaveBeenCalledWith('textbooks');
    });

    it('is_active 传入 false 应保留', async () => {
      const req = mockReq({}, { title: '新教材', is_active: false });
      const res = mockRes();
      const next = vi.fn();

      await createTextbook(req, res, next);

      const createData = mockPrisma.textbooks.create.mock.calls[0][0].data;
      expect(createData.is_active).toBe(false);
    });

    it('sort_order 传入时应使用传入值', async () => {
      const req = mockReq({}, { title: '新教材', sort_order: 10 });
      const res = mockRes();
      const next = vi.fn();

      await createTextbook(req, res, next);

      const createData = mockPrisma.textbooks.create.mock.calls[0][0].data;
      expect(createData.sort_order).toBe(10);
    });

    it('price 为空字符串时应为 null', async () => {
      const req = mockReq({}, { title: '新教材', price: '' });
      const res = mockRes();
      const next = vi.fn();

      await createTextbook(req, res, next);

      const createData = mockPrisma.textbooks.create.mock.calls[0][0].data;
      expect(createData.price).toBeNull();
    });

    it('publish_date 为空时应为 null', async () => {
      const req = mockReq({}, { title: '新教材', publish_date: '' });
      const res = mockRes();
      const next = vi.fn();

      await createTextbook(req, res, next);

      const createData = mockPrisma.textbooks.create.mock.calls[0][0].data;
      expect(createData.publish_date).toBeNull();
    });

    it('category 为空时应为 null', async () => {
      const req = mockReq({}, { title: '新教材', category: '' });
      const res = mockRes();
      const next = vi.fn();

      await createTextbook(req, res, next);

      const createData = mockPrisma.textbooks.create.mock.calls[0][0].data;
      expect(createData.category).toBeNull();
    });
  });

  describe('验证', () => {
    it('缺少 title 应返回 fail', async () => {
      const req = mockReq({}, { isbn: '978-0-123' });
      const res = mockRes();
      const next = vi.fn();

      await createTextbook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '书名不能为空',
        })
      );
      expect(mockPrisma.textbooks.create).not.toHaveBeenCalled();
    });

    it('title 为空字符串应返回 fail', async () => {
      const req = mockReq({}, { title: '' });
      const res = mockRes();
      const next = vi.fn();

      await createTextbook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '书名不能为空',
        })
      );
    });

    it('重复标题应返回 409 fail', async () => {
      mockPrisma.textbooks.findFirst.mockResolvedValue({ id: 99, title: '已存在' });
      const req = mockReq({}, { title: '已存在' });
      const res = mockRes();
      const next = vi.fn();

      await createTextbook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '该教材名称已存在',
        })
      );
      expect(mockPrisma.textbooks.create).not.toHaveBeenCalled();
    });
  });

  describe('错误处理', () => {
    it('P2002 错误应返回 409', async () => {
      const error = new Error('Unique constraint');
      error.code = 'P2002';
      mockPrisma.textbooks.create.mockRejectedValue(error);

      const req = mockReq({}, { title: '冲突教材' });
      const res = mockRes();
      const next = vi.fn();

      await createTextbook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '该书名的教材已存在',
        })
      );
    });

    it('非 P2002 错误应通过 next(e) 传递', async () => {
      const error = new Error('Unexpected');
      mockPrisma.textbooks.create.mockRejectedValue(error);

      const req = mockReq({}, { title: '测试' });
      const res = mockRes();
      const next = vi.fn();

      await createTextbook(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('创建失败时应记录失败审计日志', async () => {
      const error = new Error('DB error');
      mockPrisma.textbooks.create.mockRejectedValue(error);

      const req = mockReq({}, { title: '测试' });
      const res = mockRes();
      const next = vi.fn();

      await createTextbook(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create',
          module: 'textbook',
          result: 'failed',
        })
      );
    });
  });
});

// ════════════════════════════════════════════════
// updateTextbook 测试
// ════════════════════════════════════════════════
describe('updateTextbook', () => {
  const TEXTBOOK_ID = 42;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.textbooks.findFirst.mockResolvedValue(null);
    mockPrisma.textbooks.update.mockResolvedValue({
      id: TEXTBOOK_ID,
      title: '更新后标题',
    });
  });

  describe('基本更新', () => {
    it('有效数据应更新教材并返回 success', async () => {
      const req = mockReq({ id: TEXTBOOK_ID }, { title: '更新后标题' });
      const res = mockRes();
      const next = vi.fn();

      await updateTextbook(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockPrisma.textbooks.update).toHaveBeenCalledWith({
        where: { id: TEXTBOOK_ID },
        data: expect.objectContaining({ title: '更新后标题' }),
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: '更新成功',
        })
      );
    });

    it('更新成功后应调用审计日志和 invalidateSortOrderCache', async () => {
      const req = mockReq({ id: TEXTBOOK_ID }, { title: '新标题' });
      const res = mockRes();
      const next = vi.fn();

      await updateTextbook(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          module: 'textbook',
          result: 'success',
        })
      );
      expect(invalidateSortOrderCache).toHaveBeenCalledWith('textbooks');
    });

    it('price 传入应转为 Number', async () => {
      const req = mockReq({ id: TEXTBOOK_ID }, { price: '55.5' });
      const res = mockRes();
      const next = vi.fn();

      await updateTextbook(req, res, next);

      const updateData = mockPrisma.textbooks.update.mock.calls[0][0].data;
      expect(updateData.price).toBe(55.5);
    });

    it('price 为空字符串时应为 null', async () => {
      const req = mockReq({ id: TEXTBOOK_ID }, { price: '' });
      const res = mockRes();
      const next = vi.fn();

      await updateTextbook(req, res, next);

      const updateData = mockPrisma.textbooks.update.mock.calls[0][0].data;
      expect(updateData.price).toBeNull();
    });

    it('publish_date 为空字符串时应为 null', async () => {
      const req = mockReq({ id: TEXTBOOK_ID }, { publish_date: '' });
      const res = mockRes();
      const next = vi.fn();

      await updateTextbook(req, res, next);

      const updateData = mockPrisma.textbooks.update.mock.calls[0][0].data;
      expect(updateData.publish_date).toBeNull();
    });

    it('publish_date 传入有效值应保留', async () => {
      const req = mockReq({ id: TEXTBOOK_ID }, { publish_date: '2024-01-15' });
      const res = mockRes();
      const next = vi.fn();

      await updateTextbook(req, res, next);

      const updateData = mockPrisma.textbooks.update.mock.calls[0][0].data;
      expect(updateData.publish_date).toBe('2024-01-15');
    });
  });

  describe('重复标题检查', () => {
    it('更新 title 且重复应返回 409', async () => {
      mockPrisma.textbooks.findFirst.mockResolvedValue({ id: 99, title: '已存在' });
      const req = mockReq({ id: TEXTBOOK_ID }, { title: '已存在' });
      const res = mockRes();
      const next = vi.fn();

      await updateTextbook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '该教材名称已存在',
        })
      );
      expect(mockPrisma.textbooks.update).not.toHaveBeenCalled();
    });

    it('更新 title 不重复应正常更新', async () => {
      mockPrisma.textbooks.findFirst.mockResolvedValue(null);
      const req = mockReq({ id: TEXTBOOK_ID }, { title: '唯一标题' });
      const res = mockRes();
      const next = vi.fn();

      await updateTextbook(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockPrisma.textbooks.update).toHaveBeenCalled();
    });
  });

  describe('错误处理', () => {
    it('P2025 错误应返回 404', async () => {
      const error = new Error('Record not found');
      error.code = 'P2025';
      mockPrisma.textbooks.update.mockRejectedValue(error);

      const req = mockReq({ id: TEXTBOOK_ID }, { title: '测试' });
      const res = mockRes();
      const next = vi.fn();

      await updateTextbook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '教材不存在',
        })
      );
    });

    it('P2002 错误（内层 update）应返回 409', async () => {
      const error = new Error('Unique constraint');
      error.code = 'P2002';
      mockPrisma.textbooks.update.mockRejectedValue(error);

      const req = mockReq({ id: TEXTBOOK_ID }, { title: '测试' });
      const res = mockRes();
      const next = vi.fn();

      await updateTextbook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '该书名的教材已存在',
        })
      );
    });

    it('非 P2025/P2002 错误应通过 next(e) 传递', async () => {
      const error = new Error('Database connection failed');
      mockPrisma.textbooks.update.mockRejectedValue(error);

      const req = mockReq({ id: TEXTBOOK_ID }, { title: '测试' });
      const res = mockRes();
      const next = vi.fn();

      await updateTextbook(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('更新失败时应记录失败审计日志', async () => {
      const error = new Error('Unexpected error');
      mockPrisma.textbooks.update.mockRejectedValue(error);

      const req = mockReq({ id: TEXTBOOK_ID }, { title: '测试' });
      const res = mockRes();
      const next = vi.fn();

      await updateTextbook(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          module: 'textbook',
          result: 'failed',
        })
      );
    });
  });
});

// ════════════════════════════════════════════════
// deleteTextbook 测试
// ════════════════════════════════════════════════
describe('deleteTextbook', () => {
  const TEXTBOOK_ID = 42;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.plan_textbooks.count.mockResolvedValue(0);
    mockPrisma.textbooks.delete.mockResolvedValue({
      id: TEXTBOOK_ID,
      title: '被删教材',
    });
  });

  describe('正常删除', () => {
    it('未被引用应正常删除并返回 success', async () => {
      const req = mockReq({ id: TEXTBOOK_ID }, {});
      const res = mockRes();
      const next = vi.fn();

      await deleteTextbook(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockPrisma.plan_textbooks.count).toHaveBeenCalledWith({
        where: { textbook_id: TEXTBOOK_ID },
      });
      expect(mockPrisma.textbooks.delete).toHaveBeenCalledWith({
        where: { id: TEXTBOOK_ID },
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: '删除成功',
        })
      );
    });

    it('删除成功后应调用审计日志和 invalidateSortOrderCache', async () => {
      const req = mockReq({ id: TEXTBOOK_ID }, {});
      const res = mockRes();
      const next = vi.fn();

      await deleteTextbook(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'delete',
          module: 'textbook',
          result: 'success',
          details: expect.objectContaining({ id: TEXTBOOK_ID, name: '被删教材' }),
        })
      );
      expect(invalidateSortOrderCache).toHaveBeenCalledWith('textbooks');
    });
  });

  describe('引用检查', () => {
    it('被培养方案引用时应返回 fail', async () => {
      mockPrisma.plan_textbooks.count.mockResolvedValue(2);
      const req = mockReq({ id: TEXTBOOK_ID }, {});
      const res = mockRes();
      const next = vi.fn();

      await deleteTextbook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '该教材已被培养方案引用，无法删除',
        })
      );
      expect(mockPrisma.textbooks.delete).not.toHaveBeenCalled();
    });
  });

  describe('错误处理', () => {
    it('P2025 错误应返回 404', async () => {
      const error = new Error('Record not found');
      error.code = 'P2025';
      mockPrisma.textbooks.delete.mockRejectedValue(error);

      const req = mockReq({ id: TEXTBOOK_ID }, {});
      const res = mockRes();
      const next = vi.fn();

      await deleteTextbook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '教材不存在',
        })
      );
    });

    it('非 P2025 错误应通过 next(e) 传递', async () => {
      const error = new Error('Unexpected');
      mockPrisma.textbooks.delete.mockRejectedValue(error);

      const req = mockReq({ id: TEXTBOOK_ID }, {});
      const res = mockRes();
      const next = vi.fn();

      await deleteTextbook(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('删除失败时应记录失败审计日志', async () => {
      const error = new Error('DB error');
      mockPrisma.textbooks.delete.mockRejectedValue(error);

      const req = mockReq({ id: TEXTBOOK_ID }, {});
      const res = mockRes();
      const next = vi.fn();

      await deleteTextbook(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'delete',
          module: 'textbook',
          result: 'failed',
        })
      );
    });
  });
});

// ════════════════════════════════════════════════
// toggleTextbookStatus 测试
// ════════════════════════════════════════════════
describe('toggleTextbookStatus', () => {
  const TEXTBOOK_ID = 42;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.textbooks.findUnique.mockResolvedValue({
      is_active: true,
      title: '测试教材',
    });
    mockPrisma.textbooks.update.mockResolvedValue({
      id: TEXTBOOK_ID,
      is_active: false,
      title: '测试教材',
    });
  });

  describe('状态切换', () => {
    it('不传 is_active 应盲目 toggle（true → false）', async () => {
      const req = mockReq({ id: TEXTBOOK_ID }, {});
      const res = mockRes();
      const next = vi.fn();

      await toggleTextbookStatus(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockPrisma.textbooks.update).toHaveBeenCalledWith({
        where: { id: TEXTBOOK_ID },
        data: { is_active: false },
      });
    });

    it('传入 is_active=true 应使用指定值', async () => {
      mockPrisma.textbooks.findUnique.mockResolvedValue({
        is_active: false,
        title: '测试教材',
      });
      mockPrisma.textbooks.update.mockResolvedValue({
        id: TEXTBOOK_ID,
        is_active: true,
        title: '测试教材',
      });

      const req = mockReq({ id: TEXTBOOK_ID }, { is_active: true });
      const res = mockRes();
      const next = vi.fn();

      await toggleTextbookStatus(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockPrisma.textbooks.update).toHaveBeenCalledWith({
        where: { id: TEXTBOOK_ID },
        data: { is_active: true },
      });
    });

    it('传入 is_active=false 应设为 false', async () => {
      const req = mockReq({ id: TEXTBOOK_ID }, { is_active: false });
      const res = mockRes();
      const next = vi.fn();

      await toggleTextbookStatus(req, res, next);

      expect(mockPrisma.textbooks.update).toHaveBeenCalledWith({
        where: { id: TEXTBOOK_ID },
        data: { is_active: false },
      });
    });

    it('启用成功应返回"已启用"消息', async () => {
      mockPrisma.textbooks.findUnique.mockResolvedValue({
        is_active: false,
        title: '测试教材',
      });
      mockPrisma.textbooks.update.mockResolvedValue({
        id: TEXTBOOK_ID,
        is_active: true,
        title: '测试教材',
      });

      const req = mockReq({ id: TEXTBOOK_ID }, { is_active: true });
      const res = mockRes();
      const next = vi.fn();

      await toggleTextbookStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: '已启用',
        })
      );
    });

    it('停用成功应返回"已停用"消息', async () => {
      const req = mockReq({ id: TEXTBOOK_ID }, { is_active: false });
      const res = mockRes();
      const next = vi.fn();

      await toggleTextbookStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: '已停用',
        })
      );
    });

    it('成功后应调用审计日志和 invalidateSortOrderCache', async () => {
      const req = mockReq({ id: TEXTBOOK_ID }, {});
      const res = mockRes();
      const next = vi.fn();

      await toggleTextbookStatus(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          module: 'textbook',
          result: 'success',
        })
      );
      expect(invalidateSortOrderCache).toHaveBeenCalledWith('textbooks');
    });
  });

  describe('教材不存在', () => {
    it('findUnique 返回 null 应返回 404', async () => {
      mockPrisma.textbooks.findUnique.mockResolvedValue(null);

      const req = mockReq({ id: TEXTBOOK_ID }, {});
      const res = mockRes();
      const next = vi.fn();

      await toggleTextbookStatus(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '教材不存在',
        })
      );
      expect(mockPrisma.textbooks.update).not.toHaveBeenCalled();
    });
  });

  describe('错误处理', () => {
    it('P2025 错误应返回 404', async () => {
      const error = new Error('Record not found');
      error.code = 'P2025';
      mockPrisma.textbooks.update.mockRejectedValue(error);

      const req = mockReq({ id: TEXTBOOK_ID }, {});
      const res = mockRes();
      const next = vi.fn();

      await toggleTextbookStatus(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '教材不存在',
        })
      );
    });

    it('非 P2025 错误应通过 next(e) 传递', async () => {
      const error = new Error('Unexpected');
      mockPrisma.textbooks.update.mockRejectedValue(error);

      const req = mockReq({ id: TEXTBOOK_ID }, {});
      const res = mockRes();
      const next = vi.fn();

      await toggleTextbookStatus(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('更新失败时应记录失败审计日志', async () => {
      const error = new Error('DB error');
      mockPrisma.textbooks.update.mockRejectedValue(error);

      const req = mockReq({ id: TEXTBOOK_ID }, {});
      const res = mockRes();
      const next = vi.fn();

      await toggleTextbookStatus(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          module: 'textbook',
          result: 'failed',
        })
      );
    });
  });
});

// ════════════════════════════════════════════════
// batchUpdateTextbooks 测试
// ════════════════════════════════════════════════
describe('batchUpdateTextbooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.textbooks.findMany.mockResolvedValue([
      { id: 1, title: '教材A' },
      { id: 2, title: '教材B' },
    ]);
    mockTx.textbooks.update.mockResolvedValue({});
  });

  describe('正常批量更新', () => {
    it('有效 ids 和 updates 应批量更新并返回 success', async () => {
      const req = {
        body: { ids: [1, 2], updates: { category: '新类别' } },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateTextbooks(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            total: 2,
            succeeded: expect.arrayContaining([
              expect.objectContaining({ id: 1 }),
              expect.objectContaining({ id: 2 }),
            ]),
            failed: [],
          }),
        })
      );
    });

    it('成功后应调用审计日志和 invalidateSortOrderCache', async () => {
      const req = {
        body: { ids: [1], updates: { category: 'test' } },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateTextbooks(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'batch_update',
          module: 'textbook',
          result: 'success',
        })
      );
      expect(invalidateSortOrderCache).toHaveBeenCalledWith('textbooks');
    });

    it('只允许更新安全字段', async () => {
      const req = {
        body: {
          ids: [1],
          updates: { category: '新类别', title: '不应更新', id: 999 },
        },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateTextbooks(req, res, next);

      // title 和 id 不在安全字段列表中
      const txUpdateCall = mockTx.textbooks.update.mock.calls[0][0];
      expect(txUpdateCall.data).toEqual({ category: '新类别' });
      expect(txUpdateCall.data).not.toHaveProperty('title');
      expect(txUpdateCall.data).not.toHaveProperty('id');
    });

    it('sort_order 应转为 Number', async () => {
      const req = {
        body: { ids: [1], updates: { sort_order: '10' } },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateTextbooks(req, res, next);

      const txUpdateCall = mockTx.textbooks.update.mock.calls[0][0];
      expect(txUpdateCall.data.sort_order).toBe(10);
    });

    it('事务中单条失败应记录在 failed 中', async () => {
      const error = new Error('Not found');
      error.code = 'P2025';
      mockTx.textbooks.update.mockResolvedValueOnce({}).mockRejectedValueOnce(error);

      const req = {
        body: { ids: [1, 2], updates: { category: 'test' } },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateTextbooks(req, res, next);

      const responseCall = res.json.mock.calls[0][0];
      expect(responseCall.data.succeeded).toHaveLength(1);
      expect(responseCall.data.failed).toHaveLength(1);
      expect(responseCall.data.failed[0].reason).toBe('教材不存在');
    });
  });

  describe('验证', () => {
    it('ids 为空数组应返回 fail', async () => {
      const req = {
        body: { ids: [], updates: { category: 'test' } },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateTextbooks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'ids 不能为空',
        })
      );
    });

    it('ids 非数组应返回 fail', async () => {
      const req = {
        body: { ids: 'invalid', updates: { category: 'test' } },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateTextbooks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'ids 不能为空',
        })
      );
    });

    it('ids 超过 500 应返回 fail', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => i + 1);
      const req = {
        body: { ids, updates: { category: 'test' } },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateTextbooks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '单次批量更新最多 500 个教材',
        })
      );
    });

    it('updates 为空应返回 fail', async () => {
      const req = {
        body: { ids: [1], updates: null },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateTextbooks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'updates 不能为空',
        })
      );
    });

    it('updates 非对象应返回 fail', async () => {
      const req = {
        body: { ids: [1], updates: 'string' },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateTextbooks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('ids 全为无效值应返回 fail', async () => {
      const req = {
        body: { ids: [-1, 0, 'abc'], updates: { category: 'test' } },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateTextbooks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'ids 中没有有效的教材 ID',
        })
      );
    });

    it('updates 中无安全字段应返回 fail', async () => {
      const req = {
        body: { ids: [1], updates: { title: '不安全字段' } },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateTextbooks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '没有可更新的字段',
        })
      );
    });
  });

  describe('去重', () => {
    it('重复 id 应去重', async () => {
      mockPrisma.textbooks.findMany.mockResolvedValue([{ id: 1, title: '教材A' }]);

      const req = {
        body: { ids: [1, 1, 1], updates: { category: 'test' } },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateTextbooks(req, res, next);

      const responseCall = res.json.mock.calls[0][0];
      expect(responseCall.data.total).toBe(1);
    });
  });

  describe('错误处理', () => {
    it('数据库错误应通过 next(e) 传递', async () => {
      const error = new Error('DB error');
      mockPrisma.textbooks.findMany.mockRejectedValue(error);

      const req = {
        body: { ids: [1], updates: { category: 'test' } },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateTextbooks(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});

// ════════════════════════════════════════════════
// batchDeleteTextbooks 测试
// ════════════════════════════════════════════════
describe('batchDeleteTextbooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.textbooks.findMany.mockResolvedValue([
      { id: 1, title: '教材A' },
      { id: 2, title: '教材B' },
    ]);
    mockPrisma.plan_textbooks.groupBy.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockTx));
    mockTx.textbooks.deleteMany.mockResolvedValue({ count: 2 });
  });

  describe('正常批量删除', () => {
    it('有效 ids 应批量删除并返回 success', async () => {
      const req = {
        body: { ids: [1, 2] },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteTextbooks(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            total: 2,
            succeeded: expect.arrayContaining([
              expect.objectContaining({ id: 1, title: '教材A' }),
              expect.objectContaining({ id: 2, title: '教材B' }),
            ]),
            failed: [],
            deletedCount: 2,
          }),
        })
      );
    });

    it('成功后应调用审计日志', async () => {
      const req = {
        body: { ids: [1] },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteTextbooks(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'batch_delete',
          module: 'textbook',
        })
      );
    });

    it('成功后应调用 invalidateSortOrderCache', async () => {
      const req = {
        body: { ids: [1] },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteTextbooks(req, res, next);

      expect(invalidateSortOrderCache).toHaveBeenCalledWith('textbooks');
    });
  });

  describe('引用检查', () => {
    it('被引用的教材应跳过删除', async () => {
      mockPrisma.plan_textbooks.groupBy.mockResolvedValue([{ textbook_id: 1, _count: 3 }]);

      const req = {
        body: { ids: [1, 2] },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteTextbooks(req, res, next);

      const responseCall = res.json.mock.calls[0][0];
      // 教材1 被引用应失败
      expect(responseCall.data.failed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            title: '教材A',
            reason: expect.stringContaining('3 个培养方案引用'),
          }),
        ])
      );
      // 教材2 应成功
      expect(responseCall.data.succeeded).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 2, title: '教材B' })])
      );
    });

    it('全部被引用时不应调用事务', async () => {
      mockPrisma.plan_textbooks.groupBy.mockResolvedValue([
        { textbook_id: 1, _count: 1 },
        { textbook_id: 2, _count: 2 },
      ]);

      const req = {
        body: { ids: [1, 2] },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteTextbooks(req, res, next);

      // deletableIds 为空，不应调用 $transaction
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('不存在的教材', () => {
    it('不存在的教材 id 应在 failed 中标记', async () => {
      mockPrisma.textbooks.findMany.mockResolvedValue([{ id: 1, title: '教材A' }]);

      const req = {
        body: { ids: [1, 999] },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteTextbooks(req, res, next);

      const responseCall = res.json.mock.calls[0][0];
      expect(responseCall.data.failed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 999,
            title: 'ID:999',
            reason: '教材不存在',
          }),
        ])
      );
    });
  });

  describe('验证', () => {
    it('ids 为空数组应返回 fail', async () => {
      const req = {
        body: { ids: [] },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteTextbooks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'ids 不能为空',
        })
      );
    });

    it('ids 非数组应返回 fail', async () => {
      const req = {
        body: { ids: 'invalid' },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteTextbooks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('ids 超过 500 应返回 fail', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => i + 1);
      const req = {
        body: { ids },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteTextbooks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '单次批量删除最多 500 个教材',
        })
      );
    });

    it('ids 全为无效值应返回 fail', async () => {
      const req = {
        body: { ids: [-1, 0, 'abc'] },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteTextbooks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'ids 中没有有效的教材 ID',
        })
      );
    });
  });

  describe('去重', () => {
    it('重复 id 应去重', async () => {
      mockPrisma.textbooks.findMany.mockResolvedValue([{ id: 1, title: '教材A' }]);
      mockTx.textbooks.deleteMany.mockResolvedValue({ count: 1 });

      const req = {
        body: { ids: [1, 1, 1] },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteTextbooks(req, res, next);

      const responseCall = res.json.mock.calls[0][0];
      expect(responseCall.data.total).toBe(1);
    });
  });

  describe('错误处理', () => {
    it('数据库错误应通过 next(e) 传递', async () => {
      const error = new Error('DB error');
      mockPrisma.textbooks.findMany.mockRejectedValue(error);

      const req = {
        body: { ids: [1] },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteTextbooks(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
