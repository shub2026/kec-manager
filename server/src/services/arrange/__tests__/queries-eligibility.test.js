/**
 * queries.js 纯函数单元测试
 *
 * 覆盖：
 * - isTextbookMatch（教材匹配，修过 9 轮的关键函数）
 * - isCollegeEligible（学院资格）
 * - isLevelEligible（层次资格）
 */
import { describe, it, expect, vi } from 'vitest';

// Mock prisma（模块加载依赖）
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

const { isTextbookMatch, isCollegeEligible, isLevelEligible } = await import('../queries.js');

// ──────────────────────────────────────────────
// isTextbookMatch
// 这是修复九轮的核心函数，重点覆盖所有边界
// ──────────────────────────────────────────────
describe('isTextbookMatch', () => {
  describe('班级无教材', () => {
    it('班级 textbookIds 为空数组时应返回 false', () => {
      const teacher = { inherentTextbookIds: [300] };
      const cls = { textbookIds: [] };
      expect(isTextbookMatch(teacher, cls)).toBe(false);
    });

    it('班级 textbookIds 为 null/undefined 时应返回 false', () => {
      const teacher = { inherentTextbookIds: [300] };
      expect(isTextbookMatch(teacher, { textbookIds: null })).toBe(false);
      expect(isTextbookMatch(teacher, { textbookIds: undefined })).toBe(false);
    });
  });

  describe('教师无固有教材（修复九轮关键）', () => {
    it('教师 inherentTextbookIds 为空数组时应返回 true（能教任何教材）', () => {
      // 修复九轮：FALLBACK_EMPTY=true 让新教师 inherentTextbookIds=[]
      // 原逻辑返回 false 会屏蔽所有新教师，修复后返回 true
      const teacher = { inherentTextbookIds: [] };
      const cls = { textbookIds: [999] };
      expect(isTextbookMatch(teacher, cls)).toBe(true);
    });

    it('教师 inherentTextbookIds 为 null 时应返回 true（兜底）', () => {
      // teacher.inherentTextbookIds ?? teacher.textbookIds → textbookIds
      // 若 textbookIds 也为空 → true
      const teacher = { inherentTextbookIds: null, textbookIds: [] };
      const cls = { textbookIds: [999] };
      expect(isTextbookMatch(teacher, cls)).toBe(true);
    });

    it('教师 inherentTextbookIds 为 undefined 时应回退到 textbookIds', () => {
      const teacher = { inherentTextbookIds: undefined, textbookIds: [300] };
      const cls = { textbookIds: [300] };
      expect(isTextbookMatch(teacher, cls)).toBe(true);
    });
  });

  describe('正常匹配', () => {
    it('教师固有教材包含班级教材时应返回 true', () => {
      const teacher = { inherentTextbookIds: [300, 301] };
      const cls = { textbookIds: [300] };
      expect(isTextbookMatch(teacher, cls)).toBe(true);
    });

    it('教师固有教材不包含班级教材时应返回 false', () => {
      const teacher = { inherentTextbookIds: [300] };
      const cls = { textbookIds: [999] };
      expect(isTextbookMatch(teacher, cls)).toBe(false);
    });

    it('多对多部分匹配时应返回 true', () => {
      const teacher = { inherentTextbookIds: [300, 301, 302] };
      const cls = { textbookIds: [302, 303] }; // 302 匹配
      expect(isTextbookMatch(teacher, cls)).toBe(true);
    });

    it('多对多完全不匹配时应返回 false', () => {
      const teacher = { inherentTextbookIds: [300, 301] };
      const cls = { textbookIds: [302, 303] };
      expect(isTextbookMatch(teacher, cls)).toBe(false);
    });
  });
});

// ──────────────────────────────────────────────
// isCollegeEligible
// ──────────────────────────────────────────────
describe('isCollegeEligible', () => {
  it('教师无 schedulingCollegeIds 时应返回 true（不限制）', () => {
    expect(isCollegeEligible({ schedulingCollegeIds: [] }, { collegeId: 10 })).toBe(true);
    expect(isCollegeEligible({ schedulingCollegeIds: null }, { collegeId: 10 })).toBe(true);
    expect(isCollegeEligible({}, { collegeId: 10 })).toBe(true);
  });

  it('教师 schedulingCollegeIds 包含班级 collegeId 时应返回 true', () => {
    expect(isCollegeEligible({ schedulingCollegeIds: [10, 11] }, { collegeId: 10 })).toBe(true);
  });

  it('教师 schedulingCollegeIds 不包含班级 collegeId 时应返回 false', () => {
    expect(isCollegeEligible({ schedulingCollegeIds: [99] }, { collegeId: 10 })).toBe(false);
  });
});

// ──────────────────────────────────────────────
// isLevelEligible
// ──────────────────────────────────────────────
describe('isLevelEligible', () => {
  it('教师无 schedulingLevelIds 时应返回 true（不限制）', () => {
    expect(isLevelEligible({ schedulingLevelIds: [] }, { trainingLevelId: 20 })).toBe(true);
    expect(isLevelEligible({}, { trainingLevelId: 20 })).toBe(true);
  });

  it('教师 schedulingLevelIds 包含班级 trainingLevelId 时应返回 true', () => {
    expect(isLevelEligible({ schedulingLevelIds: [20, 21] }, { trainingLevelId: 20 })).toBe(true);
  });

  it('教师 schedulingLevelIds 不包含班级 trainingLevelId 时应返回 false', () => {
    expect(isLevelEligible({ schedulingLevelIds: [99] }, { trainingLevelId: 20 })).toBe(false);
  });

  it('班级无 trainingLevelId 时应返回 falsy（需明确匹配）', () => {
    // 代码：cls.trainingLevelId && t.schedulingLevelIds.includes(...)
    // trainingLevelId 为 null 时短路返回 null（falsy 但不是 false）
    expect(isLevelEligible({ schedulingLevelIds: [20] }, { trainingLevelId: null })).toBeFalsy();
    expect(isLevelEligible({ schedulingLevelIds: [20] }, {})).toBeFalsy();
  });
});
