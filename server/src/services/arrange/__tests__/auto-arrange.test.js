/**
 * auto-arrange.js 单元测试
 *
 * 策略：测相对差值，而非绝对值，避免硬编码 magic number
 * 核心目标：验证修复过的 bug 不再回归
 */
import { describe, it, expect, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock constants/index.js
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

const { calcMatchScore, isTeacherEligible, calcAllMatchRates } = await import('../auto-arrange.js');

const C = {
  COLLEGE_WEIGHT: 5,
  LEVEL_WEIGHT: 5,
  ASSIGNED_WEIGHT: 10,
  INHERENT_WEIGHT: 4,
  PENALTY_PER_NEW: 10,
  ZERO_TEXTBOOK_BONUS: 30,
};

/**
 * 构造"空白"教师：无学院/层次限制，1 本固有教材（避免触发 ZERO_TEXTBOOK_BONUS）
 * 用于测单一变量的影响
 */
function baseTeacher() {
  return {
    id: 1,
    name: 'T',
    personnelType: 'full_time',
    schedulingCollegeIds: [], // 无限制
    schedulingLevelIds: [], // 无限制
    assignedTextbookIds: new Set([300]),
    assignedCollegeIds: new Set(),
    assignedHours: 0,
    totalWeeklyHours: 0,
    courseHours: 0,
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
    textbookIds: [300],
  };
}

// ──────────────────────────────────────────────
// calcMatchScore
// ──────────────────────────────────────────────
describe('calcMatchScore', () => {
  describe('学院匹配加分', () => {
    it('有学院匹配应比无匹配高 COLLEGE_WEIGHT 分', () => {
      const tNoCollege = baseTeacher(); // schedulingCollegeIds: []
      const tWithCollege = baseTeacher();
      tWithCollege.schedulingCollegeIds = [10];
      const c = baseClass(); // collegeId: 10

      const scoreNoCollege = calcMatchScore(tNoCollege, c);
      const scoreWithCollege = calcMatchScore(tWithCollege, c);
      expect(scoreWithCollege - scoreNoCollege).toBe(C.COLLEGE_WEIGHT);
    });
  });

  describe('层次匹配加分', () => {
    it('有层次匹配应比无匹配高 LEVEL_WEIGHT 分', () => {
      const tNoLevel = baseTeacher(); // schedulingLevelIds: []
      const tWithLevel = baseTeacher();
      tWithLevel.schedulingLevelIds = [20];
      const c = baseClass(); // trainingLevelId: 20

      const scoreNoLevel = calcMatchScore(tNoLevel, c);
      const scoreWithLevel = calcMatchScore(tWithLevel, c);
      expect(scoreWithLevel - scoreNoLevel).toBe(C.LEVEL_WEIGHT);
    });
  });

  describe('固有教材匹配加分', () => {
    it('教师固有教材匹配班级教材时应比不匹配高 INHERENT_WEIGHT 分', () => {
      const tMatch = baseTeacher(); // inherentTextbookIds: [300], 班级 [300]
      const tNoMatch = baseTeacher();
      tNoMatch.inherentTextbookIds = [999]; // 不匹配
      const c = baseClass(); // textbookIds: [300]

      const scoreMatch = calcMatchScore(tMatch, c);
      const scoreNoMatch = calcMatchScore(tNoMatch, c);
      expect(scoreMatch - scoreNoMatch).toBe(C.INHERENT_WEIGHT);
    });
  });

  describe('已分配教材加分', () => {
    it('assignedTextbookIds 包含班级教材的教师分数应更高', () => {
      const c = baseClass(); // [300]

      const tAssigned = baseTeacher();
      tAssigned.inherentTextbookIds = [300];
      tAssigned.assignedTextbookIds = new Set([300]);

      const tNotAssigned = baseTeacher();
      tNotAssigned.inherentTextbookIds = [300];
      tNotAssigned.assignedTextbookIds = new Set([301]); // 不包含 300

      const scoreAssigned = calcMatchScore(tAssigned, c);
      const scoreNotAssigned = calcMatchScore(tNotAssigned, c);

      // tAssigned 触发 ASSIGNED_WEIGHT，tNotAssigned 触发 -10000 惩罚
      // 所以 tAssigned 分数一定远高于 tNotAssigned
      expect(scoreAssigned).toBeGreaterThan(scoreNotAssigned);
    });
  });

  describe('修复九轮：inherentTextbookIds 为空时不屏蔽', () => {
    it('教师 inherentTextbookIds=[] 时应能匹配任何教材（不被 isTextbookMatch 屏蔽）', () => {
      const tEmpty = baseTeacher();
      tEmpty.inherentTextbookIds = []; // 空数组 = 无约束
      tEmpty.assignedTextbookIds = new Set();
      const c = baseClass(); // textbookIds: [300]

      // 不应返回极低分数（未被屏蔽）
      const score = calcMatchScore(tEmpty, c);
      expect(score).toBeGreaterThan(-5000);
    });

    it('教师 inherentTextbookIds=null 时也不应崩溃', () => {
      const tNull = baseTeacher();
      tNull.inherentTextbookIds = null;
      tNull.assignedTextbookIds = new Set();
      const c = baseClass();
      expect(() => calcMatchScore(tNull, c)).not.toThrow();
    });
  });

  describe('教材内聚惩罚（PENALTY_PER_NEW）', () => {
    it('tbCount=0 的教师接班级时，新增 N 本教材应扣 N * PENALTY_PER_NEW', () => {
      // 使用 tbCount=0 的教师，避免阶段链惩罚干扰
      const t = baseTeacher();
      t.assignedTextbookIds = new Set(); // tbCount = 0
      t.inherentTextbookIds = [];

      // 班级教材 [300]：教师无教材，所以 300 是"新增"的
      // 但 PENALTY_PER_NEW 只在 cls.textbookIds 有值且 assignedTextbookIds 有值时触发
      // 当 assignedTextbookIds 为空时，newCount = cls.textbookIds.length
      // 所以仍然会扣分

      const c0 = baseClass();
      c0.textbookIds = [300]; // 1 本新增

      const c1 = baseClass();
      c1.textbookIds = [300, 301]; // 2 本新增

      // 注意：tbCount=0 触发 ZERO_TEXTBOOK_BONUS，但两个 case 都触发，差值不受影响
      const score0 = calcMatchScore(t, c0);
      const score1 = calcMatchScore(t, c1);

      // 差值应为 PENALTY_PER_NEW（因为多 1 本新增）
      expect(score0 - score1).toBe(C.PENALTY_PER_NEW);
    });
  });

  describe('教材数量分级奖惩', () => {
    it('教师教材数为 0 时应比教材数为 2 时高（ZERO_TEXTBOOK_BONUS 生效）', () => {
      const c = baseClass(); // [300]

      // t0: tbCount=0, t2: tbCount=2 (已满，不接新教材时不被惩罚)
      const t0 = baseTeacher();
      t0.assignedTextbookIds = new Set();
      t0.inherentTextbookIds = [];

      const t2 = baseTeacher();
      t2.assignedTextbookIds = new Set([300, 301]);
      t2.inherentTextbookIds = [300, 301];

      // c: [300], t2 已持有 300 → newCount=0 → 不触发 -10000
      const score0 = calcMatchScore(t0, c);
      const score2 = calcMatchScore(t2, c);

      // t0 有 ZERO_TEXTBOOK_BONUS (30分)，t2 没有
      // 但 t2 可能触发了其他惩罚/奖励，所以只断言 t0 > t2
      expect(score0).toBeGreaterThan(score2);
    });

    it('教师已有 MAX 本教材且接新班需新教材时，分数应极低（< -9000）', () => {
      const t = baseTeacher();
      t.assignedTextbookIds = new Set([300, 301]); // MAX=2
      t.inherentTextbookIds = [300, 301];
      const c = baseClass();
      c.textbookIds = [302]; // 需要新教材 → 超上限

      const score = calcMatchScore(t, c);
      expect(score).toBeLessThan(-9000); // base - 10000
    });
  });

  describe('同学院内聚奖励（硬编码 +3）', () => {
    it('教师已接过该学院班级时应比没接过高 3 分', () => {
      const c = baseClass(); // collegeId: 10

      const tNoBonus = baseTeacher();
      tNoBonus.assignedCollegeIds = new Set();

      const tWithBonus = baseTeacher();
      tWithBonus.assignedCollegeIds = new Set([10]);

      const scoreNoBonus = calcMatchScore(tNoBonus, c);
      const scoreWithBonus = calcMatchScore(tWithBonus, c);
      expect(scoreWithBonus - scoreNoBonus).toBe(3);
    });
  });
});

// ──────────────────────────────────────────────
// isTeacherEligible
// ──────────────────────────────────────────────
describe('isTeacherEligible', () => {
  const mode = 'standard';

  it('容量足够时应返回 true', () => {
    const t = baseTeacher();
    t.standardCap = 16;
    t.fullCap = 20;
    t.assignedHours = 4;
    const c = baseClass();
    c.weeklyHours = 4;
    expect(isTeacherEligible(t, c, mode)).toBe(true);
  });

  it('容量不足时应返回 false', () => {
    const t = baseTeacher();
    t.standardCap = 16;
    t.fullCap = 20;
    t.assignedHours = 14;
    const c = baseClass();
    c.weeklyHours = 4; // 14+4 > 16
    expect(isTeacherEligible(t, c, mode)).toBe(false);
  });

  it('学院限制不匹配时应返回 false', () => {
    const t = baseTeacher();
    t.schedulingCollegeIds = [99];
    const c = baseClass(); // collegeId: 10
    expect(isTeacherEligible(t, c, mode)).toBe(false);
  });

  it('学院限制为空时应忽略', () => {
    const t = baseTeacher();
    t.schedulingCollegeIds = [];
    const c = baseClass();
    expect(isTeacherEligible(t, c, mode)).toBe(true);
  });

  it('层次限制不匹配时应返回 false', () => {
    const t = baseTeacher();
    t.schedulingLevelIds = [99];
    const c = baseClass(); // trainingLevelId: 20
    expect(isTeacherEligible(t, c, mode)).toBe(false);
  });

  it('教材硬上限：已有 MAX 本且需新教材时应返回 false', () => {
    const t = baseTeacher();
    t.assignedTextbookIds = new Set([300, 301]);
    t.inherentTextbookIds = [300, 301];
    const c = baseClass();
    c.textbookIds = [302];
    expect(isTeacherEligible(t, c, mode)).toBe(false);
  });

  it('教材硬上限：已有 MAX 本但无需新教材时应返回 true', () => {
    const t = baseTeacher();
    t.assignedTextbookIds = new Set([300, 301]);
    t.inherentTextbookIds = [300, 301];
    const c = baseClass();
    c.textbookIds = [300];
    expect(isTeacherEligible(t, c, mode)).toBe(true);
  });
});

// ──────────────────────────────────────────────
// calcAllMatchRates
// ──────────────────────────────────────────────
describe('calcAllMatchRates', () => {
  it('完全匹配时匹配率应为 100%', () => {
    const assignments = [{ teacher_id: 1, class_id: 100 }];
    const classes = [{ classId: 100, collegeId: 10, trainingLevelId: 20, textbookIds: [300] }];
    const teacherMap = new Map([
      [1, { schedulingCollegeIds: [10], schedulingLevelIds: [20], inherentTextbookIds: [300] }],
    ]);

    const result = calcAllMatchRates(assignments, classes, teacherMap);
    expect(result.collegeMatchRate).toBe(100);
    expect(result.textbookMatchRate).toBe(100);
    expect(result.levelMatchRate).toBe(100);
  });

  it('完全不匹配时匹配率应为 0%', () => {
    const assignments = [{ teacher_id: 1, class_id: 100 }];
    const classes = [{ classId: 100, collegeId: 10, trainingLevelId: 20, textbookIds: [300] }];
    const teacherMap = new Map([
      [1, { schedulingCollegeIds: [99], schedulingLevelIds: [99], inherentTextbookIds: [999] }],
    ]);

    const result = calcAllMatchRates(assignments, classes, teacherMap);
    expect(result.collegeMatchRate).toBe(0);
    expect(result.textbookMatchRate).toBe(0);
    expect(result.levelMatchRate).toBe(0);
  });

  it('无安排时 denominator 保护为 1，不应崩溃', () => {
    const result = calcAllMatchRates([], [], new Map());
    expect(result.collegeMatchRate).toBe(0);
    expect(result.textbookCohesionRate).toBe(100);
  });

  it('同一教师接 2 班用同一教材 → 内聚度 100', () => {
    const assignments = [
      { teacher_id: 1, class_id: 100 },
      { teacher_id: 1, class_id: 101 },
    ];
    const classes = [
      { classId: 100, collegeId: 10, trainingLevelId: 20, textbookIds: [300] },
      { classId: 101, collegeId: 10, trainingLevelId: 20, textbookIds: [300] },
    ];
    const teacherMap = new Map([
      [1, { schedulingCollegeIds: [10], schedulingLevelIds: [20], inherentTextbookIds: [] }],
    ]);

    const result = calcAllMatchRates(assignments, classes, teacherMap);
    expect(result.textbookCohesionRate).toBe(100);
    expect(result.avgTextbookPerTeacher).toBe(1);
  });

  it('同一教师接 2 班用 2 本不同教材 → 内聚度 50', () => {
    const assignments = [
      { teacher_id: 1, class_id: 100 },
      { teacher_id: 1, class_id: 101 },
    ];
    const classes = [
      { classId: 100, collegeId: 10, trainingLevelId: 20, textbookIds: [300] },
      { classId: 101, collegeId: 10, trainingLevelId: 20, textbookIds: [301] },
    ];
    const teacherMap = new Map([
      [1, { schedulingCollegeIds: [10], schedulingLevelIds: [20], inherentTextbookIds: [] }],
    ]);

    const result = calcAllMatchRates(assignments, classes, teacherMap);
    expect(result.textbookCohesionRate).toBe(50);
    expect(result.avgTextbookPerTeacher).toBe(2);
  });
});
