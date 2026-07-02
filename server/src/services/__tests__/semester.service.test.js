/**
 * semester.service.js 单元测试
 *
 * 覆盖：
 * - parseSemester（纯函数）：YYYY-YYYY-N 解析与严格校验
 * - formatSemesterLabel（纯函数）：标签格式化（秋季用 startYear，春季用 endYear）
 * - calcClassSemester（纯函数）：班级相对学期序号计算与越界判定
 * - getCurrentSemesterInfo（异步，读 prisma.system_settings + 缓存）
 * - getSemesterInfoFromRequest（异步，query 优先，回退全局当前学期）
 * - getActiveClassFilter（异步，读 prisma.classes distinct duration_years + 缓存）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma（避免真实 PrismaClient 连接）
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    system_settings: { findUnique: vi.fn() },
    classes: { findMany: vi.fn() },
  },
}));

// Mock logger，避免 winston 文件/控制台副作用
vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const {
  parseSemester,
  formatSemesterLabel,
  calcClassSemester,
  getCurrentSemesterInfo,
  getSemesterInfoFromRequest,
  getActiveClassFilter,
  invalidateSemesterCache,
  invalidateDurationCache,
} = await import('../semester.service.js');

const { prisma } = await import('../../lib/prisma.js');

beforeEach(() => {
  vi.clearAllMocks();
  invalidateSemesterCache();
  invalidateDurationCache();
});

// ──────────────────────────────────────────────
// parseSemester
// ──────────────────────────────────────────────
describe('parseSemester', () => {
  describe('有效输入', () => {
    it('"2025-2026-1" 应解析为完整对象', () => {
      expect(parseSemester('2025-2026-1')).toEqual({
        startYear: 2025,
        endYear: 2026,
        semesterIndex: 1,
        raw: '2025-2026-1',
        label: '2025年秋季(第1学期)',
      });
    });

    it('"2025-2026-2" label 应为春季且使用 endYear', () => {
      expect(parseSemester('2025-2026-2').label).toBe('2026年春季(第2学期)');
    });

    it('前后空格应被 trim 后正常解析', () => {
      const r = parseSemester(' 2025-2026-1 ');
      expect(r).not.toBeNull();
      expect(r.raw).toBe('2025-2026-1');
      expect(r.startYear).toBe(2025);
      expect(r.semesterIndex).toBe(1);
    });
  });

  describe('无效输入返回 null', () => {
    it.each([
      ['空字符串', ''],
      ['null', null],
      ['undefined', undefined],
      ['数字', 2025],
      ['对象', {}],
    ])('%s 应返回 null', (_label, v) => {
      expect(parseSemester(v)).toBeNull();
    });

    it('semesterIndex 越界 (3) 应返回 null', () => {
      expect(parseSemester('2025-2026-3')).toBeNull();
    });

    it('semesterIndex 为 0 应返回 null', () => {
      expect(parseSemester('2025-2026-0')).toBeNull();
    });

    it('endYear !== startYear+1 应返回 null', () => {
      expect(parseSemester('2025-2024-1')).toBeNull();
    });

    it('小数 semesterIndex 应返回 null', () => {
      expect(parseSemester('2025-2026-1.5')).toBeNull();
    });

    it('杂尾字符串应返回 null', () => {
      expect(parseSemester('2025-2026-1abc')).toBeNull();
    });

    it('年份 < 2000 应返回 null', () => {
      expect(parseSemester('1999-2000-1')).toBeNull();
    });

    it('年份 > 2099 应返回 null', () => {
      expect(parseSemester('2100-2101-1')).toBeNull();
    });
  });
});

// ──────────────────────────────────────────────
// formatSemesterLabel
// ──────────────────────────────────────────────
describe('formatSemesterLabel', () => {
  it('(2025, 2026, 1) → "2025年秋季(第1学期)"', () => {
    expect(formatSemesterLabel(2025, 2026, 1)).toBe('2025年秋季(第1学期)');
  });

  it('(2025, 2026, 2) → "2026年春季(第2学期)"', () => {
    expect(formatSemesterLabel(2025, 2026, 2)).toBe('2026年春季(第2学期)');
  });
});

// ──────────────────────────────────────────────
// calcClassSemester
// ──────────────────────────────────────────────
describe('calcClassSemester', () => {
  describe('有效计算', () => {
    it.each([
      ['入学2024 学制3 学期2025-2026-1', { enrollment_year: 2024, duration_years: 3 }, '2025-2026-1', { grade: 2, currentSemesterNum: 3 }],
      ['入学2024 学制3 学期2025-2026-2', { enrollment_year: 2024, duration_years: 3 }, '2025-2026-2', { grade: 2, currentSemesterNum: 4 }],
      ['入学2025 学制3 学期2025-2026-1', { enrollment_year: 2025, duration_years: 3 }, '2025-2026-1', { grade: 1, currentSemesterNum: 1 }],
      ['入学2023 学制3 学期2025-2026-1（最后一学年）', { enrollment_year: 2023, duration_years: 3 }, '2025-2026-1', { grade: 3, currentSemesterNum: 5 }],
      ['入学2025 学制2 学期2025-2026-2', { enrollment_year: 2025, duration_years: 2 }, '2025-2026-2', { grade: 1, currentSemesterNum: 2 }],
      ['入学2024 学制5 学期2025-2026-1（5年制大专）', { enrollment_year: 2024, duration_years: 5 }, '2025-2026-1', { grade: 2, currentSemesterNum: 3 }],
      ['入学2021 学制5 学期2025-2026-2（最后一学期）', { enrollment_year: 2021, duration_years: 5 }, '2025-2026-2', { grade: 5, currentSemesterNum: 10 }],
    ])('%s', (_label, cls, semStr, expected) => {
      const sem = parseSemester(semStr);
      expect(calcClassSemester(cls, sem)).toEqual(expected);
    });
  });

  describe('越界与守卫返回 null', () => {
    it.each([
      ['入学2022 学制3 学期2025-2026-1（grade=4 越界）', { enrollment_year: 2022, duration_years: 3 }, '2025-2026-1'],
      ['入学2020 学制5 学期2025-2026-1（已毕业）', { enrollment_year: 2020, duration_years: 5 }, '2025-2026-1'],
    ])('%s 应返回 null', (_label, cls, semStr) => {
      expect(calcClassSemester(cls, parseSemester(semStr))).toBeNull();
    });

    it('cls=null 应返回 null', () => {
      expect(calcClassSemester(null, parseSemester('2025-2026-1'))).toBeNull();
    });

    it('semesterInfo=null 应返回 null', () => {
      expect(calcClassSemester({ enrollment_year: 2024, duration_years: 3 }, null)).toBeNull();
    });

    it('duration_years=0 应返回 null', () => {
      expect(
        calcClassSemester({ enrollment_year: 2024, duration_years: 0 }, parseSemester('2025-2026-1')),
      ).toBeNull();
    });

    it('duration_years 缺失应返回 null', () => {
      expect(
        calcClassSemester({ enrollment_year: 2024 }, parseSemester('2025-2026-1')),
      ).toBeNull();
    });
  });
});

// ──────────────────────────────────────────────
// getCurrentSemesterInfo
// ──────────────────────────────────────────────
describe('getCurrentSemesterInfo', () => {
  it('system_settings 有有效 current_semester 应返回 parsed', async () => {
    prisma.system_settings.findUnique.mockResolvedValue({ value: '2025-2026-1' });
    const r = await getCurrentSemesterInfo();
    expect(r).toEqual({
      startYear: 2025,
      endYear: 2026,
      semesterIndex: 1,
      raw: '2025-2026-1',
      label: '2025年秋季(第1学期)',
    });
    expect(prisma.system_settings.findUnique).toHaveBeenCalledWith({
      where: { key: 'current_semester' },
    });
  });

  it('system_settings 无记录应返回 null', async () => {
    prisma.system_settings.findUnique.mockResolvedValue(null);
    expect(await getCurrentSemesterInfo()).toBeNull();
    expect(prisma.system_settings.findUnique).toHaveBeenCalledTimes(1);
  });

  it('system_settings 值无效应返回 null', async () => {
    prisma.system_settings.findUnique.mockResolvedValue({ value: 'invalid' });
    expect(await getCurrentSemesterInfo()).toBeNull();
  });

  it('缓存命中：连续两次调用，第二次 findUnique 不应被调用', async () => {
    prisma.system_settings.findUnique.mockResolvedValue({ value: '2025-2026-1' });
    await getCurrentSemesterInfo();
    expect(prisma.system_settings.findUnique).toHaveBeenCalledTimes(1);
    await getCurrentSemesterInfo();
    expect(prisma.system_settings.findUnique).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────
// getSemesterInfoFromRequest
// ──────────────────────────────────────────────
describe('getSemesterInfoFromRequest', () => {
  it('req.query.semester 有效应返回 parsed 且不查 prisma', async () => {
    const r = await getSemesterInfoFromRequest({ query: { semester: '2025-2026-1' } });
    expect(r).toEqual({
      startYear: 2025,
      endYear: 2026,
      semesterIndex: 1,
      raw: '2025-2026-1',
      label: '2025年秋季(第1学期)',
    });
    expect(prisma.system_settings.findUnique).not.toHaveBeenCalled();
  });

  it('req.query.semester 无效应返回 null 且不查 prisma', async () => {
    expect(await getSemesterInfoFromRequest({ query: { semester: 'invalid' } })).toBeNull();
    expect(prisma.system_settings.findUnique).not.toHaveBeenCalled();
  });

  it('req.query 无 semester 应回退 getCurrentSemesterInfo', async () => {
    prisma.system_settings.findUnique.mockResolvedValue({ value: '2025-2026-2' });
    const r = await getSemesterInfoFromRequest({ query: {} });
    expect(r).not.toBeNull();
    expect(r.raw).toBe('2025-2026-2');
    expect(prisma.system_settings.findUnique).toHaveBeenCalledTimes(1);
  });

  it('req.query 缺省（无 query 对象）应回退 getCurrentSemesterInfo', async () => {
    prisma.system_settings.findUnique.mockResolvedValue(null);
    expect(await getSemesterInfoFromRequest({})).toBeNull();
    expect(prisma.system_settings.findUnique).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────
// getActiveClassFilter
// ──────────────────────────────────────────────
describe('getActiveClassFilter', () => {
  it('semesterInfo 有效应构建 OR 条件，每个含 is_left_school:false 与 enrollment_year gte/lte', async () => {
    prisma.classes.findMany.mockResolvedValue([{ duration_years: 2 }, { duration_years: 3 }]);
    const sem = parseSemester('2025-2026-1');
    const filter = await getActiveClassFilter(sem);
    expect(filter).toEqual({
      OR: [
        { duration_years: 2, is_left_school: false, enrollment_year: { gte: 2024, lte: 2025 } },
        { duration_years: 3, is_left_school: false, enrollment_year: { gte: 2023, lte: 2025 } },
      ],
    });
    expect(prisma.classes.findMany).toHaveBeenCalledWith({
      select: { duration_years: true },
      distinct: ['duration_years'],
    });
  });

  it('semesterInfo=null 且 getCurrentSemesterInfo 返回 null 应返回 { is_left_school: false }', async () => {
    prisma.system_settings.findUnique.mockResolvedValue(null);
    const filter = await getActiveClassFilter(null);
    expect(filter).toEqual({ is_left_school: false });
    expect(prisma.classes.findMany).not.toHaveBeenCalled();
  });

  it('缓存命中：连续两次调用 duration 不变，第二次 findMany 不应被调用', async () => {
    prisma.classes.findMany.mockResolvedValue([{ duration_years: 2 }, { duration_years: 3 }]);
    const sem = parseSemester('2025-2026-1');
    await getActiveClassFilter(sem);
    expect(prisma.classes.findMany).toHaveBeenCalledTimes(1);
    await getActiveClassFilter(sem);
    expect(prisma.classes.findMany).toHaveBeenCalledTimes(1);
  });
});
