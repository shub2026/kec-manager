import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatBirthDate, calcAge } from '@/utils/date';

describe('formatBirthDate', () => {
  it('空值返回占位符', () => {
    expect(formatBirthDate(null)).toBe('-');
    expect(formatBirthDate('')).toBe('-');
    expect(formatBirthDate(undefined)).toBe('-');
  });

  it('完整日期截取到月份', () => {
    expect(formatBirthDate('1990-05-20')).toBe('1990-05');
  });

  it('YYYY-MM 格式原样返回', () => {
    expect(formatBirthDate('1990-05')).toBe('1990-05');
  });

  it('短于 7 位的字符串原样返回', () => {
    expect(formatBirthDate('1990')).toBe('1990');
  });
});

describe('calcAge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 固定系统时间，保证年龄计算可复现
    vi.setSystemTime(new Date('2026-07-15T08:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('空值返回占位符', () => {
    expect(calcAge(null)).toBe('-');
    expect(calcAge('')).toBe('-');
  });

  it('生日月份已过时按整年计算', () => {
    expect(calcAge('1990-05')).toBe(36);
  });

  it('生日月份未到时减一岁', () => {
    expect(calcAge('1990-12')).toBe(35);
  });

  it('支持 YYYY-MM-DD 格式', () => {
    expect(calcAge('2000-01-01')).toBe(26);
  });

  it('缺少月份分段时返回占位符', () => {
    expect(calcAge('1990')).toBe('-');
  });

  it('非数字年月返回占位符', () => {
    expect(calcAge('abcd-ef')).toBe('-');
  });

  it('年龄不为正数时返回占位符', () => {
    expect(calcAge('2026-01')).toBe('-');
  });
});
