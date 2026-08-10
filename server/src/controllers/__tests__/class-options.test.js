/**
 * class.controller.js — listClassOptions（合班伙伴候选接口）单元测试
 *
 * 覆盖修复点：
 * 1. 全量查询不带分页（避免 pageSize 上限截断合班伙伴候选）
 * 2. 返回项仅含轻量字段 id/name/college_id/combination_id/matched_plan_id
 * 3. matched_plan_id 与 findBestMatchPlan 口径一致（命中取 plan.id，未命中为 null）
 * 4. 异常路径走 next(e)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  classes: {
    findMany: vi.fn(),
  },
  training_plans: {
    findMany: vi.fn(),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖服务（与 class-list-plan.test.js 保持一致）
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

const mockFindBestMatchPlan = vi.fn();
vi.mock('../../services/plan.service.js', () => ({
  findBestMatchPlan: (...args) => mockFindBestMatchPlan(...args),
}));

vi.mock('../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { listClassOptions } = await import('../class.controller.js');

function mockReq() {
  return { query: {}, user: { id: 1 }, ip: '127.0.0.1' };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

const CLASS_A = {
  id: 1,
  name: 'GZ26建筑加固1班',
  college_id: 47,
  combination_id: null,
  major_id: 1,
  training_level_id: 2,
  custom_plan_id: null,
};

const CLASS_B = {
  id: 2,
  name: 'GZ26建筑加固2班',
  college_id: 47,
  combination_id: 9,
  major_id: 1,
  training_level_id: 2,
  custom_plan_id: null,
};

const PLAN = { id: 2, name: '高职培养方案', major_id: null, training_level_id: 2 };

describe('listClassOptions — 合班伙伴候选接口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.classes.findMany.mockResolvedValue([CLASS_A, CLASS_B]);
    mockPrisma.training_plans.findMany.mockResolvedValue([PLAN]);
    mockFindBestMatchPlan.mockReturnValue(PLAN);
  });

  it('全量查询不带分页：按 id 升序且无 skip/take', async () => {
    const res = mockRes();
    await listClassOptions(mockReq(), res, vi.fn());

    expect(mockPrisma.classes.findMany).toHaveBeenCalledTimes(1);
    const args = mockPrisma.classes.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ id: 'asc' });
    expect(args.skip).toBeUndefined();
    expect(args.take).toBeUndefined();
  });

  it('返回项仅含轻量字段（id/name/college_id/combination_id/matched_plan_id）', async () => {
    const res = mockRes();
    await listClassOptions(mockReq(), res, vi.fn());

    const { items } = res.json.mock.calls[0][0].data;
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        ['college_id', 'combination_id', 'id', 'matched_plan_id', 'name'].sort()
      );
    }
    expect(items[0]).toEqual({
      id: 1,
      name: 'GZ26建筑加固1班',
      college_id: 47,
      combination_id: null,
      matched_plan_id: 2,
    });
  });

  it('matched_plan_id 取 findBestMatchPlan 命中方案的 id', async () => {
    const res = mockRes();
    await listClassOptions(mockReq(), res, vi.fn());

    const { items } = res.json.mock.calls[0][0].data;
    expect(items[0].matched_plan_id).toBe(PLAN.id);
    expect(items[1].matched_plan_id).toBe(PLAN.id);
    // findBestMatchPlan 收到班级对象与全量方案列表
    expect(mockFindBestMatchPlan).toHaveBeenCalledWith(CLASS_A, [PLAN]);
    expect(mockFindBestMatchPlan).toHaveBeenCalledWith(CLASS_B, [PLAN]);
  });

  it('findBestMatchPlan 未命中 → matched_plan_id 为 null', async () => {
    mockFindBestMatchPlan.mockReturnValue(null);

    const res = mockRes();
    await listClassOptions(mockReq(), res, vi.fn());

    const { items } = res.json.mock.calls[0][0].data;
    expect(items[0].matched_plan_id).toBeNull();
    expect(items[1].matched_plan_id).toBeNull();
  });

  it('并发加载全量方案且 select 含 created_at（多匹配取最新的确定性依据）', async () => {
    const res = mockRes();
    await listClassOptions(mockReq(), res, vi.fn());

    expect(mockPrisma.training_plans.findMany).toHaveBeenCalledTimes(1);
    const args = mockPrisma.training_plans.findMany.mock.calls[0][0];
    expect(args.select).toMatchObject({
      id: true,
      major_id: true,
      training_level_id: true,
      created_at: true,
    });
  });

  it('无班级数据 → 返回空列表', async () => {
    mockPrisma.classes.findMany.mockResolvedValue([]);

    const res = mockRes();
    await listClassOptions(mockReq(), res, vi.fn());

    expect(res.json.mock.calls[0][0].data).toEqual({ items: [] });
    expect(mockFindBestMatchPlan).not.toHaveBeenCalled();
  });

  it('prisma 抛错 → 交给 next 处理', async () => {
    const boom = new Error('db down');
    mockPrisma.classes.findMany.mockRejectedValue(boom);

    const next = vi.fn();
    const res = mockRes();
    await listClassOptions(mockReq(), res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});
