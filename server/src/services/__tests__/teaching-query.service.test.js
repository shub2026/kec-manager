/**
 * teaching-query.service.js 单元测试
 *
 * 重点锁定「任课查询」两个视图刻意不同的合班口径：
 * - aggregateByTeacher：合班归并为逻辑教学单元（教师只上一遍课）
 * - aggregateByTextbook：按自然班计数（教材人手一本，合班不减用书量）
 *
 * 聚合函数均为纯函数，测试直接用真实的 dedupeTeachingUnits 构造快照，
 * 因此"教师视图归并 / 教材视图不归并"的差异是被真实验证的，而非 mock 出来的。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  teaching_assignments: { findMany: vi.fn().mockResolvedValue([]) },
  teachers: { findMany: vi.fn().mockResolvedValue([]) },
  textbooks: { findMany: vi.fn().mockResolvedValue([]) },
  training_levels: { findMany: vi.fn().mockResolvedValue([]) },
  plan_courses: { findMany: vi.fn().mockResolvedValue([]) },
  class_combinations: { findMany: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

const {
  aggregateByTeacher,
  aggregateByTextbook,
  buildLoadSummary,
  buildTeachingLoadSnapshot,
} = await import('../teaching-query.service.js');
const { dedupeTeachingUnits } = await import('../teaching-statistics.service.js');

/** 构造一条 teaching_assignments 行（字段与 fetchSemesterAssignments 的 include 一致） */
function assign(overrides = {}) {
  const {
    classId = 1,
    className = 'A班',
    courseId = 10,
    courseName = '数学',
    teacherId = 1,
    weeklyHours = 4,
    combinationId = null,
    collegeId = 3,
    collegeName = '信息学院',
    majorId = 5,
    majorName = '计算机',
    levelId = 7,
    levelName = '本科',
    studentCount = 40,
  } = overrides;
  return {
    class_id: classId,
    course_id: courseId,
    teacher_id: teacherId,
    weekly_hours: weeklyHours,
    is_auto: false,
    class: {
      id: classId,
      name: className,
      student_count: studentCount,
      combination_id: combinationId,
      college_id: collegeId,
      major_id: majorId,
      training_level_id: levelId,
      custom_plan_id: null,
      enrollment_year: 2024,
      duration_years: 4,
      colleges: collegeId == null ? null : { id: collegeId, name: collegeName },
      majors: majorId == null ? null : { id: majorId, name: majorName },
      training_levels: levelId == null ? null : { id: levelId, name: levelName },
    },
    course: { id: courseId, name: courseName },
  };
}

/** 构造快照：units 用真实 dedupeTeachingUnits 计算，保证合班口径被真实验证 */
function snapshot({
  rawAssignments,
  idsMap = new Map(),
  teachers = [],
  textbooks = [],
  combinationNoMap = new Map(),
}) {
  return {
    semester: '2025-2026-2',
    semesterInfo: { raw: '2025-2026-2', label: '2025-2026学年 春季(第2学期)' },
    rawAssignments,
    units: dedupeTeachingUnits(rawAssignments),
    idsMap,
    teacherMap: new Map(teachers.map((t) => [t.id, t])),
    textbookInfoMap: new Map(textbooks.map((t) => [t.id, t])),
    combinationNoMap,
  };
}

const TEXTBOOKS = [
  { id: 100, title: '高等数学（上）', isbn: '978-1', publisher: '高教社' },
  { id: 101, title: '线性代数', isbn: '978-2', publisher: '清华社' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.teaching_assignments.findMany.mockResolvedValue([]);
  mockPrisma.teachers.findMany.mockResolvedValue([]);
  mockPrisma.textbooks.findMany.mockResolvedValue([]);
  mockPrisma.plan_courses.findMany.mockResolvedValue([]);
  mockPrisma.class_combinations.findMany.mockResolvedValue([]);
});

describe('aggregateByTeacher（教师视图：合班归并口径）', () => {
  it('合班 3 个成员班 → 计 1 个逻辑教学班，班级名拼接', () => {
    const rows = [1, 2, 3].map((id) =>
      assign({ classId: id, className: `${id}班`, combinationId: 99, teacherId: 1 })
    );
    const snap = snapshot({
      rawAssignments: rows,
      combinationNoMap: new Map([[99, 1]]),
    });

    const [t] = aggregateByTeacher(snap);
    expect(t.classCount).toBe(1);
    expect(t.details).toHaveLength(1);
    expect(t.details[0].isCombined).toBe(true);
    expect(t.details[0].combinationNo).toBe(1);
    expect(t.details[0].className).toBe('1班、2班、3班');
  });

  it('学科取本学期实际任教课程，而非教师档案的可授课程意向', () => {
    const rows = [
      assign({ classId: 1, courseId: 10, courseName: '数学', teacherId: 1 }),
      assign({ classId: 2, className: 'B班', courseId: 11, courseName: '物理', teacherId: 1 }),
    ];
    const snap = snapshot({
      rawAssignments: rows,
      // 档案意向是"语文"，与实际任教的数学/物理不同
      teachers: [{ id: 1, name: '张三', personnel_type: 'full_time', courses: [{ id: 99, name: '语文' }] }],
    });

    const [t] = aggregateByTeacher(snap);
    expect(t.courseList.map((c) => c.name).sort()).toEqual(['数学', '物理']);
    expect(t.courseList.some((c) => c.name === '语文')).toBe(false);
  });

  it('班级层次全为空时回退教师排课意向层次', () => {
    const rows = [assign({ classId: 1, levelId: null, levelName: null })];
    const snap = snapshot({
      rawAssignments: rows,
      teachers: [
        {
          id: 1,
          name: '张三',
          scheduling_levels: [{ training_level: { id: 7, name: '本科' } }],
        },
      ],
    });

    const [t] = aggregateByTeacher(snap);
    expect(t.trainingLevelList).toEqual([{ id: 7, name: '本科' }]);
    // 明细行的层次仍如实为空，不用意向值冒充
    expect(t.details[0].trainingLevelName).toBeNull();
  });

  it('教材数量按教师去重：合班取代表班、同教材跨班不重复计', () => {
    const rows = [
      // 合班两成员班，同课程 → 1 个单元
      assign({ classId: 1, className: 'A班', combinationId: 99, courseId: 10 }),
      assign({ classId: 2, className: 'B班', combinationId: 99, courseId: 10 }),
      // 另一门课用另一本教材
      assign({ classId: 3, className: 'C班', courseId: 11, courseName: '物理' }),
    ];
    const snap = snapshot({
      rawAssignments: rows,
      idsMap: new Map([
        ['1:10', [100]],
        ['2:10', [100]],
        ['3:11', [100, 101]],
      ]),
      textbooks: TEXTBOOKS,
    });

    const [t] = aggregateByTeacher(snap);
    expect(t.textbookCount).toBe(2);
    expect(t.textbookNames.sort()).toEqual(['线性代数', '高等数学（上）']);
    expect(t.classCount).toBe(2); // 1 个合班单元 + 1 个独立班
  });

  it('任课学院去重、明细行带课程名以区分同班多课', () => {
    const rows = [
      assign({ classId: 1, courseId: 10, courseName: '数学', collegeId: 3, collegeName: '信息学院' }),
      assign({ classId: 1, courseId: 11, courseName: '物理', collegeId: 4, collegeName: '理学院' }),
    ];
    const snap = snapshot({ rawAssignments: rows });

    const [t] = aggregateByTeacher(snap);
    expect(t.collegeList.map((c) => c.name).sort()).toEqual(['信息学院', '理学院']);
    expect(t.details).toHaveLength(2);
    expect(t.details.map((d) => d.courseName)).toEqual(['数学', '物理']);
  });

  it('排序：任教学科数降序，同学科数按姓名升序', () => {
    const rows = [
      assign({ classId: 1, teacherId: 1, courseId: 10 }),
      assign({ classId: 2, className: 'B班', teacherId: 2, courseId: 10 }),
      assign({ classId: 3, className: 'C班', teacherId: 2, courseId: 11 }),
    ];
    const snap = snapshot({
      rawAssignments: rows,
      teachers: [
        { id: 1, name: '张三' },
        { id: 2, name: '李四' },
      ],
    });

    const result = aggregateByTeacher(snap);
    expect(result.map((t) => t.teacherName)).toEqual(['李四', '张三']);
  });
});

describe('aggregateByTextbook（教材视图：自然班口径）', () => {
  it('合班 3 个成员班 → 班级数计 3、学生数为三班之和（核心口径回归）', () => {
    const rows = [1, 2, 3].map((id, i) =>
      assign({
        classId: id,
        className: `${id}班`,
        combinationId: 99,
        studentCount: 30 + i * 5, // 30 / 35 / 40
      })
    );
    const snap = snapshot({
      rawAssignments: rows,
      idsMap: new Map([
        ['1:10', [100]],
        ['2:10', [100]],
        ['3:10', [100]],
      ]),
      textbooks: TEXTBOOKS,
    });

    const [tb] = aggregateByTextbook(snap);
    // 若误用 dedupeTeachingUnits，这里会变成 1 班 / 30 人
    expect(tb.classCount).toBe(3);
    expect(tb.studentCount).toBe(105);
    expect(tb.groups).toHaveLength(1);
    expect(tb.groups[0].classCount).toBe(3);
    expect(tb.groups[0].studentCount).toBe(105);
  });

  it('同一班级多门课命中同一教材 → 只计 1 个班、学生数只累加一次', () => {
    const rows = [
      assign({ classId: 1, courseId: 10, courseName: '数学', studentCount: 40 }),
      assign({ classId: 1, courseId: 11, courseName: '物理', studentCount: 40 }),
    ];
    const snap = snapshot({
      rawAssignments: rows,
      idsMap: new Map([
        ['1:10', [100]],
        ['1:11', [100]],
      ]),
      textbooks: TEXTBOOKS,
    });

    const [tb] = aggregateByTextbook(snap);
    expect(tb.classCount).toBe(1);
    expect(tb.studentCount).toBe(40);
  });

  it('跨 2 个学科的教材只出现一行，主学科取覆盖班级数多者', () => {
    const rows = [
      assign({ classId: 1, className: 'A班', courseId: 10, courseName: '数学' }),
      assign({ classId: 2, className: 'B班', courseId: 10, courseName: '数学' }),
      assign({ classId: 3, className: 'C班', courseId: 11, courseName: '物理' }),
    ];
    const snap = snapshot({
      rawAssignments: rows,
      idsMap: new Map([
        ['1:10', [100]],
        ['2:10', [100]],
        ['3:11', [100]],
      ]),
      textbooks: TEXTBOOKS,
    });

    const result = aggregateByTextbook(snap);
    expect(result).toHaveLength(1);
    expect(result[0].primaryCourse.name).toBe('数学');
    expect(result[0].extraCourses.map((c) => c.name)).toEqual(['物理']);
    expect(result[0].classCount).toBe(3);
  });

  it('学科覆盖班级数并列时按课程名字典序取主学科（排序稳定）', () => {
    const rows = [
      assign({ classId: 1, className: 'A班', courseId: 10, courseName: '数学' }),
      assign({ classId: 2, className: 'B班', courseId: 11, courseName: '物理' }),
    ];
    const snap = snapshot({
      rawAssignments: rows,
      idsMap: new Map([
        ['1:10', [100]],
        ['2:11', [100]],
      ]),
      textbooks: TEXTBOOKS,
    });

    const [tb] = aggregateByTextbook(snap);
    expect(tb.primaryCourse.name).toBe('数学');
    expect(tb.extraCourses.map((c) => c.name)).toEqual(['物理']);
  });

  it('班级缺专业/层次时不丢数据，归入 null 分组', () => {
    const rows = [
      assign({ classId: 1, className: 'A班', majorId: null, majorName: null }),
      assign({ classId: 2, className: 'B班', levelId: null, levelName: null }),
    ];
    const snap = snapshot({
      rawAssignments: rows,
      idsMap: new Map([
        ['1:10', [100]],
        ['2:10', [100]],
      ]),
      textbooks: TEXTBOOKS,
    });

    const [tb] = aggregateByTextbook(snap);
    expect(tb.classCount).toBe(2);
    expect(tb.groups).toHaveLength(2);
    const nullMajor = tb.groups.find((g) => g.majorName === null);
    const nullLevel = tb.groups.find((g) => g.levelName === null);
    expect(nullMajor.classCount).toBe(1);
    expect(nullLevel.classCount).toBe(1);
  });

  it('按层次|专业分组，并汇总各组任课教师', () => {
    const rows = [
      assign({ classId: 1, className: 'A班', teacherId: 1, levelId: 7, levelName: '本科', majorId: 5, majorName: '计算机', studentCount: 40 }),
      assign({ classId: 2, className: 'B班', teacherId: 2, levelId: 7, levelName: '本科', majorId: 5, majorName: '计算机', studentCount: 35 }),
      assign({ classId: 3, className: 'C班', teacherId: 1, levelId: 8, levelName: '专科', majorId: 6, majorName: '软件', studentCount: 30 }),
    ];
    const snap = snapshot({
      rawAssignments: rows,
      idsMap: new Map([
        ['1:10', [100]],
        ['2:10', [100]],
        ['3:10', [100]],
      ]),
      textbooks: TEXTBOOKS,
      teachers: [
        { id: 1, name: '张三' },
        { id: 2, name: '李四' },
      ],
    });

    const [tb] = aggregateByTextbook(snap);
    expect(tb.groups).toHaveLength(2);
    expect(tb.classCount).toBe(3);
    expect(tb.studentCount).toBe(105);
    expect(tb.teacherCount).toBe(2);

    const cs = tb.groups.find((g) => g.majorName === '计算机');
    expect(cs.classCount).toBe(2);
    expect(cs.studentCount).toBe(75);
    expect(cs.teachers.map((t) => t.name).sort()).toEqual(['张三', '李四']);

    const sw = tb.groups.find((g) => g.majorName === '软件');
    expect(sw.teachers.map((t) => t.name)).toEqual(['张三']);
  });

  it('教材记录缺失（无 title）时跳过，不产出空行', () => {
    const rows = [assign({ classId: 1 })];
    const snap = snapshot({
      rawAssignments: rows,
      idsMap: new Map([['1:10', [100, 999]]]),
      textbooks: TEXTBOOKS, // 999 无记录
    });

    const result = aggregateByTextbook(snap);
    expect(result).toHaveLength(1);
    expect(result[0].textbookId).toBe(100);
  });

  it('排序：学科名升序 → 班级数降序 → 教材名升序', () => {
    const rows = [
      assign({ classId: 1, className: 'A班', courseId: 10, courseName: '数学' }),
      assign({ classId: 2, className: 'B班', courseId: 11, courseName: '物理' }),
      assign({ classId: 3, className: 'C班', courseId: 11, courseName: '物理' }),
    ];
    const snap = snapshot({
      rawAssignments: rows,
      idsMap: new Map([
        ['1:10', [100]],
        ['2:11', [101]],
        ['3:11', [101]],
      ]),
      textbooks: TEXTBOOKS,
    });

    const result = aggregateByTextbook(snap);
    // 数学(1班) 在前，物理(2班) 在后 —— 学科名优先于班级数
    expect(result.map((t) => t.primaryCourse.name)).toEqual(['数学', '物理']);
  });
});

describe('buildLoadSummary', () => {
  it('总班级数/学生数按自然班去重（不受教材重复命中影响）', () => {
    const rows = [
      assign({ classId: 1, className: 'A班', courseId: 10, studentCount: 40 }),
      assign({ classId: 1, className: 'A班', courseId: 11, studentCount: 40 }),
      assign({ classId: 2, className: 'B班', courseId: 10, studentCount: 35 }),
    ];
    const snap = snapshot({ rawAssignments: rows });
    const summary = buildLoadSummary(snap, [{}, {}], [{}]);

    expect(summary).toEqual({
      totalTeachers: 2,
      totalTextbooks: 1,
      totalClasses: 2,
      totalStudents: 75,
    });
  });
});

describe('buildTeachingLoadSnapshot', () => {
  it('学期格式非法返回 null', async () => {
    await expect(buildTeachingLoadSnapshot('2025-2026-9')).resolves.toBeNull();
    expect(mockPrisma.teaching_assignments.findMany).not.toHaveBeenCalled();
  });

  it('无排课数据时返回空视图且不查教师/教材', async () => {
    const snap = await buildTeachingLoadSnapshot('2025-2026-2');

    expect(snap.rawAssignments).toEqual([]);
    expect(snap.units).toEqual([]);
    expect(mockPrisma.teachers.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.textbooks.findMany).not.toHaveBeenCalled();
    expect(aggregateByTeacher(snap)).toEqual([]);
    expect(aggregateByTextbook(snap)).toEqual([]);
  });

  it('取数条件与课时统计同口径：在职教师 + 排除 0 课时', async () => {
    await buildTeachingLoadSnapshot('2025-2026-2');

    const [args] = mockPrisma.teaching_assignments.findMany.mock.calls[0];
    expect(args.where).toMatchObject({
      semester: '2025-2026-2',
      teacher: { status: 'active' },
      weekly_hours: { gt: 0 },
    });
    // 教材视图需要自然班学生数与专业/层次名
    expect(args.include.class.select).toMatchObject({
      student_count: true,
      majors: { select: { id: true, name: true } },
      training_levels: { select: { id: true, name: true } },
    });
  });

  it('有排课时批量查教师与在用教材，无合班时不查合班组号', async () => {
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([assign({ classId: 1 })]);
    mockPrisma.teachers.findMany.mockResolvedValue([{ id: 1, name: '张三' }]);
    mockPrisma.plan_courses.findMany.mockResolvedValue([]);

    const snap = await buildTeachingLoadSnapshot('2025-2026-2');

    expect(snap.teacherMap.get(1).name).toBe('张三');
    expect(mockPrisma.class_combinations.findMany).not.toHaveBeenCalled();
  });

  it('有合班安排时加载全局合班组号', async () => {
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([
      assign({ classId: 1, combinationId: 99 }),
    ]);
    mockPrisma.class_combinations.findMany.mockResolvedValue([{ id: 99 }]);

    const snap = await buildTeachingLoadSnapshot('2025-2026-2');

    expect(snap.combinationNoMap.get(99)).toBe(1);
  });

  it('分批查询：单批满 500 条时继续取下一批', async () => {
    const fullBatch = Array.from({ length: 500 }, (_, i) => assign({ classId: i + 1 }));
    mockPrisma.teaching_assignments.findMany
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce([assign({ classId: 501 })]);

    const snap = await buildTeachingLoadSnapshot('2025-2026-2');

    expect(mockPrisma.teaching_assignments.findMany).toHaveBeenCalledTimes(2);
    expect(snap.rawAssignments).toHaveLength(501);
  });
});
