/**
 * 标准课时保障轮专项测试
 *
 * 背景：五阶段贪心按"剩余容量降序"选教师，大容量教师先整组吃光班级，
 * 导致教师充足时仍随机出现个别教师欠标准课时。保障轮在阶段1（意向教师）
 * 之后按 专职 > 兼职 > 外聘、缺口降序 让有缺口教师优先拿班，
 * 拿到标准课时即停（不吃到 max）。
 *
 * 策略：与 auto-arrange.phase1.test.js 一致，mock queries.js 数据源 + prisma，
 * 以 preview 模式跑完整 autoArrange 主流程。
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
  INHERENT_CLASS: { ENABLED: false, CONTINUITY_WEIGHT: 8 },
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
  part_time: { standard: 12, max: 16 },
  external: { standard: 12, max: 16 },
};

/** 教师 fixture（getTeachersForCourse 返回形状） */
function makeTeacher(id, personnelType, overrides = {}) {
  return {
    id,
    name: `T${id}`,
    personnelType,
    defaultWeeklyHours: null,
    schedulingCollegeIds: [],
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
function makeClass(classId, weeklyHours, textbookId = 5, collegeId = 1) {
  return {
    classId,
    className: `班级${classId}`,
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

const hoursOf = (result, teacherId) =>
  result.assigned
    .filter((a) => a.teacher_id === teacherId)
    .reduce((s, a) => s + a.weekly_hours, 0);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.teaching_assignments.findMany.mockResolvedValue([]);
  prismaMock.teaching_assignments.count.mockResolvedValue(0);
  prismaMock.system_settings.findUnique.mockResolvedValue(null);
});

describe('标准课时保障轮', () => {
  it('课时充足（总需求=专职标准之和）：前两位教师达到标准课时（旧贪心会一人吃光）', async () => {
    // 3 位专职（标准16），8 个 4h 班共 32h = 2×16：
    // 保障轮按缺口优先补足，前两位各拿 16h；T3 无剩余班级，欠课时告警（总需求本就不足 3 人）
    const classes = Array.from({ length: 8 }, (_, i) => makeClass(101 + i, 4));
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'full_time'),
      makeTeacher(2, 'full_time'),
      makeTeacher(3, 'full_time'),
    ]);

    const result = await runArrange();

    const hours = [1, 2, 3].map((id) => hoursOf(result, id)).sort((a, b) => b - a);
    expect(hours[0]).toBe(16);
    expect(hours[1]).toBe(16);
    expect(hours[2]).toBe(0);
    expect(result.unassignedCount).toBe(0);
    // T3 欠课时告警（总需求 32h < 3×16h，属真实欠课时）
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('T3');
  });

  it('重复运行结果确定（无随机欠课时教师漂移）', async () => {
    const classes = Array.from({ length: 8 }, (_, i) => makeClass(101 + i, 4));
    const teachers = () => [
      makeTeacher(1, 'full_time'),
      makeTeacher(2, 'full_time'),
      makeTeacher(3, 'full_time'),
    ];
    getClassesWithCourseFn.mockResolvedValue(classes);

    getTeachersForCourseFn.mockResolvedValue(teachers());
    const r1 = await runArrange();
    getTeachersForCourseFn.mockResolvedValue(teachers());
    const r2 = await runArrange();

    const sig = (r) =>
      r.assigned
        .map((a) => `${a.teacher_id}:${a.class_id}`)
        .sort()
        .join(',');
    expect(sig(r2)).toBe(sig(r1));
  });

  it('课时紧张：专职先填满，其次兼职，最后外聘', async () => {
    // 各类别标准均为 12（小时配置覆写），5 个 4h 班共 20h < 3×12=36：
    // 专职拿 12、兼职拿 8、外聘拿 0（按类别序 + 缺口降序）
    const settings = {
      full_time: { standard: 12, max: 20 },
      part_time: { standard: 12, max: 16 },
      external: { standard: 12, max: 16 },
    };
    const classes = Array.from({ length: 5 }, (_, i) => makeClass(101 + i, 4));
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'external'), // 故意把外聘放数组前面，验证排序不依赖输入顺序
      makeTeacher(2, 'part_time'),
      makeTeacher(3, 'full_time'),
    ]);

    const result = await autoArrange(1, '2026-2027-1', 'standard', settings, null, {
      preview: true,
    });

    expect(hoursOf(result, 3)).toBe(12); // 专职先满
    expect(hoursOf(result, 2)).toBe(8); // 兼职次之
    expect(hoursOf(result, 1)).toBe(0); // 外聘最后，允许欠课时
    expect(result.unassignedCount).toBe(0);
  });

  it('保障轮不超拿：教师到标准课时即停，剩余班级留给他人', async () => {
    // 1 专职（标准16/上限20）+ 1 兼职（标准12）：6 个 4h 班共 24h
    // 保障轮专职先拿 16h 即停（不吃到 20），兼职拿剩余 8h
    const classes = Array.from({ length: 6 }, (_, i) => makeClass(101 + i, 4));
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'full_time'),
      makeTeacher(2, 'part_time'),
    ]);

    const result = await runArrange();

    expect(hoursOf(result, 1)).toBe(16);
    expect(hoursOf(result, 2)).toBe(8);
    expect(result.unassignedCount).toBe(0);
  });

  it('意向教师在保障轮内不拿意向范围外班级', async () => {
    // T1 意向学院2（标准16），学院2 内仅 8h；学院1 有 8h 无偏好教师 T2 可拿
    const classes = [
      makeClass(101, 4, 5, 2),
      makeClass(102, 4, 5, 2),
      makeClass(103, 4, 5, 1),
      makeClass(104, 4, 5, 1),
    ];
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'full_time', { schedulingCollegeIds: [2] }),
      makeTeacher(2, 'full_time'),
    ]);

    const result = await runArrange();

    const mine = result.assigned.filter((a) => a.teacher_id === 1);
    expect(mine.reduce((s, a) => s + a.weekly_hours, 0)).toBe(8);
    // 意向硬约束：T1 不得拿学院1的班级（103/104）
    expect(mine.map((a) => a.class_id).sort()).toEqual([101, 102]);
    expect(hoursOf(result, 2)).toBe(8);
    expect(result.unassignedCount).toBe(0);
  });

  it('保障轮中单教材开关仍生效：受限教师只拿已持教材班级', async () => {
    // T1 开启单教材开关且已持教材5：tb6 班级不得被 T1 拿走
    const classes = [
      makeClass(101, 4, 6),
      makeClass(102, 4, 6),
      makeClass(103, 4, 5),
    ];
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'full_time', {
        singleTextbookOnly: true,
        textbookIds: [5],
        inherentTextbookIds: [5],
        assignedTextbookIds: new Set([5]),
      }),
      makeTeacher(2, 'full_time'),
    ]);

    const result = await runArrange();

    const mine = result.assigned.filter((a) => a.teacher_id === 1);
    expect(mine.map((a) => a.class_id)).toEqual([103]);
    expect(hoursOf(result, 2)).toBe(8); // tb6 两班归 T2
    expect(result.unassignedCount).toBe(0);
  });

  it('手动排课已达标准的教师不参与保障轮抢课', async () => {
    // T1 已有 16h 手动安排（满标准，totalWeeklyHours 由 queries 层汇总反映）；
    // 剩余 2 个 4h 班由 T2/T3 分配
    prismaMock.teaching_assignments.findMany
      .mockResolvedValueOnce([
        { teacher_id: 1, class_id: 900, weekly_hours: 16, is_auto: false },
      ]) // manualAssignments
      .mockResolvedValueOnce([]) // lockedAssignments
      .mockResolvedValueOnce([]); // currentAutoAssignments
    const classes = [
      makeClass(101, 4),
      makeClass(102, 4),
      makeClass(900, 16), // 已被手动安排的班级（会被排除）
    ];
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'full_time', { totalWeeklyHours: 16 }), // 手动课时已计入
      makeTeacher(2, 'full_time'),
      makeTeacher(3, 'full_time'),
    ]);

    const result = await runArrange();

    expect(hoursOf(result, 1)).toBe(0); // 已达标，不再抢课
    expect(hoursOf(result, 2) + hoursOf(result, 3)).toBe(8);
  });

  it('保障轮后仍欠课时的教师输出告警（与 F12 意向预警去重）', async () => {
    // T1 意向学院2但学院2无班级：F12 预警 + 保障轮无法补足，只告警一次；
    // T2 无偏好但班级不足（8h < 标准16h）：输出欠课时告警
    const classes = [makeClass(101, 4, 5, 1), makeClass(102, 4, 5, 1)];
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'full_time', { schedulingCollegeIds: [2] }),
      makeTeacher(2, 'full_time'),
    ]);

    const result = await runArrange();

    const t1Warnings = result.warnings.filter((w) => w.includes('T1'));
    expect(t1Warnings).toHaveLength(1); // F12 与欠课时告警去重
    expect(t1Warnings[0]).toContain('意向范围内供给');
    const t2Warnings = result.warnings.filter((w) => w.includes('T2'));
    expect(t2Warnings).toHaveLength(1);
    expect(t2Warnings[0]).toContain('目标课时未满足');
  });
});

describe('自定义课时最高优先级', () => {
  it('自定义 < 类别标准：standard 模式容量收紧为自定义值，课时充足也不超拿', async () => {
    // T1 自定义 10（< 标准16）：13 个 2h 班共 26h，T2 先补足标准 16，
    // T1 拿到自定义上限 10 即停（第三组 12h > 10 不得拿）
    const classes = Array.from({ length: 13 }, (_, i) => makeClass(101 + i, 2));
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'full_time', { defaultWeeklyHours: 10 }),
      makeTeacher(2, 'full_time'),
    ]);

    const result = await runArrange();

    expect(hoursOf(result, 1)).toBe(10);
    expect(hoursOf(result, 2)).toBe(16);
    expect(result.unassignedCount).toBe(0);
  });

  it('自定义 > 类别上限：full 模式可放宽到自定义值（不再受类别 max 约束）', async () => {
    // T1 自定义 24（> max 20）：full 模式 fullCap = 24，6 个 4h 班全部吃下
    // （旧口径 min(自定义, max)=20 会导致 4h 未分配）
    const classes = Array.from({ length: 6 }, (_, i) => makeClass(101 + i, 4));
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'full_time', { defaultWeeklyHours: 24 }),
    ]);

    const result = await autoArrange(1, '2026-2027-1', 'full', HOUR_SETTINGS, null, {
      preview: true,
    });

    expect(hoursOf(result, 1)).toBe(24);
    expect(result.unassignedCount).toBe(0);
  });

  it('自定义 > 类别标准：保障轮只补到类别标准（guaranteeCap），不挤占他人达标课时', async () => {
    // T1 自定义 24（> 标准16）+ T2 无自定义：8 个 4h 班共 32h = 2×16
    // 保障轮按 guaranteeCap=16 各补 16；若保障轮误用 standardCap=24，
    // T1 会先拿 24 导致 T2 只剩 8h 而欠课时
    const classes = Array.from({ length: 8 }, (_, i) => makeClass(101 + i, 4));
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'full_time', { defaultWeeklyHours: 24 }),
      makeTeacher(2, 'full_time'),
    ]);

    const result = await runArrange();

    expect(hoursOf(result, 1)).toBe(16);
    expect(hoursOf(result, 2)).toBe(16);
    expect(result.unassignedCount).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('自定义教师欠课时告警：缺口按自定义值计算，措辞体现自定义来源', async () => {
    // T1 自定义 10 但只有 8h 班级：告警目标 10h、还差 2h，且标注目标取自定义口径
    const classes = [makeClass(101, 4), makeClass(102, 4)];
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'full_time', { defaultWeeklyHours: 10 }),
    ]);

    const result = await runArrange();

    expect(hoursOf(result, 1)).toBe(8);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('目标课时未满足');
    expect(result.warnings[0]).toContain('目标 10 h');
    expect(result.warnings[0]).toContain('还差 2 h');
    expect(result.warnings[0]).toContain('自定义课时');
  });
});

describe('自定义课时硬保障开关', () => {
  it('开关开启：保障目标提升为自定义值，课时充足时补到自定义课时', async () => {
    // T1 自定义 24（> 标准16）+ T2 无自定义：10 个 4h 班共 40h = 24 + 16
    // 开关开启后 T1 保障目标 = 24（缺口 8 大于 T2，保障轮先补满 T1），T2 拿 16
    const classes = Array.from({ length: 10 }, (_, i) => makeClass(101 + i, 4));
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'full_time', { defaultWeeklyHours: 24 }),
      makeTeacher(2, 'full_time'),
    ]);

    const result = await runArrange({ customHoursGuarantee: true });

    expect(hoursOf(result, 1)).toBe(24);
    expect(hoursOf(result, 2)).toBe(16);
    expect(result.unassignedCount).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('开关开启：未设自定义课时的教师行为不变（仍按类别标准保障）', async () => {
    // 同场景对照：T2 无自定义，保障目标仍为类别标准 16，不受开关影响
    const classes = Array.from({ length: 10 }, (_, i) => makeClass(101 + i, 4));
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'full_time', { defaultWeeklyHours: 24 }),
      makeTeacher(2, 'full_time'),
    ]);

    const result = await runArrange({ customHoursGuarantee: true });

    expect(hoursOf(result, 2)).toBe(16); // 类别标准，未被膨胀到自定义口径
    expect(result.unassignedCount).toBe(0);
  });

  it('开关关闭（默认）：保障轮仍只补到类别标准，剩余需求不强制喂给高自定义教师', async () => {
    // 与开关开启对照：9 个 4h 班共 36h，保障轮各补 16（共 32）后剩 4h 由后续阶段分配；
    // 保障目标仍为 min(自定义, 标准)=16，不因自定义 24 而强制补到 24
    const classes = Array.from({ length: 9 }, (_, i) => makeClass(101 + i, 4));
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'full_time', { defaultWeeklyHours: 24 }),
      makeTeacher(2, 'full_time'),
    ]);

    const result = await runArrange();

    // 保障轮只把 T1 补到类别标准 16（未强补到 24），剩余 4h 由后续阶段按剩余容量分给 T1
    expect(hoursOf(result, 1)).toBe(20);
    expect(hoursOf(result, 2)).toBe(16);
    expect(result.unassignedCount).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('开关开启且供给不足：排课照常成功，欠课时告警标注硬保障口径', async () => {
    // T1 自定义 24 但仅 8h 供给：目标 24 无法满足，仅告警不阻断
    const classes = [makeClass(101, 4), makeClass(102, 4)];
    getClassesWithCourseFn.mockResolvedValue(classes);
    getTeachersForCourseFn.mockResolvedValue([
      makeTeacher(1, 'full_time', { defaultWeeklyHours: 24 }),
    ]);

    const result = await runArrange({ customHoursGuarantee: true });

    expect(hoursOf(result, 1)).toBe(8);
    expect(result.unassignedCount).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('目标课时未满足');
    expect(result.warnings[0]).toContain('目标 24 h');
    expect(result.warnings[0]).toContain('还差 16 h');
    expect(result.warnings[0]).toContain('硬保障已开启');
  });
});
