/**
 * auto-arrange 补充测试
 *
 * 覆盖 auto-arrange.test.js 未涉及的导出函数：
 * - diagnoseFailure：排课失败诊断（5 条路径）
 *
 * 同时覆盖 validate.js：
 * - validateHourSettings：课时设置参数校验
 */
import { describe, it, expect, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock 依赖
// ──────────────────────────────────────────────
vi.mock('../../../constants/index.js', () => ({
  DEFAULT_HOUR_SETTINGS: {
    full_time: { standard: 16, max: 20 },
    part_time: { standard: 12, max: 16 },
    external: { standard: 12, max: 16 },
  },
  WORKLOAD_BALANCE: { SCORE_THRESHOLD: 1, LOAD_RATE_THRESHOLD: 0.2 },
  TEXTBOOK_COHESION: {
    ENABLED: true,
    COLLEGE_WEIGHT: 5,
    LEVEL_WEIGHT: 5,
    ASSIGNED_WEIGHT: 10,
    INHERENT_WEIGHT: 4,
    PENALTY_PER_NEW: 10,
    ZERO_TEXTBOOK_BONUS: 30,
    TEXTBOOK_COUNT_PENALTY_1_NEW: 200,
    TEXTBOOK_COUNT_BONUS_1_SAME: 8,
    TEXTBOOK_COUNT_PENALTY_2: 20,
    TEXTBOOK_COUNT_PENALTY_3PLUS: 150,
    MAX_TEXTBOOKS_PER_TEACHER: 2,
    COHESION_PHASE_ENABLED: true,
    PHASE0_ENABLED: false,
    FALLBACK_EMPTY: true,
    SCATTERED_THRESHOLD: 3,
  },
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

const { diagnoseFailure } = await import('../auto-arrange.js');
const { validateHourSettings } = await import('../validate.js');

// ──────────────────────────────────────────────
// 辅助构造器
// ──────────────────────────────────────────────
function makeTeacher(overrides = {}) {
  return {
    id: 1,
    name: '教师A',
    personnelType: 'full_time',
    schedulingCollegeIds: [],
    schedulingLevelIds: [],
    assignedTextbookIds: new Set(),
    assignedCollegeIds: new Set(),
    assignedHours: 0,
    effectiveTotal: 0,
    standardCap: 16,
    fullCap: 20,
    standardHours: 16,
    maxHours: 20,
    defaultWeeklyHours: null,
    courseExistingHours: 0,
    inherentTextbookIds: [],
    ...overrides,
  };
}

function makeClass(overrides = {}) {
  return {
    classId: 100,
    className: '班级A',
    collegeId: 10,
    trainingLevelId: 20,
    weeklyHours: 4,
    textbookIds: [300],
    ...overrides,
  };
}

// ══════════════════════════════════════════════
// diagnoseFailure
// ══════════════════════════════════════════════
describe('diagnoseFailure', () => {
  const mode = 'standard';

  describe('路径1：没有候选教师', () => {
    it('教师列表为空时应返回"没有可教此课程的教师"', () => {
      const result = diagnoseFailure(makeClass(), [], mode);
      expect(result.reason).toBe('没有可教此课程的教师');
      expect(result.details).toBeNull();
    });
  });

  describe('路径2：所有教师容量已满', () => {
    it('所有教师 assignedHours + weeklyHours > cap 时应返回容量满', () => {
      const teachers = [
        makeTeacher({ id: 1, name: 'T1', assignedHours: 14, standardCap: 16 }),
        makeTeacher({ id: 2, name: 'T2', assignedHours: 16, standardCap: 16 }),
      ];
      const cls = makeClass({ weeklyHours: 4 }); // 14+4=18>16, 16+4=20>16
      const result = diagnoseFailure(cls, teachers, mode);
      expect(result.reason).toContain('容量已满');
      expect(result.details).toHaveLength(2);
    });

    it('full 模式下应使用 fullCap', () => {
      const teachers = [
        makeTeacher({ assignedHours: 18, fullCap: 20 }),
      ];
      const cls = makeClass({ weeklyHours: 4 }); // 18+4=22>20
      const result = diagnoseFailure(cls, teachers, 'full');
      expect(result.reason).toContain('容量已满');
    });
  });

  describe('路径3：所有教师本课程课时达上限', () => {
    it('所有教师 courseExistingHours + assignedHours + weeklyHours > defaultWeeklyHours', () => {
      const teachers = [
        makeTeacher({
          id: 1, name: 'T1',
          defaultWeeklyHours: 8,
          courseExistingHours: 4,
          assignedHours: 2,
          standardCap: 20, // 容量足够
        }),
        makeTeacher({
          id: 2, name: 'T2',
          defaultWeeklyHours: 6,
          courseExistingHours: 4,
          assignedHours: 0,
          standardCap: 20,
        }),
      ];
      const cls = makeClass({ weeklyHours: 4 });
      // T1: 4+2+4=10>8, T2: 4+0+4=8>6 → 全部超限
      const result = diagnoseFailure(cls, teachers, mode);
      expect(result.reason).toContain('本课程课时已达上限');
    });
  });

  describe('路径4→实际走路径5（isTeacherEligible 已含容量检查）', () => {
    it('T1 学院/层次匹配但容量满时，isTeacherEligible 返回 false，最终走 fallback 路径', () => {
      // 注意：isTeacherEligible 内部已检查容量（auto-arrange.js:127）
      // 所以 T1 虽然学院/层次匹配，但 assignedHours+weeklyHours>standardCap
      // → isTeacherEligible 返回 false → eligibleTeachers 为空 → 走 fallback
      const teachers = [
        makeTeacher({
          id: 1, name: 'T1',
          schedulingCollegeIds: [10], // 学院匹配
          schedulingLevelIds: [20],   // 层次匹配
          assignedHours: 14,
          standardCap: 16,            // 14+4=18 > 16 → 容量满
        }),
        makeTeacher({
          id: 2, name: 'T2',
          schedulingCollegeIds: [99], // 学院不匹配
          assignedHours: 0,
          standardCap: 16,
        }),
      ];
      const cls = makeClass({ weeklyHours: 4, collegeId: 10, trainingLevelId: 20 });
      const result = diagnoseFailure(cls, teachers, mode);
      // 实际走 fallback（路径5），因为所有教师都不满足 isTeacherEligible
      expect(result.reason).toContain('无匹配的教师');
      expect(result.details.totalTeachers).toBe(2);
      expect(result.details.collegeMatchCount).toBe(1); // T1 学院匹配
      expect(result.details.levelMatchCount).toBe(1);   // T1 层次匹配
    });
  });

  describe('路径5：无匹配的教师（偏好筛选后无候选）', () => {
    it('学院/层次/教材不匹配时应返回详细统计', () => {
      const teachers = [
        makeTeacher({
          id: 1, name: 'T1',
          schedulingCollegeIds: [99],
          schedulingLevelIds: [99],
          inherentTextbookIds: [999],
          assignedHours: 0,
          standardCap: 16,
        }),
        makeTeacher({
          id: 2, name: 'T2',
          schedulingCollegeIds: [10],
          schedulingLevelIds: [99],
          inherentTextbookIds: [999],
          assignedHours: 0,
          standardCap: 16,
        }),
      ];
      const cls = makeClass({ collegeId: 10, trainingLevelId: 20, textbookIds: [300] });
      const result = diagnoseFailure(cls, teachers, mode);
      expect(result.reason).toContain('无匹配的教师');
      expect(result.details.totalTeachers).toBe(2);
      expect(result.details.collegeMatchCount).toBe(1); // T2 学院匹配
      expect(result.details.levelMatchCount).toBe(0);
      expect(result.details.textbookMatchCount).toBe(0);
    });
  });

  describe('边界：details 最多显示 5 位教师', () => {
    it('超过 5 位容量满的教师时 details 应截断为 5', () => {
      const teachers = Array.from({ length: 8 }, (_, i) =>
        makeTeacher({ id: i, name: `T${i}`, assignedHours: 16, standardCap: 16 })
      );
      const cls = makeClass({ weeklyHours: 4 });
      const result = diagnoseFailure(cls, teachers, mode);
      expect(result.reason).toContain('容量已满');
      expect(result.details).toHaveLength(5);
    });
  });
});

// ══════════════════════════════════════════════
// validateHourSettings
// ══════════════════════════════════════════════
describe('validateHourSettings', () => {
  const validSettings = {
    full_time: { standard: 16, max: 20 },
    part_time: { standard: 12, max: 16 },
    external: { standard: 12, max: 16 },
  };

  it('合法设置应不抛异常', () => {
    expect(() => validateHourSettings(validSettings)).not.toThrow();
  });

  describe('缺少类型', () => {
    it('缺少 full_time 应抛异常', () => {
      const s = { ...validSettings };
      delete s.full_time;
      expect(() => validateHourSettings(s)).toThrow(/full_time/);
    });

    it('缺少 part_time 应抛异常', () => {
      const s = { ...validSettings };
      delete s.part_time;
      expect(() => validateHourSettings(s)).toThrow(/part_time/);
    });

    it('缺少 external 应抛异常', () => {
      const s = { ...validSettings };
      delete s.external;
      expect(() => validateHourSettings(s)).toThrow(/external/);
    });
  });

  describe('无效数字', () => {
    it('standard 为 NaN 应抛异常', () => {
      const s = { ...validSettings, full_time: { standard: NaN, max: 20 } };
      expect(() => validateHourSettings(s)).toThrow(/有效数字/);
    });

    it('max 为 Infinity 应抛异常', () => {
      const s = { ...validSettings, full_time: { standard: 16, max: Infinity } };
      expect(() => validateHourSettings(s)).toThrow(/有效数字/);
    });
  });

  describe('范围校验', () => {
    it('standard < 1 应抛异常', () => {
      const s = { ...validSettings, full_time: { standard: 0, max: 20 } };
      expect(() => validateHourSettings(s)).toThrow(/大于0/);
    });

    it('max > 40 应抛异常', () => {
      const s = { ...validSettings, full_time: { standard: 16, max: 41 } };
      expect(() => validateHourSettings(s)).toThrow(/1-40/);
    });

    it('max < 1 应抛异常', () => {
      const s = { ...validSettings, full_time: { standard: 16, max: 0 } };
      expect(() => validateHourSettings(s)).toThrow(/1-40/);
    });

    it('standard > max 应抛异常', () => {
      const s = { ...validSettings, full_time: { standard: 22, max: 20 } };
      expect(() => validateHourSettings(s)).toThrow(/不能超过/);
    });
  });

  describe('边界值', () => {
    it('standard = max 应合法', () => {
      const s = { ...validSettings, full_time: { standard: 20, max: 20 } };
      expect(() => validateHourSettings(s)).not.toThrow();
    });

    it('standard = 1, max = 1 应合法', () => {
      const s = { ...validSettings, full_time: { standard: 1, max: 1 } };
      expect(() => validateHourSettings(s)).not.toThrow();
    });

    it('max = 40 应合法', () => {
      const s = { ...validSettings, full_time: { standard: 16, max: 40 } };
      expect(() => validateHourSettings(s)).not.toThrow();
    });
  });
});
