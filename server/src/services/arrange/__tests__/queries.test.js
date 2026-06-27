import { describe, it, expect } from 'vitest';
import { parseSemester } from '../queries.js';

describe('parseSemester', () => {
  it('应正确解析合法学期字符串', () => {
    const result = parseSemester('2025-2026-1');
    expect(result).toEqual({
      startYear: 2025,
      endYear: 2026,
      semesterIndex: 1,
      label: '2025-2026-1',
    });
  });

  it('应支持春季学期（semesterIndex=2）', () => {
    const result = parseSemester('2024-2025-2');
    expect(result).toEqual({
      startYear: 2024,
      endYear: 2025,
      semesterIndex: 2,
      label: '2024-2025-2',
    });
  });

  it('学期索引为 0 时应返回 null', () => {
    expect(parseSemester('2025-2026-0')).toBeNull();
  });

  it('学期索引大于 2 时应返回 null', () => {
    expect(parseSemester('2025-2026-3')).toBeNull();
  });

  it('年份非数字时应返回 null', () => {
    expect(parseSemester('abcd-2026-1')).toBeNull();
  });

  it('格式不正确的字符串应返回 null', () => {
    expect(parseSemester('2025-2026')).toBeNull();     // 只有两段
    expect(parseSemester('2025')).toBeNull();           // 只有一段
    expect(parseSemester('')).toBeNull();               // 空字符串
    expect(parseSemester(null)).toBeNull();             // null
    expect(parseSemester(undefined)).toBeNull();        // undefined
  });

  it('endYear 小于 startYear 时应仍可解析（不强制校验逻辑关系）', () => {
    // parseSemester 本身不校验年份逻辑关系，只校验格式
    const result = parseSemester('2026-2025-1');
    expect(result).not.toBeNull();
    expect(result.startYear).toBe(2026);
    expect(result.endYear).toBe(2025);
  });
});
