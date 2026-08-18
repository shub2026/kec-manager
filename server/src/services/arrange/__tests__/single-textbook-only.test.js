/**
 * 教师「只带一本教材」个人开关专项测试（全局教材内聚 ENABLED=false 场景）
 *
 * 验证个人开关独立于全局 TEXTBOOK_COHESION.ENABLED：
 * - 全局关闭时，开启开关的教师仍受 1 本教材硬约束；
 * - 全局关闭时，未开启开关的教师无教材约束（maxTb=0）。
 *
 * Mock 策略：与 auto-arrange.test.js 一致，但 ENABLED 置为 false。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../constants/index.js', () => ({
  DEFAULT_HOUR_SETTINGS: {
    full_time: { standard: 16, max: 20 },
    part_time: { standard: 12, max: 16 },
    external: { standard: 12, max: 16 },
  },
  WORKLOAD_BALANCE: { SCORE_THRESHOLD: 1, LOAD_RATE_THRESHOLD: 0.2 },
  TEXTBOOK_COHESION: {
    ENABLED: false, // 全局教材内聚关闭
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
  TABU_SEARCH: {
    ENABLED: false,
    MAX_ITERATIONS: 500,
    TABU_TENURE: 10,
    NO_IMPROVEMENT_LIMIT: 80,
    SINGLE_COURSE_TIMEOUT_MS: 15000,
    UNASSIGNED_PENALTY: 500,
    UNDER_ASSIGNMENT_PENALTY: 5,
    RANDOM_SEED: 42,
  },
  SWAP_CONFIG: { MAX_DEPTH: 3, MAX_UNASSIGNED: 30 },
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: {} }));

const { teacherMaxTextbooks, isTeacherEligible } = await import('../auto-arrange.js');

function baseTeacher() {
  return {
    id: 1,
    name: 'T',
    personnelType: 'full_time',
    schedulingCollegeIds: [],
    schedulingLevelIds: [],
    assignedTextbookIds: new Set([300]),
    assignedCollegeIds: new Set(),
    assignedHours: 0,
    totalWeeklyHours: 0,
    courseHours: 0,
    standardCap: 16,
    fullCap: 20,
    inherentTextbookIds: [300],
  };
}

function baseClass() {
  return {
    classId: 100,
    className: 'C',
    collegeId: 10,
    trainingLevelId: 20,
    weeklyHours: 4,
    textbookIds: [301],
  };
}

describe('全局 ENABLED=false 时的个人单教材开关', () => {
  it('teacherMaxTextbooks：开启开关的教师仍受 1 本约束', () => {
    expect(teacherMaxTextbooks({ singleTextbookOnly: true })).toBe(1);
  });

  it('teacherMaxTextbooks：未开启开关的教师无教材约束（返回 0）', () => {
    expect(teacherMaxTextbooks({ singleTextbookOnly: false })).toBe(0);
    expect(teacherMaxTextbooks({})).toBe(0);
  });

  it('isTeacherEligible：受限教师接班会引入第 2 本教材 → 拒绝', () => {
    const t = baseTeacher();
    t.singleTextbookOnly = true;
    expect(isTeacherEligible(t, baseClass(), 'standard')).toBe(false);
  });

  it('isTeacherEligible：受限教师接同教材班级 → 放行', () => {
    const t = baseTeacher();
    t.singleTextbookOnly = true;
    const c = baseClass();
    c.textbookIds = [300];
    expect(isTeacherEligible(t, c, 'standard')).toBe(true);
  });

  it('isTeacherEligible：未开启开关的教师不受教材约束（对照）', () => {
    const t = baseTeacher();
    t.assignedTextbookIds = new Set([300, 301, 302]); // 已持 3 本也不拦
    expect(isTeacherEligible(t, baseClass(), 'standard')).toBe(true);
  });
});
