/**
 * useSemesters 学期工具 composable 单元测试
 *
 * 覆盖：
 * - availableSemesters：范围与格式（默认前后各 3 年 × 2 学期）
 * - getCurrentSemester：月份分支（≥起始月 / 1 月归上学期 / 其余春季）与自定义起始月
 * - fetchCurrentSemester：后端配置优先、非法值回退本地、加载失败回退、学期边界月份配置
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockStore = vi.hoisted(() => ({
  load: vi.fn().mockResolvedValue(),
  currentSemesterValue: vi.fn(),
  settings: null,
}));

vi.mock('../stores/settings', () => ({
  useSettingsStore: () => mockStore,
}));

import { useSemesters } from './useSemesters';

beforeEach(() => {
  vi.clearAllMocks();
  mockStore.settings = null;
  mockStore.currentSemesterValue.mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('availableSemesters', () => {
  it('默认前后各 3 年，共 14 个学期且格式正确', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15'));
    const { availableSemesters } = useSemesters();

    expect(availableSemesters.value).toHaveLength(14);
    expect(availableSemesters.value[0]).toEqual({
      value: '2023-2024-1',
      label: '2023-2024学年 秋季(第1学期)',
    });
    expect(availableSemesters.value.at(-1).value).toBe('2029-2030-2');
  });

  it('自定义范围生效', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15'));
    const { availableSemesters } = useSemesters({ rangeBefore: 1, rangeAfter: 0 });

    expect(availableSemesters.value).toHaveLength(4); // 2025、2026 两年 × 2
    expect(availableSemesters.value[0].value).toBe('2025-2026-1');
  });
});

describe('getCurrentSemester', () => {
  it.each([
    ['9 月起属新学年秋季第 1 学期', '2026-09-01', '2026-2027-1'],
    ['12 月仍为秋季第 1 学期', '2026-12-31', '2026-2027-1'],
    ['1 月归上一学年秋季第 1 学期（期末周）', '2027-01-15', '2026-2027-1'],
    ['2-7 月为上一学年春季第 2 学期', '2027-03-10', '2026-2027-2'],
    ['7 月仍为春季第 2 学期', '2027-07-31', '2026-2027-2'],
  ])('%s', (_desc, date, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(date));
    const { getCurrentSemester } = useSemesters();
    expect(getCurrentSemester()).toBe(expected);
  });

  it('自定义学期起始月（9 月）：8 月仍属上学期春季', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15'));
    const { getCurrentSemester } = useSemesters();
    expect(getCurrentSemester(9)).toBe('2025-2026-2');
    expect(getCurrentSemester(8)).toBe('2026-2027-1');
  });
});

describe('fetchCurrentSemester', () => {
  it('后端配置合法时直接采用', async () => {
    mockStore.currentSemesterValue.mockReturnValue('2026-2027-2');
    const { fetchCurrentSemester } = useSemesters();
    expect(await fetchCurrentSemester()).toBe('2026-2027-2');
  });

  it('后端配置非法（年份不连续）时回退本地计算', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01'));
    mockStore.currentSemesterValue.mockReturnValue('2025-2027-1');
    const { fetchCurrentSemester } = useSemesters();
    expect(await fetchCurrentSemester()).toBe('2026-2027-1');
  });

  it('后端配置非法（第三段非 1/2）时回退本地计算', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01'));
    mockStore.currentSemesterValue.mockReturnValue('2026-2027-3');
    const { fetchCurrentSemester } = useSemesters();
    expect(await fetchCurrentSemester()).toBe('2026-2027-1');
  });

  it('加载失败时回退本地计算', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01'));
    mockStore.load.mockRejectedValueOnce(new Error('network'));
    const { fetchCurrentSemester } = useSemesters();

    expect(await fetchCurrentSemester()).toBe('2026-2027-1');
    consoleSpy.mockRestore();
  });

  it('学期边界月份配置生效（配置 9 月时 8 月算上学期春季）', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15'));
    mockStore.currentSemesterValue.mockReturnValue(null); // 无有效配置 → 本地计算
    mockStore.settings = { semesterStartMonth: { value: '9' } };
    const { fetchCurrentSemester } = useSemesters();

    expect(await fetchCurrentSemester()).toBe('2025-2026-2');
  });

  it('非法的边界月份配置被忽略（回退默认 8 月）', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15'));
    mockStore.currentSemesterValue.mockReturnValue(null);
    mockStore.settings = { semesterStartMonth: { value: '13' } };
    const { fetchCurrentSemester } = useSemesters();

    expect(await fetchCurrentSemester()).toBe('2026-2027-1');
  });
});
