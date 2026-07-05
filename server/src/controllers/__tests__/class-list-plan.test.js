/**
 * class.controller.js — listClasses 培养方案匹配 单元测试
 *
 * 重点覆盖 listClasses 中的方案匹配逻辑：
 * 1. 有 custom_plan_id 的班级 → matchedPlanName 来自 training_plans.name
 * 2. 无 custom_plan_id, 按专业匹配 → matchedPlanName 来自 findBestMatchPlan
 * 3. 无 custom_plan_id, 仅按层次匹配 → matchedPlanName 来自 findBestMatchPlan
 * 4. 无任何匹配方案 → matchedPlanName = null
 * 5. 专业+层次交叉匹配 → planMatchWarning 被设置
 * 6. 无交叉匹配 → planMatchWarning = null
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  classes: {
    count: vi.fn(),
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
// Mock 依赖服务
// ──────────────────────────────────────────────
vi.mock('../../services/settings.service.js', () => ({
  getCurrentSemesterInfo: vi.fn(),
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
const { listClasses } = await import('../class.controller.js');
const { getCurrentSemesterInfo } = await import('../../services/settings.service.js');
const { buildClassFilter } = await import('../../services/class-filter.service.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(query = {}) {
  return { query, user: { id: 1 }, ip: '127.0.0.1' };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

const SEMESTER_INFO = {
  startYear: 2025,
  endYear: 2026,
  semesterIndex: 2,
  raw: '2025-2026-2',
};

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('listClasses — 培养方案匹配逻辑', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getCurrentSemesterInfo.mockResolvedValue(SEMESTER_INFO);
    buildClassFilter.mockResolvedValue({ where: {}, planNotFound: false });
    mockPrisma.classes.count.mockResolvedValue(1);
    // allClassesForMappings (第二次 findMany) 和 allPlansForMapping (第二次 training_plans.findMany)
    // 默认返回空以简化测试
    mockPrisma.classes.findMany.mockImplementation(async (args) => {
      // 根据 include 判断是哪次调用
      if (args.include) {
        // 第一次：主查询（带 include）
        return [];
      }
      // 第二次：allClassesForMappings（只有 select）
      return [];
    });
    mockPrisma.training_plans.findMany.mockResolvedValue([]);
    mockFindBestMatchPlan.mockReturnValue(null);
  });

  // ── 场景 1: 有 custom_plan_id → matchedPlanName 来自 training_plans.name ──
  it('有 custom_plan_id 的班级，matchedPlanName 应等于 training_plans.name', async () => {
    const classWithCustomPlan = {
      id: 1,
      name: '2024级学前1班',
      enrollment_year: 2024,
      duration_years: 3,
      major_id: 1,
      college_id: 1,
      training_level_id: 2,
      is_left_school: false,
      custom_plan_id: 10,
      status: 'active',
      majors: { id: 1, name: '学前教育' },
      colleges: { id: 1, name: '教育学院' },
      training_levels: { id: 2, name: '本科' },
      training_plans: { id: 10, name: '2024学前教育方案' },
    };

    mockPrisma.classes.findMany.mockImplementation(async (args) => {
      if (args.include) return [classWithCustomPlan];
      return [];
    });

    const req = mockReq({});
    const res = mockRes();
    await listClasses(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.items[0].matchedPlanName).toBe('2024学前教育方案');
    expect(data.items[0].planMatchWarning).toBeNull();
  });

  // ── 场景 2: 无 custom_plan_id, 按专业匹配 ──
  it('无 custom_plan_id, 按专业匹配成功 → matchedPlanName 来自 findBestMatchPlan', async () => {
    const classNoCustom = {
      id: 2,
      name: '2024级学前2班',
      enrollment_year: 2024,
      duration_years: 3,
      major_id: 1,
      college_id: 1,
      training_level_id: 2,
      is_left_school: false,
      custom_plan_id: null,
      status: 'active',
      majors: { id: 1, name: '学前教育' },
      colleges: { id: 1, name: '教育学院' },
      training_levels: { id: 2, name: '本科' },
      training_plans: null,
    };

    const majorPlan = { id: 20, name: '学前教育专业方案', major_id: 1, training_level_id: null };

    mockPrisma.classes.findMany.mockImplementation(async (args) => {
      if (args.include) return [classNoCustom];
      return [];
    });
    mockPrisma.training_plans.findMany.mockResolvedValue([majorPlan]);
    mockFindBestMatchPlan.mockReturnValue(majorPlan);

    const req = mockReq({});
    const res = mockRes();
    await listClasses(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.items[0].matchedPlanName).toBe('学前教育专业方案');
  });

  // ── 场景 3: 无 custom_plan_id, 仅按层次匹配 ──
  it('无 custom_plan_id, 仅层次匹配 → matchedPlanName 来自层次方案', async () => {
    const classLevelOnly = {
      id: 3,
      name: '2024级计算机班',
      enrollment_year: 2024,
      duration_years: 3,
      major_id: null,
      college_id: 1,
      training_level_id: 2,
      is_left_school: false,
      custom_plan_id: null,
      status: 'active',
      majors: null,
      colleges: { id: 1, name: '工学院' },
      training_levels: { id: 2, name: '本科' },
      training_plans: null,
    };

    const levelPlan = { id: 30, name: '本科通用方案', major_id: null, training_level_id: 2 };

    mockPrisma.classes.findMany.mockImplementation(async (args) => {
      if (args.include) return [classLevelOnly];
      return [];
    });
    mockPrisma.training_plans.findMany.mockResolvedValue([levelPlan]);
    mockFindBestMatchPlan.mockReturnValue(levelPlan);

    const req = mockReq({});
    const res = mockRes();
    await listClasses(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.items[0].matchedPlanName).toBe('本科通用方案');
  });

  // ── 场景 4: 无任何匹配方案 → matchedPlanName = null ──
  it('无任何匹配方案 → matchedPlanName = null', async () => {
    const classNoPlan = {
      id: 4,
      name: '2024级无方案班',
      enrollment_year: 2024,
      duration_years: 3,
      major_id: 99,
      college_id: 1,
      training_level_id: 99,
      is_left_school: false,
      custom_plan_id: null,
      status: 'active',
      majors: { id: 99, name: '未知专业' },
      colleges: { id: 1, name: '某学院' },
      training_levels: { id: 99, name: '未知层次' },
      training_plans: null,
    };

    mockPrisma.classes.findMany.mockImplementation(async (args) => {
      if (args.include) return [classNoPlan];
      return [];
    });
    mockPrisma.training_plans.findMany.mockResolvedValue([]);
    mockFindBestMatchPlan.mockReturnValue(null);

    const req = mockReq({});
    const res = mockRes();
    await listClasses(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.items[0].matchedPlanName).toBeNull();
    expect(data.items[0].planMatchWarning).toBeNull();
  });

  // ── 场景 5: 专业+层次交叉匹配 → planMatchWarning 被设置 ──
  it('专业 AND 层次匹配不同方案 → planMatchWarning 应被设置', async () => {
    const classCross = {
      id: 5,
      name: '2024级交叉班',
      enrollment_year: 2024,
      duration_years: 3,
      major_id: 1,
      college_id: 1,
      training_level_id: 2,
      is_left_school: false,
      custom_plan_id: null,
      status: 'active',
      majors: { id: 1, name: '学前教育' },
      colleges: { id: 1, name: '教育学院' },
      training_levels: { id: 2, name: '本科' },
      training_plans: null,
    };

    const majorPlan = { id: 20, name: '学前教育方案', major_id: 1, training_level_id: null };
    const levelPlan = { id: 30, name: '本科通用方案', major_id: null, training_level_id: 2 };

    mockPrisma.classes.findMany.mockImplementation(async (args) => {
      if (args.include) return [classCross];
      return [];
    });
    mockPrisma.training_plans.findMany.mockResolvedValue([majorPlan, levelPlan]);
    // findBestMatchPlan returns major plan (priority)
    mockFindBestMatchPlan.mockReturnValue(majorPlan);

    const req = mockReq({});
    const res = mockRes();
    await listClasses(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.items[0].matchedPlanName).toBe('学前教育方案');
    expect(data.items[0].planMatchWarning).toBeTruthy();
    expect(data.items[0].planMatchWarning).toContain('交叉');
  });

  // ── 场景 6: 仅专业匹配，无层次方案 → planMatchWarning = null ──
  it('仅专业匹配，无层次方案 → planMatchWarning = null', async () => {
    const classMajorOnly = {
      id: 6,
      name: '2024级纯专业班',
      enrollment_year: 2024,
      duration_years: 3,
      major_id: 1,
      college_id: 1,
      training_level_id: 2,
      is_left_school: false,
      custom_plan_id: null,
      status: 'active',
      majors: { id: 1, name: '学前教育' },
      colleges: { id: 1, name: '教育学院' },
      training_levels: { id: 2, name: '本科' },
      training_plans: null,
    };

    const majorPlan = { id: 20, name: '学前教育方案', major_id: 1, training_level_id: null };

    mockPrisma.classes.findMany.mockImplementation(async (args) => {
      if (args.include) return [classMajorOnly];
      return [];
    });
    // Only one plan (major-based, no level-based plans exist)
    mockPrisma.training_plans.findMany.mockResolvedValue([majorPlan]);
    mockFindBestMatchPlan.mockReturnValue(majorPlan);

    const req = mockReq({});
    const res = mockRes();
    await listClasses(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.items[0].matchedPlanName).toBe('学前教育方案');
    // No level-matched plans → no cross-match warning
    expect(data.items[0].planMatchWarning).toBeNull();
  });

  // ── 场景: buildClassFilter 返回 planNotFound → 返回空列表 ──
  it('buildClassFilter 返回 planNotFound → 直接返回空列表', async () => {
    buildClassFilter.mockResolvedValue({ where: null, planNotFound: true });

    const req = mockReq({ plan_id: '999' });
    const res = mockRes();
    await listClasses(req, res, vi.fn());

    const result = res.json.mock.calls[0][0];
    expect(result.success).toBe(true);
    expect(result.data.items).toEqual([]);
    expect(result.data.total).toBe(0);
  });

  // ── 场景: is_left_school 班级状态应为 left_school ──
  it('is_left_school 班级 → status = left_school', async () => {
    const leftSchoolClass = {
      id: 7,
      name: '已离校班',
      enrollment_year: 2020,
      duration_years: 3,
      major_id: 1,
      college_id: 1,
      training_level_id: 2,
      is_left_school: true,
      custom_plan_id: null,
      status: 'left_school',
      majors: { id: 1, name: '学前教育' },
      colleges: { id: 1, name: '教育学院' },
      training_levels: { id: 2, name: '本科' },
      training_plans: null,
    };

    mockPrisma.classes.findMany.mockImplementation(async (args) => {
      if (args.include) return [leftSchoolClass];
      return [];
    });
    mockPrisma.training_plans.findMany.mockResolvedValue([]);
    mockFindBestMatchPlan.mockReturnValue(null);

    const req = mockReq({});
    const res = mockRes();
    await listClasses(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.items[0].status).toBe('left_school');
  });
});
