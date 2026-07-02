/**
 * class.controller.js 单元测试
 *
 * 重点覆盖模块内私有函数 calculateClassStatus 的状态判定逻辑。
 *
 * 注意：calculateClassStatus 为 class.controller.js 内部 function 声明（未 export），
 * 此处采用“提取并单独测试”的方式：在下方内联复制其实现进行测试。
 * 如原函数修改，需同步更新此处的副本。
 * 原函数位于 server/src/controllers/class.controller.js 第 10-26 行。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ──────────────────────────────────────────────
// calculateClassStatus 逻辑副本（从 class.controller.js 提取）
// 原函数为模块私有，未导出；如原函数修改需同步更新。
// ──────────────────────────────────────────────
function calculateClassStatus(enrollmentYear, durationYears, semesterInfo = null) {
  let startYear;

  if (semesterInfo && semesterInfo.startYear) {
    startYear = semesterInfo.startYear;
  } else if (semesterInfo && semesterInfo.value) {
    startYear = Number(semesterInfo.value.split('-')[0]);
  } else {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    startYear = currentMonth >= 8 ? currentYear : currentYear - 1;
  }

  const grade = startYear - enrollmentYear + 1;
  return grade <= durationYears ? 'active' : 'graduated';
}

// ──────────────────────────────────────────────
// 分支 1：semesterInfo 有 startYear
// ──────────────────────────────────────────────
describe('calculateClassStatus - 分支1: semesterInfo 有 startYear', () => {
  it('入学2024 / 学制3 / startYear2025 → 年级2 在读', () => {
    expect(calculateClassStatus(2024, 3, { startYear: 2025, semesterIndex: 1 })).toBe('active');
  });

  it('入学2022 / 学制3 / startYear2025 → 年级4 已毕业', () => {
    expect(calculateClassStatus(2022, 3, { startYear: 2025, semesterIndex: 1 })).toBe('graduated');
  });

  it('入学2025 / 学制3 / startYear2025 → 年级1 在读', () => {
    expect(calculateClassStatus(2025, 3, { startYear: 2025, semesterIndex: 1 })).toBe('active');
  });

  it('入学2020 / 学制5 / startYear2025 → 年级6 已毕业', () => {
    expect(calculateClassStatus(2020, 5, { startYear: 2025, semesterIndex: 2 })).toBe('graduated');
  });

  it('入学2021 / 学制5 / startYear2025 → 年级5 在读（5年制最后一年）', () => {
    expect(calculateClassStatus(2021, 5, { startYear: 2025, semesterIndex: 2 })).toBe('active');
  });
});

// ──────────────────────────────────────────────
// 分支 2：semesterInfo 有 value（旧格式兼容）
// ──────────────────────────────────────────────
describe('calculateClassStatus - 分支2: semesterInfo 有 value（旧格式兼容）', () => {
  it('value=2025-2026-1 → startYear2025 / 入学2024 / 学制3 → 在读', () => {
    expect(calculateClassStatus(2024, 3, { value: '2025-2026-1' })).toBe('active');
  });

  it('value=2025-2026-2 → startYear2025 / 入学2022 / 学制3 → 已毕业', () => {
    expect(calculateClassStatus(2022, 3, { value: '2025-2026-2' })).toBe('graduated');
  });
});

// ──────────────────────────────────────────────
// 分支 3：semesterInfo 为 null（回退系统时钟）
// ──────────────────────────────────────────────
describe('calculateClassStatus - 分支3: semesterInfo 为 null（回退系统时钟）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('当前 2025-09-15（9月 >=8）→ startYear2025 / 入学2024 / 学制3 → 在读', () => {
    vi.setSystemTime(new Date(2025, 8, 15)); // 月份从 0 开始，8 = 9月
    expect(calculateClassStatus(2024, 3, null)).toBe('active');
  });

  it('当前 2025-09-15（9月 >=8）→ startYear2025 / 入学2022 / 学制3 → 已毕业', () => {
    vi.setSystemTime(new Date(2025, 8, 15));
    expect(calculateClassStatus(2022, 3, null)).toBe('graduated');
  });

  it('当前 2025-03-15（3月 <8）→ startYear2024 / 入学2023 / 学制3 → 在读', () => {
    vi.setSystemTime(new Date(2025, 2, 15)); // 2 = 3月
    expect(calculateClassStatus(2023, 3, null)).toBe('active');
  });

  it('当前 2025-03-15（3月 <8）→ startYear2024 / 入学2021 / 学制3 → 已毕业', () => {
    vi.setSystemTime(new Date(2025, 2, 15));
    expect(calculateClassStatus(2021, 3, null)).toBe('graduated');
  });
});

// ──────────────────────────────────────────────
// 边界场景
// ──────────────────────────────────────────────
describe('calculateClassStatus - 边界场景', () => {
  it('入学2025 / 学制2 / startYear2025 → 年级1 在读（2年制第一年）', () => {
    expect(calculateClassStatus(2025, 2, { startYear: 2025 })).toBe('active');
  });

  it('入学2024 / 学制2 / startYear2025 → 年级2 在读（2年制最后一年）', () => {
    expect(calculateClassStatus(2024, 2, { startYear: 2025 })).toBe('active');
  });

  it('入学2023 / 学制2 / startYear2025 → 年级3 已毕业（2年制已毕业）', () => {
    expect(calculateClassStatus(2023, 2, { startYear: 2025 })).toBe('graduated');
  });

  it('grade 恰好等于 durationYears → 在读（边界）', () => {
    // startYear2025, 入学2023, 学制3 → grade=3 == durationYears
    expect(calculateClassStatus(2023, 3, { startYear: 2025 })).toBe('active');
  });

  it('grade = durationYears + 1 → 已毕业（边界）', () => {
    // startYear2025, 入学2022, 学制3 → grade=4 = durationYears+1
    expect(calculateClassStatus(2022, 3, { startYear: 2025 })).toBe('graduated');
  });
});
