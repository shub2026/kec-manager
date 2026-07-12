/**
 * autoFixSortOrder 单元测试
 *
 * 覆盖场景：
 * - 重复排序值超过 50% 阈值 → 触发修复
 * - 重复排序值低于 50% 阈值 → 不修复
 * - 修复后重新分配顺序值
 * - TTL 缓存防止频繁运行
 * - 空列表 / 单元素 → no-op
 * - 异常处理 → 返回 false
 * - buildUpdateData / normalizeSortOrder / getNextSortOrder 辅助函数
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  majors: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  courses: {
    findMany: vi.fn(),
    update: vi.fn(),
    aggregate: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

vi.mock('../logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const {
  autoFixSortOrder,
  invalidateSortOrderCache,
  getNextSortOrder,
  normalizeSortOrder,
  buildUpdateData,
} = await import('../sort.js');

// ════════════════════════════════════════════════
// autoFixSortOrder
// ════════════════════════════════════════════════
describe('autoFixSortOrder', () => {
  // 每个测试递增 10 分钟，确保上一个测试的 sortCache 条目已过期（TTL = 5分钟）
  let testTimeBase = new Date('2030-01-01T00:00:00Z').getTime();

  beforeEach(() => {
    vi.clearAllMocks();
    testTimeBase += 10 * 60 * 1000; // +10 min per test
    vi.useFakeTimers({ now: testTimeBase });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('空列表 → no-op，返回 false', async () => {
    mockPrisma.majors.findMany.mockResolvedValue([]);

    const result = await autoFixSortOrder('majors');
    expect(result).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('单元素 → no-op，返回 false', async () => {
    mockPrisma.majors.findMany.mockResolvedValue([{ id: 1, sort_order: 1 }]);

    const result = await autoFixSortOrder('majors');
    expect(result).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('全部排序值相同（100% 重复） → 触发修复', async () => {
    mockPrisma.majors.findMany.mockResolvedValue([
      { id: 1, sort_order: 5 },
      { id: 2, sort_order: 5 },
      { id: 3, sort_order: 5 },
    ]);
    mockPrisma.majors.update.mockResolvedValue({});
    mockPrisma.$transaction.mockResolvedValue([]);

    const result = await autoFixSortOrder('majors');
    expect(result).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // 验证 update 被调用了 3 次，sort_order 分别为 1, 2, 3
    expect(mockPrisma.majors.update).toHaveBeenCalledTimes(3);
    expect(mockPrisma.majors.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { sort_order: 1 },
    });
    expect(mockPrisma.majors.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { sort_order: 2 },
    });
    expect(mockPrisma.majors.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { sort_order: 3 },
    });
  });

  it('重复比例超过 50% → 触发修复', async () => {
    // 5 个元素，2 个唯一值 → uniqueValues.size=2 < items.length*0.5=2.5 → needsFix=true
    mockPrisma.majors.findMany.mockResolvedValue([
      { id: 1, sort_order: 1 },
      { id: 2, sort_order: 1 },
      { id: 3, sort_order: 1 },
      { id: 4, sort_order: 2 },
      { id: 5, sort_order: 2 },
    ]);
    mockPrisma.majors.update.mockResolvedValue({});
    mockPrisma.$transaction.mockResolvedValue([]);

    const result = await autoFixSortOrder('majors');
    expect(result).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('重复比例低于 50% → 不修复', async () => {
    // 4 个元素，3 个唯一值 → uniqueValues.size=3, 3 < 4*0.5=2 → false, 且 3 !== 1 → needsFix=false
    mockPrisma.majors.findMany.mockResolvedValue([
      { id: 1, sort_order: 1 },
      { id: 2, sort_order: 2 },
      { id: 3, sort_order: 3 },
      { id: 4, sort_order: 3 },
    ]);

    const result = await autoFixSortOrder('majors');
    expect(result).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('TTL 缓存 → 第二次调用不重复执行', async () => {
    mockPrisma.majors.findMany.mockResolvedValue([
      { id: 1, sort_order: 1 },
      { id: 2, sort_order: 1 },
    ]);
    mockPrisma.majors.update.mockResolvedValue({});
    mockPrisma.$transaction.mockResolvedValue([]);

    // 第一次调用（触发修复）
    await autoFixSortOrder('majors');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

    // 第二次调用（TTL 内）→ 直接返回 false，不查询数据库
    const result = await autoFixSortOrder('majors');
    expect(result).toBe(false);
    // findMany 没有被第二次调用
    expect(mockPrisma.majors.findMany).toHaveBeenCalledTimes(1);
  });

  it('TTL 过期后 → 重新执行', async () => {
    mockPrisma.majors.findMany.mockResolvedValue([
      { id: 1, sort_order: 1 },
      { id: 2, sort_order: 1 },
    ]);
    mockPrisma.majors.update.mockResolvedValue({});
    mockPrisma.$transaction.mockResolvedValue([]);

    // 第一次调用
    await autoFixSortOrder('majors');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

    // 跳过 TTL（5分钟）
    vi.advanceTimersByTime(6 * 60 * 1000);

    mockPrisma.majors.findMany.mockResolvedValue([
      { id: 1, sort_order: 1 },
      { id: 2, sort_order: 1 },
    ]);

    // 第二次调用（TTL 已过期）
    await autoFixSortOrder('majors');
    expect(mockPrisma.majors.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('数据库异常 → 返回 false，不抛出错误', async () => {
    mockPrisma.majors.findMany.mockRejectedValue(new Error('DB connection lost'));

    const result = await autoFixSortOrder('majors');
    expect(result).toBe(false);
  });

  it('带 where 条件 → 传递到 findMany', async () => {
    mockPrisma.majors.findMany.mockResolvedValue([]);

    await autoFixSortOrder('majors', { type: 'public' });
    expect(mockPrisma.majors.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: 'public' },
      })
    );
  });
});

// ════════════════════════════════════════════════
// buildUpdateData
// ════════════════════════════════════════════════
describe('buildUpdateData', () => {
  it('只提取允许字段', () => {
    const data = { name: 'test', code: 'T1', secret: 'hidden' };
    const result = buildUpdateData(data, ['name', 'code']);
    expect(result).toEqual({ name: 'test', code: 'T1' });
    expect(result).not.toHaveProperty('secret');
  });

  it('sort_order 被强制转换为 Number', () => {
    const data = { name: 'test', sort_order: '42' };
    const result = buildUpdateData(data, ['name', 'sort_order']);
    expect(result.sort_order).toBe(42);
    expect(typeof result.sort_order).toBe('number');
  });

  it('undefined 字段不出现在结果中', () => {
    const data = { name: 'test' };
    const result = buildUpdateData(data, ['name', 'code', 'sort_order']);
    expect(result).toEqual({ name: 'test' });
    expect(result).not.toHaveProperty('code');
    expect(result).not.toHaveProperty('sort_order');
  });

  it('空对象 → 空结果', () => {
    const result = buildUpdateData({}, ['name', 'code']);
    expect(result).toEqual({});
  });
});

// ════════════════════════════════════════════════
// normalizeSortOrder
// ════════════════════════════════════════════════
describe('normalizeSortOrder', () => {
  it('有值时返回 Number 转换结果', () => {
    expect(normalizeSortOrder('5', 99)).toBe(5);
    expect(normalizeSortOrder(10, 99)).toBe(10);
  });

  it('undefined 时返回默认值', () => {
    expect(normalizeSortOrder(undefined, 99)).toBe(99);
  });
});

// ════════════════════════════════════════════════
// getNextSortOrder
// ════════════════════════════════════════════════
describe('getNextSortOrder', () => {
  it('返回 max + 1', async () => {
    mockPrisma.courses.aggregate.mockResolvedValue({ _max: { sort_order: 10 } });
    const result = await getNextSortOrder('courses');
    expect(result).toBe(11);
  });

  it('max 为 null 时返回 1', async () => {
    mockPrisma.courses.aggregate.mockResolvedValue({ _max: { sort_order: null } });
    const result = await getNextSortOrder('courses');
    expect(result).toBe(1);
  });
});

// ════════════════════════════════════════════════
// invalidateSortOrderCache
// ════════════════════════════════════════════════
describe('invalidateSortOrderCache', () => {
  it('传入 modelName 不抛错', () => {
    expect(() => invalidateSortOrderCache('majors')).not.toThrow();
  });

  it('不传参数不抛错', () => {
    expect(() => invalidateSortOrderCache()).not.toThrow();
  });
});
