/**
 * class-filter.service 单元测试
 *
 * 覆盖 buildClassFilter 的所有筛选参数和组合：
 * - name（模糊匹配）
 * - major_id / college_id / training_level_id / enrollment_year（精确匹配）
 * - status（active / graduated / left_school / 未知值）
 * - plan_id（指定方案 / "none" / 方案不存在）
 * - 组合筛选
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
    findUnique: vi.fn(),
  },
  system_settings: {
    findUnique: vi.fn(),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// Mock settings.service 的 getCurrentSemesterInfo
vi.mock('../../services/settings.service.js', () => ({
  getCurrentSemesterInfo: vi.fn(),
}));

const { getCurrentSemesterInfo } = await import('../../services/settings.service.js');
const { buildClassFilter } = await import('../../services/class-filter.service.js');

// ──────────────────────────────────────────────
// 测试
// ──────────────────────────────────────────────
describe('buildClassFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认当前学期
    getCurrentSemesterInfo.mockResolvedValue({
      startYear: 2025,
      endYear: 2026,
      semesterIndex: 2,
      label: '2026年春季(第2学期)',
    });
    // 默认学制列表（3年和4年）
    mockPrisma.classes.findMany.mockResolvedValue([{ duration_years: 3 }, { duration_years: 4 }]);
  });

  // ════════════════════════════════════════════
  // 空查询
  // ════════════════════════════════════════════
  describe('空查询', () => {
    it('无参数应返回空 where', async () => {
      const result = await buildClassFilter({});
      expect(result.where).toEqual({});
      expect(result.planNotFound).toBe(false);
    });
  });

  // ════════════════════════════════════════════
  // name 筛选
  // ════════════════════════════════════════════
  describe('name 筛选', () => {
    it('应使用 contains 模糊匹配', async () => {
      const result = await buildClassFilter({ name: '计算机' });
      expect(result.where.name).toEqual({ contains: '计算机' });
    });
  });

  // ════════════════════════════════════════════
  // major_id / college_id / training_level_id / enrollment_year
  // ════════════════════════════════════════════
  describe('精确 ID 筛选', () => {
    it('major_id 应为数字精确匹配', async () => {
      const result = await buildClassFilter({ major_id: '146' });
      expect(result.where.major_id).toBe(146);
    });

    it('college_id 应为数字精确匹配', async () => {
      const result = await buildClassFilter({ college_id: '35' });
      expect(result.where.college_id).toBe(35);
    });

    it('training_level_id 应为数字精确匹配', async () => {
      const result = await buildClassFilter({ training_level_id: '10' });
      expect(result.where.training_level_id).toBe(10);
    });

    it('enrollment_year 应为数字精确匹配', async () => {
      const result = await buildClassFilter({ enrollment_year: '2024' });
      expect(result.where.enrollment_year).toBe(2024);
    });
  });

  // ════════════════════════════════════════════
  // status 筛选
  // ════════════════════════════════════════════
  describe('status 筛选', () => {
    it('left_school 应匹配 is_left_school=true', async () => {
      const result = await buildClassFilter({ status: 'left_school' });
      // finalWhere 应有 AND: [where, { OR: [{ is_left_school: true }] }]
      expect(result.where.AND).toBeDefined();
      const orClause = result.where.AND[1].OR;
      expect(orClause).toEqual([{ is_left_school: true }]);
    });

    it('active 应匹配当前在读的班级（enrollment_year >= startYear - d + 1 且 <= startYear）', async () => {
      const result = await buildClassFilter({ status: 'active' });
      expect(result.where.AND).toBeDefined();
      const orClause = result.where.AND[1].OR;
      // 应包含 3 年和 4 年学制的在读条件
      expect(orClause.length).toBe(2);
      // 3年制: enrollment_year >= 2025-3+1=2023, <= 2025
      expect(orClause[0]).toEqual({
        duration_years: 3,
        is_left_school: false,
        enrollment_year: { gte: 2023, lte: 2025 },
      });
      // 4年制: enrollment_year >= 2025-4+1=2022, <= 2025
      expect(orClause[1]).toEqual({
        duration_years: 4,
        is_left_school: false,
        enrollment_year: { gte: 2022, lte: 2025 },
      });
    });

    it('graduated 应匹配已毕业班级（enrollment_year < startYear - d + 1）', async () => {
      const result = await buildClassFilter({ status: 'graduated' });
      expect(result.where.AND).toBeDefined();
      const orClause = result.where.AND[1].OR;
      expect(orClause.length).toBe(2);
      // 3年制: enrollment_year < 2023
      expect(orClause[0]).toEqual({
        duration_years: 3,
        is_left_school: false,
        enrollment_year: { lt: 2023 },
      });
    });

    it('未知 status 应返回永假条件 id=-1', async () => {
      const result = await buildClassFilter({ status: 'nonexistent' });
      expect(result.where).toEqual({ id: -1 });
      expect(result.planNotFound).toBe(false);
    });

    it('status=active 但无当前学期时应降级为不过滤', async () => {
      getCurrentSemesterInfo.mockResolvedValue(null);
      const result = await buildClassFilter({ status: 'active' });
      // 无学期信息时 dynamicStatusFilter 为 null，finalWhere = where（空）
      expect(result.where).toEqual({});
    });
  });

  // ════════════════════════════════════════════
  // plan_id 筛选
  // ════════════════════════════════════════════
  describe('plan_id 筛选', () => {
    it('plan_id="none" 应匹配无方案关联的班级', async () => {
      mockPrisma.training_plans.findMany.mockResolvedValue([
        { id: 1, major_id: 10, training_level_id: 5 },
        { id: 2, major_id: 20, training_level_id: null },
      ]);

      const result = await buildClassFilter({ plan_id: 'none' });

      expect(result.where.custom_plan_id).toBeNull();
      expect(result.where.NOT).toBeDefined();
      const notOr = result.where.NOT.OR;
      // 应排除所有方案涉及的专业和层次
      expect(notOr).toContainEqual({ major_id: { in: [10, 20] } });
      expect(notOr).toContainEqual({ training_level_id: { in: [5] } });
    });

    it('plan_id=具体ID 应匹配 custom_plan_id 或 major/level 关联的班级', async () => {
      mockPrisma.training_plans.findUnique.mockResolvedValue({
        id: 5,
        major_id: 10,
        training_level_id: 5,
      });

      const result = await buildClassFilter({ plan_id: '5' });

      expect(result.where.OR).toBeDefined();
      // 应包含：custom_plan_id=5, major_id=10+custom_plan_id=null, training_level_id=5+custom_plan_id=null
      expect(result.where.OR).toContainEqual({ custom_plan_id: 5 });
      expect(result.where.OR).toContainEqual({
        major_id: 10,
        custom_plan_id: null,
      });
      expect(result.where.OR).toContainEqual({
        training_level_id: 5,
        custom_plan_id: null,
      });
    });

    it('plan_id=不存在的方案应返回 planNotFound=true', async () => {
      mockPrisma.training_plans.findUnique.mockResolvedValue(null);

      const result = await buildClassFilter({ plan_id: '999' });

      expect(result.where).toBeNull();
      expect(result.planNotFound).toBe(true);
    });

    it('方案只有 major_id 无 training_level_id 时，OR 中不应包含 training_level 条件', async () => {
      mockPrisma.training_plans.findUnique.mockResolvedValue({
        id: 5,
        major_id: 10,
        training_level_id: null,
      });

      const result = await buildClassFilter({ plan_id: '5' });

      expect(result.where.OR.length).toBe(2); // custom_plan_id + major_id
      expect(result.where.OR).not.toContainEqual(
        expect.objectContaining({ training_level_id: expect.anything() })
      );
    });
  });

  // ════════════════════════════════════════════
  // 组合筛选
  // ════════════════════════════════════════════
  describe('组合筛选', () => {
    it('name + college_id + status=active 应组合生效', async () => {
      const result = await buildClassFilter({
        name: '计算机',
        college_id: '35',
        status: 'active',
      });

      // name 模糊匹配
      expect(result.where.AND[0].name).toEqual({ contains: '计算机' });
      // college_id 精确匹配
      expect(result.where.AND[0].college_id).toBe(35);
      // status=active 的动态筛选
      const statusOr = result.where.AND[1].OR;
      expect(statusOr.length).toBeGreaterThan(0);
    });

    it('major_id + enrollment_year 应同时出现在 where 中', async () => {
      const result = await buildClassFilter({
        major_id: '146',
        enrollment_year: '2024',
      });

      expect(result.where.major_id).toBe(146);
      expect(result.where.enrollment_year).toBe(2024);
    });
  });
});
