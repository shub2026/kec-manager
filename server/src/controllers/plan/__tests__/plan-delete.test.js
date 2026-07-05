/**
 * plan.controller.js — deletePlan 单元测试
 *
 * 覆盖场景：
 * 1. 删除无关联班级的方案 → 成功
 * 2. 删除有关联班级的方案 → 解除关联后删除
 * 3. 验证 unlinkedCount 报告
 * 4. 验证级联删除统计（plan_courses, plan_course_semesters, plan_textbooks）
 * 5. 删除不存在的方案 → 404
 * 6. 审计日志记录正确信息
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockTx = {
  classes: {
    updateMany: vi.fn(),
  },
  training_plans: {
    delete: vi.fn(),
  },
};

const mockPrisma = {
  training_plans: {
    findUnique: vi.fn(),
  },
  plan_courses: {
    count: vi.fn(),
  },
  plan_course_semesters: {
    count: vi.fn(),
  },
  plan_textbooks: {
    count: vi.fn(),
  },
  $transaction: vi.fn(async (fn) => fn(mockTx)),
};

vi.mock('../../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖服务
// ──────────────────────────────────────────────
vi.mock('../../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../utils/sort.js', () => ({
  autoFixSortOrder: vi.fn(),
  invalidateSortOrderCache: vi.fn(),
}));

vi.mock('../../../services/plan.service.js', () => ({
  findBestMatchPlan: vi.fn(),
  isClassMatchPlan: vi.fn(),
}));

// ──────────────────────────────────────────────
// 导入被测模块（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const { deletePlan } = await import('../plan.controller.js');
const { createAuditLog } = await import('../../../services/audit.service.js');
const { invalidateSortOrderCache } = await import('../../../utils/sort.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(id) {
  return { params: { id: String(id) }, user: { id: 1 }, ip: '127.0.0.1' };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

// ──────────────────────────────────────────────
// 公共 mock 数据
// ──────────────────────────────────────────────
const EXISTING_PLAN = {
  id: 1,
  name: '2024级学前教育方案',
  major_id: 1,
  training_level_id: null,
};

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('deletePlan — 删除培养方案', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 默认：方案存在
    mockPrisma.training_plans.findUnique.mockResolvedValue({ ...EXISTING_PLAN });

    // 默认：无级联子记录
    mockPrisma.plan_courses.count.mockResolvedValue(0);
    mockPrisma.plan_course_semesters.count.mockResolvedValue(0);
    mockPrisma.plan_textbooks.count.mockResolvedValue(0);

    // 默认：事务中无关联班级
    mockTx.classes.updateMany.mockResolvedValue({ count: 0 });
    mockTx.training_plans.delete.mockResolvedValue({ id: 1 });

    // 重建 $transaction 实现（clearAllMocks 会清除）
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockTx));
  });

  // ──────────────────────────────────────────────
  // 1. 删除无关联班级的方案 → 成功
  // ──────────────────────────────────────────────
  it('无关联班级的方案应成功删除', async () => {
    const req = mockReq(1);
    const res = mockRes();
    const next = vi.fn();

    await deletePlan(req, res, next);

    expect(next).not.toHaveBeenCalled();

    // 事务内应调用 updateMany（解除关联）和 delete（删除方案）
    expect(mockTx.classes.updateMany).toHaveBeenCalledWith({
      where: { custom_plan_id: 1 },
      data: { custom_plan_id: null },
    });
    expect(mockTx.training_plans.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });

    // 返回成功响应
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: '删除成功',
      })
    );

    // 清除排序缓存
    expect(invalidateSortOrderCache).toHaveBeenCalledWith('training_plans');
  });

  // ──────────────────────────────────────────────
  // 2. 删除有关联班级的方案 → 解除关联后删除
  // ──────────────────────────────────────────────
  it('有关联班级的方案应先解除关联再删除', async () => {
    mockTx.classes.updateMany.mockResolvedValue({ count: 3 });

    const req = mockReq(1);
    const res = mockRes();
    const next = vi.fn();

    await deletePlan(req, res, next);

    expect(next).not.toHaveBeenCalled();

    // 解除关联
    expect(mockTx.classes.updateMany).toHaveBeenCalledWith({
      where: { custom_plan_id: 1 },
      data: { custom_plan_id: null },
    });

    // 删除方案
    expect(mockTx.training_plans.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  // ──────────────────────────────────────────────
  // 3. 验证 unlinkedCount 报告
  // ──────────────────────────────────────────────
  it('审计日志中应包含正确的 unlinkedCount', async () => {
    mockTx.classes.updateMany.mockResolvedValue({ count: 5 });

    const req = mockReq(1);
    const res = mockRes();
    const next = vi.fn();

    await deletePlan(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'trainingPlan',
        action: 'delete',
        result: 'success',
        details: expect.objectContaining({
          plan_id: 1,
          plan_name: '2024级学前教育方案',
          unlinked_count: 5,
        }),
        message: expect.stringContaining('解除 5 个班级关联'),
      })
    );
  });

  // ──────────────────────────────────────────────
  // 4. 验证级联删除统计
  // ──────────────────────────────────────────────
  it('审计日志中应包含级联删除的子记录数量', async () => {
    mockPrisma.plan_courses.count.mockResolvedValue(8);
    mockPrisma.plan_course_semesters.count.mockResolvedValue(24);
    mockPrisma.plan_textbooks.count.mockResolvedValue(12);

    const req = mockReq(1);
    const res = mockRes();
    const next = vi.fn();

    await deletePlan(req, res, next);

    expect(next).not.toHaveBeenCalled();

    // 级联统计查询应被调用
    expect(mockPrisma.plan_courses.count).toHaveBeenCalledWith({
      where: { plan_id: 1 },
    });
    expect(mockPrisma.plan_course_semesters.count).toHaveBeenCalledWith({
      where: { plan_courses: { plan_id: 1 } },
    });
    expect(mockPrisma.plan_textbooks.count).toHaveBeenCalledWith({
      where: { plan_course_semesters: { plan_courses: { plan_id: 1 } } },
    });

    // 审计日志中包含级联统计
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          cascaded_plan_courses: 8,
          cascaded_plan_course_semesters: 24,
          cascaded_plan_textbooks: 12,
        }),
      })
    );
  });

  // ──────────────────────────────────────────────
  // 5. 删除不存在的方案 → 404
  // ──────────────────────────────────────────────
  it('方案不存在应返回 404', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue(null);

    const req = mockReq(999);
    const res = mockRes();
    const next = vi.fn();

    await deletePlan(req, res, next);

    // next 应被调用并传入 NotFoundError
    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error.message).toBe('培养方案不存在');
    expect(error.statusCode).toBe(404);

    // 事务不应被调用
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // 6. 审计日志记录正确信息
  // ──────────────────────────────────────────────
  it('无关联班级时审计日志消息不应包含"解除"字样', async () => {
    mockTx.classes.updateMany.mockResolvedValue({ count: 0 });

    const req = mockReq(1);
    const res = mockRes();
    const next = vi.fn();

    await deletePlan(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '删除培养方案：2024级学前教育方案',
      })
    );
  });

  it('删除失败时应记录失败审计日志', async () => {
    // 让事务抛出错误
    mockPrisma.$transaction.mockImplementation(async () => {
      throw new Error('数据库连接失败');
    });

    const req = mockReq(1);
    const res = mockRes();
    const next = vi.fn();

    await deletePlan(req, res, next);

    // 应调用失败审计日志
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'trainingPlan',
        action: 'delete',
        result: 'failed',
        details: expect.objectContaining({
          error: '数据库连接失败',
        }),
      })
    );

    // next 应被调用传递错误
    expect(next).toHaveBeenCalled();
  });
});
