import { describe, it, expect } from 'vitest';
import { personnelLabel, personnelTagType } from '@/utils/personnel';

describe('personnelLabel', () => {
  it('已知类别映射为中文标签', () => {
    expect(personnelLabel('full_time')).toBe('专职');
    expect(personnelLabel('part_time')).toBe('兼职');
    expect(personnelLabel('external')).toBe('外聘');
  });

  it('未知类别原样返回', () => {
    expect(personnelLabel('other_type')).toBe('other_type');
  });

  it('驼峰变体归一化后映射（缓存/历史数据兼容）', () => {
    expect(personnelLabel('fullTime')).toBe('专职');
    expect(personnelLabel('partTime')).toBe('兼职');
  });

  it('空值返回占位符', () => {
    expect(personnelLabel(null)).toBe('-');
    expect(personnelLabel('')).toBe('-');
    expect(personnelLabel(undefined)).toBe('-');
  });
});

describe('personnelTagType', () => {
  it('语义色方案：专职=绿、兼职=橙、外聘=灰', () => {
    expect(personnelTagType('full_time')).toBe('success');
    expect(personnelTagType('part_time')).toBe('warning');
    expect(personnelTagType('external')).toBe('info');
  });

  it('未知类别返回空字符串', () => {
    expect(personnelTagType('other')).toBe('');
    expect(personnelTagType(null)).toBe('');
  });

  it('驼峰变体归一化后映射语义色', () => {
    expect(personnelTagType('fullTime')).toBe('success');
    expect(personnelTagType('partTime')).toBe('warning');
  });
});
