/**
 * validate.js — 合班一致性校验单元测试
 */
import { describe, it, expect } from 'vitest';
import { validateCombinedClassConsistency } from '../validate.js';

describe('validateCombinedClassConsistency', () => {
  it('同合班成员班分配同一教师 → 无违规', () => {
    const assignments = [
      { classId: 1, teacherId: 5, combinationId: 10 },
      { classId: 2, teacherId: 5, combinationId: 10 },
    ];
    expect(validateCombinedClassConsistency(assignments)).toEqual([]);
  });

  it('同合班成员班分配不同教师 → 应报违规', () => {
    const assignments = [
      { classId: 1, teacherId: 5, combinationId: 10 },
      { classId: 2, teacherId: 8, combinationId: 10 },
    ];
    const violations = validateCombinedClassConsistency(assignments);
    expect(violations).toHaveLength(1);
    expect(violations[0].combinationId).toBe(10);
  });

  it('不同合班组合互不干扰', () => {
    const assignments = [
      { classId: 1, teacherId: 5, combinationId: 10 },
      { classId: 2, teacherId: 8, combinationId: 10 }, // 组合10冲突
      { classId: 3, teacherId: 7, combinationId: 20 },
      { classId: 4, teacherId: 7, combinationId: 20 }, // 组合20一致
    ];
    const violations = validateCombinedClassConsistency(assignments);
    expect(violations).toHaveLength(1);
    expect(violations[0].combinationId).toBe(10);
  });

  it('无合班(combinationId 为 null)的安排应被忽略', () => {
    const assignments = [
      { classId: 1, teacherId: 5, combinationId: null },
      { classId: 2, teacherId: 8, combinationId: null },
    ];
    expect(validateCombinedClassConsistency(assignments)).toEqual([]);
  });

  it('合班成员班存在未分配教师(null)时不算冲突', () => {
    const assignments = [
      { classId: 1, teacherId: 5, combinationId: 10 },
      { classId: 2, teacherId: null, combinationId: 10 },
    ];
    expect(validateCombinedClassConsistency(assignments)).toEqual([]);
  });
});
