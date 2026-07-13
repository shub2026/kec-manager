/**
 * data-export.controller.js 单元测试
 *
 * 覆盖导出函数：
 * - exportCourses：课程数据导出、错误处理
 * - exportTextbooks：教材数据导出、错误处理
 * - exportClasses：班级数据导出（含方案匹配、年级计算、合班）、错误处理
 * - exportTeachers：教师数据导出、错误处理
 * - exportStatistics：课时统计导出（含筛选、合计行）、错误处理
 * - exportTeachingArrange：教学安排导出、参数校验
 * - exportTextbookUsage：教材使用导出、学期校验
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ──────────────────────────────────────────────
// Hoisted mocks
// ──────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  // prisma models
  coursesFindMany: vi.fn().mockResolvedValue([]),
  textbooksFindMany: vi.fn().mockResolvedValue([]),
  textbooksFindUnique: vi.fn().mockResolvedValue(null),
  classesFindMany: vi.fn().mockResolvedValue([]),
  teachersFindMany: vi.fn().mockResolvedValue([]),
  trainingPlansFindMany: vi.fn().mockResolvedValue([]),
  teachingAssignmentsGroupBy: vi.fn().mockResolvedValue([]),
  teachingAssignmentsFindMany: vi.fn().mockResolvedValue([]),
  coursesFindUnique: vi.fn().mockResolvedValue(null),
  // services
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  getSemesterInfoFromRequest: vi.fn().mockResolvedValue(null),
  getCurrentSemesterInfo: vi.fn().mockResolvedValue(null),
  getActiveClassFilter: vi.fn().mockResolvedValue({ is_left_school: false }),
  calcClassSemester: vi.fn().mockReturnValue(null),
  buildConsecutiveTextbookMap: vi.fn().mockResolvedValue(new Map()),
  isClassMatchPlan: vi.fn().mockReturnValue(false),
  findBestMatchPlan: vi.fn().mockReturnValue(null),
  buildClassFilter: vi.fn().mockResolvedValue({ where: {} }),
  getClassesWithCourse: vi.fn().mockResolvedValue([]),
  buildCombinationMemberMap: vi.fn().mockResolvedValue(new Map()),
  formatPartnerNames: vi.fn().mockReturnValue(''),
  // excel
  createWorkbook: vi.fn().mockResolvedValue({}),
  workbookToBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-xlsx')),
  // response
  success: vi.fn((_res, data, msg) => {
    _res.json({ success: true, data, message: msg });
  }),
}));

// ──────────────────────────────────────────────
// Mock modules
// ──────────────────────────────────────────────
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    courses: {
      findMany: mocks.coursesFindMany,
      findUnique: mocks.coursesFindUnique,
    },
    textbooks: {
      findMany: mocks.textbooksFindMany,
      findUnique: mocks.textbooksFindUnique,
    },
    classes: {
      findMany: mocks.classesFindMany,
    },
    teachers: {
      findMany: mocks.teachersFindMany,
    },
    training_plans: {
      findMany: mocks.trainingPlansFindMany,
    },
    teaching_assignments: {
      groupBy: mocks.teachingAssignmentsGroupBy,
      findMany: mocks.teachingAssignmentsFindMany,
    },
  },
}));

vi.mock('../../../services/audit.service.js', () => ({
  createAuditLog: mocks.createAuditLog,
}));

vi.mock('../../../services/settings.service.js', () => ({
  getSemesterInfoFromRequest: mocks.getSemesterInfoFromRequest,
  getCurrentSemesterInfo: mocks.getCurrentSemesterInfo,
}));

vi.mock('../../../services/class.service.js', () => ({
  getActiveClassFilter: mocks.getActiveClassFilter,
}));

vi.mock('../../../services/semester.service.js', () => ({
  calcClassSemester: mocks.calcClassSemester,
  buildConsecutiveTextbookMap: mocks.buildConsecutiveTextbookMap,
}));

vi.mock('../../../services/plan.service.js', () => ({
  isClassMatchPlan: mocks.isClassMatchPlan,
  findBestMatchPlan: mocks.findBestMatchPlan,
}));

vi.mock('../../../services/class-filter.service.js', () => ({
  buildClassFilter: mocks.buildClassFilter,
}));

vi.mock('../../../services/teaching-arrange.service.js', () => ({
  getClassesWithCourse: mocks.getClassesWithCourse,
}));

vi.mock('../../../services/class-combination.service.js', () => ({
  buildCombinationMemberMap: mocks.buildCombinationMemberMap,
  formatPartnerNames: mocks.formatPartnerNames,
}));

vi.mock('../../../utils/excel.js', () => ({
  createWorkbook: mocks.createWorkbook,
  workbookToBuffer: mocks.workbookToBuffer,
}));

vi.mock('../../../utils/response.js', () => ({
  success: mocks.success,
}));

const {
  exportCourses,
  exportTextbooks,
  exportClasses,
  exportTeachers,
  exportStatistics,
  exportTeachingArrange,
  exportTextbookUsage,
} = await import('../data-export.controller.js');

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn(),
  };
}

function makeReq(overrides = {}) {
  return {
    query: {},
    params: {},
    body: {},
    user: { id: 1 },
    ip: '127.0.0.1',
    ...overrides,
  };
}

const SEMESTER_INFO = {
  startYear: 2025,
  endYear: 2026,
  semesterIndex: 1,
  raw: '2025-2026-1',
  label: '2025年秋季(第1学期)',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.coursesFindMany.mockResolvedValue([]);
  mocks.textbooksFindMany.mockResolvedValue([]);
  mocks.textbooksFindUnique.mockResolvedValue(null);
  mocks.classesFindMany.mockResolvedValue([]);
  mocks.teachersFindMany.mockResolvedValue([]);
  mocks.trainingPlansFindMany.mockResolvedValue([]);
  mocks.teachingAssignmentsGroupBy.mockResolvedValue([]);
  mocks.teachingAssignmentsFindMany.mockResolvedValue([]);
  mocks.coursesFindUnique.mockResolvedValue(null);
  mocks.createAuditLog.mockResolvedValue(undefined);
  mocks.getSemesterInfoFromRequest.mockResolvedValue(null);
  mocks.getCurrentSemesterInfo.mockResolvedValue(null);
  mocks.getActiveClassFilter.mockResolvedValue({ is_left_school: false });
  mocks.calcClassSemester.mockReturnValue(null);
  mocks.buildConsecutiveTextbookMap.mockResolvedValue(new Map());
  mocks.isClassMatchPlan.mockReturnValue(false);
  mocks.findBestMatchPlan.mockReturnValue(null);
  mocks.buildClassFilter.mockResolvedValue({ where: {} });
  mocks.getClassesWithCourse.mockResolvedValue([]);
  mocks.buildCombinationMemberMap.mockResolvedValue(new Map());
  mocks.formatPartnerNames.mockReturnValue('');
  mocks.createWorkbook.mockResolvedValue({});
  mocks.workbookToBuffer.mockResolvedValue(Buffer.from('fake-xlsx'));
});

// ══════════════════════════════════════════════
// exportCourses
// ══════════════════════════════════════════════
describe('exportCourses', () => {
  it('应导出课程数据并设置响应头', async () => {
    mocks.coursesFindMany.mockResolvedValue([
      { name: '语文', code: 'CHN001', type: 'public', description: '基础语文', sort_order: 1 },
      { name: '专业课A', code: null, type: 'major', description: null, sort_order: 2 },
    ]);

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await exportCourses(req, res, next);

    expect(mocks.coursesFindMany).toHaveBeenCalledWith({ orderBy: { sort_order: 'asc' } });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      expect.stringContaining('spreadsheetml')
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment')
    );
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
    expect(mocks.createWorkbook).toHaveBeenCalledWith(
      expect.any(Array),
      expect.arrayContaining([
        expect.objectContaining({ 课程名称: '语文', 课程类型: '公共基础课' }),
        expect.objectContaining({ 课程名称: '专业课A', 课程类型: '专业课' }),
      ])
    );
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'export', module: 'course', result: 'success' })
    );
  });

  it('空课程列表应正常导出', async () => {
    mocks.coursesFindMany.mockResolvedValue([]);

    const req = makeReq();
    const res = makeRes();
    await exportCourses(req, res, vi.fn());

    expect(mocks.createWorkbook).toHaveBeenCalledWith(expect.any(Array), []);
    expect(res.send).toHaveBeenCalled();
  });

  it('错误时应调用 next 并记录失败审计', async () => {
    mocks.coursesFindMany.mockRejectedValue(new Error('DB error'));

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await exportCourses(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'failed', module: 'course' })
    );
  });
});

// ══════════════════════════════════════════════
// exportTextbooks
// ══════════════════════════════════════════════
describe('exportTextbooks', () => {
  it('应导出教材数据并映射状态', async () => {
    mocks.textbooksFindMany.mockResolvedValue([
      {
        title: '大学语文',
        isbn: '978-1',
        publisher: '高教社',
        author: '张三',
        edition: '第3版',
        publish_date: '2024-01',
        price: 45,
        category: '技工',
        is_active: true,
        sort_order: 1,
      },
      {
        title: '高数',
        isbn: null,
        publisher: null,
        author: null,
        edition: null,
        publish_date: null,
        price: null,
        category: null,
        is_active: false,
        sort_order: 2,
      },
    ]);

    const req = makeReq();
    const res = makeRes();
    await exportTextbooks(req, res, vi.fn());

    expect(mocks.textbooksFindMany).toHaveBeenCalled();
    const rows = mocks.createWorkbook.mock.calls[0][1];
    expect(rows).toHaveLength(2);
    expect(rows[0]['书名']).toBe('大学语文');
    expect(rows[0]['状态']).toBe('启用');
    expect(rows[1]['书名']).toBe('高数');
    expect(rows[1]['状态']).toBe('停用');
    expect(rows[1]['书号']).toBe('-');
    expect(res.send).toHaveBeenCalled();
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'textbook', result: 'success' })
    );
  });

  it('错误时应调用 next', async () => {
    mocks.textbooksFindMany.mockRejectedValue(new Error('fail'));

    const next = vi.fn();
    await exportTextbooks(makeReq(), makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'failed' })
    );
  });
});

// ══════════════════════════════════════════════
// exportClasses
// ══════════════════════════════════════════════
describe('exportClasses', () => {
  it('planNotFound 时应返回空结果', async () => {
    mocks.buildClassFilter.mockResolvedValue({ planNotFound: true });

    const req = makeReq({ query: { plan_id: '999' } });
    const res = makeRes();
    await exportClasses(req, res, vi.fn());

    expect(mocks.success).toHaveBeenCalledWith(res, { items: [], total: 0 }, '导出完成：无数据');
    expect(res.send).not.toHaveBeenCalled();
  });

  it('应正常导出班级数据（含年级计算）', async () => {
    const cls = {
      id: 1,
      name: '2024级学前1班',
      enrollment_year: 2024,
      duration_years: 3,
      student_count: 40,
      major_id: 10,
      training_level_id: 20,
      custom_plan_id: null,
      combination_id: null,
      is_left_school: false,
      colleges: { name: '教育学院' },
      majors: { name: '学前教育' },
      training_levels: { name: '大专' },
      training_plans: null,
    };

    mocks.buildClassFilter.mockResolvedValue({ where: {} });
    mocks.classesFindMany.mockResolvedValue([cls]);
    mocks.trainingPlansFindMany.mockResolvedValue([]);
    mocks.getCurrentSemesterInfo.mockResolvedValue(SEMESTER_INFO);
    mocks.calcClassSemester.mockReturnValue({ grade: 2, currentSemesterNum: 2 });
    mocks.findBestMatchPlan.mockReturnValue(null);
    mocks.buildCombinationMemberMap.mockResolvedValue(new Map());

    const req = makeReq();
    const res = makeRes();
    await exportClasses(req, res, vi.fn());

    const rows = mocks.createWorkbook.mock.calls[0][1];
    expect(rows).toHaveLength(1);
    expect(rows[0]['班级名称']).toBe('2024级学前1班');
    expect(rows[0]['二级学院']).toBe('教育学院');
    expect(rows[0]['年级']).toBe('2年级');
    expect(rows[0]['状态']).toBe('在读');
    expect(rows[0]['关联类型']).toBe('专业');
    expect(res.send).toHaveBeenCalled();
  });

  it('离校班级应显示"离校"状态', async () => {
    const cls = {
      id: 2,
      name: '离校班',
      enrollment_year: 2020,
      duration_years: 3,
      student_count: 0,
      major_id: null,
      training_level_id: null,
      custom_plan_id: null,
      combination_id: null,
      is_left_school: true,
      colleges: null,
      majors: null,
      training_levels: null,
      training_plans: null,
    };

    mocks.buildClassFilter.mockResolvedValue({ where: {} });
    mocks.classesFindMany.mockResolvedValue([cls]);
    mocks.trainingPlansFindMany.mockResolvedValue([]);
    mocks.getCurrentSemesterInfo.mockResolvedValue(SEMESTER_INFO);
    mocks.buildCombinationMemberMap.mockResolvedValue(new Map());

    const req = makeReq();
    const res = makeRes();
    await exportClasses(req, res, vi.fn());

    const rows = mocks.createWorkbook.mock.calls[0][1];
    expect(rows[0]['状态']).toBe('离校');
    expect(rows[0]['关联类型']).toBe('未关联');
  });

  it('已毕业班级应显示"已毕业"状态', async () => {
    const cls = {
      id: 3,
      name: '已毕业班',
      enrollment_year: 2020,
      duration_years: 3,
      student_count: 0,
      major_id: null,
      training_level_id: 10,
      custom_plan_id: null,
      combination_id: null,
      is_left_school: false,
      colleges: null,
      majors: null,
      training_levels: { name: '大专' },
      training_plans: null,
    };

    mocks.buildClassFilter.mockResolvedValue({ where: {} });
    mocks.classesFindMany.mockResolvedValue([cls]);
    mocks.trainingPlansFindMany.mockResolvedValue([]);
    mocks.getCurrentSemesterInfo.mockResolvedValue(SEMESTER_INFO);
    // calcClassSemester returns null → class is out of range
    mocks.calcClassSemester.mockReturnValue(null);
    mocks.buildCombinationMemberMap.mockResolvedValue(new Map());

    const req = makeReq();
    const res = makeRes();
    await exportClasses(req, res, vi.fn());

    const rows = mocks.createWorkbook.mock.calls[0][1];
    // enrollment_year=2020, startYear=2025 → grade = 2025-2020+1 = 6 > 1 → 已毕业
    expect(rows[0]['状态']).toBe('已毕业');
  });

  it('自定义方案的班级应显示"自定义"关联类型', async () => {
    const plan = { id: 100, name: '自定义方案', major_id: 10, training_level_id: 20 };
    const cls = {
      id: 4,
      name: '自定义班',
      enrollment_year: 2024,
      duration_years: 3,
      student_count: 30,
      major_id: null,
      training_level_id: null,
      custom_plan_id: 100,
      combination_id: null,
      is_left_school: false,
      colleges: null,
      majors: null,
      training_levels: null,
      training_plans: plan,
    };

    mocks.buildClassFilter.mockResolvedValue({ where: {} });
    mocks.classesFindMany.mockResolvedValue([cls]);
    mocks.trainingPlansFindMany.mockResolvedValue([plan]);
    mocks.getCurrentSemesterInfo.mockResolvedValue(SEMESTER_INFO);
    mocks.calcClassSemester.mockReturnValue({ grade: 1, currentSemesterNum: 1 });
    mocks.buildCombinationMemberMap.mockResolvedValue(new Map());

    const req = makeReq();
    const res = makeRes();
    await exportClasses(req, res, vi.fn());

    const rows = mocks.createWorkbook.mock.calls[0][1];
    expect(rows[0]['关联类型']).toBe('自定义');
    expect(rows[0]['当前方案']).toBe('自定义方案');
  });

  it('错误时应调用 next', async () => {
    mocks.buildClassFilter.mockRejectedValue(new Error('filter error'));

    const next = vi.fn();
    await exportClasses(makeReq(), makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'failed', module: 'class' })
    );
  });
});

// ══════════════════════════════════════════════
// exportTeachers
// ══════════════════════════════════════════════
describe('exportTeachers', () => {
  it('应导出教师数据并映射字段', async () => {
    mocks.teachersFindMany.mockResolvedValue([
      {
        name: '张三',
        gender: 'male',
        birth_date: '1990-05-15',
        qualification_type: '高中语文',
        personnel_type: 'full_time',
        status: 'active',
        default_weekly_hours: 16,
        affiliated_college: { name: '教育学院' },
        courses: [{ course: { name: '语文' } }, { course: { name: '写作' } }],
        scheduling_colleges: [{ college: { name: '教育学院' } }],
        scheduling_levels: [{ training_level: { name: '大专' } }],
      },
      {
        name: '李四',
        gender: 'female',
        birth_date: null,
        qualification_type: null,
        personnel_type: 'part_time',
        status: 'disabled',
        default_weekly_hours: null,
        affiliated_college: null,
        courses: [],
        scheduling_colleges: [],
        scheduling_levels: [],
      },
    ]);

    const req = makeReq();
    const res = makeRes();
    await exportTeachers(req, res, vi.fn());

    const rows = mocks.createWorkbook.mock.calls[0][1];
    expect(rows).toHaveLength(2);
    expect(rows[0]['教师姓名']).toBe('张三');
    expect(rows[0]['性别']).toBe('男');
    expect(rows[0]['出生年月']).toBe('1990-05');
    expect(rows[0]['人员类别']).toBe('专职');
    expect(rows[0]['状态']).toBe('启用');
    expect(rows[0]['学科']).toBe('语文、写作');
    expect(rows[0]['自定义课时']).toBe(16);
    expect(rows[1]['性别']).toBe('女');
    expect(rows[1]['人员类别']).toBe('兼职');
    expect(rows[1]['状态']).toBe('禁用');
    expect(rows[1]['自定义课时']).toBe('-');
    expect(res.send).toHaveBeenCalled();
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'teacher', result: 'success' })
    );
  });

  it('错误时应调用 next', async () => {
    mocks.teachersFindMany.mockRejectedValue(new Error('DB error'));

    const next = vi.fn();
    await exportTeachers(makeReq(), makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'failed' })
    );
  });
});

// ══════════════════════════════════════════════
// exportStatistics
// ══════════════════════════════════════════════
describe('exportStatistics', () => {
  it('缺少学期参数时应返回 400', async () => {
    const req = makeReq({ query: {} });
    const res = makeRes();
    const next = vi.fn();

    await exportStatistics(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '请选择学期' })
    );
  });

  it('应导出课时统计并生成合计行', async () => {
    const teacher = {
      id: 1,
      name: '王五',
      personnel_type: 'full_time',
      affiliated_college: { name: '教育学院' },
      courses: [{ course: { name: '数学' } }],
      scheduling_colleges: [{ college: { name: '教育学院' } }],
    };

    mocks.teachingAssignmentsGroupBy.mockResolvedValue([
      { teacher_id: 1, _sum: { weekly_hours: 12 }, _count: { id: 3 } },
    ]);
    mocks.teachersFindMany.mockResolvedValue([teacher]);
    mocks.teachingAssignmentsFindMany.mockResolvedValue([
      {
        teacher_id: 1,
        course_id: 10,
        weekly_hours: 4,
        class: {
          name: '班级A',
          colleges: { id: 1, name: '教育学院' },
          training_levels: { name: '大专' },
        },
        course: { name: '数学' },
      },
      {
        teacher_id: 1,
        course_id: 10,
        weekly_hours: 4,
        class: {
          name: '班级B',
          colleges: { id: 1, name: '教育学院' },
          training_levels: { name: '大专' },
        },
        course: { name: '数学' },
      },
      {
        teacher_id: 1,
        course_id: 10,
        weekly_hours: 4,
        class: {
          name: '班级C',
          colleges: { id: 1, name: '教育学院' },
          training_levels: { name: '大专' },
        },
        course: { name: '数学' },
      },
    ]);

    const req = makeReq({ query: { semester: '2025-2026-1' } });
    const res = makeRes();
    await exportStatistics(req, res, vi.fn());

    const rows = mocks.createWorkbook.mock.calls[0][1];
    // 1 data row + 1 summary row
    expect(rows).toHaveLength(2);
    expect(rows[0]['姓名']).toBe('王五');
    expect(rows[0]['人员类别']).toBe('专职');
    expect(rows[0]['总周课时']).toBe(12);
    expect(rows[0]['班级数']).toBe(3);
    // 合计行
    expect(rows[1]['姓名']).toBe('合计');
    expect(rows[1]['总周课时']).toBe(12);
    expect(rows[1]['班级数']).toBe(3);
    expect(rows[1]['课程明细']).toBe('1位教师');
    expect(res.send).toHaveBeenCalled();
  });

  it('应支持教师筛选条件', async () => {
    mocks.teachingAssignmentsGroupBy.mockResolvedValue([]);
    mocks.teachersFindMany.mockResolvedValue([]);
    mocks.teachingAssignmentsFindMany.mockResolvedValue([]);

    const req = makeReq({
      query: {
        semester: '2025-2026-1',
        name: '王',
        type: 'full_time',
        affiliated_college: '5',
        subject: '数学',
        level: '10',
        college: '3',
      },
    });
    const res = makeRes();
    await exportStatistics(req, res, vi.fn());

    // 验证 groupBy 被调用，且 where 条件包含教师筛选
    expect(mocks.teachingAssignmentsGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          semester: '2025-2026-1',
          class: { college_id: 3 },
          teacher: expect.objectContaining({
            name: { contains: '王' },
            personnel_type: 'full_time',
          }),
        }),
      })
    );
  });

  it('错误时应调用 next', async () => {
    mocks.teachingAssignmentsGroupBy.mockRejectedValue(new Error('DB error'));

    const req = makeReq({ query: { semester: '2025-2026-1' } });
    const res = makeRes();
    const next = vi.fn();

    await exportStatistics(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'failed' })
    );
  });
});

// ══════════════════════════════════════════════
// exportTeachingArrange
// ══════════════════════════════════════════════
describe('exportTeachingArrange', () => {
  it('缺少 course_id 参数时应返回 400', async () => {
    const req = makeReq({ query: { semester: '2025-2026-1' } });
    const res = makeRes();

    await exportTeachingArrange(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '缺少课程或学期参数' })
    );
  });

  it('缺少 semester 参数时应返回 400', async () => {
    const req = makeReq({ query: { course_id: '1' } });
    const res = makeRes();

    await exportTeachingArrange(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('课程不存在时应返回 404', async () => {
    mocks.coursesFindUnique.mockResolvedValue(null);

    const req = makeReq({ query: { course_id: '999', semester: '2025-2026-1' } });
    const res = makeRes();

    await exportTeachingArrange(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '课程不存在' })
    );
  });

  it('应正常导出教学安排数据', async () => {
    mocks.coursesFindUnique.mockResolvedValue({ id: 1, name: '数学' });
    mocks.getClassesWithCourse.mockResolvedValue([
      {
        classId: 10,
        className: '班级A',
        collegeName: '教育学院',
        majorName: '学前教育',
        trainingLevelName: '大专',
        enrollmentYear: 2024,
        grade: 2,
        currentSemester: 2,
        studentCount: 40,
        weeklyHours: 4,
        textbooks: [{ title: '数学上册' }],
        combinationId: null,
      },
    ]);
    mocks.teachingAssignmentsFindMany.mockResolvedValue([
      {
        class_id: 10,
        teacher: { id: 1, name: '王老师', personnel_type: 'full_time' },
        is_auto: true,
      },
    ]);
    mocks.buildCombinationMemberMap.mockResolvedValue(new Map());

    const req = makeReq({ query: { course_id: '1', semester: '2025-2026-1' } });
    const res = makeRes();
    await exportTeachingArrange(req, res, vi.fn());

    const rows = mocks.createWorkbook.mock.calls[0][1];
    expect(rows).toHaveLength(1);
    expect(rows[0]['班级名称']).toBe('班级A');
    expect(rows[0]['任课教师']).toBe('王老师');
    expect(rows[0]['安排方式']).toBe('自动');
    expect(rows[0]['教材']).toBe('数学上册');
    expect(res.send).toHaveBeenCalled();
  });

  it('未安排教师的班级应显示"未安排"', async () => {
    mocks.coursesFindUnique.mockResolvedValue({ id: 1, name: '数学' });
    mocks.getClassesWithCourse.mockResolvedValue([
      {
        classId: 10,
        className: '班级A',
        collegeName: null,
        majorName: null,
        trainingLevelName: null,
        enrollmentYear: 2024,
        grade: 1,
        currentSemester: 1,
        studentCount: 30,
        weeklyHours: 2,
        textbooks: [],
        combinationId: null,
      },
    ]);
    mocks.teachingAssignmentsFindMany.mockResolvedValue([]);
    mocks.buildCombinationMemberMap.mockResolvedValue(new Map());

    const req = makeReq({ query: { course_id: '1', semester: '2025-2026-1' } });
    const res = makeRes();
    await exportTeachingArrange(req, res, vi.fn());

    const rows = mocks.createWorkbook.mock.calls[0][1];
    expect(rows[0]['任课教师']).toBe('未安排');
    expect(rows[0]['安排方式']).toBe('-');
  });

  it('错误时应调用 next', async () => {
    mocks.coursesFindUnique.mockRejectedValue(new Error('DB error'));

    const req = makeReq({ query: { course_id: '1', semester: '2025-2026-1' } });
    const res = makeRes();
    const next = vi.fn();

    await exportTeachingArrange(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'failed' })
    );
  });
});

// ══════════════════════════════════════════════
// exportTextbookUsage
// ══════════════════════════════════════════════
describe('exportTextbookUsage', () => {
  it('无学期信息且无 query.semester 时应返回 400', async () => {
    mocks.getSemesterInfoFromRequest.mockResolvedValue(null);

    const req = makeReq({ params: { id: '1' } });
    const res = makeRes();

    await exportTextbookUsage(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringMatching(/设置当前学期/) })
    );
  });

  it('学期格式错误时应返回 400', async () => {
    mocks.getSemesterInfoFromRequest.mockResolvedValue(null);

    const req = makeReq({ params: { id: '1' }, query: { semester: 'bad' } });
    const res = makeRes();

    await exportTextbookUsage(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringMatching(/格式错误/) })
    );
  });

  it('教材不存在时应返回 404', async () => {
    mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);
    mocks.textbooksFindUnique.mockResolvedValue(null);
    mocks.classesFindMany.mockResolvedValue([]);

    const req = makeReq({ params: { id: '999' } });
    const res = makeRes();

    await exportTextbookUsage(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '教材不存在' })
    );
  });

  it('应正常导出教材使用情况并包含合计行', async () => {
    mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);

    const textbook = {
      id: 1,
      title: '大学语文',
      isbn: '978-1',
      plan_textbooks: [
        {
          textbook_id: 1,
          is_required: true,
          plan_course_semesters: {
            plan_course_id: 100,
            semester: 1,
            plan_courses: {
              id: 100,
              training_plans: { id: 10, majors: { id: 1 }, training_levels: { id: 1 } },
              courses: { name: '语文' },
            },
          },
        },
      ],
    };

    const cls = {
      id: 1,
      name: '班级A',
      enrollment_year: 2024,
      duration_years: 3,
      student_count: 40,
      major_id: 1,
      training_level_id: 1,
      colleges: { name: '教育学院' },
      majors: { name: '学前教育' },
      training_levels: { name: '大专' },
    };

    mocks.textbooksFindUnique.mockResolvedValue(textbook);
    mocks.classesFindMany.mockResolvedValue([cls]);
    mocks.calcClassSemester.mockReturnValue({ grade: 1, currentSemesterNum: 1 });
    mocks.isClassMatchPlan.mockReturnValue(true);
    mocks.buildConsecutiveTextbookMap.mockResolvedValue(new Map());

    const req = makeReq({ params: { id: '1' } });
    const res = makeRes();
    await exportTextbookUsage(req, res, vi.fn());

    const rows = mocks.createWorkbook.mock.calls[0][1];
    // 1 data row + 1 summary row
    expect(rows).toHaveLength(2);
    expect(rows[0]['教材名称']).toBe('大学语文');
    expect(rows[0]['使用班级']).toBe('班级A');
    expect(rows[0]['学生人数']).toBe(40);
    expect(rows[0]['是否必订']).toBe('是');
    // 合计行
    expect(rows[1]['教材名称']).toBe('合计');
    expect(rows[1]['学生人数']).toBe(40);
    expect(res.send).toHaveBeenCalled();
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'success' })
    );
  });

  it('错误时应调用 next', async () => {
    mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);
    mocks.textbooksFindUnique.mockRejectedValue(new Error('DB error'));
    mocks.classesFindMany.mockResolvedValue([]);

    const req = makeReq({ params: { id: '1' } });
    const res = makeRes();
    const next = vi.fn();

    await exportTextbookUsage(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'failed' })
    );
  });
});
