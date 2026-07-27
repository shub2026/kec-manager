/**
 * autoArrange 阶段1（意向教师教材组选取）集成回归测试
 *
 * 回归场景（蒋梅案例）：意向教师的教材组选取按"本人意向范围内可拿课时"降序，
 * 而非全局需求顺序，防止零头组烧掉教材名额（MAX_TEXTBOOKS_PER_TEACHER）
 * 导致意向内课时充足却欠分配。
 *
 * 策略：mock queries.js 数据源 + prisma，以 preview 模式跑完整 autoArrange 主流程
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getClassesWithCourseFn, getTeachersForCourseFn, prismaMock } = vi.hoisted(() => ({
  getClassesWithCourseFn: vi.fn(),
  getTeachersForCourseFn: vi.fn(),
  prismaMock: {
    teaching_assignments: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    system_settings: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

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
  TABU_SEARCH: { ENABLED: false },
  SWAP_CONFIG: { MAX_DEPTH: 3, MAX_UNASSIGNED: 30 },
}));

vi.mock('../../../utils/logger.js', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: prismaMock }));

// B-01: 数据库锁直接放行
vi.mock('../lock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

// mock 数据源；匹配工具函数与真实实现保持一致（纯函数，逻辑拷贝）
vi.mock('../queries.js', () => ({
  getClassesWithCourse: getClassesWithCourseFn,
  getTeachersForCourse: getTeachersForCourseFn,
  isTextbookMatch: (teacher, cls) => {
    const inherentIds = teacher.inherentTextbookIds ?? teacher.textbookIds;
    if (!cls.textbookIds?.length) return false;
    if (!inherentIds?.length) return true;
    return inherentIds.some((tid) => cls.textbookIds.includes(tid));
  },
  isCollegeEligible: (t, cls) => {
    if (!t.schedulingCollegeIds || t.schedulingCollegeIds.length === 0) return true;
    return t.schedulingCollegeIds.includes(cls.collegeId);
  },
  isLevelEligible: (t, cls) => {
    if (!t.schedulingLevelIds || t.schedulingLevelIds.length === 0) return true;
    if (!cls.trainingLevelId) return false;
    return t.schedulingLevelIds.includes(cls.trainingLevelId);
  },
}));

const { autoArrange } = await import('../auto-arrange.js');

const HOUR_SETTINGS = {
  full_time: { standard: 16, max: 20 },
  part_time: { standard: 8, max: 10 },
  external: { standard: 12, max: 16 },
};

/** 意向教师（专职，标准16节），意向学院=2 */
function prefTeacher(overrides = {}) {
  return {
    id: 1,
    name: '意向教师',
    personnelType: 'full_time',
    defaultWeeklyHours: null,
    schedulingCollegeIds: [2],
    schedulingLevelIds: [],
    textbookIds: [],
    inherentTextbookIds: [],
    assignedTextbookIds: new Set(),
    assignedCollegeIds: new Set(),
    totalWeeklyHours: 0,
    totalClassCount: 0,
    courseHours: 0,
    courseClassCount: 0,
    ...overrides,
  };
}

/** 班级 fixture（getClassesWithCourse 返回形状，textbooks 为对象数组） */
function makeClass(classId, collegeId, weeklyHours, textbookId, name = null) {
  return {
    classId,
    className: name || `班级${classId}`,
    collegeId,
    collegeName: `学院${collegeId}`,
    majorId: 1,
    majorName: '专业',
    trainingLevelId: 20,
    trainingLevelName: '层次',
    combinationId: null,
    grade: 1,
    enrollmentYear: 2026,
    studentCount: 40,
    currentSemester: 1,
    weeklyHours,
    weeksCount: 18,
    totalHours: weeklyHours * 18,
    textbooks: [{ id: textbookId, title: `教材${textbookId}` }],
  };
}

function runArrange(options = {}) {
  return autoArrange(1, '2026-2027-1', 'standard', HOUR_SETTINGS, null, {
    preview: true,
    ...options,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.teaching_assignments.findMany.mockResolvedValue([]);
  prismaMock.teaching_assignments.count.mockResolvedValue(0);
  prismaMock.system_settings.findUnique.mockResolvedValue(null);
});

describe('阶段1：意向教师按可拿课时最大的教材组优先（蒋梅场景回归）', () => {
  it('全局需求大的零头组不应烧掉教材名额，教师应拿满意向内课时充足的组', async () => {
    // G1(tb157) 全局需求最大(44h)但学院2内仅 4h；G2(tb158) 18h 但学院2内仅 2h；
    // G3(tb161) 全局需求最小(16h)但全部在学院2 —— 恰好排满标准 16 节
    const classes = [
      // G1: 10 个学院1班（4h）+ 1 个学院2班（4h）
      ...Array.from({ length: 10 }, (_, i) => makeClass(101 + i, 1, 4, 157)),
      makeClass(111, 2, 4, 157),
      // G2: 8 个学院1班（2h）+ 1 个学院2班（2h）
      ...Array.from({ length: 8 }, (_, i) => makeClass(201 + i, 1, 2, 158)),
      makeClass(209, 2, 2, 158),
      // G3: 8 个学院2班（2h）
      ...Array.from({ length: 8 }, (_, i) => makeClass(301 + i, 2, 2, 161)),
    ];
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([prefTeacher()]);

    const result = await runArrange();

    const mine = result.assigned.filter((a) => a.teacher_id === 1);
    const totalHours = mine.reduce((s, a) => s + a.weekly_hours, 0);
    // 拿满标准课时 16 节，且全部来自 G3（tb161）
    expect(totalHours).toBe(16);
    expect(mine.map((a) => a.class_id).sort()).toEqual([301, 302, 303, 304, 305, 306, 307, 308]);
    // 意向严格性：不得分配学院1的班级
    const c1Ids = new Set(classes.filter((c) => c.collegeId === 1).map((c) => c.classId));
    expect(mine.some((a) => c1Ids.has(a.class_id))).toBe(false);
    // 学院2内的零头班（111/209）留给他人/未分配，而非烧教师教材名额
    expect(result.unassigned.map((u) => u.classId)).toEqual(expect.arrayContaining([111, 209]));
  });

  it('已持教材的组应优先追加（tier 0），再在教材名额内开新组', async () => {
    // 教师已持有 tb158（来自前序课程 globalTextbookMap）
    // 学院2内：tb158 两个班共 4h，tb161 八个班共 16h
    const classes = [
      makeClass(401, 2, 2, 158),
      makeClass(402, 2, 2, 158),
      ...Array.from({ length: 8 }, (_, i) => makeClass(301 + i, 2, 2, 161)),
    ];
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([prefTeacher()]);

    const result = await runArrange({ globalTextbookMap: new Map([[1, new Set([158])]]) });

    const mine = result.assigned.filter((a) => a.teacher_id === 1);
    const mineIds = new Set(mine.map((a) => a.class_id));
    // 先拿完已持教材 tb158 的 2 个班，再从 tb161 补足到 16 节
    expect(mineIds.has(401)).toBe(true);
    expect(mineIds.has(402)).toBe(true);
    expect(mine.reduce((s, a) => s + a.weekly_hours, 0)).toBe(16);
  });

  it('教材名额已满时不得开新教材组', async () => {
    // 教师已持 2 本教材（上限），学院2内只有 tb161 新教材组
    const classes = Array.from({ length: 8 }, (_, i) => makeClass(301 + i, 2, 2, 161));
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([prefTeacher()]);

    const result = await runArrange({
      globalTextbookMap: new Map([[1, new Set([157, 158])]]),
    });

    expect(result.assigned.filter((a) => a.teacher_id === 1)).toHaveLength(0);
    expect(result.unassignedCount).toBe(8);
  });

  it('审计修复回归：DB 教材种子与 globalTextbookMap 应取并集而非替换', async () => {
    // DB 已排记录解析出教材 157（assignedTextbookIds 种子）+ 前序课程累计 158，
    // 并集后已持 2 本达上限 → 不得开 tb161 新组；
    // 旧替换式合并会丢失 157，误判为仅持 1 本而放行
    const classes = Array.from({ length: 8 }, (_, i) => makeClass(301 + i, 2, 2, 161));
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      prefTeacher({ assignedTextbookIds: new Set([157]) }),
    ]);

    const result = await runArrange({
      globalTextbookMap: new Map([[1, new Set([158])]]),
    });

    expect(result.assigned.filter((a) => a.teacher_id === 1)).toHaveLength(0);
    expect(result.unassignedCount).toBe(8);
  });

  it('多位意向教师共享意向学院时不应互相锁死', async () => {
    // 两位意向学院=2 的教师，学院2内 tb161 共 12 个班 24h：
    // 教师A拿满16h后，教师B应能继续拿剩余 8h
    const classes = Array.from({ length: 12 }, (_, i) => makeClass(301 + i, 2, 2, 161));
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      prefTeacher(),
      prefTeacher({
        id: 2,
        name: '意向教师B',
        assignedTextbookIds: new Set(),
        assignedCollegeIds: new Set(),
      }),
    ]);

    const result = await runArrange();

    const hoursOf = (tid) =>
      result.assigned.filter((a) => a.teacher_id === tid).reduce((s, a) => s + a.weekly_hours, 0);
    expect(hoursOf(1) + hoursOf(2)).toBe(24);
    expect(Math.max(hoursOf(1), hoursOf(2))).toBe(16);
    expect(result.unassignedCount).toBe(0);
  });
});
