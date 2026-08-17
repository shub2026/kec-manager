/**
 * getDashboardStats 单元测试
 *
 * 覆盖场景：
 * - 正确聚合统计数据
 * - 课程数量和总周课时来自培养方案 plan_courses（开设课程），非 teaching_assignments（已排课）
 * - 参与教师数仍来自 teaching_assignments（排课记录）
 * - 在职教师过滤 (teacher.status = 'active')
 * - totalWeeklyHours 四舍五入
 * - 无学期参数 → 返回错误
 * - 在读班级和学生数计算
 * - 班级有 major_id 但方案按层次匹配 → 总周课时正确
 * - 无匹配方案时 courses 和 totalWeeklyHours 为 0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  majors: { count: vi.fn() },
  training_plans: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  textbooks: { count: vi.fn() },
  classes: { findMany: vi.fn() },
  courses: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  colleges: { findMany: vi.fn() },
  teachers: { count: vi.fn() },
  teaching_assignments: {
    groupBy: vi.fn(),
    findMany: vi.fn(),
    aggregate: vi.fn(),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖服务
// ──────────────────────────────────────────────
vi.mock('../../services/class.service.js', () => ({
  getActiveClassFilter: vi.fn(),
}));

const mockCalcClassSemester = vi.fn();
vi.mock('../../services/semester.service.js', () => ({
  getSemesterInfoFromRequest: vi.fn(),
  calcClassSemester: (...args) => mockCalcClassSemester(...args),
  getPreviousSemester: () => '2025-2026-1',
}));

const mockFindBestMatchPlan = vi.fn();
vi.mock('../../services/plan.service.js', () => ({
  findBestMatchPlan: (...args) => mockFindBestMatchPlan(...args),
}));

// 课时概览 courseStats 现与教学安排页共用 getCourseOverviewAggregate，控制器层 mock 掉
const mockGetCourseOverviewAggregate = vi.fn();
vi.mock('../../services/teaching-arrange.service.js', () => ({
  getCourseOverviewAggregate: (...args) => mockGetCourseOverviewAggregate(...args),
}));

vi.mock('../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  default: { error: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { getDashboardStats, getDashboardInsights } = await import('../dashboard.controller.js');
const { getActiveClassFilter } = await import('../../services/class.service.js');
const { getSemesterInfoFromRequest } = await import('../../services/semester.service.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(query = {}) {
  return { query, user: { id: 1 }, ip: '127.0.0.1' };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

// 测试用的方案数据工厂
function makePlan(id, opts = {}) {
  return {
    id,
    name: opts.name || `方案${id}`,
    major_id: opts.major_id ?? null,
    college_id: opts.college_id ?? null,
    training_level_id: opts.training_level_id ?? null,
    majors: opts.majors ?? null,
    colleges: opts.colleges ?? null,
    training_levels: opts.training_levels ?? null,
    plan_courses: opts.plan_courses || [],
  };
}

function makePlanCourse(courseId, startSem, endSem, weeklyHours, semesterOverrides = []) {
  return {
    course_id: courseId,
    start_semester: startSem,
    end_semester: endSem,
    weekly_hours: weeklyHours,
    courses: { id: courseId },
    plan_course_semesters: semesterOverrides,
  };
}

// ════════════════════════════════════════════════
// getDashboardStats
// ════════════════════════════════════════════════
describe('getDashboardStats', () => {
  const semesterInfo = {
    startYear: 2025,
    endYear: 2026,
    semesterIndex: 2,
    raw: '2025-2026-2',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    getSemesterInfoFromRequest.mockResolvedValue(semesterInfo);
    getActiveClassFilter.mockResolvedValue({ enrollment_year: { gte: 2023 } });

    mockPrisma.majors.count.mockResolvedValue(10);
    mockPrisma.training_plans.count.mockResolvedValue(25);
    mockPrisma.textbooks.count.mockResolvedValue(50);
    // 默认在读班级：2个班级，各有 enrollment_year 和 duration_years
    mockPrisma.classes.findMany.mockResolvedValue([
      {
        id: 1,
        student_count: 40,
        enrollment_year: 2024,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: null,
      },
      {
        id: 2,
        student_count: 35,
        enrollment_year: 2024,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: null,
      },
    ]);
    // 默认方案：一个按层次匹配的方案，含 2 门课程在当前学期（semester 4）
    mockPrisma.training_plans.findMany.mockResolvedValue([
      makePlan(1, {
        training_level_id: 2,
        training_levels: { id: 2, name: '本科' },
        plan_courses: [
          makePlanCourse(10, 1, 6, 4, [{ semester: 4, weekly_hours: 4 }]),
          makePlanCourse(20, 3, 5, 2, [{ semester: 4, weekly_hours: 2 }]),
        ],
      }),
    ]);
    // 默认 calcClassSemester: 2024 入学 + 2025-2026-2 → grade=2, semesterNum=4
    mockCalcClassSemester.mockReturnValue({ grade: 2, currentSemesterNum: 4 });
    // 默认 findBestMatchPlan: 返回方案 1
    mockFindBestMatchPlan.mockImplementation((cls, plans) => plans[0] || null);
    // 默认教师排课
    mockPrisma.teaching_assignments.groupBy.mockResolvedValue([
      { teacher_id: 1, _sum: { weekly_hours: 12 } },
      { teacher_id: 2, _sum: { weekly_hours: 8 } },
    ]);
    // BIZ-M3: 已排课记录明细（默认无记录，合班去重后求和为 0）
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([]);
  });

  it('无学期参数 → 返回错误', async () => {
    const req = mockReq({});
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '请选择学期' })
    );
  });

  it('返回正确的聚合统计数据', async () => {
    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          semester: '2025-2026-2',
          majors: 10,
          classes: 2,
          textbooks: 50,
          plans: 25,
          totalStudents: 75, // 40 + 35
          teachingTeachers: 2,
          // 课程数量来自方案：2门课在当前学期开设（weekly_hours > 0）
          courses: 2,
          // 总周课时 = (4 + 2) * 2个班级 = 12
          totalWeeklyHours: 12,
        }),
      })
    );
  });

  it('课程数量和总周课时来自培养方案，而非 teaching_assignments', async () => {
    // teaching_assignments 有 5 门课（排课记录），但方案只有 2 门课在当前学期
    mockPrisma.teaching_assignments.groupBy.mockResolvedValue([
      { teacher_id: 1, _sum: { weekly_hours: 30 } },
    ]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    // 课程数 = 方案中当前学期的课程数（2），不是排课记录的课程数
    expect(data.courses).toBe(2);
    // 总周课时 = 方案课时 × 班级数（(4+2)*2=12），不是排课记录的 30
    expect(data.totalWeeklyHours).toBe(12);
    // 参与教师仍然来自 teaching_assignments
    expect(data.teachingTeachers).toBe(1);
  });

  it('在读学生数是各班级 student_count 之和', async () => {
    mockPrisma.classes.findMany.mockResolvedValue([
      {
        id: 1,
        student_count: 30,
        enrollment_year: 2024,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: null,
      },
      {
        id: 2,
        student_count: 0,
        enrollment_year: 2024,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: null,
      },
      {
        id: 3,
        student_count: 50,
        enrollment_year: 2024,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: null,
      },
    ]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.totalStudents).toBe(80);
  });

  it('student_count 为 null 时按 0 计算', async () => {
    mockPrisma.classes.findMany.mockResolvedValue([
      {
        id: 1,
        student_count: null,
        enrollment_year: 2024,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: null,
      },
      {
        id: 2,
        student_count: 25,
        enrollment_year: 2024,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: null,
      },
    ]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.totalStudents).toBe(25);
  });

  it('教师统计的 where 条件含 semester + weekly_hours>0 + active', async () => {
    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const teacherCallArgs = mockPrisma.teaching_assignments.groupBy.mock.calls[0][0];
    expect(teacherCallArgs.where).toEqual(
      expect.objectContaining({
        semester: '2025-2026-2',
        weekly_hours: { gt: 0 },
        teacher: { status: 'active' },
      })
    );
  });

  it('totalWeeklyHours 四舍五入到一位小数', async () => {
    // 方案含一门课 weekly_hours=3.33
    mockPrisma.training_plans.findMany.mockResolvedValue([
      makePlan(1, {
        training_level_id: 2,
        plan_courses: [makePlanCourse(10, 1, 6, 3.33, [{ semester: 4, weekly_hours: 3.33 }])],
      }),
    ]);
    // 1个班级
    mockPrisma.classes.findMany.mockResolvedValue([
      {
        id: 1,
        student_count: 40,
        enrollment_year: 2024,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: null,
      },
    ]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    // 3.33 → Math.round(3.33 * 10) / 10 = 3.3
    expect(data.totalWeeklyHours).toBe(3.3);
  });

  it('无在读班级 → courses 和 totalWeeklyHours 为 0', async () => {
    mockPrisma.classes.findMany.mockResolvedValue([]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.classes).toBe(0);
    expect(data.totalStudents).toBe(0);
    expect(data.courses).toBe(0);
    expect(data.totalWeeklyHours).toBe(0);
  });

  it('班级无匹配方案 → 该班级的课程不计入', async () => {
    mockFindBestMatchPlan.mockReturnValue(null);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.courses).toBe(0);
    expect(data.totalWeeklyHours).toBe(0);
  });

  it('班级有 major_id 但方案按层次匹配 → 总周课时按方案实际字段计算', async () => {
    // 模拟 bug 场景：班级有 major_id=200(转段) + training_level_id=46(五年制)
    // 方案只有 training_level_id=46，应按层次匹配
    mockPrisma.classes.findMany.mockResolvedValue([
      {
        id: 100,
        student_count: 45,
        enrollment_year: 2023,
        duration_years: 5,
        major_id: 200,
        training_level_id: 46,
        college_id: 44,
        custom_plan_id: null,
      },
    ]);
    mockCalcClassSemester.mockReturnValue({ grade: 3, currentSemesterNum: 5 });

    const levelPlan = makePlan(6, {
      name: '五年制方案',
      training_level_id: 46,
      plan_courses: [
        makePlanCourse(50, 1, 8, 6, [{ semester: 5, weekly_hours: 6 }]),
        makePlanCourse(51, 1, 8, 4, [{ semester: 5, weekly_hours: 4 }]),
      ],
    });
    mockPrisma.training_plans.findMany.mockResolvedValue([levelPlan]);
    mockFindBestMatchPlan.mockReturnValue(levelPlan);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.courses).toBe(2); // 2 门课在当前学期开设
    expect(data.totalWeeklyHours).toBe(10); // 6 + 4
  });

  it('custom_plan_id 优先于 findBestMatchPlan', async () => {
    const customPlan = makePlan(99, {
      name: '自定义方案',
      plan_courses: [makePlanCourse(70, 3, 6, 3, [{ semester: 4, weekly_hours: 3 }])],
    });
    mockPrisma.classes.findMany.mockResolvedValue([
      {
        id: 1,
        student_count: 30,
        enrollment_year: 2024,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: 99,
      },
    ]);
    mockPrisma.training_plans.findMany.mockResolvedValue([customPlan]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.courses).toBe(1);
    expect(data.totalWeeklyHours).toBe(3);
    // findBestMatchPlan 不应被调用
    expect(mockFindBestMatchPlan).not.toHaveBeenCalled();
  });

  it('课程不在当前学期范围内 → 不计入', async () => {
    // 方案的课程 start_semester=5, end_semester=8，当前学期是 4
    mockPrisma.training_plans.findMany.mockResolvedValue([
      makePlan(1, {
        training_level_id: 2,
        plan_courses: [makePlanCourse(10, 5, 8, 4, [{ semester: 5, weekly_hours: 4 }])],
      }),
    ]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.courses).toBe(0);
    expect(data.totalWeeklyHours).toBe(0);
  });

  it('weekly_hours 为 0 的课程不计入', async () => {
    // 只用 1 个班级，避免累加翻倍
    mockPrisma.classes.findMany.mockResolvedValue([
      {
        id: 1,
        student_count: 40,
        enrollment_year: 2024,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: null,
      },
    ]);
    mockPrisma.training_plans.findMany.mockResolvedValue([
      makePlan(1, {
        training_level_id: 2,
        plan_courses: [
          makePlanCourse(10, 1, 6, 0, [{ semester: 4, weekly_hours: 0 }]),
          makePlanCourse(20, 1, 6, 3, [{ semester: 4, weekly_hours: 3 }]),
        ],
      }),
    ]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.courses).toBe(1);
    expect(data.totalWeeklyHours).toBe(3);
  });

  it('相同 course_id 跨多个班级只计一次课程数，但周课时累加', async () => {
    // 2个班级匹配同一方案，方案含相同 course_id
    mockPrisma.classes.findMany.mockResolvedValue([
      {
        id: 1,
        student_count: 40,
        enrollment_year: 2024,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: null,
      },
      {
        id: 2,
        student_count: 35,
        enrollment_year: 2024,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: null,
      },
    ]);
    mockPrisma.training_plans.findMany.mockResolvedValue([
      makePlan(1, {
        training_level_id: 2,
        plan_courses: [makePlanCourse(10, 1, 6, 4, [{ semester: 4, weekly_hours: 4 }])],
      }),
    ]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    // 课程数去重：只有 1 门课
    expect(data.courses).toBe(1);
    // 但总周课时累加：4 + 4 = 8（每个班级各 4 课时）
    expect(data.totalWeeklyHours).toBe(8);
  });

  it('calcClassSemester 返回 null 的班级跳过计算', async () => {
    mockPrisma.classes.findMany.mockResolvedValue([
      {
        id: 1,
        student_count: 40,
        enrollment_year: 2020,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: null,
      },
    ]);
    // 该班级已毕业，calcClassSemester 返回 null
    mockCalcClassSemester.mockReturnValue(null);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    // 学生数仍然计入（totalStudents 不依赖 calcClassSemester）
    expect(data.totalStudents).toBe(40);
    // 但课程和课时为 0
    expect(data.courses).toBe(0);
    expect(data.totalWeeklyHours).toBe(0);
  });

  it('无排课时 teachingTeachers 为 0', async () => {
    mockPrisma.teaching_assignments.groupBy.mockResolvedValue([]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.teachingTeachers).toBe(0);
  });

  it('教材统计仅计算活跃教材 (is_active: true)', async () => {
    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    expect(mockPrisma.textbooks.count).toHaveBeenCalledWith({
      where: { is_active: true },
    });
  });

  it('assignedWeeklyHours 合班去重：同组合同课同教师只计一次课时', async () => {
    // 两行同组合(99)、同课程、同教师 → 只计 4；另一独立班 2 → 合计 6（而非 10）
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([
      {
        weekly_hours: 4,
        course_id: 10,
        teacher_id: 1,
        class_id: 1,
        class: { combination_id: 99 },
      },
      {
        weekly_hours: 4,
        course_id: 10,
        teacher_id: 1,
        class_id: 2,
        class: { combination_id: 99 },
      },
      {
        weekly_hours: 2,
        course_id: 20,
        teacher_id: 1,
        class_id: 3,
        class: { combination_id: null },
      },
    ]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.assignedWeeklyHours).toBe(6);
  });

  it('异常时传递给 next', async () => {
    mockPrisma.majors.count.mockRejectedValue(new Error('DB error'));

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    const next = vi.fn();
    await getDashboardStats(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ════════════════════════════════════════════════
// getDashboardInsights — 合班去重回归
// ════════════════════════════════════════════════
describe('getDashboardInsights', () => {
  const semesterInfo = {
    startYear: 2025,
    endYear: 2026,
    semesterIndex: 2,
    raw: '2025-2026-2',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getSemesterInfoFromRequest.mockResolvedValue(semesterInfo);
    // computeOfferedCourses 依赖：默认无在读班级/方案 → 应开课程为空集
    getActiveClassFilter.mockResolvedValue({});
    mockPrisma.classes.findMany.mockResolvedValue([]);
    mockPrisma.training_plans.findMany.mockResolvedValue([]);
    // 课时概览聚合：默认无课程
    mockGetCourseOverviewAggregate.mockResolvedValue([]);
  });

  it('合班教学应去重：课时只计 1 次、逻辑教学班=1（不虚高）', async () => {
    const teacher = {
      id: 1,
      name: '王五',
      default_weekly_hours: 10,
      personnel_type: 'full_time',
      affiliated_college: { id: 1, name: '教育学院' },
    };
    const teacherB = {
      id: 2,
      name: '赵六',
      default_weekly_hours: 10,
      personnel_type: 'external',
      affiliated_college: { id: 1, name: '教育学院' },
    };
    // 两行同组合(99)、同课程(数学)、同教师 → 物理上是一节合班课
    const allAssignments = [
      {
        weekly_hours: 4,
        course_id: 10,
        class_id: 1,
        teacher,
        class: { college_id: 1, combination_id: 99, colleges: { id: 1, name: '教育学院' } },
        course: { id: 10, name: '数学', type: '必修' },
      },
      {
        weekly_hours: 4,
        course_id: 10,
        class_id: 2,
        teacher,
        class: { college_id: 1, combination_id: 99, colleges: { id: 1, name: '教育学院' } },
        course: { id: 10, name: '数学', type: '必修' },
      },
      // 一个独立班（非合班）英语课
      {
        weekly_hours: 2,
        course_id: 20,
        class_id: 3,
        teacher,
        class: { college_id: 1, combination_id: null, colleges: { id: 1, name: '教育学院' } },
        course: { id: 20, name: '英语', type: '必修' },
      },
      // 外聘教师 4 课时独立课，供 teacherLoad TOP 排序与人员类别断言
      {
        weekly_hours: 4,
        course_id: 10,
        class_id: 4,
        teacher: teacherB,
        class: { college_id: 1, combination_id: null, colleges: { id: 1, name: '教育学院' } },
        course: { id: 10, name: '数学', type: '必修' },
      },
    ];

    // 应开课程：一个班级匹配含数学(10)/英语(20)的方案，使 completion 口径有意义
    mockPrisma.classes.findMany.mockResolvedValue([
      {
        id: 1,
        student_count: 40,
        enrollment_year: 2024,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: null,
      },
    ]);
    mockPrisma.training_plans.findMany.mockResolvedValue([
      makePlan(1, {
        training_level_id: 2,
        plan_courses: [
          makePlanCourse(10, 1, 6, 4, [{ semester: 4, weekly_hours: 4 }]),
          makePlanCourse(20, 3, 5, 2, [{ semester: 4, weekly_hours: 2 }]),
        ],
      }),
    ]);
    mockCalcClassSemester.mockReturnValue({ grade: 2, currentSemesterNum: 4 });
    mockFindBestMatchPlan.mockImplementation((cls, plans) => plans[0] || null);
    // 第一次 findMany：已排课课程（去重）
    mockPrisma.teaching_assignments.findMany.mockResolvedValueOnce([
      { course_id: 10 },
      { course_id: 20 },
    ]);
    // 第二次 findMany：全部排课记录（含合班成员班）
    mockPrisma.teaching_assignments.findMany.mockResolvedValueOnce(allAssignments);
    mockPrisma.colleges.findMany.mockResolvedValue([{ id: 1, name: '教育学院' }]);
    mockPrisma.teachers.count.mockResolvedValue(5);
    mockPrisma.courses.findMany.mockResolvedValue([
      { id: 10, name: '数学' },
      { id: 20, name: '英语' },
    ]);
    // 课时概览口径与教学安排页对齐：来自 getCourseOverviewAggregate（当前方案课时/应排班级）；
    // 按学期参数返回不同 fixture，覆盖上学期对比（数学 +2 / 英语 -2）
    mockGetCourseOverviewAggregate.mockImplementation((sem) =>
      Promise.resolve(
        sem === '2025-2026-2'
          ? [
              {
                courseId: 10,
                courseName: '数学',
                courseType: '必修',
                totalClasses: 1,
                totalCourseHours: 4,
                assignedHours: 4,
                teacherCount: 1,
              },
              {
                courseId: 20,
                courseName: '英语',
                courseType: '必修',
                totalClasses: 1,
                totalCourseHours: 2,
                assignedHours: 2,
                teacherCount: 1,
              },
              {
                courseId: 99,
                courseName: '体育',
                courseType: '公共',
                totalClasses: 0,
                totalCourseHours: 0,
                assignedHours: 0,
                teacherCount: 0,
              },
            ]
          : [
              // 上学期：数学 2 课时（本学期增至 4），英语 4 课时（本学期降至 2）
              { courseId: 10, courseName: '数学', totalClasses: 1, totalCourseHours: 2 },
              { courseId: 20, courseName: '英语', totalClasses: 1, totalCourseHours: 4 },
            ]
      )
    );

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardInsights(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;

    // 课时概览按教学安排页口径映射：数学总课时 4 / 1 班 / 1 教师；
    // 无应排班级的课程（本学期不开设）不进入列表；
    // 上学期对比：数学 4-2=+2，英语 2-4=-2
    expect(mockGetCourseOverviewAggregate).toHaveBeenCalledWith('2025-2026-2');
    expect(mockGetCourseOverviewAggregate).toHaveBeenCalledWith('2025-2026-1');
    expect(data.courseStats).toHaveLength(2);
    const math = data.courseStats.find((c) => c.name === '数学');
    expect(math).toEqual({
      id: 10,
      name: '数学',
      totalHours: 4,
      classCount: 1,
      teacherCount: 1,
      prevTotalHours: 2,
      delta: 2,
    });
    const eng = data.courseStats.find((c) => c.name === '英语');
    expect(eng).toEqual({
      id: 20,
      name: '英语',
      totalHours: 2,
      classCount: 1,
      teacherCount: 1,
      prevTotalHours: 4,
      delta: -2,
    });

    // 学院课时分布也应去重：4（数学合班）+ 2（英语）+ 4（赵六）= 10，而非 14
    const dist = data.distribution.find((d) => d.name === '教育学院');
    expect(dist.hours).toBe(10);

    // 教师负载：参与 2 人 / 在职 5 人，总课时 6+4=10 → 人均 5；
    // TOP 按课时降序，byPersonnelType 按 personnel_type 计数
    expect(data.teacherLoad).toEqual({
      totalTeachers: 5,
      assignedTeachers: 2,
      avgHours: 5,
      top: [
        { id: 1, name: '王五', hours: 6 },
        { id: 2, name: '赵六', hours: 4 },
      ],
      byPersonnelType: { full_time: 1, external: 1 },
    });

    // 王五总课时去重后为 6，未超 default_weekly_hours(10)
    expect(data.alerts.overloadedTeachers).toHaveLength(0);

    // 完成度按应开口径：应开 2 门（数学/英语）且均已排 → 门数 2/2；
    // rate 为课时口径：已排 6 ÷ 总 6 = 100%
    expect(data.completion.totalCourses).toBe(2);
    expect(data.completion.assignedCourses).toBe(2);
    expect(data.completion.rate).toBe(100);
    expect(data.completion.totalHours).toBe(6);
    expect(data.completion.assignedHours).toBe(6);
  });

  it('完成度与未排课提醒按"本学期应开课程"口径，不开设的课程不计入也不误报', async () => {
    // 应开 3 门：10/20/30；课程库另有本学期不开的 99
    mockPrisma.training_plans.findMany.mockResolvedValue([
      makePlan(1, {
        training_level_id: 2,
        plan_courses: [
          makePlanCourse(10, 1, 6, 4, [{ semester: 4, weekly_hours: 4 }]),
          makePlanCourse(20, 3, 5, 2, [{ semester: 4, weekly_hours: 2 }]),
          makePlanCourse(30, 3, 5, 2, [{ semester: 4, weekly_hours: 2 }]),
        ],
      }),
    ]);
    mockPrisma.classes.findMany.mockResolvedValue([
      {
        id: 1,
        student_count: 40,
        enrollment_year: 2024,
        duration_years: 3,
        major_id: 1,
        training_level_id: 2,
        college_id: 1,
        custom_plan_id: null,
      },
    ]);
    mockCalcClassSemester.mockReturnValue({ grade: 2, currentSemesterNum: 4 });
    mockFindBestMatchPlan.mockImplementation((cls, plans) => plans[0] || null);

    // 已排 2 门（10/20）
    mockPrisma.teaching_assignments.findMany.mockResolvedValueOnce([
      { course_id: 10 },
      { course_id: 20 },
    ]);
    mockPrisma.teaching_assignments.findMany.mockResolvedValueOnce([]);
    mockPrisma.colleges.findMany.mockResolvedValue([]);
    mockPrisma.teachers.count.mockResolvedValue(3);
    mockPrisma.courses.findMany.mockResolvedValue([
      { id: 10, name: '数学' },
      { id: 20, name: '英语' },
      { id: 30, name: '化学' },
      { id: 99, name: '体育' }, // 本学期不开设
    ]);
    // 排课聚合：数学/英语已排满（4+2），化学应开 2 课时未排 → rate = 6/8 = 75%
    mockGetCourseOverviewAggregate.mockResolvedValue([
      {
        courseId: 10,
        courseName: '数学',
        totalClasses: 1,
        totalCourseHours: 4,
        assignedHours: 4,
        teacherCount: 1,
      },
      {
        courseId: 20,
        courseName: '英语',
        totalClasses: 1,
        totalCourseHours: 2,
        assignedHours: 2,
        teacherCount: 1,
      },
      {
        courseId: 30,
        courseName: '化学',
        totalClasses: 1,
        totalCourseHours: 2,
        assignedHours: 0,
        teacherCount: 0,
      },
      {
        courseId: 99,
        courseName: '体育',
        totalClasses: 0,
        totalCourseHours: 0,
        assignedHours: 0,
        teacherCount: 0,
      },
    ]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardInsights(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;

    // 门数分母=应开 3 门（而非课程库 4 门），分子=已排∩应开 2 门；
    // rate 为课时口径：已排 6 ÷ 总 8 = 75%（而非门数口径 67%）
    expect(data.completion.totalCourses).toBe(3);
    expect(data.completion.assignedCourses).toBe(2);
    expect(data.completion.rate).toBe(75);
    expect(data.completion.totalHours).toBe(8);
    expect(data.completion.assignedHours).toBe(6);

    // 未排课提醒只含应开未排的化学，不含本学期不开的体育
    expect(data.alerts.unassignedCourses).toHaveLength(1);
    expect(data.alerts.unassignedCourses[0].name).toBe('化学');

    // 无排课记录时教师负载为空态：参与 0 人、人均 0、TOP 为空
    expect(data.teacherLoad.assignedTeachers).toBe(0);
    expect(data.teacherLoad.avgHours).toBe(0);
    expect(data.teacherLoad.top).toEqual([]);
    expect(data.teacherLoad.byPersonnelType).toEqual({});
  });

  it('课时概览口径与教学安排页对齐：应排未排班级计入班级数与总课时，教师数为 0 也展示，上学期无该课程时 delta 为 null', async () => {
    // 化学：2 个应排班级（周课时各 2）但尚未安排教师 →
    // 总课时 4 / 2 班 / 0 教师，与教学安排页概览卡片一致；
    // 上学期无化学 → prevTotalHours/delta 均为 null（前端展示"新增"）
    mockGetCourseOverviewAggregate.mockImplementation((sem) =>
      Promise.resolve(
        sem === '2025-2026-2'
          ? [
              {
                courseId: 30,
                courseName: '化学',
                courseType: '必修',
                totalClasses: 2,
                totalCourseHours: 4,
                teacherCount: 0,
                assignedCount: 0,
                assignedHours: 0,
                remainingHours: 4,
              },
            ]
          : []
      )
    );

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardInsights(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.courseStats).toEqual([
      {
        id: 30,
        name: '化学',
        totalHours: 4,
        classCount: 2,
        teacherCount: 0,
        prevTotalHours: null,
        delta: null,
      },
    ]);
  });

  it('无学期参数 → 返回错误', async () => {
    const req = mockReq({});
    const res = mockRes();
    await getDashboardInsights(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '请选择学期' })
    );
  });
});
