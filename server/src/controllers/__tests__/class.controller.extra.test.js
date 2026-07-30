/**
 * class.controller.js — batchDeleteClasses, batchUpdateClasses 单元测试
 *
 * 补充覆盖现有测试文件未涉及的导出函数。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockTx = {
  classes: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn(),
  },
};

const mockPrisma = {
  classes: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
  },
  teaching_assignments: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
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
vi.mock('../../services/settings.service.js', () => ({
  getCurrentSemesterInfo: vi.fn(),
  getSemesterStartMonth: vi.fn().mockResolvedValue(8),
}));

vi.mock('../../services/class.service.js', () => ({
  getActiveClassFilter: vi.fn(),
  invalidateDurationCache: vi.fn(),
}));

vi.mock('../../services/class-filter.service.js', () => ({
  buildClassFilter: vi.fn(),
}));

vi.mock('../../services/plan.service.js', () => ({
  findBestMatchPlan: vi.fn(),
  isClassMatchPlan: vi.fn(),
}));

vi.mock('../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../services/class-combination.service.js', () => ({
  applyCombination: vi.fn(),
  buildCombinationMemberMap: vi.fn().mockResolvedValue(new Map()),
  formatPartnerNames: vi.fn().mockReturnValue(''),
  getPartnersOfClass: vi.fn().mockResolvedValue([]),
  dissolveAfterClassDeletion: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { batchDeleteClasses, batchUpdateClasses } = await import('../class.controller.js');
const { getActiveClassFilter, invalidateDurationCache } =
  await import('../../services/class.service.js');
const { createAuditLog } = await import('../../services/audit.service.js');
const { dissolveAfterClassDeletion } = await import('../../services/class-combination.service.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(bodyOrQuery, params = {}) {
  return {
    params,
    body: bodyOrQuery,
    query: bodyOrQuery,
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
// batchDeleteClasses
// ════════════════════════════════════════════════
describe('batchDeleteClasses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.classes.findMany.mockResolvedValue([]);
    mockPrisma.teaching_assignments.groupBy.mockResolvedValue([]);
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([]);
    mockTx.classes.deleteMany.mockResolvedValue({ count: 0 });
  });

  // ── 输入校验 ──
  describe('输入校验', () => {
    it('ids 为空数组应返回 fail', async () => {
      const req = mockReq({ ids: [] });
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteClasses(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: 'ids 不能为空' })
      );
    });

    it('ids 不是数组应返回 fail', async () => {
      const req = mockReq({ ids: 'not-array' });
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteClasses(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('ids 超过 500 应返回 fail', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => i + 1);
      const req = mockReq({ ids });
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteClasses(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining('500'),
        })
      );
    });

    it('ids 中没有有效 ID 应返回 fail', async () => {
      const req = mockReq({ ids: [-1, 0, 'abc', 1.5] });
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteClasses(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'ids 中没有有效的班级 ID',
        })
      );
    });
  });

  // ── 正常批量删除 ──
  describe('正常批量删除', () => {
    it('所有班级可删除时应全部删除成功', async () => {
      mockPrisma.classes.findMany
        .mockResolvedValueOnce([
          { id: 1, name: '班级A' },
          { id: 2, name: '班级B' },
        ])
        .mockResolvedValueOnce([]); // combination query

      mockPrisma.teaching_assignments.groupBy.mockResolvedValue([]);
      mockTx.classes.deleteMany.mockResolvedValue({ count: 2 });

      const req = mockReq({ ids: [1, 2] });
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteClasses(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            total: 2,
            deletedCount: 2,
            succeeded: [
              { id: 1, name: '班级A' },
              { id: 2, name: '班级B' },
            ],
            failed: [],
          }),
        })
      );
    });

    it('删除成功后应调用 invalidateDurationCache', async () => {
      mockPrisma.classes.findMany
        .mockResolvedValueOnce([{ id: 1, name: '班级A' }])
        .mockResolvedValueOnce([]);
      mockTx.classes.deleteMany.mockResolvedValue({ count: 1 });

      const req = mockReq({ ids: [1] });
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteClasses(req, res, next);

      expect(invalidateDurationCache).toHaveBeenCalled();
    });

    it('删除成功后应记录审计日志', async () => {
      mockPrisma.classes.findMany
        .mockResolvedValueOnce([{ id: 1, name: '班级A' }])
        .mockResolvedValueOnce([]);
      mockTx.classes.deleteMany.mockResolvedValue({ count: 1 });

      const req = mockReq({ ids: [1] });
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteClasses(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'batch_delete',
          module: 'class',
          result: 'success',
        })
      );
    });
  });

  // ── 有排课记录阻止删除 ──
  describe('有排课记录阻止删除', () => {
    it('有排课记录的班级应放入 failed 列表', async () => {
      mockPrisma.classes.findMany.mockResolvedValueOnce([
        { id: 1, name: '班级A' },
        { id: 2, name: '班级B' },
      ]);
      mockPrisma.teaching_assignments.groupBy.mockResolvedValue([{ class_id: 1, _count: 3 }]);
      mockPrisma.teaching_assignments.findMany.mockResolvedValue([
        { class_id: 1, semester: '2025-2026-1' },
      ]);
      // Only class 2 is deletable
      mockPrisma.classes.findMany.mockResolvedValueOnce([]); // combination query
      mockTx.classes.deleteMany.mockResolvedValue({ count: 1 });

      const req = mockReq({ ids: [1, 2] });
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteClasses(req, res, next);

      expect(next).not.toHaveBeenCalled();
      const data = res.json.mock.calls[0][0].data;
      expect(data.succeeded).toEqual([{ id: 2, name: '班级B' }]);
      expect(data.failed).toHaveLength(1);
      expect(data.failed[0].id).toBe(1);
      expect(data.failed[0].reason).toContain('排课记录');
    });
  });

  // ── 班级不存在 ──
  describe('班级不存在', () => {
    it('不存在的 ID 应放入 failed 列表', async () => {
      mockPrisma.classes.findMany.mockResolvedValueOnce([{ id: 1, name: '班级A' }]);
      mockPrisma.teaching_assignments.groupBy.mockResolvedValue([]);
      mockPrisma.classes.findMany.mockResolvedValueOnce([]); // combination query
      mockTx.classes.deleteMany.mockResolvedValue({ count: 1 });

      const req = mockReq({ ids: [1, 999] });
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteClasses(req, res, next);

      const data = res.json.mock.calls[0][0].data;
      expect(data.failed).toContainEqual({
        id: 999,
        name: 'ID:999',
        reason: '班级不存在',
      });
    });
  });

  // ── 合班组合清理 ──
  describe('合班组合清理', () => {
    it('删除合班班级后应调用 dissolveAfterClassDeletion', async () => {
      mockPrisma.classes.findMany.mockResolvedValueOnce([{ id: 1, name: '合班A' }]);
      mockPrisma.teaching_assignments.groupBy.mockResolvedValue([]);
      // combination query returns a combination_id
      mockPrisma.classes.findMany.mockResolvedValueOnce([{ combination_id: 42 }]);
      mockTx.classes.deleteMany.mockResolvedValue({ count: 1 });
      dissolveAfterClassDeletion.mockResolvedValue(null);

      const req = mockReq({ ids: [1] });
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteClasses(req, res, next);

      expect(dissolveAfterClassDeletion).toHaveBeenCalledWith(mockTx, 42);
    });
  });

  // ── ids 去重 ──
  describe('ids 去重', () => {
    it('重复 ids 应去重处理', async () => {
      mockPrisma.classes.findMany.mockResolvedValueOnce([{ id: 1, name: '班级A' }]);
      mockPrisma.teaching_assignments.groupBy.mockResolvedValue([]);
      mockPrisma.classes.findMany.mockResolvedValueOnce([]); // combination query
      mockTx.classes.deleteMany.mockResolvedValue({ count: 1 });

      const req = mockReq({ ids: [1, 1, 1] });
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteClasses(req, res, next);

      const data = res.json.mock.calls[0][0].data;
      expect(data.total).toBe(1);
    });
  });

  // ── 异常处理 ──
  describe('异常处理', () => {
    it('数据库异常应通过 next(e) 传递', async () => {
      const error = new Error('DB error');
      mockPrisma.classes.findMany.mockRejectedValue(error);

      const req = mockReq({ ids: [1] });
      const res = mockRes();
      const next = vi.fn();

      await batchDeleteClasses(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});

// ════════════════════════════════════════════════
// batchUpdateClasses
// ════════════════════════════════════════════════
describe('batchUpdateClasses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.classes.findMany.mockResolvedValue([]);
    mockTx.classes.update.mockResolvedValue({});
  });

  // ── 输入校验 ──
  describe('输入校验', () => {
    it('ids 为空数组应返回 fail', async () => {
      const req = mockReq({ ids: [], updates: { major_id: 1 } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: 'ids 不能为空' })
      );
    });

    it('ids 不是数组应返回 fail', async () => {
      const req = mockReq({ ids: 'bad', updates: { major_id: 1 } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('ids 超过 500 应返回 fail', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => i + 1);
      const req = mockReq({ ids, updates: { major_id: 1 } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining('500'),
        })
      );
    });

    it('updates 为空应返回 fail', async () => {
      const req = mockReq({ ids: [1, 2], updates: null });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: 'updates 不能为空' })
      );
    });

    it('updates 不是对象应返回 fail', async () => {
      const req = mockReq({ ids: [1], updates: 'string' });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: 'updates 不能为空' })
      );
    });

    it('ids 中没有有效 ID 应返回 fail', async () => {
      const req = mockReq({ ids: [-1, 0], updates: { major_id: 1 } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'ids 中没有有效的班级 ID',
        })
      );
    });

    it('没有可更新的安全字段应返回 fail', async () => {
      const req = mockReq({ ids: [1], updates: { name: 'unsafe' } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '没有可更新的字段',
        })
      );
    });
  });

  // ── 安全字段过滤 ──
  describe('安全字段过滤', () => {
    it('只允许更新安全字段（major_id, college_id 等）', async () => {
      mockPrisma.classes.findMany.mockResolvedValue([{ id: 1, name: '班级A' }]);
      mockTx.classes.update.mockResolvedValue({});

      const req = mockReq({
        ids: [1],
        updates: {
          major_id: 5,
          name: 'hacked', // 不安全字段，应被忽略
        },
      });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      expect(next).not.toHaveBeenCalled();
      const updateCall = mockTx.classes.update.mock.calls[0][0];
      expect(updateCall.data).toHaveProperty('major_id', 5);
      expect(updateCall.data).not.toHaveProperty('name');
    });
  });

  // ── 正常批量更新 ──
  describe('正常批量更新', () => {
    it('多个班级应全部更新成功', async () => {
      mockPrisma.classes.findMany.mockResolvedValue([
        { id: 1, name: '班级A' },
        { id: 2, name: '班级B' },
      ]);
      mockTx.classes.update.mockResolvedValue({});

      const req = mockReq({ ids: [1, 2], updates: { major_id: 3 } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockTx.classes.update).toHaveBeenCalledTimes(2);
      const data = res.json.mock.calls[0][0].data;
      expect(data.succeeded).toHaveLength(2);
      expect(data.failed).toHaveLength(0);
    });

    it('更新成功后应记录审计日志', async () => {
      mockPrisma.classes.findMany.mockResolvedValue([{ id: 1, name: '班级A' }]);
      mockTx.classes.update.mockResolvedValue({});

      const req = mockReq({ ids: [1], updates: { college_id: 2 } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'batch_update',
          module: 'class',
          result: 'success',
        })
      );
    });
  });

  // ── 数值字段转换 ──
  describe('数值字段转换', () => {
    it('major_id 应转换为 Number，null 值保留为 null', async () => {
      mockPrisma.classes.findMany.mockResolvedValue([{ id: 1, name: '班级A' }]);
      mockTx.classes.update.mockResolvedValue({});

      const req = mockReq({ ids: [1], updates: { major_id: '5' } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      const updateCall = mockTx.classes.update.mock.calls[0][0];
      expect(updateCall.data.major_id).toBe(5);
    });

    it('major_id=0 → null（falsy 值处理）', async () => {
      mockPrisma.classes.findMany.mockResolvedValue([{ id: 1, name: '班级A' }]);
      mockTx.classes.update.mockResolvedValue({});

      const req = mockReq({ ids: [1], updates: { major_id: 0 } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      const updateCall = mockTx.classes.update.mock.calls[0][0];
      expect(updateCall.data.major_id).toBeNull();
    });

    it('is_left_school 应转为布尔值', async () => {
      mockPrisma.classes.findMany.mockResolvedValue([{ id: 1, name: '班级A' }]);
      mockTx.classes.update.mockResolvedValue({});

      const req = mockReq({ ids: [1], updates: { is_left_school: 1 } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      const updateCall = mockTx.classes.update.mock.calls[0][0];
      expect(updateCall.data.is_left_school).toBe(true);
    });

    it('enrollment_year 应转为 Number', async () => {
      mockPrisma.classes.findMany.mockResolvedValue([{ id: 1, name: '班级A' }]);
      mockTx.classes.update.mockResolvedValue({});

      const req = mockReq({ ids: [1], updates: { enrollment_year: '2024' } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      const updateCall = mockTx.classes.update.mock.calls[0][0];
      expect(updateCall.data.enrollment_year).toBe(2024);
    });

    it('duration_years 更新后应调用 invalidateDurationCache', async () => {
      mockPrisma.classes.findMany.mockResolvedValue([{ id: 1, name: '班级A' }]);
      mockTx.classes.update.mockResolvedValue({});

      const req = mockReq({ ids: [1], updates: { duration_years: 4 } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      expect(invalidateDurationCache).toHaveBeenCalled();
    });
  });

  // ── 事务内更新失败 ──
  describe('事务内更新失败', () => {
    it('P2025 错误应将对应班级放入 failed 列表', async () => {
      mockPrisma.classes.findMany.mockResolvedValue([
        { id: 1, name: '班级A' },
        { id: 999, name: '不存在' },
      ]);

      const p2025Error = new Error('Record not found');
      p2025Error.code = 'P2025';

      mockTx.classes.update.mockResolvedValueOnce({}).mockRejectedValueOnce(p2025Error);

      const req = mockReq({ ids: [1, 999], updates: { major_id: 5 } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      const data = res.json.mock.calls[0][0].data;
      expect(data.succeeded).toHaveLength(1);
      expect(data.failed).toHaveLength(1);
      expect(data.failed[0].id).toBe(999);
      expect(data.failed[0].reason).toBe('班级不存在');
    });

    it('非 P2025 错误应将对应班级放入 failed 列表并包含错误信息', async () => {
      mockPrisma.classes.findMany.mockResolvedValue([{ id: 1, name: '班级A' }]);
      mockTx.classes.update.mockRejectedValue(new Error('Unexpected'));

      const req = mockReq({ ids: [1], updates: { major_id: 5 } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      const data = res.json.mock.calls[0][0].data;
      expect(data.failed).toHaveLength(1);
      expect(data.failed[0].reason).toBe('Unexpected');
    });
  });

  // ── ids 去重 ──
  describe('ids 去重', () => {
    it('重复 ids 应去重处理', async () => {
      mockPrisma.classes.findMany.mockResolvedValue([{ id: 1, name: '班级A' }]);
      mockTx.classes.update.mockResolvedValue({});

      const req = mockReq({ ids: [1, 1, 1], updates: { major_id: 2 } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      expect(mockTx.classes.update).toHaveBeenCalledTimes(1);
      const data = res.json.mock.calls[0][0].data;
      expect(data.total).toBe(1);
    });
  });

  // ── 异常处理 ──
  describe('异常处理', () => {
    it('数据库异常应通过 next(e) 传递', async () => {
      const error = new Error('DB error');
      mockPrisma.classes.findMany.mockRejectedValue(error);

      const req = mockReq({ ids: [1], updates: { major_id: 2 } });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateClasses(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
