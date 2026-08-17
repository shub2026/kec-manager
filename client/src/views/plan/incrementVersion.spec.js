import { describe, it, expect } from 'vitest';
import { incrementVersion } from '@/views/plan/incrementVersion';

describe('incrementVersion（派生新版本号）', () => {
  it('主版本号 +1，次版本号归零', () => {
    expect(incrementVersion('V1.0')).toBe('V2.0');
    expect(incrementVersion('V1.2')).toBe('V2.0');
  });

  it('无次版本号时仅主版本号 +1', () => {
    expect(incrementVersion('V3')).toBe('V4');
  });

  it('空值返回空字符串', () => {
    expect(incrementVersion(null)).toBe('');
    expect(incrementVersion(undefined)).toBe('');
    expect(incrementVersion('')).toBe('');
    expect(incrementVersion('  ')).toBe('');
  });

  it('无数字段的字符串原样返回', () => {
    expect(incrementVersion('初版')).toBe('初版');
  });

  it('保留前导零宽度', () => {
    expect(incrementVersion('V09.1')).toBe('V10.0');
  });

  it('保留前后缀', () => {
    expect(incrementVersion('方案V1.0修订')).toBe('方案V2.0修订');
  });
});
