/**
 * trainingLevel.controller.js 单元测试
 *
 * 覆盖：listTrainingLevels, createTrainingLevel, updateTrainingLevel, deleteTrainingLevel
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  training_levels: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  classes: {
    count: vi.fn().mockResolvedValue(0),
  },
  teacher_training_levels: {
    count: vi.fn().mockResolvedValue(0),
  },
  training_plans: {
    count: vi.fn().mockResolvedValue(0),
  },
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
        updateData[field] = field === 'sort_order' ? Number(data[field]) : data[field];
      }
    }
    return updateData;
  }),
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { listTrainingLevels, createTrainingLevel, updateTrainingLevel, deleteTrainingLevel } =
  await import('../trainingLevel.controller.js');
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
// listTrainingLevels
// ════════════════════════════════════════════════
describe('listTrainingLevels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应返回格式化后的层次列表，包含 classCount/planCount/schedulingCount', async () => {
    mockPrisma.training_levels.findMany.mockResolvedValue([
      {
        id: 1,
        name: '本科',
        code: 'UG',
        _count: { classes: 20, training_plans: 5, scheduling_teachers: 8 },
      },
    ]);

    const res = mockRes();
    await listTrainingLevels({}, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            name: '本科',
            classCount: 20,
            planCount: 5,
            schedulingCount: 8,
          }),
        ]),
      })
    );
  });

  it('无层次时应返回空数组', async () => {
    mockPrisma.training_levels.findMany.mockResolvedValue([]);

    const res = mockRes();
    await listTrainingLevels({}, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: [] }));
  });

  it('_count 缺失时 counts 应默认为 0', async () => {
    mockPrisma.training_levels.findMany.mockResolvedValue([{ id: 1, name: '空层次', _count: {} }]);

    const res = mockRes();
    await listTrainingLevels({}, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data[0].classCount).toBe(0);
    expect(data[0].planCount).toBe(0);
    expect(data[0].schedulingCount).toBe(0);
  });

  it('数据库异常应通过 next(e) 传递', async () => {
    const error = new Error('DB error');
    mockPrisma.training_levels.findMany.mockRejectedValue(error);

    const res = mockRes();
    const next = vi.fn();
    await listTrainingLevels({}, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ════════════════════════════════════════════════
// createTrainingLevel
// ════════════════════════════════════════════════
describe('createTrainingLevel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.training_levels.create.mockResolvedValue({ id: 1, name: '新层次' });
  });

  it('正常创建应返回 success 并调用审计日志', async () => {
    const req = mockReq({ name: '新层次', code: 'NEW' });
    const res = mockRes();
    const next = vi.fn();

    await createTrainingLevel(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.training_levels.create).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '创建成功' })
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', module: 'training_level', result: 'success' })
    );
  });

  it('创建后应调用 invalidateSortOrderCache', async () => {
    const req = mockReq({ name: '新层次' });
    const res = mockRes();
    const next = vi.fn();

    await createTrainingLevel(req, res, next);

    expect(invalidateSortOrderCache).toHaveBeenCalledWith('training_levels');
  });

  it('不传 name 应返回 fail', async () => {
    const req = mockReq({ code: 'NO_NAME' });
    const res = mockRes();
    const next = vi.fn();

    await createTrainingLevel(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '层次名称不能为空' })
    );
  });

  it('sort_order 传入时应使用传入值', async () => {
    const req = mockReq({ name: '排序层次', sort_order: 77 });
    const res = mockRes();
    const next = vi.fn();

    await createTrainingLevel(req, res, next);

    const createArg = mockPrisma.training_levels.create.mock.calls[0][0];
    expect(createArg.data.sort_order).toBe(77);
  });

  it('sort_order 未传入时应使用 getNextSortOrder 返回值', async () => {
    const req = mockReq({ name: '自动排序层次' });
    const res = mockRes();
    const next = vi.fn();

    await createTrainingLevel(req, res, next);

    const createArg = mockPrisma.training_levels.create.mock.calls[0][0];
    expect(createArg.data.sort_order).toBe(1);
  });

  it('P2002（名称重复）应返回 fail 并记录审计', async () => {
    const error = new Error('Unique constraint');
    error.code = 'P2002';
    mockPrisma.training_levels.create.mockRejectedValue(error);

    const req = mockReq({ name: '重复层次' });
    const res = mockRes();
    const next = vi.fn();

    await createTrainingLevel(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '该层次名称已存在' })
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        module: 'training_level',
        result: 'failed',
        details: { name: '重复层次' },
      })
    );
  });

  it('其他错误应通过 next(e) 传递并记录审计', async () => {
    const error = new Error('Unexpected');
    mockPrisma.training_levels.create.mockRejectedValue(error);

    const req = mockReq({ name: '异常层次' });
    const res = mockRes();
    const next = vi.fn();

    await createTrainingLevel(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        module: 'training_level',
        result: 'failed',
        details: { name: '异常层次' },
      })
    );
  });

  it('创建失败时审计日志应正确记录 req.body.name', async () => {
    const error = new Error('Fail');
    mockPrisma.training_levels.create.mockRejectedValue(error);

    const req = mockReq({ name: '失败层次' });
    const res = mockRes();
    const next = vi.fn();

    await createTrainingLevel(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { name: '失败层次' },
        result: 'failed',
      })
    );
  });
});

// ════════════════════════════════════════════════
// updateTrainingLevel
// ════════════════════════════════════════════════
describe('updateTrainingLevel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.training_levels.update.mockResolvedValue({ id: 1, name: '更新后' });
  });

  it('正常更新应返回 success', async () => {
    const req = mockReq({ name: '更新后' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateTrainingLevel(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '更新成功' })
    );
  });

  it('更新后应调用 invalidateSortOrderCache 和审计日志', async () => {
    const req = mockReq({ name: '更新后' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateTrainingLevel(req, res, next);

    expect(invalidateSortOrderCache).toHaveBeenCalledWith('training_levels');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', module: 'training_level', result: 'success' })
    );
  });

  it('P2025（层次不存在）应返回 404 fail', async () => {
    const error = new Error('Not found');
    error.code = 'P2025';
    mockPrisma.training_levels.update.mockRejectedValue(error);

    const req = mockReq({ name: '不存在' }, { id: '999' });
    const res = mockRes();
    const next = vi.fn();

    await updateTrainingLevel(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '层次不存在' })
    );
  });

  it('P2002（名称重复）应返回 fail', async () => {
    const error = new Error('Unique');
    error.code = 'P2002';
    mockPrisma.training_levels.update.mockRejectedValue(error);

    const req = mockReq({ name: '重复' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateTrainingLevel(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '该层次名称已存在' })
    );
  });

  it('其他错误应通过 next(e) 传递', async () => {
    const error = new Error('Unexpected');
    mockPrisma.training_levels.update.mockRejectedValue(error);

    const req = mockReq({ name: '异常' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateTrainingLevel(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ════════════════════════════════════════════════
// deleteTrainingLevel
// ════════════════════════════════════════════════
describe('deleteTrainingLevel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.classes.count.mockResolvedValue(0);
    mockPrisma.teacher_training_levels.count.mockResolvedValue(0);
    mockPrisma.training_plans.count.mockResolvedValue(0);
    mockPrisma.training_levels.delete.mockResolvedValue({ id: 1, name: '已删层次' });
  });

  it('无关联时删除成功', async () => {
    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteTrainingLevel(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '删除成功' })
    );
    expect(invalidateSortOrderCache).toHaveBeenCalledWith('training_levels');
  });

  it('存在班级时应阻止删除', async () => {
    mockPrisma.classes.count.mockResolvedValue(3);

    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteTrainingLevel(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('班级'),
      })
    );
  });

  it('存在排课偏好/培养方案时应阻止删除', async () => {
    mockPrisma.teacher_training_levels.count.mockResolvedValue(2);
    mockPrisma.training_plans.count.mockResolvedValue(1);

    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteTrainingLevel(req, res, next);

    const msg = res.json.mock.calls[0][0].message;
    expect(msg).toContain('排课偏好');
    expect(msg).toContain('培养方案');
  });

  it('P2025（层次不存在）应返回 404', async () => {
    const error = new Error('Not found');
    error.code = 'P2025';
    mockPrisma.training_levels.delete.mockRejectedValue(error);

    const req = mockReq({}, { id: '999' });
    const res = mockRes();
    const next = vi.fn();

    await deleteTrainingLevel(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '层次不存在' })
    );
  });

  it('其他删除错误应通过 next(e) 传递', async () => {
    const error = new Error('Unexpected');
    mockPrisma.training_levels.delete.mockRejectedValue(error);

    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteTrainingLevel(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('删除成功应记录审计日志', async () => {
    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteTrainingLevel(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        module: 'training_level',
        result: 'success',
      })
    );
  });
});
