/**
 * teaching-statistics.service.js 单元测试
 *
 * 覆盖合班去重纯函数：
 * - dedupeTeachingUnits：将同一 (combination_id ?? class_id, course_id, teacher_id)
 *   的多个成员班行归并为 1 个"逻辑教学单元"，周课时只计 1 次。
 * - isCombinedUnit：成员班级数 > 1 即视为合班单元。
 * - dedupeClassUnits：应排班级维度合班归并（课时取代表班值）。
 * - resolveClassCourseTextbooks：班级×课程教材解析链路（方案匹配+学期换算+归档排除）。
 *
 * 重点关注易回归的边界：
 * 1. 合班正常合并，课时只计一次（防虚高）
 * 2. 合班但不同教师分上 → 不被误合并
 * 3. 缺 class_id 但有 combination_id → 仍能按组合去重（修复回归测试 mock 坑后锁定）
 * 4. 缺 combination_id 且缺 class_id → 退化回退键，每行被合并（记录当前行为）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dedupeTeachingUnits, isCombinedUnit } from '../teaching-statistics.service.js';

// ── resolveClassCourseTextbooks 依赖 mock（vi.mock 提升，先于模块加载生效）──
const mockPrisma = vi.hoisted(() => ({
  plan_courses: { findMany: vi.fn().mockResolvedValue([]) },
  textbooks: { findMany: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../plan.service.js', () => ({ findBestMatchPlan: vi.fn() }));
vi.mock('../semester.service.js', () => ({ calcClassSemester: vi.fn() }));

const { dedupeClassUnits, resolveClassCourseTextbooks } = await import(
  '../teaching-statistics.service.js'
);
const { findBestMatchPlan } = await import('../plan.service.js');
const { calcClassSemester } = await import('../semester.service.js');

// 构造一条 teaching_assignments 行
function row(overrides = {}) {
  return {
    class_id: 1,
    course_id: 10,
    teacher_id: 1,
    weekly_hours: 4,
    is_auto: false,
    class: { id: 1, name: 'A班', combination_id: null },
    course: { id: 10, name: '数学' },
    ...overrides,
  };
}

describe('dedupeTeachingUnits', () => {
  it('非合班：不同班级各为独立单元', () => {
    const rows = [
      row({ class_id: 1, class: { id: 1, name: 'A班', combination_id: null } }),
      row({ class_id: 2, class: { id: 2, name: 'B班', combination_id: null } }),
    ];
    const units = dedupeTeachingUnits(rows);
    expect(units).toHaveLength(2);
    expect(units.every((u) => !isCombinedUnit(u))).toBe(true);
    // 课时各自保留
    expect(units.reduce((s, u) => s + u.weeklyHours, 0)).toBe(8);
  });

  it('合班：同组合+同课程+同教师 → 合并为 1 单元，课时仅计 1 次', () => {
    const rows = [
      row({ class_id: 1, weekly_hours: 4, class: { id: 1, name: 'A班', combination_id: 99 } }),
      row({ class_id: 2, weekly_hours: 4, class: { id: 2, name: 'B班', combination_id: 99 } }),
    ];
    const units = dedupeTeachingUnits(rows);
    expect(units).toHaveLength(1);
    // 关键：周课时只计一次（4），而非 8（防虚高）
    expect(units[0].weeklyHours).toBe(4);
    expect(units[0].memberClassIds).toEqual([1, 2]);
    expect(units[0].combinationId).toBe(99);
    expect(isCombinedUnit(units[0])).toBe(true);
  });

  it('合班但不同教师 → 不被误合并（各自为单元）', () => {
    const rows = [
      row({ class_id: 1, teacher_id: 1, class: { id: 1, name: 'A班', combination_id: 99 } }),
      row({ class_id: 2, teacher_id: 2, class: { id: 2, name: 'B班', combination_id: 99 } }),
    ];
    const units = dedupeTeachingUnits(rows);
    expect(units).toHaveLength(2);
    expect(units.every((u) => !isCombinedUnit(u))).toBe(true);
  });

  it('缺 class_id 但有 combination_id → 仍能按组合去重（防回归测试坑）', () => {
    // 复现 export 测试 mock 场景：teaching_assignments 行缺 class_id 外键
    const rows = [
      {
        course_id: 10,
        teacher_id: 1,
        weekly_hours: 4,
        class: { id: 1, name: 'A班', combination_id: 99 },
      },
      {
        course_id: 10,
        teacher_id: 1,
        weekly_hours: 4,
        class: { id: 2, name: 'B班', combination_id: 99 },
      },
    ];
    const units = dedupeTeachingUnits(rows);
    expect(units).toHaveLength(1);
    expect(units[0].weeklyHours).toBe(4);
    expect(isCombinedUnit(units[0])).toBe(true);
  });

  it('缺 combination_id 又缺 class_id → 退化为回退键，两行被合并', () => {
    // 真实数据外键恒在，此条仅记录退化行为：键都回退 'unknown' 而合并
    const rows = [
      { course_id: 10, teacher_id: 1, weekly_hours: 4, class: { combination_id: null } },
      { course_id: 10, teacher_id: 1, weekly_hours: 4, class: { combination_id: null } },
    ];
    const units = dedupeTeachingUnits(rows);
    expect(units).toHaveLength(1);
  });

  it('混合场景：1 个合班单元 + 1 个独立单元 → 共 2 单元，课时正确', () => {
    const rows = [
      row({ class_id: 1, weekly_hours: 4, class: { id: 1, name: 'A班', combination_id: 99 } }),
      row({ class_id: 2, weekly_hours: 4, class: { id: 2, name: 'B班', combination_id: 99 } }),
      row({
        class_id: 3,
        weekly_hours: 2,
        course_id: 20,
        class: { id: 3, name: 'C班', combination_id: null },
      }),
    ];
    const units = dedupeTeachingUnits(rows);
    expect(units).toHaveLength(2);
    expect(units.reduce((s, u) => s + u.weeklyHours, 0)).toBe(6); // 4 + 2，而非 10
    expect(units.filter(isCombinedUnit)).toHaveLength(1);
  });

  it('representative 透传原始行字段（is_auto 等）', () => {
    const r = row({
      class_id: 1,
      weekly_hours: 4,
      is_auto: true,
      class: { id: 1, name: 'A班', combination_id: 99 },
    });
    const units = dedupeTeachingUnits([r]);
    expect(units[0].representative.is_auto).toBe(true);
    expect(units[0].representative.class_id).toBe(1);
  });
});

describe('isCombinedUnit', () => {
  it('成员班级数 > 1 → true', () => {
    expect(isCombinedUnit({ memberClassIds: [1, 2] })).toBe(true);
  });
  it('成员班级数 = 1 → false', () => {
    expect(isCombinedUnit({ memberClassIds: [1] })).toBe(false);
  });
});

// ──────────────────────────────────────────────
// dedupeClassUnits（应排班级维度合班归并）
// ──────────────────────────────────────────────
describe('dedupeClassUnits', () => {
  it('非合班班级各自独立成单元', () => {
    const { units, classUnitMap } = dedupeClassUnits([
      { classId: 1, weeklyHours: 4, combinationId: null },
      { classId: 2, weeklyHours: 2, combinationId: null },
    ]);
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.key)).toEqual(['cls:1', 'cls:2']);
    expect(classUnitMap.get(1)).toBe('cls:1');
    expect(classUnitMap.get(2)).toBe('cls:2');
  });

  it('合班成员班归并为 1 单元，课时取代表班（首个成员）值', () => {
    const { units, classUnitMap } = dedupeClassUnits([
      { classId: 1, weeklyHours: 4, combinationId: 9 },
      { classId: 2, weeklyHours: 6, combinationId: 9 }, // 成员班课时不同也只取代表班
    ]);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ key: 'comb:9', combinationId: 9, weeklyHours: 4 });
    expect(units[0].memberClassIds).toEqual([1, 2]);
    expect(classUnitMap.get(1)).toBe('comb:9');
    expect(classUnitMap.get(2)).toBe('comb:9');
  });

  it('混合场景：合班单元 + 独立单元', () => {
    const { units } = dedupeClassUnits([
      { classId: 1, weeklyHours: 4, combinationId: 9 },
      { classId: 2, weeklyHours: 4, combinationId: 9 },
      { classId: 3, weeklyHours: 2, combinationId: null },
    ]);
    expect(units).toHaveLength(2);
    expect(units.reduce((s, u) => s + u.weeklyHours, 0)).toBe(6); // 4 + 2，而非 4+4+2
  });
});

// ──────────────────────────────────────────────
// resolveClassCourseTextbooks（教材解析链路）
// ──────────────────────────────────────────────
describe('resolveClassCourseTextbooks', () => {
  const semesterInfo = { startYear: 2026, endYear: 2027, term: 1 };
  const cls = {
    id: 1,
    name: 'A班',
    major_id: 5,
    training_level_id: null,
    custom_plan_id: null,
    enrollment_year: 2025,
    duration_years: 3,
  };
  const assignment = { class_id: 1, course_id: 10, teacher_id: 1, weekly_hours: 4, class: cls };
  const activePlan = {
    id: 100,
    major_id: 5,
    training_level_id: null,
    status: 'active',
    apply_from_year: null,
    apply_to_year: null,
  };
  const planCourse = {
    course_id: 10,
    training_plans: activePlan,
    plan_course_semesters: [
      { semester: 2, plan_textbooks: [{ textbook_id: 101 }, { textbook_id: 102 }] },
      { semester: 3, plan_textbooks: [{ textbook_id: 103 }] },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.plan_courses.findMany.mockResolvedValue([]);
    mockPrisma.textbooks.findMany.mockResolvedValue([]);
  });

  it('正常链路：匹配方案+学期命中 → 返回教材 ID 与标题映射', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([planCourse]);
    findBestMatchPlan.mockReturnValue(activePlan);
    calcClassSemester.mockReturnValue({ currentSemesterNum: 2 });
    mockPrisma.textbooks.findMany.mockResolvedValue([
      { id: 101, title: '教材A' },
      { id: 102, title: '教材B' },
    ]);

    const { idsMap, titleMap } = await resolveClassCourseTextbooks([assignment], semesterInfo);
    expect(idsMap.get('1:10')).toEqual([101, 102]);
    expect(titleMap.get(101)).toBe('教材A');
    expect(titleMap.get(102)).toBe('教材B');
  });

  it('归档方案不参与匹配候选', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([
      planCourse,
      {
        course_id: 10,
        training_plans: { id: 200, status: 'archived' },
        plan_course_semesters: [{ semester: 2, plan_textbooks: [{ textbook_id: 999 }] }],
      },
    ]);
    findBestMatchPlan.mockReturnValue(activePlan);
    calcClassSemester.mockReturnValue({ currentSemesterNum: 2 });

    await resolveClassCourseTextbooks([assignment], semesterInfo);
    const candidates = findBestMatchPlan.mock.calls[0][1];
    expect(candidates.map((p) => p.id)).toEqual([100]); // 归档的 200 被剔除
  });

  it('空安排或缺学期信息 → 空映射且不查库', async () => {
    const r1 = await resolveClassCourseTextbooks([], semesterInfo);
    const r2 = await resolveClassCourseTextbooks([assignment], null);
    expect(r1.idsMap.size).toBe(0);
    expect(r2.idsMap.size).toBe(0);
    expect(mockPrisma.plan_courses.findMany).not.toHaveBeenCalled();
  });

  it('课程无方案课程记录 → 空数组', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([]);
    const { idsMap } = await resolveClassCourseTextbooks([assignment], semesterInfo);
    expect(idsMap.get('1:10')).toEqual([]);
    expect(findBestMatchPlan).not.toHaveBeenCalled();
  });

  it('班级匹配不到方案 → 空数组', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([planCourse]);
    findBestMatchPlan.mockReturnValue(null);
    const { idsMap } = await resolveClassCourseTextbooks([assignment], semesterInfo);
    expect(idsMap.get('1:10')).toEqual([]);
    expect(calcClassSemester).not.toHaveBeenCalled();
  });

  it('学期换算失败（越界/缺数据）→ 空数组', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([planCourse]);
    findBestMatchPlan.mockReturnValue(activePlan);
    calcClassSemester.mockReturnValue(null);
    const { idsMap } = await resolveClassCourseTextbooks([assignment], semesterInfo);
    expect(idsMap.get('1:10')).toEqual([]);
  });

  it('当前学期无教材记录 → 空数组且不查教材标题', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([planCourse]);
    findBestMatchPlan.mockReturnValue(activePlan);
    calcClassSemester.mockReturnValue({ currentSemesterNum: 5 }); // 不在 2/3 中
    const { idsMap } = await resolveClassCourseTextbooks([assignment], semesterInfo);
    expect(idsMap.get('1:10')).toEqual([]);
    expect(mockPrisma.textbooks.findMany).not.toHaveBeenCalled();
  });

  it('行 class_id 与 class.id 不一致（班级信息缺失）→ 空数组', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([planCourse]);
    const broken = { ...assignment, class_id: 999 };
    const { idsMap } = await resolveClassCourseTextbooks([broken], semesterInfo);
    expect(idsMap.get('999:10')).toEqual([]);
    expect(findBestMatchPlan).not.toHaveBeenCalled();
  });

  it('同班级同课程重复安排行 → 键去重仅解析一次', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([planCourse]);
    findBestMatchPlan.mockReturnValue(activePlan);
    calcClassSemester.mockReturnValue({ currentSemesterNum: 2 });
    mockPrisma.textbooks.findMany.mockResolvedValue([{ id: 101, title: '教材A' }]);

    const { idsMap } = await resolveClassCourseTextbooks(
      [assignment, { ...assignment }],
      semesterInfo
    );
    expect(idsMap.size).toBe(1);
    expect(findBestMatchPlan).toHaveBeenCalledTimes(1);
  });
});
