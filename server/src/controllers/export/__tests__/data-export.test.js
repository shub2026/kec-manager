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
 * - exportTextbookUsage：教材使用导出（单教材/全部教材）、学期校验
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
  planCoursesFindMany: vi.fn().mockResolvedValue([]),
  coursesFindUnique: vi.fn().mockResolvedValue(null),
  // services
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  getSemesterInfoFromRequest: vi.fn().mockResolvedValue(null),
  getCurrentSemesterInfo: vi.fn().mockResolvedValue(null),
  getActiveClassFilter: vi.fn().mockResolvedValue({ is_left_school: false }),
  calcClassSemester: vi.fn().mockReturnValue(null),
  parseSemester: vi.fn().mockReturnValue(null),
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
    plan_courses: {
      findMany: mocks.planCoursesFindMany,
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
  parseSemester: mocks.parseSemester,
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
        expect.objectContaining({ 课程名称: '语文', 课程类型: '公共课' }),
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
    expect(rows[1]['书号']).toBe('');
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
        remark: '高中语文',
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
        remark: null,
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
    expect(rows[0]['备注']).toBe('高中语文');
    expect(rows[0]['自定义课时']).toBe(16);
    expect(rows[1]['性别']).toBe('女');
    expect(rows[1]['人员类别']).toBe('兼职');
    expect(rows[1]['状态']).toBe('禁用');
    expect(rows[1]['备注']).toBe('-');
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
      remark: '高中语文教师资格证',
    };

    mocks.teachersFindMany.mockResolvedValue([teacher]);
    mocks.teachingAssignmentsFindMany.mockResolvedValue([
      {
        teacher_id: 1,
        class_id: 1,
        course_id: 10,
        weekly_hours: 4,
        class: {
          id: 1,
          name: '班级A',
          combination_id: null,
          colleges: { id: 1, name: '教育学院' },
          training_levels: { name: '大专' },
        },
        course: { name: '数学' },
      },
      {
        teacher_id: 1,
        class_id: 2,
        course_id: 10,
        weekly_hours: 4,
        class: {
          id: 2,
          name: '班级B',
          combination_id: null,
          colleges: { id: 1, name: '教育学院' },
          training_levels: { name: '大专' },
        },
        course: { name: '数学' },
      },
      {
        teacher_id: 1,
        class_id: 3,
        course_id: 10,
        weekly_hours: 4,
        class: {
          id: 3,
          name: '班级C',
          combination_id: null,
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
    // 教材解析 mock 为空 → 教材数 0；合计行不汇总教材数
    expect(rows[0]['教材数']).toBe(0);
    // 备注置于数据最后一列
    expect(rows[0]['备注']).toBe('高中语文教师资格证');
    // 合计行
    expect(rows[1]['姓名']).toBe('合计');
    expect(rows[1]['总周课时']).toBe(12);
    expect(rows[1]['班级数']).toBe(3);
    expect(rows[1]['教材数']).toBe('');
    expect(rows[1]['课程明细']).toBe('1位教师');
    expect(rows[1]['备注']).toBe('');
    expect(res.send).toHaveBeenCalled();
  });

  it('导出列顺序应与前端课时统计页一致', async () => {
    const teacher = {
      id: 1,
      name: '王五',
      personnel_type: 'full_time',
      affiliated_college: { name: '教育学院' },
      courses: [{ course: { name: '数学' } }],
      scheduling_colleges: [{ college: { name: '教育学院' } }],
    };
    mocks.teachersFindMany.mockResolvedValue([teacher]);
    mocks.teachingAssignmentsFindMany.mockResolvedValue([
      {
        teacher_id: 1,
        class_id: 1,
        course_id: 10,
        weekly_hours: 4,
        class: {
          id: 1,
          name: '班级A',
          combination_id: null,
          colleges: { id: 1, name: '教育学院' },
          training_levels: { name: '大专' },
        },
        course: { name: '数学' },
      },
    ]);

    const req = makeReq({ query: { semester: '2025-2026-1' } });
    const res = makeRes();
    await exportStatistics(req, res, vi.fn());

    const headers = mocks.createWorkbook.mock.calls[0][0];
    const labelOrder = headers.map((h) => h.label);
    // 与前端 TeachingStatistics.vue 主表列顺序对齐（课程明细为展开明细的额外列，备注按需求置于数据最末位）
    expect(labelOrder).toEqual([
      '姓名',
      '归属学院',
      '人员类别',
      '任教科目',
      '任课层次',
      '任课学院',
      '教材数',
      '班级数',
      '总周课时',
      '课程明细',
      '备注',
    ]);
  });

  it('合班教学应去重为 1 个逻辑教学班（课时与班级数不虚高）', async () => {
    const teacher = {
      id: 1,
      name: '王五',
      personnel_type: 'full_time',
      affiliated_college: { name: '教育学院' },
      courses: [{ course: { name: '数学' } }],
      scheduling_colleges: [{ college: { name: '教育学院' } }],
    };

    mocks.teachersFindMany.mockResolvedValue([teacher]);
    // 两个成员班（A、B）同属组合 99，同课程、同教师，各 4 课时：
    // 物理上是一节合班课，应只计 1 次（总周课时 4，班级数 1）
    mocks.teachingAssignmentsFindMany.mockResolvedValue([
      {
        teacher_id: 1,
        class_id: 1,
        course_id: 10,
        weekly_hours: 4,
        class: {
          id: 1,
          name: '班级A',
          combination_id: 99,
          colleges: { id: 1, name: '教育学院' },
          training_levels: { name: '大专' },
        },
        course: { name: '数学' },
      },
      {
        teacher_id: 1,
        class_id: 2,
        course_id: 10,
        weekly_hours: 4,
        class: {
          id: 2,
          name: '班级B',
          combination_id: 99,
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
    expect(rows[0]['总周课时']).toBe(4);
    expect(rows[0]['班级数']).toBe(1);
    expect(rows[0]['课程明细']).toBe('数学(4课时/1班)');
    // 合计行同样去重
    expect(rows[1]['总周课时']).toBe(4);
    expect(rows[1]['班级数']).toBe(1);
    expect(res.send).toHaveBeenCalled();
  });

  it('取数应与统计页同口径（仅在职教师、排除 0 课时安排）', async () => {
    const req = makeReq({ query: { semester: '2025-2026-1' } });
    await exportStatistics(req, makeRes(), vi.fn());

    expect(mocks.teachingAssignmentsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          semester: '2025-2026-1',
          teacher: { status: 'active' },
          weekly_hours: { gt: 0 },
        },
      })
    );
  });

  it('筛选参数应按名称文本过滤，与前端 filteredTeachers 同语义', async () => {
    const teachers = [
      {
        id: 1,
        name: '王五',
        personnel_type: 'full_time',
        affiliated_college: { name: '教育学院' },
        // 意向科目含“英语”，但实际只教“数学”：科目筛选应按实际授课匹配
        courses: [{ course: { name: '数学' } }, { course: { name: '英语' } }],
        scheduling_levels: [],
      },
      {
        id: 2,
        name: '李四',
        personnel_type: 'part_time',
        affiliated_college: { name: '体育学院' },
        courses: [{ course: { name: '体育' } }],
        scheduling_levels: [],
      },
    ];
    const assignments = [
      {
        teacher_id: 1,
        class_id: 1,
        course_id: 10,
        weekly_hours: 4,
        class: {
          id: 1,
          name: '班级A',
          combination_id: null,
          colleges: { id: 1, name: '教育学院' },
          training_levels: { name: '大专' },
        },
        course: { name: '数学' },
      },
      {
        teacher_id: 2,
        class_id: 2,
        course_id: 20,
        weekly_hours: 6,
        class: {
          id: 2,
          name: '班级B',
          combination_id: null,
          colleges: { id: 2, name: '体育学院' },
          training_levels: { name: '中专' },
        },
        course: { name: '体育' },
      },
    ];

    const runExport = async (query) => {
      mocks.teachingAssignmentsFindMany.mockResolvedValue(assignments);
      mocks.teachersFindMany.mockResolvedValue(teachers);
      await exportStatistics(makeReq({ query }), makeRes(), vi.fn());
      return mocks.createWorkbook.mock.calls.at(-1)[1];
    };

    // 任课学院名称筛选（原实现 Number('教育学院')=NaN 会导出空表）
    let rows = await runExport({ semester: '2025-2026-1', college: '教育学院' });
    expect(rows).toHaveLength(2); // 1 数据行 + 合计行
    expect(rows[0]['姓名']).toBe('王五');
    expect(rows[1]['课程明细']).toBe('1位教师');

    // 任课层次名称筛选（原实现 Number('中专')=NaN 会报 Prisma 校验错误）
    rows = await runExport({ semester: '2025-2026-1', level: '中专' });
    expect(rows).toHaveLength(2);
    expect(rows[0]['姓名']).toBe('李四');

    // 归属学院名称精确匹配（原实现 NaN 会错配无归属学院教师）
    rows = await runExport({ semester: '2025-2026-1', affiliated_college: '体育学院' });
    expect(rows).toHaveLength(2);
    expect(rows[0]['姓名']).toBe('李四');

    // 科目按实际授课精确匹配：意向科目“英语”未实际授课 → 不命中（仅合计行）
    rows = await runExport({ semester: '2025-2026-1', subject: '英语' });
    expect(rows).toHaveLength(1);
    expect(rows[0]['姓名']).toBe('合计');
    rows = await runExport({ semester: '2025-2026-1', subject: '数学' });
    expect(rows).toHaveLength(2);
    expect(rows[0]['姓名']).toBe('王五');

    // 姓名包含 + 类别精确匹配
    rows = await runExport({ semester: '2025-2026-1', name: '四', type: 'part_time' });
    expect(rows).toHaveLength(2);
    expect(rows[0]['姓名']).toBe('李四');
  });

  it('任课层次为空时应回退教师意向层次（与页面一致）', async () => {
    mocks.teachersFindMany.mockResolvedValue([
      {
        id: 1,
        name: '王五',
        personnel_type: 'full_time',
        affiliated_college: { name: '教育学院' },
        courses: [{ course: { name: '数学' } }],
        scheduling_levels: [{ training_level: { name: '五年制' } }],
      },
    ]);
    mocks.teachingAssignmentsFindMany.mockResolvedValue([
      {
        teacher_id: 1,
        class_id: 1,
        course_id: 10,
        weekly_hours: 4,
        class: {
          id: 1,
          name: '班级A',
          combination_id: null,
          colleges: { id: 1, name: '教育学院' },
          training_levels: null, // 班级无层次 → 回退意向
        },
        course: { name: '数学' },
      },
    ]);

    const req = makeReq({ query: { semester: '2025-2026-1', level: '五年制' } });
    await exportStatistics(req, makeRes(), vi.fn());

    const rows = mocks.createWorkbook.mock.calls[0][1];
    expect(rows).toHaveLength(2);
    expect(rows[0]['姓名']).toBe('王五');
    expect(rows[0]['任课层次']).toBe('五年制');
  });

  it('错误时应调用 next', async () => {
    mocks.teachingAssignmentsFindMany.mockRejectedValue(new Error('DB error'));

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
  const SINGLE_HEADERS = [
    '班级名称',
    '学院',
    '专业',
    '培养层次',
    '入学年份',
    '年级',
    '在读学期',
    '人数',
    '周课时',
    '教材',
    '任课教师',
    '安排方式',
    '合班教学',
  ];

  it('缺少 semester 参数时应返回 400', async () => {
    const req = makeReq({ query: { course_id: '1' } });
    const res = makeRes();

    await exportTeachingArrange(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '缺少学期参数' })
    );
  });

  it('仅缺 course_id 时不再 400，应进入全部科目模式并正常导出', async () => {
    mocks.coursesFindMany.mockResolvedValue([]);

    const req = makeReq({ query: { semester: '2025-2026-1' } });
    const res = makeRes();

    await exportTeachingArrange(req, res, vi.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalled();
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

    // 单科目模式回归：13 列表头顺序逐列断言
    const headers = mocks.createWorkbook.mock.calls[0][0];
    expect(headers.map((h) => h.label)).toEqual(SINGLE_HEADERS);
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

  describe('全部科目模式（缺省 course_id）', () => {
    function mockTwoCourses() {
      mocks.coursesFindMany.mockResolvedValue([
        { id: 1, name: '数学' },
        { id: 2, name: '英语' },
      ]);
      // 一次性查询该学期全部安排（含 course_id）
      mocks.teachingAssignmentsFindMany.mockResolvedValue([
        {
          course_id: 1,
          class_id: 10,
          teacher: { id: 1, name: '王老师', personnel_type: 'full_time' },
          is_auto: true,
        },
        {
          course_id: 2,
          class_id: 20,
          teacher: { id: 2, name: '李老师', personnel_type: 'part_time' },
          is_auto: false,
        },
      ]);
      mocks.getClassesWithCourse.mockImplementation(async (courseId) =>
        Number(courseId) === 1
          ? [
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
            ]
          : [
              {
                classId: 20,
                className: '班级B',
                collegeName: '外国语学院',
                majorName: '商务英语',
                trainingLevelName: '本科',
                enrollmentYear: 2023,
                grade: 3,
                currentSemester: 5,
                studentCount: 35,
                weeklyHours: 2,
                textbooks: [{ title: '英语精读' }],
                combinationId: null,
              },
            ]
      );
      mocks.buildCombinationMemberMap.mockResolvedValue(new Map());
    }

    it('表头应为 14 列且首列为科目，逐列顺序断言', async () => {
      mockTwoCourses();

      const req = makeReq({ query: { semester: '2025-2026-1' } });
      const res = makeRes();
      await exportTeachingArrange(req, res, vi.fn());

      const headers = mocks.createWorkbook.mock.calls[0][0];
      expect(headers.map((h) => h.label)).toEqual(['科目', ...SINGLE_HEADERS]);
    });

    it('应合并多课程数据且每行科目取值正确', async () => {
      mockTwoCourses();

      const req = makeReq({ query: { semester: '2025-2026-1' } });
      const res = makeRes();
      await exportTeachingArrange(req, res, vi.fn());

      const rows = mocks.createWorkbook.mock.calls[0][1];
      expect(rows).toHaveLength(2);
      expect(rows[0]['科目']).toBe('数学');
      expect(rows[0]['班级名称']).toBe('班级A');
      expect(rows[0]['任课教师']).toBe('王老师');
      expect(rows[0]['安排方式']).toBe('自动');
      expect(rows[1]['科目']).toBe('英语');
      expect(rows[1]['班级名称']).toBe('班级B');
      expect(rows[1]['任课教师']).toBe('李老师');
      expect(rows[1]['安排方式']).toBe('手动');

      // 逐课程拉取班级，且不应用筛选条件（全量导出）
      expect(mocks.getClassesWithCourse).toHaveBeenCalledWith(1, '2025-2026-1', {});
      expect(mocks.getClassesWithCourse).toHaveBeenCalledWith(2, '2025-2026-1', {});
    });

    it('文件名应为 教学安排_全部科目_{semester}.xlsx 且审计记录 scope/courseCount', async () => {
      mockTwoCourses();

      const req = makeReq({ query: { semester: '2025-2026-1' } });
      const res = makeRes();
      await exportTeachingArrange(req, res, vi.fn());

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining(encodeURIComponent('教学安排_全部科目_2025-2026-1.xlsx'))
      );
      expect(mocks.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'success',
          details: expect.objectContaining({ scope: 'all', courseCount: 2, rowCount: 2 }),
        })
      );
    });
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
              course_id: 1,
              start_semester: 1,
              end_semester: 2,
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

  it('无 params.id 时应导出全部启用教材并逐列断言表头顺序', async () => {
    mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);

    const makeTextbook = (id, title, isbn) => ({
      id,
      title,
      isbn,
      plan_textbooks: [
        {
          textbook_id: id,
          is_required: true,
          plan_course_semesters: {
            plan_course_id: 100 + id,
            semester: 1,
            plan_courses: {
              id: 100 + id,
              course_id: id,
              start_semester: 1,
              end_semester: 2,
              training_plans: { id: 10, majors: { id: 1 }, training_levels: { id: 1 } },
              courses: { name: `课程${id}` },
            },
          },
        },
      ],
    });

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

    mocks.textbooksFindMany.mockResolvedValue([
      makeTextbook(1, '大学语文', '978-1'),
      makeTextbook(2, '高等数学', '978-2'),
    ]);
    mocks.classesFindMany.mockResolvedValue([cls]);
    mocks.calcClassSemester.mockReturnValue({ grade: 1, currentSemesterNum: 1 });
    mocks.isClassMatchPlan.mockReturnValue(true);
    mocks.buildConsecutiveTextbookMap.mockResolvedValue(new Map());

    const req = makeReq({ query: { semester: '2025-2026-1' } });
    const res = makeRes();
    await exportTextbookUsage(req, res, vi.fn());

    // 仅导出启用教材，按 sort_order 排序
    expect(mocks.textbooksFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { is_active: true },
        orderBy: { sort_order: 'asc' },
      })
    );

    // 表头逐列断言完整顺序（与前端教材查询表格一致）
    const headers = mocks.createWorkbook.mock.calls[0][0];
    expect(headers.map((h) => h.label)).toEqual([
      '教材名称',
      '书号',
      '使用班级',
      '学院',
      '专业',
      '培养层次',
      '年级',
      '课程',
      '学生人数',
      '使用学期',
      '是否必订',
    ]);

    const rows = mocks.createWorkbook.mock.calls[0][1];
    // 2 本教材各 1 行 + 1 合计行
    expect(rows).toHaveLength(3);
    expect(rows[0]['教材名称']).toBe('大学语文');
    expect(rows[1]['教材名称']).toBe('高等数学');
    // 全部教材模式合计行按记录数口径，学生人数累加
    expect(rows[2]['教材名称']).toBe('合计');
    expect(rows[2]['使用班级']).toBe('2条记录');
    expect(rows[2]['学生人数']).toBe(80);

    // 文件名含"全部教材"与学期
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining(encodeURIComponent('教材使用_全部教材_2025-2026-1.xlsx'))
    );
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'success',
        details: expect.objectContaining({ scope: 'all', textbookCount: 2, rowCount: 3 }),
      })
    );
  });

  it('同一班级匹配多个方案的同一课程时应按 (班级,课程) 去重仅计一行', async () => {
    mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);

    // 同一门课程(course_id=1)在两个不同方案的 plan_courses 中都配了本教材
    const makePlanTextbook = (pcId, planId) => ({
      textbook_id: 1,
      is_required: true,
      plan_course_semesters: {
        plan_course_id: pcId,
        semester: 1,
        plan_courses: {
          id: pcId,
          course_id: 1,
          start_semester: 1,
          end_semester: 2,
          training_plans: { id: planId, majors: { id: 1 }, training_levels: { id: 1 } },
          courses: { name: '语文' },
        },
      },
    });
    const textbook = {
      id: 1,
      title: '大学语文',
      isbn: '978-1',
      plan_textbooks: [makePlanTextbook(100, 10), makePlanTextbook(200, 20)],
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
    // 与查询接口 B-14 同口径：只计 1 数据行 + 1 合计行，学生人数不重复累加
    expect(rows).toHaveLength(2);
    expect(rows[0]['使用班级']).toBe('班级A');
    expect(rows[1]['教材名称']).toBe('合计');
    expect(rows[1]['学生人数']).toBe(40);
  });

  it('教材学期超出方案课程授课范围时不应导出', async () => {
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
            semester: 1, // 越界：方案课程授课范围为第 2-3 学期
            plan_courses: {
              id: 100,
              course_id: 1,
              start_semester: 2,
              end_semester: 3,
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
    // 无数据行，仅合计行（与查询接口一致跳过越界条目）
    expect(rows).toHaveLength(1);
    expect(rows[0]['教材名称']).toBe('合计');
    expect(rows[0]['学生人数']).toBe(0);
  });

  it('全部教材模式无学期信息时应返回 400', async () => {
    mocks.getSemesterInfoFromRequest.mockResolvedValue(null);

    const req = makeReq();
    const res = makeRes();

    await exportTextbookUsage(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.textbooksFindMany).not.toHaveBeenCalled();
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
