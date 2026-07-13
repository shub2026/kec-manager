/**
 * class.service.js 单元测试
 *
 * class.service.js 是 semester.service.js 的 re-export 文件，
 * 验证 getActiveClassFilter 和 invalidateDurationCache 可通过 class.service.js 正确导入并使用。
 *
 * 覆盖：
 * - getActiveClassFilter：有/无 semesterInfo、缓存行为、null 降级
 * - invalidateDurationCache：缓存清除后下次调用重新查询
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma
const mockPrisma = {
  system_settings: { findUnique: vi.fn() },
  classes: { findMany: vi.fn() },
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// 从 class.service.js 导入（re-export）
const { getActiveClassFilter, invalidateDurationCache } =
  await import('../../services/class.service.js');

// 同时导入 invalidateSemesterCache 用于清理
const { invalidateSemesterCache, parseSemester } =
  await import('../../services/semester.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  invalidateSemesterCache();
  invalidateDurationCache();
});

// ════════════════════════════════════════════════
// getActiveClassFilter (via class.service.js re-export)
// ════════════════════════════════════════════════
describe('getActiveClassFilter (re-export from class.service.js)', () => {
  it('传入 semesterInfo 时应构建 OR 条件', async () => {
    mockPrisma.classes.findMany.mockResolvedValue([{ duration_years: 3 }, { duration_years: 5 }]);

    const sem = parseSemester('2025-2026-1');
    const filter = await getActiveClassFilter(sem);

    expect(filter).toHaveProperty('OR');
    expect(filter.OR).toHaveLength(2);
    // duration_years=3: enrollment_year gte=2023, lte=2025
    expect(filter.OR[0]).toEqual({
      duration_years: 3,
      is_left_school: false,
      enrollment_year: { gte: 2023, lte: 2025 },
    });
    // duration_years=5: enrollment_year gte=2021, lte=2025
    expect(filter.OR[1]).toEqual({
      duration_years: 5,
      is_left_school: false,
      enrollment_year: { gte: 2021, lte: 2025 },
    });
  });

  it('semesterInfo=null 且 getCurrentSemesterInfo 返回 null 应返回降级条件', async () => {
    // getCurrentSemesterInfo returns null when no system_setting found
    mockPrisma.system_settings.findUnique.mockResolvedValue(null);

    const filter = await getActiveClassFilter(null);

    expect(filter).toEqual({ is_left_school: false });
    // classes.findMany should not be called in the null fallback path
    expect(mockPrisma.classes.findMany).not.toHaveBeenCalled();
  });

  it('semesterInfo=null 且 getCurrentSemesterInfo 有值应使用全局学期', async () => {
    mockPrisma.system_settings.findUnique.mockResolvedValue({ value: '2025-2026-2' });
    mockPrisma.classes.findMany.mockResolvedValue([{ duration_years: 4 }]);

    const filter = await getActiveClassFilter(null);

    expect(filter).toHaveProperty('OR');
    expect(filter.OR).toHaveLength(1);
    // startYear=2025, duration=4: enrollment_year gte=2022, lte=2025
    expect(filter.OR[0]).toEqual({
      duration_years: 4,
      is_left_school: false,
      enrollment_year: { gte: 2022, lte: 2025 },
    });
  });

  it('duration_years 查询应过滤 null 值', async () => {
    mockPrisma.classes.findMany.mockResolvedValue([
      { duration_years: 3 },
      { duration_years: null },
      { duration_years: 2 },
    ]);

    const sem = parseSemester('2025-2026-1');
    const filter = await getActiveClassFilter(sem);

    // null duration should be filtered out
    expect(filter.OR).toHaveLength(2);
  });

  it('缓存命中：连续两次调用不重复查询 duration_years', async () => {
    mockPrisma.classes.findMany.mockResolvedValue([{ duration_years: 3 }]);

    const sem = parseSemester('2025-2026-1');
    await getActiveClassFilter(sem);
    await getActiveClassFilter(sem);

    // findMany for duration_years should only be called once
    expect(mockPrisma.classes.findMany).toHaveBeenCalledTimes(1);
  });

  it('invalidateDurationCache 后再次调用应重新查询', async () => {
    mockPrisma.classes.findMany.mockResolvedValue([{ duration_years: 3 }]);

    const sem = parseSemester('2025-2026-1');
    await getActiveClassFilter(sem);
    expect(mockPrisma.classes.findMany).toHaveBeenCalledTimes(1);

    invalidateDurationCache();

    await getActiveClassFilter(sem);
    expect(mockPrisma.classes.findMany).toHaveBeenCalledTimes(2);
  });
});

// ════════════════════════════════════════════════
// invalidateDurationCache (via class.service.js re-export)
// ════════════════════════════════════════════════
describe('invalidateDurationCache (re-export from class.service.js)', () => {
  it('应为可调用函数', () => {
    expect(typeof invalidateDurationCache).toBe('function');
  });

  it('调用后不应抛出异常', () => {
    expect(() => invalidateDurationCache()).not.toThrow();
  });

  it('多次调用不应抛出异常', () => {
    expect(() => {
      invalidateDurationCache();
      invalidateDurationCache();
      invalidateDurationCache();
    }).not.toThrow();
  });
});

// ════════════════════════════════════════════════
// Re-export 完整性验证
// ════════════════════════════════════════════════
describe('class.service.js re-export 完整性', () => {
  it('getActiveClassFilter 应为函数', () => {
    expect(typeof getActiveClassFilter).toBe('function');
  });

  it('invalidateDurationCache 应为函数', () => {
    expect(typeof invalidateDurationCache).toBe('function');
  });
});
