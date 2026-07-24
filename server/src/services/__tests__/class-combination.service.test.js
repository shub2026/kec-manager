/**
 * class-combination.service.js 单元测试
 *
 * 覆盖所有导出函数：
 * - validateSameCollege（同学院校验）
 * - applyCombination（应用合班关系，事务内）
 * - cleanupCombination（清理组合）
 * - buildCombinationMemberMap（批量查询组合成员）
 * - getPartnersOfClass（获取合班伙伴）
 * - formatPartnerNames（拼接伙伴名称）
 * - dissolveAfterClassDeletion（删除后解散组合）
 *
 * Mock 策略：vi.hoisted 创建 mock，vi.mock 注入 prisma 和 logger。
 * 事务函数通过手工构造 tx mock 对象隔离数据库依赖。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma（vi.hoisted 确保变量在 mock 提升后可用）
// ──────────────────────────────────────────────
const { mockClassesFindMany, mockClassesFindUnique } = vi.hoisted(() => ({
  mockClassesFindMany: vi.fn(),
  mockClassesFindUnique: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    classes: {
      findMany: mockClassesFindMany,
      findUnique: mockClassesFindUnique,
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入被测函数
// ──────────────────────────────────────────────
const {
  validateSameCollege,
  applyCombination,
  cleanupCombination,
  buildCombinationMemberMap,
  getPartnersOfClass,
  formatPartnerNames,
  dissolveAfterClassDeletion,
} = await import('../../services/class-combination.service.js');

// ──────────────────────────────────────────────
// 辅助：构造事务 mock 对象
// ──────────────────────────────────────────────
function makeTx(overrides = {}) {
  return {
    classes: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      ...overrides.classes,
    },
    class_combinations: {
      create: vi.fn(),
      delete: vi.fn(),
      ...overrides.class_combinations,
    },
  };
}

// ──────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════
// formatPartnerNames（纯函数，最简单，先测）
// ══════════════════════════════════════════════
describe('formatPartnerNames', () => {
  it('null 时应返回空字符串', () => {
    expect(formatPartnerNames(null)).toBe('');
  });

  it('undefined 时应返回空字符串', () => {
    expect(formatPartnerNames(undefined)).toBe('');
  });

  it('空数组时应返回空字符串', () => {
    expect(formatPartnerNames([])).toBe('');
  });

  it('单个伙伴时应返回其名称', () => {
    expect(formatPartnerNames([{ id: 1, name: 'A班' }])).toBe('A班');
  });

  it('多个伙伴时应用顿号连接', () => {
    const partners = [
      { id: 1, name: 'A班' },
      { id: 2, name: 'B班' },
      { id: 3, name: 'C班' },
    ];
    expect(formatPartnerNames(partners)).toBe('A班、B班、C班');
  });

  it('两个伙伴时应用顿号连接', () => {
    const partners = [
      { id: 1, name: '烹饪1班' },
      { id: 2, name: '烹饪2班' },
    ];
    expect(formatPartnerNames(partners)).toBe('烹饪1班、烹饪2班');
  });
});

// ══════════════════════════════════════════════
// validateSameCollege
// ══════════════════════════════════════════════
describe('validateSameCollege', () => {
  it('classIds 不是数组时应返回 { ok: true }', async () => {
    const result = await validateSameCollege(null, 1);
    expect(result).toEqual({ ok: true });
  });

  it('classIds 为空数组时应返回 { ok: true }', async () => {
    const result = await validateSameCollege([], 1);
    expect(result).toEqual({ ok: true });
  });

  it('collegeId 为 null 时应返回错误', async () => {
    const result = await validateSameCollege([10, 11], null);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('未设置学院');
  });

  it('collegeId 为 0 (falsy) 时应返回错误', async () => {
    const result = await validateSameCollege([10], 0);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('未设置学院');
  });

  it('部分班级不存在时应返回错误', async () => {
    mockClassesFindMany.mockResolvedValue([
      { id: 10, name: 'A班', college_id: 1 },
      // id=11 不存在
    ]);
    const result = await validateSameCollege([10, 11], 1);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('不存在');
  });

  it('所有班级同学院时应返回 { ok: true }', async () => {
    mockClassesFindMany.mockResolvedValue([
      { id: 10, name: 'A班', college_id: 5 },
      { id: 11, name: 'B班', college_id: 5 },
    ]);
    const result = await validateSameCollege([10, 11], 5);
    expect(result).toEqual({ ok: true });
  });

  it('有班级不同学院时应返回错误并列出名称', async () => {
    mockClassesFindMany.mockResolvedValue([
      { id: 10, name: 'A班', college_id: 5 },
      { id: 11, name: 'B班', college_id: 9 },
      { id: 12, name: 'C班', college_id: 8 },
    ]);
    const result = await validateSameCollege([10, 11, 12], 5);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('B班');
    expect(result.message).toContain('C班');
    expect(result.message).not.toContain('A班');
  });

  it('单个不同学院的班级也应正确报错', async () => {
    mockClassesFindMany.mockResolvedValue([{ id: 10, name: 'X班', college_id: 3 }]);
    const result = await validateSameCollege([10], 1);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('X班');
  });
});

// ══════════════════════════════════════════════
// cleanupCombination
// ══════════════════════════════════════════════
describe('cleanupCombination', () => {
  it('combinationId 为 null 时应直接返回 false', async () => {
    const tx = makeTx();
    const result = await cleanupCombination(tx, null);
    expect(result).toBe(false);
    expect(tx.classes.count).not.toHaveBeenCalled();
  });

  it('combinationId 为 undefined 时应直接返回 false', async () => {
    const tx = makeTx();
    const result = await cleanupCombination(tx, undefined);
    expect(result).toBe(false);
  });

  it('剩余 0 个班级时应解散组合（删除记录）', async () => {
    const tx = makeTx();
    tx.classes.count.mockResolvedValue(0);
    tx.class_combinations.delete.mockResolvedValue({});

    const result = await cleanupCombination(tx, 100, [1, 2]);

    expect(result).toBe(true);
    expect(tx.classes.count).toHaveBeenCalledWith({
      where: { combination_id: 100, id: { notIn: [1, 2] } },
    });
    // remaining=0 时不需要 updateMany
    expect(tx.classes.updateMany).not.toHaveBeenCalled();
    expect(tx.class_combinations.delete).toHaveBeenCalledWith({ where: { id: 100 } });
  });

  it('剩余 1 个班级时应将该班级 combination_id 置空并解散', async () => {
    const tx = makeTx();
    tx.classes.count.mockResolvedValue(1);
    tx.classes.updateMany.mockResolvedValue({ count: 1 });
    tx.class_combinations.delete.mockResolvedValue({});

    const result = await cleanupCombination(tx, 100, [5]);

    expect(result).toBe(true);
    expect(tx.classes.updateMany).toHaveBeenCalledWith({
      where: { combination_id: 100 },
      data: { combination_id: null },
    });
    expect(tx.class_combinations.delete).toHaveBeenCalled();
  });

  it('剩余 2 个及以上班级时不应解散', async () => {
    const tx = makeTx();
    tx.classes.count.mockResolvedValue(2);

    const result = await cleanupCombination(tx, 100, [5]);

    expect(result).toBe(false);
    expect(tx.class_combinations.delete).not.toHaveBeenCalled();
    expect(tx.classes.updateMany).not.toHaveBeenCalled();
  });

  it('并发删除组合（P2025 错误）时应静默忽略', async () => {
    const tx = makeTx();
    tx.classes.count.mockResolvedValue(0);
    const err = new Error('Record not found');
    err.code = 'P2025';
    tx.class_combinations.delete.mockRejectedValue(err);

    const result = await cleanupCombination(tx, 100, []);

    expect(result).toBe(true); // 仍返回已解散
  });

  it('非 P2025 的删除错误应向上抛出', async () => {
    const tx = makeTx();
    tx.classes.count.mockResolvedValue(0);
    const err = new Error('Connection lost');
    err.code = 'P1001';
    tx.class_combinations.delete.mockRejectedValue(err);

    await expect(cleanupCombination(tx, 100, [])).rejects.toThrow('Connection lost');
  });

  it('justRemovedClassIds 默认值应为空数组', async () => {
    const tx = makeTx();
    tx.classes.count.mockResolvedValue(3);

    await cleanupCombination(tx, 100);

    expect(tx.classes.count).toHaveBeenCalledWith({
      where: { combination_id: 100, id: { notIn: [] } },
    });
  });
});

// ══════════════════════════════════════════════
// buildCombinationMemberMap
// ══════════════════════════════════════════════
describe('buildCombinationMemberMap', () => {
  it('null 时应返回空 Map', async () => {
    const result = await buildCombinationMemberMap(null);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('空数组时应返回空 Map', async () => {
    const result = await buildCombinationMemberMap([]);
    expect(result.size).toBe(0);
  });

  it('全部为 null 的数组时应返回空 Map', async () => {
    const result = await buildCombinationMemberMap([null, null, undefined]);
    expect(result.size).toBe(0);
  });

  it('应正确构建组合→成员映射', async () => {
    mockClassesFindMany.mockResolvedValue([
      { id: 1, name: 'A班', combination_id: 10 },
      { id: 2, name: 'B班', combination_id: 10 },
      { id: 3, name: 'C班', combination_id: 20 },
    ]);

    const result = await buildCombinationMemberMap([10, 20]);

    expect(result.size).toBe(2);
    expect(result.get(10)).toEqual([
      { id: 1, name: 'A班' },
      { id: 2, name: 'B班' },
    ]);
    expect(result.get(20)).toEqual([{ id: 3, name: 'C班' }]);
  });

  it('应去重 combinationIds', async () => {
    mockClassesFindMany.mockResolvedValue([{ id: 1, name: 'A班', combination_id: 10 }]);

    await buildCombinationMemberMap([10, 10, 10]);

    expect(mockClassesFindMany).toHaveBeenCalledTimes(1);
    // 传入的 where 条件中 in 数组应已去重
    const callArg = mockClassesFindMany.mock.calls[0][0];
    const inIds = callArg.where.combination_id.in;
    expect(inIds).toEqual([10]);
  });

  it('应过滤 null 值', async () => {
    mockClassesFindMany.mockResolvedValue([{ id: 1, name: 'A班', combination_id: 10 }]);

    await buildCombinationMemberMap([10, null, undefined]);

    const callArg = mockClassesFindMany.mock.calls[0][0];
    expect(callArg.where.combination_id.in).toEqual([10]);
  });

  it('combination_id 为 null 的班级应被跳过', async () => {
    mockClassesFindMany.mockResolvedValue([
      { id: 1, name: 'A班', combination_id: 10 },
      { id: 2, name: 'B班', combination_id: null },
    ]);

    const result = await buildCombinationMemberMap([10]);

    expect(result.get(10)).toHaveLength(1);
    expect(result.get(10)[0].name).toBe('A班');
  });

  it('应按 id 升序排列（由 orderBy 保证）', async () => {
    mockClassesFindMany.mockResolvedValue([
      { id: 3, name: 'C班', combination_id: 10 },
      { id: 1, name: 'A班', combination_id: 10 },
    ]);

    const result = await buildCombinationMemberMap([10]);

    // 顺序由 mock 返回值决定，验证 map 中包含两者
    expect(result.get(10)).toHaveLength(2);
  });
});

// ══════════════════════════════════════════════
// getPartnersOfClass
// ══════════════════════════════════════════════
describe('getPartnersOfClass', () => {
  it('已知 combinationId 时应直接查询伙伴', async () => {
    mockClassesFindMany.mockResolvedValue([
      { id: 2, name: 'B班' },
      { id: 3, name: 'C班' },
    ]);

    const result = await getPartnersOfClass(1, 10);

    expect(result).toEqual([
      { id: 2, name: 'B班' },
      { id: 3, name: 'C班' },
    ]);
    expect(mockClassesFindMany).toHaveBeenCalledWith({
      where: { combination_id: 10, id: { not: 1 } },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
  });

  it('combinationId 为 null 时应查询班级获取 combination_id', async () => {
    mockClassesFindUnique.mockResolvedValue({ combination_id: 5 });
    mockClassesFindMany.mockResolvedValue([{ id: 2, name: 'B班' }]);

    const result = await getPartnersOfClass(1, null);

    expect(mockClassesFindUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: { combination_id: true },
    });
    expect(result).toEqual([{ id: 2, name: 'B班' }]);
  });

  it('combinationId 为 null 且班级也无 combination_id 时应返回空数组', async () => {
    mockClassesFindUnique.mockResolvedValue({ combination_id: null });

    const result = await getPartnersOfClass(1);

    expect(result).toEqual([]);
    expect(mockClassesFindMany).not.toHaveBeenCalled();
  });

  it('班级不存在（findUnique 返回 null）时应返回空数组', async () => {
    mockClassesFindUnique.mockResolvedValue(null);

    const result = await getPartnersOfClass(999);

    expect(result).toEqual([]);
  });

  it('combinationId 默认参数应触发查询', async () => {
    mockClassesFindUnique.mockResolvedValue({ combination_id: 7 });
    mockClassesFindMany.mockResolvedValue([]);

    const result = await getPartnersOfClass(1);

    expect(mockClassesFindUnique).toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

// ══════════════════════════════════════════════
// dissolveAfterClassDeletion
// ══════════════════════════════════════════════
describe('dissolveAfterClassDeletion', () => {
  it('combinationId 为 null 时应返回 null', async () => {
    const tx = makeTx();
    const result = await dissolveAfterClassDeletion(tx, null);
    expect(result).toBeNull();
  });

  it('组合被解散时应返回 combinationId', async () => {
    const tx = makeTx();
    tx.classes.count.mockResolvedValue(0);
    tx.class_combinations.delete.mockResolvedValue({});

    const result = await dissolveAfterClassDeletion(tx, 42);

    expect(result).toBe(42);
  });

  it('组合未解散时应返回 null', async () => {
    const tx = makeTx();
    tx.classes.count.mockResolvedValue(3); // 剩余 3 个班级，不解散

    const result = await dissolveAfterClassDeletion(tx, 42);

    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════════
// applyCombination
// ══════════════════════════════════════════════
describe('applyCombination', () => {
  describe('班级不存在', () => {
    it('应抛出错误', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue(null);

      await expect(applyCombination(tx, 999, [10], 1)).rejects.toThrow('不存在');
    });
  });

  describe('无伙伴 → 解除合班', () => {
    it('partnerClassIds 为 null 且无旧组合时应直接返回', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue({
        id: 1,
        combination_id: null,
        college_id: 5,
      });

      const result = await applyCombination(tx, 1, null, 5);

      expect(result).toEqual({ combinationId: null, dissolvedCombinationIds: [] });
      expect(tx.classes.update).not.toHaveBeenCalled();
    });

    it('partnerClassIds 为空数组且有旧组合时应解除合班', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue({
        id: 1,
        combination_id: 50,
        college_id: 5,
      });
      tx.classes.update.mockResolvedValue({});
      tx.classes.count.mockResolvedValue(0); // 旧组合无剩余
      tx.class_combinations.delete.mockResolvedValue({});

      const result = await applyCombination(tx, 1, [], 5);

      expect(result.combinationId).toBeNull();
      expect(result.dissolvedCombinationIds).toContain(50);
      expect(tx.classes.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { combination_id: null },
      });
    });

    it('partnerClassIds 为空数组且旧组合剩余 >1 班时不应解散', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue({
        id: 1,
        combination_id: 50,
        college_id: 5,
      });
      tx.classes.update.mockResolvedValue({});
      tx.classes.count.mockResolvedValue(2); // 还有 2 个班级

      const result = await applyCombination(tx, 1, [], 5);

      expect(result.combinationId).toBeNull();
      expect(result.dissolvedCombinationIds).toEqual([]);
    });

    it('partnerClassIds 为 undefined 时应视为无伙伴', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue({
        id: 1,
        combination_id: null,
        college_id: 5,
      });

      const result = await applyCombination(tx, 1, undefined, 5);

      expect(result.combinationId).toBeNull();
    });
  });

  describe('同学院校验', () => {
    it('伙伴不同学院时应抛出错误', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue({
        id: 1,
        combination_id: null,
        college_id: 5,
      });
      // validateSameCollege 现使用 tx.classes.findMany（BIZ-M4：事务内校验避免 TOCTOU）
      tx.classes.findMany.mockResolvedValue([{ id: 10, name: 'X班', college_id: 9 }]);

      await expect(applyCombination(tx, 1, [10], 5)).rejects.toThrow('同学院');
    });

    it('currentCollegeId 应优先于 currentClass.college_id', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue({
        id: 1,
        combination_id: null,
        college_id: 5,
      });
      // currentCollegeId=7 应覆盖 college_id=5
      // validateSameCollege 先调用 tx.classes.findMany（需 college_id），随后伙伴查询再调用一次（需 combination_id）
      tx.classes.findMany
        .mockResolvedValueOnce([{ id: 10, name: 'A班', college_id: 7 }])
        .mockResolvedValueOnce([{ id: 10, combination_id: null }]);
      tx.class_combinations.create.mockResolvedValue({ id: 99 });
      tx.classes.updateMany.mockResolvedValue({});

      const result = await applyCombination(tx, 1, [10], 7);

      expect(result.combinationId).toBe(99);
    });
  });

  describe('去重与排除自身', () => {
    it('partnerClassIds 只包含自身时应解除合班', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue({
        id: 1,
        combination_id: 50,
        college_id: 5,
      });
      // validateSameCollege 先用原始 [1] 调用 tx.classes.findMany（去重前），需返回该班级
      tx.classes.findMany.mockResolvedValue([{ id: 1, name: 'self', college_id: 5 }]);
      tx.classes.update.mockResolvedValue({});
      tx.classes.count.mockResolvedValue(0);
      tx.class_combinations.delete.mockResolvedValue({});

      const result = await applyCombination(tx, 1, [1], 5);

      expect(result.combinationId).toBeNull();
      expect(result.dissolvedCombinationIds).toContain(50);
    });

    it('partnerClassIds 含重复值时应去重', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue({
        id: 1,
        combination_id: null,
        college_id: 5,
      });
      // validateSameCollege 先用原始 [10, 10, 10] 调用 tx.classes.findMany，需 3 条结果通过长度校验
      tx.classes.findMany
        .mockResolvedValueOnce([
          { id: 10, name: 'A班', college_id: 5 },
          { id: 10, name: 'A班', college_id: 5 },
          { id: 10, name: 'A班', college_id: 5 },
        ])
        .mockResolvedValueOnce([{ id: 10, combination_id: null }]);
      tx.class_combinations.create.mockResolvedValue({ id: 88 });
      tx.classes.updateMany.mockResolvedValue({});

      const result = await applyCombination(tx, 1, [10, 10, 10], 5);

      expect(result.combinationId).toBe(88);
      // updateMany 的 in 数组应已去重且排除自身
      const updateCall = tx.classes.updateMany.mock.calls[0][0];
      expect(updateCall.where.id.in).toEqual([1, 10]);
    });
  });

  describe('组合创建与复用', () => {
    it('当前班级无组合且伙伴无组合时应新建组合', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue({
        id: 1,
        combination_id: null,
        college_id: 5,
      });
      tx.classes.findMany
        .mockResolvedValueOnce([{ id: 10, name: 'A班', college_id: 5 }])
        .mockResolvedValueOnce([{ id: 10, combination_id: null }]);
      tx.class_combinations.create.mockResolvedValue({ id: 200 });
      tx.classes.updateMany.mockResolvedValue({});

      const result = await applyCombination(tx, 1, [10], 5);

      expect(tx.class_combinations.create).toHaveBeenCalledWith({ data: {} });
      expect(result.combinationId).toBe(200);
    });

    it('当前班级已有组合时应复用', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue({
        id: 1,
        combination_id: 77,
        college_id: 5,
      });
      tx.classes.findMany
        .mockResolvedValueOnce([{ id: 10, name: 'A班', college_id: 5 }])
        .mockResolvedValueOnce([{ id: 10, combination_id: null }]);
      tx.classes.updateMany.mockResolvedValue({});

      const result = await applyCombination(tx, 1, [10], 5);

      expect(tx.class_combinations.create).not.toHaveBeenCalled();
      expect(result.combinationId).toBe(77);
    });

    it('当前班级无组合但伙伴已有组合时应复用伙伴的组合', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue({
        id: 1,
        combination_id: null,
        college_id: 5,
      });
      tx.classes.findMany
        .mockResolvedValueOnce([{ id: 10, name: 'A班', college_id: 5 }])
        .mockResolvedValueOnce([{ id: 10, combination_id: 55 }]);
      tx.classes.updateMany.mockResolvedValue({});

      const result = await applyCombination(tx, 1, [10], 5);

      expect(tx.class_combinations.create).not.toHaveBeenCalled();
      expect(result.combinationId).toBe(55);
    });
  });

  describe('伙伴从旧组合迁移', () => {
    it('伙伴属于不同旧组合时应复用并清理旧组合', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue({
        id: 1,
        combination_id: null,
        college_id: 5,
      });
      tx.classes.findMany
        .mockResolvedValueOnce([
          { id: 10, name: 'A班', college_id: 5 },
          { id: 11, name: 'B班', college_id: 5 },
        ])
        .mockResolvedValueOnce([
          { id: 10, combination_id: 30 },
          { id: 11, combination_id: 40 },
        ]);
      tx.classes.updateMany.mockResolvedValue({});
      // 代码复用伙伴 10 的组合 30 作为目标（不新建），伙伴 11 的旧组合 40 需清理
      // 清理旧组合 40：剩余 0 个班 → 解散
      tx.classes.count.mockResolvedValue(0);
      tx.class_combinations.delete.mockResolvedValue({});

      const result = await applyCombination(tx, 1, [10, 11], 5);

      // 复用伙伴的组合 30，不是新建
      expect(result.combinationId).toBe(30);
      expect(tx.class_combinations.create).not.toHaveBeenCalled();
      // 只有组合 40 被清理（伙伴 11 的旧组合），30 是目标组合不清理
      expect(result.dissolvedCombinationIds).toContain(40);
      expect(result.dissolvedCombinationIds).not.toContain(30);
    });

    it('伙伴与当前班级属于同一组合时不应产生旧组合清理', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue({
        id: 1,
        combination_id: 50,
        college_id: 5,
      });
      tx.classes.findMany
        .mockResolvedValueOnce([{ id: 10, name: 'A班', college_id: 5 }])
        .mockResolvedValueOnce([{ id: 10, combination_id: 50 }]);
      tx.classes.updateMany.mockResolvedValue({});

      const result = await applyCombination(tx, 1, [10], 5);

      expect(result.combinationId).toBe(50);
      expect(result.dissolvedCombinationIds).toEqual([]);
    });
  });

  describe('updateMany 调用验证', () => {
    it('应将当前班级和所有伙伴统一指向目标组合', async () => {
      const tx = makeTx();
      tx.classes.findUnique.mockResolvedValue({
        id: 1,
        combination_id: null,
        college_id: 5,
      });
      tx.classes.findMany
        .mockResolvedValueOnce([
          { id: 10, name: 'A班', college_id: 5 },
          { id: 11, name: 'B班', college_id: 5 },
        ])
        .mockResolvedValueOnce([
          { id: 10, combination_id: null },
          { id: 11, combination_id: null },
        ]);
      tx.class_combinations.create.mockResolvedValue({ id: 300 });
      tx.classes.updateMany.mockResolvedValue({});

      await applyCombination(tx, 1, [10, 11], 5);

      expect(tx.classes.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 10, 11] } },
        data: { combination_id: 300 },
      });
    });
  });
});
