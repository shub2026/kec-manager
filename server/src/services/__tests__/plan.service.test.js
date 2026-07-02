/**
 * plan.service.js 纯函数单元测试
 *
 * 覆盖：
 * - isClassMatchPlan（三级互斥匹配：custom > major | level）
 * - findBestMatchPlan（优先级匹配：custom > major > level）
 *
 * 这两个函数是 C1/C2/H1 修复的核心，被班级列表、导出、排课等多处调用
 */
import { describe, it, expect, vi } from 'vitest';

// Mock prisma（模块加载依赖）
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));

const { isClassMatchPlan, findBestMatchPlan } = await import('../plan.service.js');

// ──────────────────────────────────────────────
// isClassMatchPlan
// ──────────────────────────────────────────────
describe('isClassMatchPlan', () => {
  describe('自定义方案匹配', () => {
    it('班级 custom_plan_id 与方案 id 匹配时应返回 true', () => {
      const cls = { custom_plan_id: 10, major_id: 1, training_level_id: 2 };
      const plan = { id: 10, major_id: 1, training_level_id: null };
      expect(isClassMatchPlan(cls, plan)).toBe(true);
    });

    it('班级 custom_plan_id 与方案 id 不匹配时应返回 false', () => {
      const cls = { custom_plan_id: 10, major_id: 1, training_level_id: 2 };
      const plan = { id: 20, major_id: 1, training_level_id: null };
      expect(isClassMatchPlan(cls, plan)).toBe(false);
    });

    it('有自定义方案的班级不应走专业/层次匹配', () => {
      const cls = { custom_plan_id: 10, major_id: 1, training_level_id: 2 };
      const plan = { id: 20, major_id: 1, training_level_id: 2 }; // 专业和层次都匹配，但 id 不同
      expect(isClassMatchPlan(cls, plan)).toBe(false);
    });
  });

  describe('无自定义方案时的专业匹配', () => {
    it('专业 ID 匹配时应返回 true', () => {
      const cls = { custom_plan_id: null, major_id: 1, training_level_id: 2 };
      const plan = { id: 10, major_id: 1, training_level_id: null };
      expect(isClassMatchPlan(cls, plan)).toBe(true);
    });

    it('专业 ID 不匹配时应返回 false', () => {
      const cls = { custom_plan_id: null, major_id: 1, training_level_id: 2 };
      const plan = { id: 10, major_id: 99, training_level_id: null };
      expect(isClassMatchPlan(cls, plan)).toBe(false);
    });
  });

  describe('无自定义方案时的层次匹配', () => {
    it('层次 ID 匹配时应返回 true', () => {
      const cls = { custom_plan_id: null, major_id: 1, training_level_id: 2 };
      const plan = { id: 10, major_id: null, training_level_id: 2 };
      expect(isClassMatchPlan(cls, plan)).toBe(true);
    });

    it('层次 ID 不匹配时应返回 false', () => {
      const cls = { custom_plan_id: null, major_id: 1, training_level_id: 2 };
      const plan = { id: 10, major_id: null, training_level_id: 99 };
      expect(isClassMatchPlan(cls, plan)).toBe(false);
    });
  });

  describe('null 值守卫（防 null===null 误匹配）', () => {
    it('班级和方案的 major_id 都为 null 时不应匹配', () => {
      const cls = { custom_plan_id: null, major_id: null, training_level_id: null };
      const plan = { id: 10, major_id: null, training_level_id: null };
      expect(isClassMatchPlan(cls, plan)).toBe(false);
    });

    it('班级无 major_id 而方案有 major_id 时不应匹配', () => {
      const cls = { custom_plan_id: null, major_id: null, training_level_id: 2 };
      const plan = { id: 10, major_id: 1, training_level_id: null };
      expect(isClassMatchPlan(cls, plan)).toBe(false);
    });

    it('方案无 major_id 而班级有 major_id 时不应匹配', () => {
      const cls = { custom_plan_id: null, major_id: 1, training_level_id: null };
      const plan = { id: 10, major_id: null, training_level_id: null };
      expect(isClassMatchPlan(cls, plan)).toBe(false);
    });
  });
});

// ──────────────────────────────────────────────
// findBestMatchPlan
// ──────────────────────────────────────────────
describe('findBestMatchPlan', () => {
  const plans = [
    { id: 1, major_id: null, training_level_id: 10 }, // 层次方案 A
    { id: 2, major_id: 5, training_level_id: null }, // 专业方案 B
    { id: 3, major_id: 6, training_level_id: null }, // 专业方案 C
    { id: 4, major_id: null, training_level_id: 11 }, // 层次方案 D
  ];

  describe('自定义方案优先', () => {
    it('有 classPlanMap 且 custom_plan_id 匹配时应返回自定义方案', () => {
      const cls = { id: 100, custom_plan_id: 3, major_id: 5, training_level_id: 10 };
      const classPlanMap = new Map([[100, plans[2]]]); // id=3
      const result = findBestMatchPlan(cls, plans, classPlanMap);
      expect(result).not.toBeNull();
      expect(result.id).toBe(3);
    });

    it('无 classPlanMap 时应自动从 matchingPlans 中查找并返回自定义方案（消除 footgun）', () => {
      const cls = { id: 100, custom_plan_id: 3, major_id: 5, training_level_id: 10 };
      const result = findBestMatchPlan(cls, plans);
      // Map 缺失时回退到 matchingPlans 查找，避免静默返回 null
      expect(result).not.toBeNull();
      expect(result.id).toBe(3);
    });

    it('无 classPlanMap 且 matchingPlans 中也找不到 custom_plan_id 时才返回 null', () => {
      const cls = { id: 100, custom_plan_id: 999, major_id: 5, training_level_id: 10 };
      const result = findBestMatchPlan(cls, plans);
      // custom_plan_id 设置但找不到对应方案时，major/level 匹配被 !cls.custom_plan_id 守卫跳过，返回 null
      expect(result).toBeNull();
    });
  });

  describe('专业匹配优先于层次匹配', () => {
    it('同时有专业和层次匹配时应返回专业方案', () => {
      const cls = { custom_plan_id: null, major_id: 5, training_level_id: 10 };
      const result = findBestMatchPlan(cls, plans);
      expect(result).not.toBeNull();
      expect(result.id).toBe(2); // 专业方案，不是层次方案
    });

    it('只有层次匹配时应返回层次方案', () => {
      const cls = { custom_plan_id: null, major_id: 99, training_level_id: 11 };
      const result = findBestMatchPlan(cls, plans);
      expect(result).not.toBeNull();
      expect(result.id).toBe(4); // 层次方案 D
    });

    it('只有专业匹配时应返回专业方案', () => {
      const cls = { custom_plan_id: null, major_id: 6, training_level_id: 99 };
      const result = findBestMatchPlan(cls, plans);
      expect(result).not.toBeNull();
      expect(result.id).toBe(3); // 专业方案 C
    });

    it('无任何匹配时应返回 null', () => {
      const cls = { custom_plan_id: null, major_id: 99, training_level_id: 99 };
      const result = findBestMatchPlan(cls, plans);
      expect(result).toBeNull();
    });
  });

  describe('自定义方案与班级专业/层次不同（特殊方案场景）', () => {
    // 模拟：班级专业=133（烹饪），但自定义方案专业=149（艺术设计）
    const specialPlans = [
      { id: 11, major_id: 149, training_level_id: null }, // 艺术设计（与班级专业不同）
      { id: 9, major_id: null, training_level_id: 35 }, // 大专层次方案
    ];

    it('班级有 custom_plan_id 指向专业不同的方案时，应通过 classPlanMap 正确匹配', () => {
      const cls = { id: 823, custom_plan_id: 11, major_id: 133, training_level_id: 33 };
      const classPlanMap = new Map([[823, specialPlans[0]]]); // 方案 11
      const result = findBestMatchPlan(cls, specialPlans, classPlanMap);
      expect(result).not.toBeNull();
      expect(result.id).toBe(11);
    });

    it('班级有 custom_plan_id 但 matchingPlans 中不含该方案时，应回退查找并找到', () => {
      const cls = { id: 823, custom_plan_id: 11, major_id: 133, training_level_id: 33 };
      // matchingPlans 包含方案 11（修复后通过 customPlanIds 纳入）
      const result = findBestMatchPlan(cls, specialPlans);
      expect(result).not.toBeNull();
      expect(result.id).toBe(11);
    });

    it('班级有 custom_plan_id 且 matchingPlans 为空时，应返回 null', () => {
      const cls = { id: 823, custom_plan_id: 11, major_id: 133, training_level_id: 33 };
      const result = findBestMatchPlan(cls, []);
      expect(result).toBeNull();
    });
  });

  describe('null 值边界', () => {
    it('班级 major_id 和 training_level_id 都为 null 时应返回 null', () => {
      const cls = { custom_plan_id: null, major_id: null, training_level_id: null };
      expect(findBestMatchPlan(cls, plans)).toBeNull();
    });

    it('空方案列表应返回 null', () => {
      const cls = { custom_plan_id: null, major_id: 5, training_level_id: 10 };
      expect(findBestMatchPlan(cls, [])).toBeNull();
    });
  });
});
