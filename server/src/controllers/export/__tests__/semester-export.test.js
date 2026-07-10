/**
 * semester-export.controller.js 单元测试
 *
 * buildSemesterExportData 为内部函数（未导出），通过 exportSemesterSchedule 间接测试。
 * 覆盖：
 * - 班级与方案匹配
 * - 学期计算
 * - 课程过滤（学期范围、周课时 > 0）
 * - 导出行数据构建
 * - 空数据场景
 * - 筛选条件传递
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ──────────────────────────────────────────────
// Hoisted mocks
// ──────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  // prisma
  classesFindMany: vi.fn().mockResolvedValue([]),
  trainingPlansFindMany: vi.fn().mockResolvedValue([]),
  // services
  getSemesterInfoFromRequest: vi.fn(),
  getCurrentSemesterInfo: vi.fn(),
  parseSemesterString: vi.fn(),
  buildClassWithPlanFilter: vi.fn().mockResolvedValue({ OR: [{ major_id: { in: [1] } }] }),
  getActiveClassFilter: vi.fn().mockResolvedValue({ is_left_school: false }),
  calcClassSemester: vi.fn(),
  findBestMatchPlan: vi.fn(),
  // excel
  createWorkbook: vi.fn().mockResolvedValue({}),
  workbookToBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-xlsx')),
  // audit
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// ──────────────────────────────────────────────
// Mock modules (paths from controllers/export/__tests__/)
// ──────────────────────────────────────────────
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    classes: { findMany: mocks.classesFindMany },
    training_plans: { findMany: mocks.trainingPlansFindMany },
  },
}));

vi.mock('../../../services/settings.service.js', () => ({
  getSemesterInfoFromRequest: mocks.getSemesterInfoFromRequest,
  getCurrentSemesterInfo: mocks.getCurrentSemesterInfo,
  parseSemesterString: mocks.parseSemesterString,
}));

vi.mock('../../../services/audit.service.js', () => ({
  createAuditLog: mocks.createAuditLog,
}));

vi.mock('../../../services/class.service.js', () => ({
  getActiveClassFilter: mocks.getActiveClassFilter,
}));

vi.mock('../../../services/semester.service.js', () => ({
  calcClassSemester: mocks.calcClassSemester,
}));

vi.mock('../../../services/plan.service.js', () => ({
  findBestMatchPlan: mocks.findBestMatchPlan,
  buildClassWithPlanFilter: mocks.buildClassWithPlanFilter,
}));

vi.mock('../../../utils/excel.js', () => ({
  createWorkbook: mocks.createWorkbook,
  workbookToBuffer: mocks.workbookToBuffer,
}));

const { exportSemesterSchedule, exportSemesterSchedulePost } =
  await import('../semester-export.controller.js');

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
const SEMESTER_INFO = {
  startYear: 2025,
  endYear: 2026,
  semesterIndex: 1,
  raw: '2025-2026-1',
  label: '2025年秋季(第1学期)',
};

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
    body: {},
    user: { id: 1 },
    ip: '127.0.0.1',
    ...overrides,
  };
}

function makeClass(overrides = {}) {
  return {
    id: 1,
    name: '班级A',
    enrollment_year: 2025,
    duration_years: 4,
    student_count: 40,
    major_id: 10,
    training_level_id: 20,
    custom_plan_id: null,
    colleges: { name: '计算机学院' },
    majors: { name: '软件工程' },
    training_levels: { name: '本科' },
    training_plans: null,
    ...overrides,
  };
}

function makePlan(overrides = {}) {
  return {
    id: 100,
    name: '2025级软件工程培养方案',
    major_id: 10,
    training_level_id: 20,
    plan_courses: [],
    ...overrides,
  };
}

function makePlanCourse(overrides = {}) {
  return {
    id: 200,
    start_semester: 1,
    end_semester: 4,
    weekly_hours: 4,
    weeks_per_semester: 16,
    courses: { name: '高等数学', type: 'public' },
    plan_course_semesters: [
      {
        semester: 1,
        weekly_hours: 4,
        weeks_count: 16,
        plan_textbooks: [{ textbooks: { title: '高数上册', isbn: '978-001' } }],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.classesFindMany.mockResolvedValue([]);
  mocks.trainingPlansFindMany.mockResolvedValue([]);
  mocks.buildClassWithPlanFilter.mockResolvedValue({ OR: [{ major_id: { in: [1] } }] });
  mocks.getActiveClassFilter.mockResolvedValue({ is_left_school: false });
  mocks.createWorkbook.mockResolvedValue({});
  mocks.workbookToBuffer.mockResolvedValue(Buffer.from('fake'));
  mocks.createAuditLog.mockResolvedValue(undefined);
});

// ══════════════════════════════════════════════
describe('exportSemesterSchedule (GET)', () => {
  describe('学期信息缺失', () => {
    it('无学期信息且无 query.semester 时应返回 400', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(null);
      const req = makeReq();
      const res = makeRes();
      const next = vi.fn();

      await exportSemesterSchedule(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: expect.stringMatching(/设置当前学期/) })
      );
    });

    it('query.semester 格式错误时应返回 400', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(null);
      const req = makeReq({ query: { semester: 'bad-format' } });
      const res = makeRes();
      const next = vi.fn();

      await exportSemesterSchedule(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: expect.stringMatching(/格式错误/) })
      );
    });
  });

  describe('正常导出', () => {
    it('有学期信息时应构建数据并发送 Excel 响应', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);

      const cls = makeClass();
      const plan = makePlan({ plan_courses: [makePlanCourse()] });

      mocks.classesFindMany.mockResolvedValue([cls]);
      mocks.trainingPlansFindMany.mockResolvedValue([plan]);
      mocks.calcClassSemester.mockReturnValue({ grade: 1, currentSemesterNum: 1 });
      mocks.findBestMatchPlan.mockReturnValue(plan);

      const req = makeReq();
      const res = makeRes();
      const next = vi.fn();

      await exportSemesterSchedule(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        expect.stringContaining('spreadsheetml')
      );
      expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
      expect(mocks.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'export', result: 'success' })
      );
    });

    it('应将筛选条件传递到查询', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);
      mocks.classesFindMany.mockResolvedValue([]);
      mocks.trainingPlansFindMany.mockResolvedValue([]);

      const req = makeReq({
        query: { college_id: '5', major_id: '10', grade: '2' },
      });
      const res = makeRes();
      const next = vi.fn();

      await exportSemesterSchedule(req, res, next);

      // 验证 findMany 被调用（通过 batchFindMany）
      expect(mocks.classesFindMany).toHaveBeenCalled();
    });
  });

  describe('班级与方案匹配', () => {
    it('班级有培养方案且课程在当前学期范围内应生成导出行', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);

      const pc = makePlanCourse();
      const plan = makePlan({ plan_courses: [pc] });
      const cls = makeClass();

      mocks.classesFindMany.mockResolvedValue([cls]);
      mocks.trainingPlansFindMany.mockResolvedValue([plan]);
      mocks.calcClassSemester.mockReturnValue({ grade: 1, currentSemesterNum: 1 });
      mocks.findBestMatchPlan.mockReturnValue(plan);

      const req = makeReq();
      const res = makeRes();
      const next = vi.fn();

      await exportSemesterSchedule(req, res, next);

      // 验证 workbook 被创建（说明有行数据）
      expect(mocks.createWorkbook).toHaveBeenCalled();
      const rows = mocks.createWorkbook.mock.calls[0][1];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]['班级名称']).toBe('班级A');
      expect(rows[0]['课程']).toBe('高等数学');
      expect(rows[0]['课程类型']).toBe('公共基础课');
      expect(rows[0]['周课时']).toBe(4);
      expect(rows[0]['学期总课时']).toBe(64);
      expect(rows[0]['使用教材']).toBe('高数上册');
      expect(rows[0]['书号']).toBe('978-001');
    });

    it('本学期无有效课程的班级不应出现在导出中', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);

      // 课程的 plan_course_semesters 中无当前学期记录，且 weekly_hours=0
      const pcNoHours = makePlanCourse({
        weekly_hours: 0,
        plan_course_semesters: [
          { semester: 1, weekly_hours: 0, weeks_count: 16, plan_textbooks: [] },
        ],
      });
      const plan = makePlan({ plan_courses: [pcNoHours] });
      const cls = makeClass();

      mocks.classesFindMany.mockResolvedValue([cls]);
      mocks.trainingPlansFindMany.mockResolvedValue([plan]);
      mocks.calcClassSemester.mockReturnValue({ grade: 1, currentSemesterNum: 1 });
      mocks.findBestMatchPlan.mockReturnValue(plan);

      const req = makeReq();
      const res = makeRes();
      const next = vi.fn();

      await exportSemesterSchedule(req, res, next);

      // 修复B：周课时为0的课程被过滤 → 无有效课程 → 班级输出一行汇总（课程='无'，开课数=0）
      const rows = mocks.createWorkbook.mock.calls[0][1];
      expect(rows).toHaveLength(1);
      expect(rows[0].课程).toBe('无');
      expect(rows[0].开课数).toBe(0);
    });

    it('课程不在当前学期范围内应被过滤', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);

      // 课程只在第3-4学期开设
      const pc = makePlanCourse({
        start_semester: 3,
        end_semester: 4,
      });
      const plan = makePlan({ plan_courses: [pc] });
      const cls = makeClass();

      mocks.classesFindMany.mockResolvedValue([cls]);
      mocks.trainingPlansFindMany.mockResolvedValue([plan]);
      mocks.calcClassSemester.mockReturnValue({ grade: 1, currentSemesterNum: 1 });
      mocks.findBestMatchPlan.mockReturnValue(plan);

      const req = makeReq();
      const res = makeRes();
      const next = vi.fn();

      await exportSemesterSchedule(req, res, next);

      // 修复B：课程不在当前学期范围 → 无有效课程 → 班级输出一行汇总（课程='无'）
      const rows = mocks.createWorkbook.mock.calls[0][1];
      expect(rows).toHaveLength(1);
      expect(rows[0].课程).toBe('无');
    });

    it('无匹配方案的班级不应出现在导出中', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);

      const cls = makeClass();
      mocks.classesFindMany.mockResolvedValue([cls]);
      mocks.trainingPlansFindMany.mockResolvedValue([]);
      mocks.calcClassSemester.mockReturnValue({ grade: 1, currentSemesterNum: 1 });
      mocks.findBestMatchPlan.mockReturnValue(null);

      const req = makeReq();
      const res = makeRes();
      const next = vi.fn();

      await exportSemesterSchedule(req, res, next);

      const rows = mocks.createWorkbook.mock.calls[0][1];
      expect(rows).toHaveLength(0);
    });
  });

  describe('calcClassSemester 返回 null', () => {
    it('班级不在有效学期范围内应跳过', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);

      const cls = makeClass({ enrollment_year: 2020 }); // 已毕业
      mocks.classesFindMany.mockResolvedValue([cls]);
      mocks.trainingPlansFindMany.mockResolvedValue([]);
      mocks.calcClassSemester.mockReturnValue(null);

      const req = makeReq();
      const res = makeRes();
      const next = vi.fn();

      await exportSemesterSchedule(req, res, next);

      expect(mocks.findBestMatchPlan).not.toHaveBeenCalled();
      const rows = mocks.createWorkbook.mock.calls[0][1];
      expect(rows).toHaveLength(0);
    });
  });

  describe('grade 筛选', () => {
    it('传入 grade 筛选时应只导出匹配年级的班级', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);

      const cls1 = makeClass({ id: 1, name: '一年级班' });
      const cls2 = makeClass({ id: 2, name: '二年级班', enrollment_year: 2024 });

      mocks.classesFindMany.mockResolvedValue([cls1, cls2]);
      mocks.trainingPlansFindMany.mockResolvedValue([]);

      // cls1 → grade 1, cls2 → grade 2
      mocks.calcClassSemester
        .mockReturnValueOnce({ grade: 1, currentSemesterNum: 1 })
        .mockReturnValueOnce({ grade: 2, currentSemesterNum: 3 });

      mocks.findBestMatchPlan.mockReturnValue(null);

      const req = makeReq({ query: { grade: '2' } });
      const res = makeRes();
      const next = vi.fn();

      await exportSemesterSchedule(req, res, next);

      // findBestMatchPlan 只应为 grade=2 的班级调用
      expect(mocks.findBestMatchPlan).toHaveBeenCalledTimes(1);
      expect(mocks.findBestMatchPlan).toHaveBeenCalledWith(
        cls2,
        expect.any(Array),
        expect.any(Map)
      );
    });
  });

  describe('课程类型映射', () => {
    it('public 类型应映射为"公共基础课"', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);
      const pc = makePlanCourse({ courses: { name: '英语', type: 'public' } });
      const plan = makePlan({ plan_courses: [pc] });
      mocks.classesFindMany.mockResolvedValue([makeClass()]);
      mocks.trainingPlansFindMany.mockResolvedValue([plan]);
      mocks.calcClassSemester.mockReturnValue({ grade: 1, currentSemesterNum: 1 });
      mocks.findBestMatchPlan.mockReturnValue(plan);

      const req = makeReq();
      const res = makeRes();
      await exportSemesterSchedule(req, res, vi.fn());

      const rows = mocks.createWorkbook.mock.calls[0][1];
      expect(rows[0]['课程类型']).toBe('公共基础课');
    });

    it('非 public 类型应映射为"专业课"', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);
      const pc = makePlanCourse({ courses: { name: '专业课A', type: 'major' } });
      const plan = makePlan({ plan_courses: [pc] });
      mocks.classesFindMany.mockResolvedValue([makeClass()]);
      mocks.trainingPlansFindMany.mockResolvedValue([plan]);
      mocks.calcClassSemester.mockReturnValue({ grade: 1, currentSemesterNum: 1 });
      mocks.findBestMatchPlan.mockReturnValue(plan);

      const req = makeReq();
      const res = makeRes();
      await exportSemesterSchedule(req, res, vi.fn());

      const rows = mocks.createWorkbook.mock.calls[0][1];
      expect(rows[0]['课程类型']).toBe('专业课');
    });
  });

  describe('教材信息', () => {
    it('无教材时应显示"未指定"', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);
      const pc = makePlanCourse({
        plan_course_semesters: [
          { semester: 1, weekly_hours: 4, weeks_count: 16, plan_textbooks: [] },
        ],
      });
      const plan = makePlan({ plan_courses: [pc] });
      mocks.classesFindMany.mockResolvedValue([makeClass()]);
      mocks.trainingPlansFindMany.mockResolvedValue([plan]);
      mocks.calcClassSemester.mockReturnValue({ grade: 1, currentSemesterNum: 1 });
      mocks.findBestMatchPlan.mockReturnValue(plan);

      const req = makeReq();
      const res = makeRes();
      await exportSemesterSchedule(req, res, vi.fn());

      const rows = mocks.createWorkbook.mock.calls[0][1];
      expect(rows[0]['使用教材']).toBe('未指定');
      expect(rows[0]['书号']).toBe('-');
    });

    it('多本教材应用"、"分隔', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);
      const pc = makePlanCourse({
        plan_course_semesters: [
          {
            semester: 1,
            weekly_hours: 4,
            weeks_count: 16,
            plan_textbooks: [
              { textbooks: { title: '教材A', isbn: '111' } },
              { textbooks: { title: '教材B', isbn: '222' } },
            ],
          },
        ],
      });
      const plan = makePlan({ plan_courses: [pc] });
      mocks.classesFindMany.mockResolvedValue([makeClass()]);
      mocks.trainingPlansFindMany.mockResolvedValue([plan]);
      mocks.calcClassSemester.mockReturnValue({ grade: 1, currentSemesterNum: 1 });
      mocks.findBestMatchPlan.mockReturnValue(plan);

      const req = makeReq();
      const res = makeRes();
      await exportSemesterSchedule(req, res, vi.fn());

      const rows = mocks.createWorkbook.mock.calls[0][1];
      expect(rows[0]['使用教材']).toBe('教材A、教材B');
      expect(rows[0]['书号']).toBe('111、222');
    });
  });

  describe('错误处理', () => {
    it('内部错误应调用 next 并记录审计日志', async () => {
      mocks.getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);
      mocks.classesFindMany.mockRejectedValue(new Error('DB crash'));

      const req = makeReq();
      const res = makeRes();
      const next = vi.fn();

      await exportSemesterSchedule(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(mocks.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'failed' })
      );
    });
  });
});

// ══════════════════════════════════════════════
describe('exportSemesterSchedulePost (POST)', () => {
  it('body.semester 有效时应使用该学期', async () => {
    mocks.parseSemesterString.mockReturnValue({
      success: true,
      data: SEMESTER_INFO,
    });
    mocks.classesFindMany.mockResolvedValue([]);
    mocks.trainingPlansFindMany.mockResolvedValue([]);

    const req = makeReq({
      body: { semester: '2025-2026-1' },
    });
    const res = makeRes();
    const next = vi.fn();

    await exportSemesterSchedulePost(req, res, next);

    expect(mocks.parseSemesterString).toHaveBeenCalledWith('2025-2026-1');
    expect(res.send).toHaveBeenCalled();
  });

  it('body.semester 格式错误时应返回 400', async () => {
    mocks.parseSemesterString.mockReturnValue({
      success: false,
      error: '学期格式错误，应为 YYYY-YYYY-N',
    });

    const req = makeReq({ body: { semester: 'bad' } });
    const res = makeRes();
    const next = vi.fn();

    await exportSemesterSchedulePost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('无 semester 时应使用全局当前学期', async () => {
    mocks.getCurrentSemesterInfo.mockResolvedValue(SEMESTER_INFO);
    mocks.classesFindMany.mockResolvedValue([]);
    mocks.trainingPlansFindMany.mockResolvedValue([]);

    const req = makeReq({ body: {} });
    const res = makeRes();
    const next = vi.fn();

    await exportSemesterSchedulePost(req, res, next);

    expect(mocks.getCurrentSemesterInfo).toHaveBeenCalled();
    expect(res.send).toHaveBeenCalled();
  });

  it('无 semester 且全局学期为空时应返回 400', async () => {
    mocks.getCurrentSemesterInfo.mockResolvedValue(null);

    const req = makeReq({ body: {} });
    const res = makeRes();
    const next = vi.fn();

    await exportSemesterSchedulePost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringMatching(/设置当前学期/) })
    );
  });
});
