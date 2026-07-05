/**
 * plan.controller.js — listPlans / createPlan / updatePlan 单元测试
 *
 * listPlans: 班级计数逻辑
 * - classCount: 通过 findBestMatchPlan 每个班级只计入最佳匹配方案
 * - customLinkedClassCount: 仅 custom_plan_id 直接引用的班级数
 * - matchedClassCount: 通过 isClassMatchPlan 任意匹配的班级数
 * - 三种计数正确区分
 *
 * createPlan:
 * - 仅 major_id → 成功
 * - 仅 training_level_id → 成功
 * - 同时传 major_id + training_level_id → 错误
 * - 缺 name → 验证错误
 * - 成功时写审计日志
 *
 * updatePlan:
 * - 正常更新 → 成功
 * - sort_order-only 更新 → 绕过完整验证
 * - 不存在的方案 → 404
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  training_plans: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
    aggregate: vi.fn(),
  },
  classes: {
    findMany: vi.fn(),
  },
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

vi.mock('../../../utils/sort.js', () => ({
  autoFixSortOrder: vi.fn().mockResolvedValue(undefined),
  invalidateSortOrderCache: vi.fn(),
}));

const mockFindBestMatchPlan = vi.fn();
const mockIsClassMatchPlan = vi.fn();
vi.mock('../../../services/plan.service.js', () => ({
  findBestMatchPlan: (...args) => mockFindBestMatchPlan(...args),
  isClassMatchPlan: (...args) => mockIsClassMatchPlan(...args),
}));

vi.mock('../../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { listPlans, createPlan, updatePlan } = await import('../plan.controller.js');
const { createAuditLog } = await import('../../../services/audit.service.js');
const { invalidateSortOrderCache } = await import('../../../utils/sort.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(body = {}, params = {}, query = {}) {
  return { body, params, query, user: { id: 1 }, ip: '127.0.0.1' };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

// ════════════════════════════════════════════════
// listPlans
// ════════════════════════════════════════════════
describe('listPlans — 班级计数逻辑', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有 custom_plan_id 的班级 → customLinkedClassCount 增加', async () => {
    const planA = {
      id: 1,
      name: '方案A',
      major_id: 1,
      training_level_id: null,
      college_id: 1,
      majors: { id: 1, name: '学前教育' },
      colleges: { id: 1, name: '教育学院' },
      training_levels: null,
      plan_courses: [{ id: 1 }, { id: 2 }],
    };

    mockPrisma.training_plans.findMany.mockResolvedValue([planA]);
    mockPrisma.classes.findMany.mockResolvedValue([
      { id: 10, major_id: 1, training_level_id: null, custom_plan_id: 1 },
    ]);
    // findBestMatchPlan → planA (for classCount)
    mockFindBestMatchPlan.mockReturnValue(planA);
    // isClassMatchPlan → true for planA
    mockIsClassMatchPlan.mockReturnValue(true);

    const req = mockReq({}, {}, {});
    const res = mockRes();
    await listPlans(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data[0].customLinkedClassCount).toBe(1);
    expect(data[0].courseCount).toBe(2);
  });

  it('按专业匹配的班级 → classCount 通过 findBestMatchPlan 增加', async () => {
    const planA = {
      id: 1,
      name: '方案A',
      major_id: 1,
      training_level_id: null,
      college_id: 1,
      majors: { id: 1, name: '学前教育' },
      colleges: { id: 1, name: '教育学院' },
      training_levels: null,
      plan_courses: [],
    };

    mockPrisma.training_plans.findMany.mockResolvedValue([planA]);
    // Class without custom_plan_id, but major matches
    mockPrisma.classes.findMany.mockResolvedValue([
      { id: 10, major_id: 1, training_level_id: null, custom_plan_id: null },
    ]);
    mockFindBestMatchPlan.mockReturnValue(planA);
    mockIsClassMatchPlan.mockReturnValue(true);

    const req = mockReq({}, {}, {});
    const res = mockRes();
    await listPlans(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data[0].classCount).toBe(1);
    expect(data[0].customLinkedClassCount).toBe(0);
  });

  it('matchedClassCount 通过 isClassMatchPlan 计算（任意匹配）', async () => {
    const planA = {
      id: 1,
      name: '方案A',
      major_id: 1,
      training_level_id: null,
      college_id: 1,
      majors: { id: 1, name: '学前教育' },
      colleges: null,
      training_levels: null,
      plan_courses: [],
    };
    const planB = {
      id: 2,
      name: '方案B',
      major_id: null,
      training_level_id: 2,
      college_id: 1,
      majors: null,
      colleges: null,
      training_levels: { id: 2, name: '本科' },
      plan_courses: [],
    };

    mockPrisma.training_plans.findMany.mockResolvedValue([planA, planB]);
    mockPrisma.classes.findMany.mockResolvedValue([
      { id: 10, major_id: 1, training_level_id: 2, custom_plan_id: null },
    ]);
    // findBestMatchPlan → planA (major priority)
    mockFindBestMatchPlan.mockReturnValue(planA);
    // isClassMatchPlan → both plans match (major for A, level for B)
    mockIsClassMatchPlan.mockImplementation((cls, plan) => {
      if (plan.id === 1 && cls.major_id === plan.major_id) return true;
      if (plan.id === 2 && cls.training_level_id === plan.training_level_id) return true;
      return false;
    });

    const req = mockReq({}, {}, {});
    const res = mockRes();
    await listPlans(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    // classCount: best match only → planA gets 1, planB gets 0
    expect(data.find((p) => p.id === 1).classCount).toBe(1);
    expect(data.find((p) => p.id === 2).classCount).toBe(0);
    // matchedClassCount: any match → both get 1
    expect(data.find((p) => p.id === 1).matchedClassCount).toBe(1);
    expect(data.find((p) => p.id === 2).matchedClassCount).toBe(1);
  });

  it('三种计数正确区分：custom + major-best + any-match', async () => {
    const planA = {
      id: 1,
      name: '方案A',
      major_id: 1,
      training_level_id: null,
      college_id: 1,
      majors: null,
      colleges: null,
      training_levels: null,
      plan_courses: [],
    };

    mockPrisma.training_plans.findMany.mockResolvedValue([planA]);
    mockPrisma.classes.findMany.mockResolvedValue([
      // Class with custom_plan_id pointing to planA
      { id: 10, major_id: 1, training_level_id: null, custom_plan_id: 1 },
      // Class matching by major (no custom)
      { id: 11, major_id: 1, training_level_id: null, custom_plan_id: null },
      // Class not matching at all
      { id: 12, major_id: 99, training_level_id: null, custom_plan_id: null },
    ]);
    mockFindBestMatchPlan.mockImplementation((cls) => {
      if (cls.id === 10 || cls.id === 11) return planA;
      return null;
    });
    mockIsClassMatchPlan.mockImplementation((cls, plan) => {
      return cls.major_id === plan.major_id || cls.custom_plan_id === plan.id;
    });

    const req = mockReq({}, {}, {});
    const res = mockRes();
    await listPlans(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    const p = data[0];
    expect(p.customLinkedClassCount).toBe(1); // only class 10
    expect(p.classCount).toBe(2); // classes 10 and 11 via findBestMatchPlan
    expect(p.matchedClassCount).toBe(2); // classes 10 and 11 via isClassMatchPlan
  });

  it('college_id 筛选应传入 where 条件', async () => {
    mockPrisma.training_plans.findMany.mockResolvedValue([]);
    mockPrisma.classes.findMany.mockResolvedValue([]);

    const req = mockReq({}, {}, { college_id: '5' });
    const res = mockRes();
    await listPlans(req, res, vi.fn());

    const call = mockPrisma.training_plans.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ college_id: 5 });
  });
});

// ════════════════════════════════════════════════
// createPlan
// ════════════════════════════════════════════════
describe('createPlan — 创建培养方案', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.training_plans.aggregate.mockResolvedValue({ _max: { sort_order: 5 } });
  });

  it('仅传 major_id（无 training_level_id）→ 成功创建', async () => {
    const newPlan = {
      id: 10,
      name: '新方案',
      major_id: 1,
      training_level_id: null,
      college_id: null,
      sort_order: 6,
      majors: { id: 1, name: '学前教育' },
      colleges: null,
      training_levels: null,
    };
    mockPrisma.training_plans.create.mockResolvedValue(newPlan);

    const req = mockReq({ name: '新方案', major_id: 1 });
    const res = mockRes();
    await createPlan(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '创建成功' })
    );
    const createCall = mockPrisma.training_plans.create.mock.calls[0][0];
    expect(createCall.data.major_id).toBe(1);
    expect(createCall.data.training_level_id).toBeNull();
    expect(createCall.data.sort_order).toBe(6);
  });

  it('仅传 training_level_id（无 major_id）→ 成功创建', async () => {
    const newPlan = {
      id: 11,
      name: '层次方案',
      major_id: null,
      training_level_id: 2,
      college_id: null,
      sort_order: 6,
      majors: null,
      colleges: null,
      training_levels: { id: 2, name: '本科' },
    };
    mockPrisma.training_plans.create.mockResolvedValue(newPlan);

    const req = mockReq({ name: '层次方案', training_level_id: 2 });
    const res = mockRes();
    await createPlan(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '创建成功' })
    );
    const createCall = mockPrisma.training_plans.create.mock.calls[0][0];
    expect(createCall.data.training_level_id).toBe(2);
    expect(createCall.data.major_id).toBeNull();
  });

  it('同时传 major_id 和 training_level_id → 返回验证错误', async () => {
    const req = mockReq({ name: '冲突方案', major_id: 1, training_level_id: 2 });
    const res = mockRes();
    const next = vi.fn();
    await createPlan(req, res, next);

    // ValidationError has statusCode 422
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '专业类别和培养层次只能选择一项',
      })
    );
    expect(mockPrisma.training_plans.create).not.toHaveBeenCalled();
  });

  it('缺 name → 返回验证错误', async () => {
    const req = mockReq({ major_id: 1 });
    const res = mockRes();
    const next = vi.fn();
    await createPlan(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '方案名称为必填项',
      })
    );
    expect(mockPrisma.training_plans.create).not.toHaveBeenCalled();
  });

  it('成功创建后应写审计日志', async () => {
    const newPlan = {
      id: 12,
      name: '审计方案',
      major_id: 1,
      training_level_id: null,
      college_id: null,
      sort_order: 6,
      version: null,
      majors: { id: 1, name: '学前教育' },
      colleges: { name: '教育学院' },
      training_levels: null,
    };
    mockPrisma.training_plans.create.mockResolvedValue(newPlan);

    const req = mockReq({ name: '审计方案', major_id: 1 });
    const res = mockRes();
    await createPlan(req, res, vi.fn());

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'trainingPlan',
        action: 'create',
        result: 'success',
      })
    );
    expect(invalidateSortOrderCache).toHaveBeenCalledWith('training_plans');
  });
});

// ════════════════════════════════════════════════
// updatePlan
// ════════════════════════════════════════════════
describe('updatePlan — 更新培养方案', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常更新方案字段 → 成功', async () => {
    const oldPlan = { id: 1, college_id: 1, colleges: { name: '旧学院' } };
    const updatedPlan = {
      id: 1,
      name: '更新后方案',
      major_id: 1,
      training_level_id: null,
      college_id: 2,
      colleges: { name: '新学院' },
      majors: { id: 1, name: '学前教育' },
      training_levels: null,
    };

    mockPrisma.training_plans.findUnique.mockResolvedValue(oldPlan);
    mockPrisma.training_plans.update.mockResolvedValue(updatedPlan);

    const req = mockReq(
      { name: '更新后方案', major_id: 1, college_id: 2 },
      { id: '1' }
    );
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '更新成功' })
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        module: 'trainingPlan',
        result: 'success',
      })
    );
  });

  it('sort_order-only 更新 → 绕过完整验证直接更新', async () => {
    const updatedPlan = {
      id: 1,
      name: '原方案',
      sort_order: 3,
      major_id: 1,
      training_level_id: null,
      colleges: null,
      majors: null,
      training_levels: null,
    };
    mockPrisma.training_plans.update.mockResolvedValue(updatedPlan);

    const req = mockReq({ sort_order: 3 }, { id: '1' });
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '更新成功' })
    );
    // Should not call findUnique (bypasses full validation path)
    expect(mockPrisma.training_plans.findUnique).not.toHaveBeenCalled();
    expect(invalidateSortOrderCache).toHaveBeenCalledWith('training_plans');
  });

  it('不存在的方案（P2025）→ sort_order 路径返回 404', async () => {
    const err = new Error('Not found');
    err.code = 'P2025';
    mockPrisma.training_plans.update.mockRejectedValue(err);

    const req = mockReq({ sort_order: 3 }, { id: '999' });
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '培养方案不存在',
    });
  });

  it('不存在的方案（P2025）→ 正常更新路径返回 404', async () => {
    const err = new Error('Not found');
    err.code = 'P2025';
    mockPrisma.training_plans.findUnique.mockResolvedValue({ id: 1, college_id: 1, colleges: {} });
    mockPrisma.training_plans.update.mockRejectedValue(err);

    const req = mockReq(
      { name: 'test', major_id: 1 },
      { id: '999' }
    );
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '方案不存在',
    });
  });
});
