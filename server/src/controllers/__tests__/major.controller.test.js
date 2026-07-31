/**
 * major.controller.js 单元测试
 *
 * 覆盖：listMajors, createMajor, updateMajor, deleteMajor
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  majors: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  classes: {
    count: vi.fn().mockResolvedValue(0),
  },
  training_plans: {
    count: vi.fn().mockResolvedValue(0),
  },
};
// TOCTOU 修复后删除走交互式事务，mock 直接把自身作为 tx 客户端传入回调
mockPrisma.$transaction = vi.fn(async (fn) => fn(mockPrisma));

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
        updateData[field] = field === 'sort_order' ? Number(data[field]) : data[field];
      }
    }
    return updateData;
  }),
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { listMajors, createMajor, updateMajor, deleteMajor } =
  await import('../major.controller.js');
const { createAuditLog } = await import('../../services/audit.service.js');
const { invalidateSortOrderCache } = await import('../../utils/sort.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(body = {}, params = {}) {
  return {
    params,
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
// listMajors
// ════════════════════════════════════════════════
describe('listMajors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应返回格式化后的专业列表，包含 classCount 和 planCount', async () => {
    mockPrisma.majors.findMany.mockResolvedValue([
      {
        id: 1,
        name: '学前教育',
        code: 'PRE',
        _count: { classes: 10, training_plans: 3 },
      },
    ]);

    const res = mockRes();
    await listMajors({}, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            name: '学前教育',
            classCount: 10,
            planCount: 3,
          }),
        ]),
      })
    );
  });

  it('无专业时应返回空数组', async () => {
    mockPrisma.majors.findMany.mockResolvedValue([]);

    const res = mockRes();
    await listMajors({}, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: [] }));
  });

  it('_count 缺失时 counts 应默认为 0', async () => {
    mockPrisma.majors.findMany.mockResolvedValue([{ id: 1, name: '空专业', _count: {} }]);

    const res = mockRes();
    await listMajors({}, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data[0].classCount).toBe(0);
    expect(data[0].planCount).toBe(0);
  });

  it('数据库异常应通过 next(e) 传递', async () => {
    const error = new Error('DB error');
    mockPrisma.majors.findMany.mockRejectedValue(error);

    const res = mockRes();
    const next = vi.fn();
    await listMajors({}, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ════════════════════════════════════════════════
// createMajor
// ════════════════════════════════════════════════
describe('createMajor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.majors.create.mockResolvedValue({ id: 1, name: '新专业', code: 'NEW' });
  });

  it('正常创建应返回 success 并调用审计日志', async () => {
    const req = mockReq({ name: '新专业', code: 'NEW' });
    const res = mockRes();
    const next = vi.fn();

    await createMajor(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.majors.create).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '创建成功' })
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', module: 'major', result: 'success' })
    );
  });

  it('创建后应调用 invalidateSortOrderCache', async () => {
    const req = mockReq({ name: '新专业' });
    const res = mockRes();
    const next = vi.fn();

    await createMajor(req, res, next);

    expect(invalidateSortOrderCache).toHaveBeenCalledWith('majors');
  });

  it('不传 name 应返回 fail', async () => {
    const req = mockReq({ code: 'NO_NAME' });
    const res = mockRes();
    const next = vi.fn();

    await createMajor(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '专业名称不能为空' })
    );
  });

  it('sort_order 传入时应使用传入值', async () => {
    const req = mockReq({ name: '排序专业', sort_order: 50 });
    const res = mockRes();
    const next = vi.fn();

    await createMajor(req, res, next);

    const createArg = mockPrisma.majors.create.mock.calls[0][0];
    expect(createArg.data.sort_order).toBe(50);
  });

  it('sort_order 未传入时应使用 getNextSortOrder 返回值', async () => {
    const req = mockReq({ name: '自动排序专业' });
    const res = mockRes();
    const next = vi.fn();

    await createMajor(req, res, next);

    const createArg = mockPrisma.majors.create.mock.calls[0][0];
    expect(createArg.data.sort_order).toBe(1);
  });

  it('其他错误应通过 next(e) 传递', async () => {
    const error = new Error('Unexpected');
    mockPrisma.majors.create.mockRejectedValue(error);

    const req = mockReq({ name: '异常专业' });
    const res = mockRes();
    const next = vi.fn();

    await createMajor(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('创建失败应记录失败审计日志', async () => {
    const error = new Error('Fail');
    mockPrisma.majors.create.mockRejectedValue(error);

    const req = mockReq({ name: '失败专业' });
    const res = mockRes();
    const next = vi.fn();

    await createMajor(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        module: 'major',
        result: 'failed',
      })
    );
  });
});

// ════════════════════════════════════════════════
// updateMajor
// ════════════════════════════════════════════════
describe('updateMajor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.majors.update.mockResolvedValue({ id: 1, name: '更新后' });
  });

  it('正常更新应返回 success', async () => {
    const req = mockReq({ name: '更新后' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateMajor(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '更新成功' })
    );
  });

  it('更新后应调用 invalidateSortOrderCache 和审计日志', async () => {
    const req = mockReq({ name: '更新后' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateMajor(req, res, next);

    expect(invalidateSortOrderCache).toHaveBeenCalledWith('majors');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', module: 'major', result: 'success' })
    );
  });

  it('P2025（专业不存在）应返回 404 fail', async () => {
    const error = new Error('Not found');
    error.code = 'P2025';
    mockPrisma.majors.update.mockRejectedValue(error);

    const req = mockReq({ name: '不存在' }, { id: '999' });
    const res = mockRes();
    const next = vi.fn();

    await updateMajor(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '专业不存在' })
    );
  });

  it('其他错误应通过 next(e) 传递', async () => {
    const error = new Error('Unexpected');
    mockPrisma.majors.update.mockRejectedValue(error);

    const req = mockReq({ name: '异常' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateMajor(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ════════════════════════════════════════════════
// deleteMajor
// ════════════════════════════════════════════════
describe('deleteMajor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.classes.count.mockResolvedValue(0);
    mockPrisma.training_plans.count.mockResolvedValue(0);
    mockPrisma.majors.delete.mockResolvedValue({ id: 1, name: '已删专业' });
  });

  it('无关联时删除成功', async () => {
    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteMajor(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '删除成功' })
    );
    expect(invalidateSortOrderCache).toHaveBeenCalledWith('majors');
  });

  it('存在班级时应阻止删除', async () => {
    mockPrisma.classes.count.mockResolvedValue(5);

    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteMajor(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('班级'),
      })
    );
  });

  it('存在培养方案时应阻止删除', async () => {
    mockPrisma.training_plans.count.mockResolvedValue(2);

    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteMajor(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('培养方案'),
      })
    );
  });

  it('P2025（专业不存在）应返回 404', async () => {
    const error = new Error('Not found');
    error.code = 'P2025';
    mockPrisma.majors.delete.mockRejectedValue(error);

    const req = mockReq({}, { id: '999' });
    const res = mockRes();
    const next = vi.fn();

    await deleteMajor(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '专业不存在' })
    );
  });

  it('其他删除错误应通过 next(e) 传递', async () => {
    const error = new Error('Unexpected');
    mockPrisma.majors.delete.mockRejectedValue(error);

    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteMajor(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('删除成功应记录审计日志', async () => {
    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteMajor(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        module: 'major',
        result: 'success',
      })
    );
  });
});
