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
 * - college_id 字符串→Number() 转换
 * - college_id 为 null → 传 null
 * - status 默认 draft / 显式传值 / 非法值拒绝（白名单兜底）
 * - 完整字段（college_id+version+description+status）全部传入 Prisma
 * - major_id 和 training_level_id 都不传 → 验证错误
 * - Prisma create 抛错 → 记录失败审计日志
 *
 * updatePlan:
 * - 正常更新 → 成功
 * - sort_order-only 更新 → 绕过完整验证
 * - 不存在的方案 → 404
 * - college_id 字符串→Number() 转换 / null 传递
 * - status 未传时不包含在 updateData / 显式传值时包含 / 非法值拒绝（白名单兜底）
 * - 完整字段更新所有字段正确传入
 * - college_id 变更→审计日志 collegeChange / 未变更→不含
 * - Prisma update 非 P2025 错误 → 失败审计日志
 * - sort_order 路径调用 invalidateSortOrderCache
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
  // 与真实实现同构的常量（归档排除条件）
  NOT_ARCHIVED_PLAN_WHERE: { status: { not: 'archived' } },
}));

vi.mock('../../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { listPlans, createPlan, updatePlan, createPlanNewVersion, incrementVersion } =
  await import('../plan.controller.js');
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
  it('college_id 字符串 → Number() 转换后传入 Prisma', async () => {
    mockPrisma.training_plans.create.mockResolvedValue({
      id: 20,
      name: '带学院方案',
      college_id: 5,
      major_id: 1,
      training_level_id: null,
      status: 'draft',
      sort_order: 6,
      majors: { id: 1, name: '学前' },
      colleges: { id: 5, name: '教育学院' },
      training_levels: null,
    });

    const req = mockReq({ name: '带学院方案', major_id: '1', college_id: '5' });
    const res = mockRes();
    await createPlan(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const createCall = mockPrisma.training_plans.create.mock.calls[0][0];
    expect(createCall.data.college_id).toBe(5);
    expect(createCall.data.major_id).toBe(1);
  });

  it('college_id 为 null/空 → 传 null 给 Prisma', async () => {
    mockPrisma.training_plans.create.mockResolvedValue({
      id: 21,
      name: '无学院方案',
      college_id: null,
      major_id: 1,
      training_level_id: null,
      status: 'draft',
      sort_order: 6,
      majors: null,
      colleges: null,
      training_levels: null,
    });

    const req = mockReq({ name: '无学院方案', major_id: 1, college_id: null });
    const res = mockRes();
    await createPlan(req, res, vi.fn());

    const createCall = mockPrisma.training_plans.create.mock.calls[0][0];
    expect(createCall.data.college_id).toBeNull();
  });

  it('status 未传 → 默认 draft', async () => {
    mockPrisma.training_plans.create.mockResolvedValue({
      id: 22,
      name: '默认状态',
      major_id: 1,
      training_level_id: null,
      college_id: null,
      status: 'draft',
      sort_order: 6,
      majors: null,
      colleges: null,
      training_levels: null,
    });

    const req = mockReq({ name: '默认状态', major_id: 1 });
    const res = mockRes();
    await createPlan(req, res, vi.fn());

    const createCall = mockPrisma.training_plans.create.mock.calls[0][0];
    expect(createCall.data.status).toBe('draft');
  });

  it('status 显式传 active → 覆盖默认值', async () => {
    mockPrisma.training_plans.create.mockResolvedValue({
      id: 23,
      name: '激活方案',
      major_id: 1,
      training_level_id: null,
      college_id: null,
      status: 'active',
      sort_order: 6,
      majors: null,
      colleges: null,
      training_levels: null,
    });

    const req = mockReq({ name: '激活方案', major_id: 1, status: 'active' });
    const res = mockRes();
    await createPlan(req, res, vi.fn());

    const createCall = mockPrisma.training_plans.create.mock.calls[0][0];
    expect(createCall.data.status).toBe('active');
  });

  it('status 非法值（如大小写错误的 Archived）→ 拒绝且不落库', async () => {
    const req = mockReq({ name: '非法状态方案', major_id: 1, status: 'Archived' });
    const res = mockRes();
    const next = vi.fn();
    await createPlan(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '方案状态必须是 draft、active 或 archived',
      })
    );
    expect(mockPrisma.training_plans.create).not.toHaveBeenCalled();
  });

  it('完整字段（college_id + version + description + status）全部传入 Prisma', async () => {
    mockPrisma.training_plans.create.mockResolvedValue({
      id: 24,
      name: '完整方案',
      college_id: 3,
      major_id: null,
      training_level_id: 2,
      version: 'v2.0',
      description: '测试描述',
      status: 'draft',
      sort_order: 6,
      majors: null,
      colleges: { id: 3, name: '理学院' },
      training_levels: { id: 2, name: '本科' },
    });

    const req = mockReq({
      name: '完整方案',
      college_id: 3,
      training_level_id: 2,
      version: 'v2.0',
      description: '测试描述',
    });
    const res = mockRes();
    await createPlan(req, res, vi.fn());

    const data = mockPrisma.training_plans.create.mock.calls[0][0].data;
    expect(data).toEqual({
      name: '完整方案',
      college_id: 3,
      major_id: null,
      training_level_id: 2,
      version: 'v2.0',
      description: '测试描述',
      apply_from_year: null,
      apply_to_year: null,
      status: 'draft',
      sort_order: 6,
    });
    // include 应包含三个关联
    const include = mockPrisma.training_plans.create.mock.calls[0][0].include;
    expect(include).toEqual({ majors: true, colleges: true, training_levels: true });
  });

  it('major_id 和 training_level_id 都不传 → 返回验证错误', async () => {
    const req = mockReq({ name: '缺分类方案' });
    const res = mockRes();
    const next = vi.fn();
    await createPlan(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '请选择专业类别或培养层次',
      })
    );
    expect(mockPrisma.training_plans.create).not.toHaveBeenCalled();
  });

  it('Prisma create 抛错 → 记录失败审计日志并 next(e)', async () => {
    const dbError = new Error('Unknown argument `college_id`');
    mockPrisma.training_plans.create.mockRejectedValue(dbError);

    const req = mockReq({ name: '出错方案', major_id: 1 });
    const res = mockRes();
    const next = vi.fn();
    await createPlan(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'trainingPlan',
        action: 'create',
        result: 'failed',
        details: expect.objectContaining({
          error: 'Unknown argument `college_id`',
        }),
      })
    );
    expect(next).toHaveBeenCalledWith(dbError);
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

    const req = mockReq({ name: '更新后方案', major_id: 1, college_id: 2 }, { id: '1' });
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

  it('status-only 更新 → 绕过完整验证直接更新并写审计日志', async () => {
    const updatedPlan = {
      id: 1,
      name: '原方案',
      status: 'active',
      major_id: 1,
      training_level_id: null,
      colleges: null,
      majors: null,
      training_levels: null,
    };
    mockPrisma.training_plans.update.mockResolvedValue(updatedPlan);

    const req = mockReq({ status: 'active' }, { id: '1' });
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '更新成功' })
    );
    // 仅更新数据为 status，不触碰其他字段
    expect(mockPrisma.training_plans.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'active' } })
    );
    // 绕过完整验证路径（不调用 findUnique）
    expect(mockPrisma.training_plans.findUnique).not.toHaveBeenCalled();
    // 记录审计日志
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        module: 'trainingPlan',
        result: 'success',
        details: expect.objectContaining({ status: 'active', type: 'status' }),
      })
    );
  });

  it('status-only 快捷分支传非法值 → 拒绝且不触发 prisma.update', async () => {
    const req = mockReq({ status: 'invalid_status' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();
    await updatePlan(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '方案状态必须是 draft、active 或 archived',
      })
    );
    expect(mockPrisma.training_plans.update).not.toHaveBeenCalled();
    expect(mockPrisma.training_plans.findUnique).not.toHaveBeenCalled();
  });

  it('不存在的方案（P2025）→ status-only 路径返回 404', async () => {
    const err = new Error('Not found');
    err.code = 'P2025';
    mockPrisma.training_plans.update.mockRejectedValue(err);

    const req = mockReq({ status: 'archived' }, { id: '999' });
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '培养方案不存在',
    });
  });

  it('status 与 name 同时传 → 走完整更新路径（status 并入 updateData）', async () => {
    const oldPlan = { id: 1, college_id: 1, colleges: { name: '旧学院' } };
    mockPrisma.training_plans.findUnique.mockResolvedValue(oldPlan);
    mockPrisma.training_plans.update.mockResolvedValue({ id: 1, name: '改名方案', status: 'active' });

    const req = mockReq({ name: '改名方案', major_id: 1, status: 'active' }, { id: '1' });
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '更新成功' })
    );
    const call = mockPrisma.training_plans.update.mock.calls[0][0];
    expect(call.data.status).toBe('active');
    expect(call.data.name).toBe('改名方案');
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

    const req = mockReq({ name: 'test', major_id: 1 }, { id: '999' });
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '方案不存在',
    });
  });

  it('college_id 字符串 → Number() 转换后传入 Prisma update', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue({
      id: 1,
      college_id: 1,
      colleges: { name: '旧学院' },
    });
    mockPrisma.training_plans.update.mockResolvedValue({
      id: 1,
      name: '更新',
      college_id: 7,
      major_id: 1,
      training_level_id: null,
      colleges: { name: '新学院' },
      majors: { id: 1, name: '学前' },
      training_levels: null,
    });

    const req = mockReq({ name: '更新', major_id: '1', college_id: '7' }, { id: '1' });
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    const updateCall = mockPrisma.training_plans.update.mock.calls[0][0];
    expect(updateCall.data.college_id).toBe(7);
  });

  it('college_id 为 null → 传 null 给 Prisma update', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue({
      id: 1,
      college_id: 1,
      colleges: { name: '旧学院' },
    });
    mockPrisma.training_plans.update.mockResolvedValue({
      id: 1,
      name: '更新',
      college_id: null,
      major_id: 1,
      training_level_id: null,
      colleges: null,
      majors: null,
      training_levels: null,
    });

    const req = mockReq({ name: '更新', major_id: 1, college_id: null }, { id: '1' });
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    const updateCall = mockPrisma.training_plans.update.mock.calls[0][0];
    expect(updateCall.data.college_id).toBeNull();
  });

  it('status 未传 → 不包含在 updateData 中', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue({
      id: 1,
      college_id: null,
      colleges: null,
    });
    mockPrisma.training_plans.update.mockResolvedValue({
      id: 1,
      name: '更新',
      college_id: null,
      major_id: 1,
      training_level_id: null,
      status: 'draft',
      colleges: null,
      majors: null,
      training_levels: null,
    });

    const req = mockReq({ name: '更新', major_id: 1 }, { id: '1' });
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    const updateCall = mockPrisma.training_plans.update.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('status');
  });

  it('status 显式传 archived → 包含在 updateData 中', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue({
      id: 1,
      college_id: null,
      colleges: null,
    });
    mockPrisma.training_plans.update.mockResolvedValue({
      id: 1,
      name: '更新',
      college_id: null,
      major_id: 1,
      training_level_id: null,
      status: 'archived',
      colleges: null,
      majors: null,
      training_levels: null,
    });

    const req = mockReq({ name: '更新', major_id: 1, status: 'archived' }, { id: '1' });
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    const updateCall = mockPrisma.training_plans.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe('archived');
  });

  it('完整字段更新：所有字段正确传入 Prisma update data', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue({
      id: 1,
      college_id: 1,
      colleges: { name: '旧学院' },
    });
    mockPrisma.training_plans.update.mockResolvedValue({
      id: 1,
      name: '全字段',
      college_id: 3,
      major_id: null,
      training_level_id: 2,
      version: 'v3.0',
      description: '新描述',
      status: 'active',
      sort_order: 10,
      colleges: { name: '新学院' },
      majors: null,
      training_levels: { id: 2, name: '本科' },
    });

    const req = mockReq(
      {
        name: '全字段',
        college_id: 3,
        training_level_id: 2,
        version: 'v3.0',
        description: '新描述',
        status: 'active',
        sort_order: 10,
      },
      { id: '1' }
    );
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    const data = mockPrisma.training_plans.update.mock.calls[0][0].data;
    expect(data.name).toBe('全字段');
    expect(data.college_id).toBe(3);
    expect(data.major_id).toBeNull();
    expect(data.training_level_id).toBe(2);
    expect(data.version).toBe('v3.0');
    expect(data.description).toBe('新描述');
    expect(data.status).toBe('active');
    expect(data.sort_order).toBe(10);
  });

  it('college_id 变更 → 审计日志记录 collegeChange', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue({
      id: 1,
      college_id: 1,
      colleges: { name: '旧学院' },
    });
    mockPrisma.training_plans.update.mockResolvedValue({
      id: 1,
      name: '更新',
      college_id: 5,
      major_id: 1,
      training_level_id: null,
      colleges: { name: '新学院' },
      majors: { id: 1, name: '学前' },
      training_levels: null,
    });

    const req = mockReq({ name: '更新', major_id: 1, college_id: 5 }, { id: '1' });
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        result: 'success',
        details: expect.objectContaining({
          collegeChange: { from: '旧学院', to: '新学院' },
        }),
      })
    );
  });

  it('college_id 未变更 → 审计日志不含 collegeChange', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue({
      id: 1,
      college_id: 1,
      colleges: { name: '不变学院' },
    });
    mockPrisma.training_plans.update.mockResolvedValue({
      id: 1,
      name: '更新',
      college_id: 1,
      major_id: 1,
      training_level_id: null,
      colleges: { name: '不变学院' },
      majors: { id: 1, name: '学前' },
      training_levels: null,
    });

    const req = mockReq({ name: '更新', major_id: 1, college_id: 1 }, { id: '1' });
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    const auditCall = createAuditLog.mock.calls[0][0];
    expect(auditCall.details).not.toHaveProperty('collegeChange');
  });

  it('Prisma update 抛非 P2025 错误 → 记录失败审计日志并 throw', async () => {
    const dbError = new Error('Unknown argument `college_id`');
    mockPrisma.training_plans.findUnique.mockResolvedValue({
      id: 1,
      college_id: null,
      colleges: null,
    });
    mockPrisma.training_plans.update.mockRejectedValue(dbError);

    const req = mockReq({ name: '出错', major_id: 1 }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();
    await updatePlan(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'trainingPlan',
        action: 'update',
        result: 'failed',
        details: expect.objectContaining({
          error: 'Unknown argument `college_id`',
        }),
      })
    );
    expect(next).toHaveBeenCalledWith(dbError);
  });

  it('sort_order 更新路径也应调用 invalidateSortOrderCache', async () => {
    mockPrisma.training_plans.update.mockResolvedValue({
      id: 1,
      name: '排序更新',
      sort_order: 5,
      college_id: null,
      colleges: null,
      majors: null,
      training_levels: null,
    });

    const req = mockReq({ sort_order: 5 }, { id: '1' });
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    expect(invalidateSortOrderCache).toHaveBeenCalledWith('training_plans');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '更新成功' })
    );
  });
});

// ════════════════════════════════════════════════
// createPlan — 适用入学年份范围（同专业/层次多版本按年级区分）
// ════════════════════════════════════════════════
describe('createPlan — 适用入学年份范围', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.training_plans.aggregate.mockResolvedValue({ _max: { sort_order: 5 } });
    mockPrisma.training_plans.findMany.mockResolvedValue([]);
  });

  it('apply_from_year/apply_to_year 正常传入 Prisma', async () => {
    mockPrisma.training_plans.create.mockResolvedValue({
      id: 30,
      name: '高级工人培V1.0',
      majors: null,
      colleges: null,
      training_levels: { id: 2, name: '高级工' },
    });

    const req = mockReq({
      name: '高级工人培V1.0',
      training_level_id: 2,
      apply_from_year: 2025,
      apply_to_year: 2025,
    });
    const res = mockRes();
    await createPlan(req, res, vi.fn());

    const data = mockPrisma.training_plans.create.mock.calls[0][0].data;
    expect(data.apply_from_year).toBe(2025);
    expect(data.apply_to_year).toBe(2025);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('起始年 > 截止年 → 验证错误', async () => {
    const req = mockReq({
      name: '非法区间',
      training_level_id: 2,
      apply_from_year: 2026,
      apply_to_year: 2025,
    });
    const next = vi.fn();
    await createPlan(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: '适用入学年份起不能大于止' })
    );
    expect(mockPrisma.training_plans.create).not.toHaveBeenCalled();
  });

  it('年份越界 → 验证错误', async () => {
    const req = mockReq({ name: '越界', training_level_id: 2, apply_from_year: 1999 });
    const next = vi.fn();
    await createPlan(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('2000~2100') })
    );
  });

  it('同层次已有方案区间重叠 → 拒绝并返回冲突方案名', async () => {
    mockPrisma.training_plans.findMany.mockResolvedValue([
      { id: 5, name: '高级工人培V1.0', apply_from_year: null, apply_to_year: 2026 },
    ]);

    const req = mockReq({
      name: '高级工人培V2.0',
      training_level_id: 2,
      apply_from_year: 2026,
    });
    const next = vi.fn();
    await createPlan(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('高级工人培V1.0') })
    );
    expect(mockPrisma.training_plans.create).not.toHaveBeenCalled();
  });

  it('同层次区间相邻（V1 止 2025、V2 起 2026）→ 不算重叠，创建成功', async () => {
    mockPrisma.training_plans.findMany.mockResolvedValue([
      { id: 5, name: 'V1', apply_from_year: null, apply_to_year: 2025 },
    ]);
    mockPrisma.training_plans.create.mockResolvedValue({
      id: 31,
      name: 'V2',
      majors: null,
      colleges: null,
      training_levels: null,
    });

    const req = mockReq({ name: 'V2', training_level_id: 2, apply_from_year: 2026 });
    const res = mockRes();
    await createPlan(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('存量方案两端皆 null（覆盖全部年份）→ 任何新建同维度方案均判重叠', async () => {
    mockPrisma.training_plans.findMany.mockResolvedValue([
      { id: 5, name: '旧方案', apply_from_year: null, apply_to_year: null },
    ]);

    const req = mockReq({ name: 'V2', training_level_id: 2, apply_from_year: 2026 });
    const next = vi.fn();
    await createPlan(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('旧方案') })
    );
  });

  it('重叠校验 where 排除归档方案（支持「归档旧方案 → 同届新建」操作流）', async () => {
    mockPrisma.training_plans.create.mockResolvedValue({
      id: 32,
      name: '同届新方案',
      majors: { id: 1, name: '学前教育' },
      colleges: null,
      training_levels: null,
    });

    const req = mockReq({ name: '同届新方案', major_id: 1, apply_from_year: 2025 });
    const res = mockRes();
    await createPlan(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    // 归档方案在 DB 层被排除，不会占用适用年份区间
    const overlapWhere = mockPrisma.training_plans.findMany.mock.calls[0][0].where;
    expect(overlapWhere).toEqual({
      major_id: 1,
      status: { not: 'archived' },
    });
  });

  it('与非归档（生效/草稿）方案重叠 → 仍拒绝（回归保护）', async () => {
    mockPrisma.training_plans.findMany.mockResolvedValue([
      { id: 6, name: '生效方案', status: 'active', apply_from_year: null, apply_to_year: null },
    ]);

    const req = mockReq({ name: 'V2', training_level_id: 2, apply_from_year: 2026 });
    const next = vi.fn();
    await createPlan(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('生效方案') })
    );
    expect(mockPrisma.training_plans.create).not.toHaveBeenCalled();
  });

  it('updatePlan 完整更新路径的重叠校验同样排除归档并排除自身', async () => {
    mockPrisma.training_plans.findMany.mockResolvedValue([]);
    mockPrisma.training_plans.findUnique.mockResolvedValue({
      id: 1,
      college_id: null,
      colleges: null,
      apply_from_year: null,
      apply_to_year: null,
    });
    mockPrisma.training_plans.update.mockResolvedValue({
      id: 1,
      name: '更新',
      major_id: 1,
      training_level_id: null,
      colleges: null,
      majors: null,
      training_levels: null,
    });

    const req = mockReq({ name: '更新', major_id: 1 }, { id: '1' });
    const res = mockRes();
    await updatePlan(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const overlapWhere = mockPrisma.training_plans.findMany.mock.calls[0][0].where;
    expect(overlapWhere).toEqual({
      major_id: 1,
      status: { not: 'archived' },
      id: { not: 1 },
    });
  });
});

// ════════════════════════════════════════════════
// createPlanNewVersion — 从现有方案派生新版本
// ════════════════════════════════════════════════
describe('createPlanNewVersion — 派生新版本', () => {
  const mockTx = {
    training_plans: { update: vi.fn(), create: vi.fn() },
    plan_courses: { create: vi.fn() },
    plan_course_semesters: { create: vi.fn() },
    plan_textbooks: { create: vi.fn() },
  };

  const source = {
    id: 5,
    name: '高级工人培V1.0',
    college_id: null,
    major_id: null,
    training_level_id: 2,
    version: 'V1.0',
    description: '旧版描述',
    apply_from_year: null,
    apply_to_year: null,
    sort_order: 3,
    plan_courses: [
      {
        course_id: 11,
        start_semester: 1,
        end_semester: 2,
        weekly_hours: 4,
        weeks_per_semester: 18,
        sort_order: 1,
        is_active: true,
        plan_course_semesters: [
          {
            semester: 1,
            weekly_hours: 2,
            weeks_count: 18,
            plan_textbooks: [{ textbook_id: 7, is_required: true }],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.training_plans.findMany.mockResolvedValue([]);
    mockPrisma.training_plans.aggregate.mockResolvedValue({ _max: { sort_order: 5 } });
    mockPrisma.$transaction = vi.fn(async (fn) => fn(mockTx));
    mockTx.training_plans.create.mockResolvedValue({ id: 99, name: '高级工人培V2.0' });
    mockTx.plan_courses.create.mockResolvedValue({ id: 201 });
    mockTx.plan_course_semesters.create.mockResolvedValue({ id: 301 });
  });

  it('复制课程/学期/教材，收窄源方案止年，写审计日志', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue(source);

    const req = mockReq(
      { name: '高级工人培V2.0', version: 'V2.0', apply_from_year: 2026 },
      { id: '5' }
    );
    const res = mockRes();
    await createPlanNewVersion(req, res, vi.fn());

    // 源方案止年收窄为 2025
    expect(mockTx.training_plans.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { apply_to_year: 2025 },
    });
    // 新方案基本信息：维度继承 + 起始年 + draft + sort_order 取全局最大+1（不继承源方案）
    const createData = mockTx.training_plans.create.mock.calls[0][0].data;
    expect(createData).toMatchObject({
      name: '高级工人培V2.0',
      training_level_id: 2,
      version: 'V2.0',
      apply_from_year: 2026,
      apply_to_year: null,
      status: 'draft',
      sort_order: 6,
    });
    // 深拷贝链路：课程 → 学期 → 教材
    expect(mockTx.plan_courses.create).toHaveBeenCalledTimes(1);
    expect(mockTx.plan_courses.create.mock.calls[0][0].data.plan_id).toBe(99);
    // 派生继承源课程的启用状态
    expect(mockTx.plan_courses.create.mock.calls[0][0].data.is_active).toBe(true);
    expect(mockTx.plan_course_semesters.create).toHaveBeenCalledTimes(1);
    expect(mockTx.plan_course_semesters.create.mock.calls[0][0].data.plan_course_id).toBe(201);
    expect(mockTx.plan_textbooks.create).toHaveBeenCalledWith({
      data: { semester_id: 301, textbook_id: 7, is_required: true },
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'trainingPlan', action: 'createVersion', result: 'success' })
    );
  });

  it('update_source_end_year=false 且源方案覆盖起始年 → 拒绝且不落库', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue(source);

    const req = mockReq(
      { apply_from_year: 2026, update_source_end_year: false },
      { id: '5' }
    );
    const next = vi.fn();
    await createPlanNewVersion(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('收窄') })
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('源方案止年早于起始年（已收窄过）→ 不收窄不拒绝，正常复制', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue({
      ...source,
      apply_to_year: 2025,
    });

    const req = mockReq({ apply_from_year: 2026 }, { id: '5' });
    const res = mockRes();
    await createPlanNewVersion(req, res, vi.fn());

    expect(mockTx.training_plans.update).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('缺起始入学年份 → 验证错误', async () => {
    const req = mockReq({}, { id: '5' });
    const next = vi.fn();
    await createPlanNewVersion(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: '请填写新版本适用起始入学年份' })
    );
    expect(mockPrisma.training_plans.findUnique).not.toHaveBeenCalled();
  });

  it('源方案不存在 → 404', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue(null);

    const req = mockReq({ apply_from_year: 2026 }, { id: '999' });
    const next = vi.fn();
    await createPlanNewVersion(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('与同维度其他方案重叠 → 拒绝', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue(source);
    mockPrisma.training_plans.findMany.mockResolvedValue([
      { id: 8, name: '已有V2', apply_from_year: 2026, apply_to_year: null },
    ]);

    const req = mockReq({ apply_from_year: 2026 }, { id: '5' });
    const next = vi.fn();
    await createPlanNewVersion(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('已有V2') })
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('未传 version → 按源方案版本自动递增（V1.0 → V2.0）', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue(source);

    const req = mockReq({ apply_from_year: 2026 }, { id: '5' });
    const res = mockRes();
    await createPlanNewVersion(req, res, vi.fn());

    const createData = mockTx.training_plans.create.mock.calls[0][0].data;
    expect(createData.version).toBe('V2.0');
  });

  it('显式传 version → 使用传入值，不递增', async () => {
    mockPrisma.training_plans.findUnique.mockResolvedValue(source);

    const req = mockReq({ apply_from_year: 2026, version: ' V3.0 ' }, { id: '5' });
    const res = mockRes();
    await createPlanNewVersion(req, res, vi.fn());

    const createData = mockTx.training_plans.create.mock.calls[0][0].data;
    expect(createData.version).toBe('V3.0');
  });

  it('源课程已禁用 → 派生后仍保持禁用', async () => {
    const disabledSource = {
      ...source,
      plan_courses: [
        {
          ...source.plan_courses[0],
          is_active: false,
        },
      ],
    };
    mockPrisma.training_plans.findUnique.mockResolvedValue(disabledSource);

    const req = mockReq({ apply_from_year: 2026 }, { id: '5' });
    await createPlanNewVersion(req, mockRes(), vi.fn());

    expect(mockTx.plan_courses.create.mock.calls[0][0].data.is_active).toBe(false);
  });
});

// ════════════════════════════════════════════════
// incrementVersion — 版本号递增纯函数
// ════════════════════════════════════════════════
describe('incrementVersion — 版本号递增', () => {
  it('标准版本号：主版本 +1，次版本归零', () => {
    expect(incrementVersion('V1.0')).toBe('V2.0');
    expect(incrementVersion('V1.2')).toBe('V2.0');
    expect(incrementVersion('v2.5')).toBe('v3.0');
  });

  it('无次版本号：仅主版本 +1', () => {
    expect(incrementVersion('V3')).toBe('V4');
    expect(incrementVersion('2.5')).toBe('3.0');
  });

  it('保留前缀/后缀与前导零风格', () => {
    expect(incrementVersion('第2版')).toBe('第3版');
    expect(incrementVersion('V01.0')).toBe('V02.0');
  });

  it('无数字或空值 → 返回原值/null', () => {
    expect(incrementVersion('初版')).toBe('初版');
    expect(incrementVersion(null)).toBeNull();
    expect(incrementVersion(undefined)).toBeNull();
    expect(incrementVersion('')).toBeNull();
  });
});

// ════════════════════════════════════════════════
// 归档方案计数口径：归档后使用班级数应归零
// ════════════════════════════════════════════════
describe('listPlans — 归档方案计数', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('归档方案的 classCount / matchedClassCount 应为 0（不参与匹配候选）', async () => {
    const archivedPlan = {
      id: 1,
      name: '归档方案',
      major_id: 1,
      training_level_id: null,
      college_id: 1,
      status: 'archived',
      majors: null,
      colleges: null,
      training_levels: null,
      plan_courses: [{ id: 1 }],
    };
    const activePlan = {
      id: 2,
      name: '生效方案',
      major_id: 1,
      training_level_id: null,
      college_id: 1,
      status: 'active',
      majors: null,
      colleges: null,
      training_levels: null,
      plan_courses: [{ id: 2 }],
    };

    mockPrisma.training_plans.findMany.mockResolvedValue([archivedPlan, activePlan]);
    mockPrisma.classes.findMany.mockResolvedValue([
      // 一个按专业可匹配两方案的班级
      { id: 10, major_id: 1, training_level_id: null, custom_plan_id: null, enrollment_year: 2024 },
    ]);
    // findBestMatchPlan/isClassMatchPlan 若被喂入归档方案会返回它——
    // 控制器应把归档方案从候选中剔除，使归档方案计数为 0
    mockFindBestMatchPlan.mockImplementation((_cls, plans) => plans[0] || null);
    mockIsClassMatchPlan.mockReturnValue(true);

    const req = mockReq({}, {}, {});
    const res = mockRes();
    await listPlans(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    const archived = data.find((p) => p.id === 1);
    const active = data.find((p) => p.id === 2);
    // 归档方案：使用班级数归零
    expect(archived.classCount).toBe(0);
    expect(archived.matchedClassCount).toBe(0);
    // 生效方案正常计数
    expect(active.classCount).toBe(1);
    expect(active.matchedClassCount).toBe(1);
    // findBestMatchPlan 的候选列表不含归档方案
    const calledPlans = mockFindBestMatchPlan.mock.calls[0][1];
    expect(calledPlans.map((p) => p.id)).toEqual([2]);
    // isClassMatchPlan 的遍历列表也不含归档方案
    const matchPlanIds = mockIsClassMatchPlan.mock.calls.map((c) => c[1].id);
    expect(matchPlanIds).not.toContain(1);
  });

  it('班级自定义关联归档方案 → customPlanMap 不命中，classCount 不计入归档方案', async () => {
    const archivedPlan = {
      id: 1,
      name: '归档方案',
      major_id: null,
      training_level_id: null,
      college_id: null,
      status: 'archived',
      majors: null,
      colleges: null,
      training_levels: null,
      plan_courses: [],
    };
    mockPrisma.training_plans.findMany.mockResolvedValue([archivedPlan]);
    mockPrisma.classes.findMany.mockResolvedValue([
      // 班级钉住归档方案（custom_plan_id=1）
      { id: 10, major_id: null, training_level_id: null, custom_plan_id: 1, enrollment_year: 2024 },
    ]);
    mockFindBestMatchPlan.mockReturnValue(null);
    mockIsClassMatchPlan.mockReturnValue(false);

    const req = mockReq({}, {}, {});
    const res = mockRes();
    await listPlans(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    // 使用班级数归零；customLinkedClassCount 保留（反映数据仍存在 custom_plan_id 引用）
    expect(data[0].classCount).toBe(0);
    expect(data[0].matchedClassCount).toBe(0);
    expect(data[0].customLinkedClassCount).toBe(1);
  });
});
