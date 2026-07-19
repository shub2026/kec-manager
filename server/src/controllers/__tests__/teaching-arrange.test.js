/**
 * teaching-arrange.controller.js — assignTeacher 单元测试
 *
 * 覆盖场景：
 * 1. 成功安排（显式 weekly_hours）
 * 2. 自动推导 weekly_hours（findBestMatchPlan 路径）
 * 3. 班级已离校 → 错误
 * 4. 教师已禁用 → 错误
 * 5. 教师未关联课程 → 错误
 * 6. 工作量超限警告
 * 7. 班级不存在 → 404
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  $transaction: vi.fn(async (cb) => cb(mockPrisma)),
  classes: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  teachers: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  teacher_courses: {
    findUnique: vi.fn(),
  },
  teaching_assignments: {
    upsert: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
    groupBy: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
  training_levels: {
    findMany: vi.fn(),
  },
  textbooks: {
    findMany: vi.fn(),
  },
  plan_courses: {
    findMany: vi.fn(),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖服务
// ──────────────────────────────────────────────
vi.mock('../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/plan.service.js', () => ({
  findBestMatchPlan: vi.fn(),
}));

vi.mock('../../services/teaching-arrange.service.js', () => ({
  getClassesWithCourse: vi.fn(),
  getTeachersForCourse: vi.fn(),
  autoArrange: vi.fn(),
  batchAutoArrange: vi.fn(),
  parseSemester: vi.fn(),
  validateHourSettings: vi.fn(),
}));

vi.mock('../../services/semester.service.js', () => ({
  calcClassSemester: vi.fn(),
}));

// ──────────────────────────────────────────────
// 导入被测模块（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const { assignTeacher, resetAutoAssignments, getStatistics, deleteAssignment } =
  await import('../teaching-arrange.controller.js');
const { createAuditLog } = await import('../../services/audit.service.js');
const { findBestMatchPlan } = await import('../../services/plan.service.js');
const { parseSemester } = await import('../../services/teaching-arrange.service.js');
const { calcClassSemester } = await import('../../services/semester.service.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(body = {}, overrides = {}) {
  return { body, user: { id: 1 }, ip: '127.0.0.1', ...overrides };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

// ──────────────────────────────────────────────
// 公共 mock 数据
// ──────────────────────────────────────────────
const ACTIVE_CLASS = {
  id: 10,
  name: '2024级学前1班',
  is_left_school: false,
  custom_plan_id: null,
  major_id: 1,
  training_level_id: 2,
  enrollment_year: 2024,
  duration_years: 3,
};

const ACTIVE_TEACHER = {
  id: 5,
  name: '张老师',
  status: 'active',
  personnel_type: 'full_time',
};

const UPSERTED_ASSIGNMENT = {
  id: 100,
  teacher_id: 5,
  class_id: 10,
  course_id: 3,
  semester: '2025-2026-2',
  weekly_hours: 4,
  is_auto: false,
  teacher: { id: 5, name: '张老师', personnel_type: 'full_time' },
  class: { id: 10, name: '2024级学前1班' },
};

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('assignTeacher — 手动安排教师', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 默认：班级存在且未离校
    mockPrisma.classes.findFirst.mockResolvedValue({ ...ACTIVE_CLASS });
    mockPrisma.classes.findUnique.mockResolvedValue({
      ...ACTIVE_CLASS,
      majors: { id: 1 },
      training_levels: { id: 2 },
    });

    // 默认：教师存在且启用
    mockPrisma.teachers.findUnique.mockResolvedValue({ ...ACTIVE_TEACHER });

    // 默认：教师可教该课程
    mockPrisma.teacher_courses.findUnique.mockResolvedValue({
      teacher_id: 5,
      course_id: 3,
    });

    // 默认：upsert 成功
    mockPrisma.teaching_assignments.upsert.mockResolvedValue({ ...UPSERTED_ASSIGNMENT });

    // 默认：工作量查询不超限
    mockPrisma.teaching_assignments.groupBy.mockResolvedValue([
      { teacher_id: 5, _sum: { weekly_hours: 10 } },
    ]);
  });

  // ──────────────────────────────────────────────
  // 1. 成功安排（显式 weekly_hours）
  // ──────────────────────────────────────────────
  it('显式传入 weekly_hours 应成功安排并返回成功响应', async () => {
    const req = mockReq({
      class_id: 10,
      course_id: 3,
      semester: '2025-2026-2',
      teacher_id: 5,
      weekly_hours: 4,
    });
    const res = mockRes();
    const next = vi.fn();

    await assignTeacher(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.teaching_assignments.upsert).toHaveBeenCalledTimes(1);

    // upsert 的 create 分支应包含传入的 weekly_hours
    const upsertCall = mockPrisma.teaching_assignments.upsert.mock.calls[0][0];
    expect(upsertCall.create.weekly_hours).toBe(4);
    expect(upsertCall.create.teacher_id).toBe(5);
    expect(upsertCall.create.class_id).toBe(10);

    // 返回成功响应
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: '安排成功',
      })
    );

    // 审计日志被调用
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        module: 'teachingArrange',
        result: 'success',
      })
    );
  });

  // ──────────────────────────────────────────────
  // 2. 自动推导 weekly_hours（findBestMatchPlan 路径）
  // ──────────────────────────────────────────────
  it('未传 weekly_hours 时应通过 findBestMatchPlan 推导周课时', async () => {
    // parseSemester 返回学期信息
    parseSemester.mockReturnValue({
      startYear: 2025,
      endYear: 2026,
      semesterIndex: 2,
      raw: '2025-2026-2',
    });

    // calcClassSemester 返回当前学期号
    calcClassSemester.mockReturnValue({ currentSemesterNum: 2 });

    // plan_courses 查询返回方案课程
    mockPrisma.plan_courses.findMany.mockResolvedValue([
      {
        id: 20,
        course_id: 3,
        start_semester: 1,
        end_semester: 4,
        weekly_hours: 6,
        plan_course_semesters: [
          { semester: 1, weekly_hours: 6 },
          { semester: 2, weekly_hours: 8 },
          { semester: 3, weekly_hours: 6 },
        ],
        training_plans: { id: 1, major_id: 1, training_level_id: null },
      },
    ]);

    // findBestMatchPlan 返回匹配的方案
    findBestMatchPlan.mockReturnValue({ id: 1, major_id: 1, training_level_id: null });

    const req = mockReq({
      class_id: 10,
      course_id: 3,
      semester: '2025-2026-2',
      teacher_id: 5,
      // weekly_hours 不传，走推导路径
    });
    const res = mockRes();
    const next = vi.fn();

    await assignTeacher(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(parseSemester).toHaveBeenCalledWith('2025-2026-2');
    expect(calcClassSemester).toHaveBeenCalled();
    expect(findBestMatchPlan).toHaveBeenCalled();

    // upsert 的 create 分支应使用推导出的 weekly_hours (semester=2 → 8)
    const upsertCall = mockPrisma.teaching_assignments.upsert.mock.calls[0][0];
    expect(upsertCall.create.weekly_hours).toBe(8);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '安排成功' })
    );
  });

  // ──────────────────────────────────────────────
  // 3. 班级已离校 → 错误
  // ──────────────────────────────────────────────
  it('班级已离校（is_left_school=true）应返回错误', async () => {
    // findFirst 查询 is_left_school: false 条件，已离校班级返回 null
    mockPrisma.classes.findFirst.mockResolvedValue(null);

    const req = mockReq({
      class_id: 10,
      course_id: 3,
      semester: '2025-2026-2',
      teacher_id: 5,
      weekly_hours: 4,
    });
    const res = mockRes();
    const next = vi.fn();

    await assignTeacher(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '班级不存在或已离校',
      })
    );
    expect(mockPrisma.teaching_assignments.upsert).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // 4. 教师已禁用 → 错误
  // ──────────────────────────────────────────────
  it('教师已禁用（status=disabled）应返回错误', async () => {
    mockPrisma.teachers.findUnique.mockResolvedValue({
      ...ACTIVE_TEACHER,
      status: 'disabled',
    });

    const req = mockReq({
      class_id: 10,
      course_id: 3,
      semester: '2025-2026-2',
      teacher_id: 5,
      weekly_hours: 4,
    });
    const res = mockRes();
    const next = vi.fn();

    await assignTeacher(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '该教师已禁用，无法安排',
      })
    );
    expect(mockPrisma.teaching_assignments.upsert).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // 5. 教师未关联课程 → 错误
  // ──────────────────────────────────────────────
  it('教师未关联此课程（teacher_courses 不存在）应返回错误', async () => {
    mockPrisma.teacher_courses.findUnique.mockResolvedValue(null);

    const req = mockReq({
      class_id: 10,
      course_id: 3,
      semester: '2025-2026-2',
      teacher_id: 5,
      weekly_hours: 4,
    });
    const res = mockRes();
    const next = vi.fn();

    await assignTeacher(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '该教师未关联此课程，无法安排',
      })
    );
    expect(mockPrisma.teaching_assignments.upsert).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // 6. 工作量超限警告
  // ──────────────────────────────────────────────
  it('教师工作量超限时应在响应中包含 workloadWarning', async () => {
    // 优化5：工作量检查改用 findMany + dedupeTeachingUnits（合班去重）
    // 模拟总课时超过 full_time 的 max (20)：3 个非合班单元，各 9 课时 = 27 > 20
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([
      { teacher_id: 5, course_id: 1, weekly_hours: 9, class_id: 1, class: { combination_id: null } },
      { teacher_id: 5, course_id: 2, weekly_hours: 9, class_id: 2, class: { combination_id: null } },
      { teacher_id: 5, course_id: 3, weekly_hours: 9, class_id: 3, class: { combination_id: null } },
    ]);

    const req = mockReq({
      class_id: 10,
      course_id: 3,
      semester: '2025-2026-2',
      teacher_id: 5,
      weekly_hours: 4,
    });
    const res = mockRes();
    const next = vi.fn();

    await assignTeacher(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          workloadWarning: expect.stringContaining('超过建议上限'),
        }),
      })
    );
  });

  // ──────────────────────────────────────────────
  // 7. 班级不存在 → 404（教师不存在）
  // ──────────────────────────────────────────────
  it('教师不存在应返回 404', async () => {
    mockPrisma.teachers.findUnique.mockResolvedValue(null);

    const req = mockReq({
      class_id: 10,
      course_id: 3,
      semester: '2025-2026-2',
      teacher_id: 999,
      weekly_hours: 4,
    });
    const res = mockRes();
    const next = vi.fn();

    await assignTeacher(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '教师不存在',
      })
    );
    expect(mockPrisma.teaching_assignments.upsert).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // 补充：缺少必要参数
  // ──────────────────────────────────────────────
  it('缺少必要参数应返回错误', async () => {
    const req = mockReq({ class_id: 10 }); // 缺少 course_id, semester, teacher_id
    const res = mockRes();
    const next = vi.fn();

    await assignTeacher(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '缺少必要参数',
      })
    );
  });
});

// ════════════════════════════════════════════════
// resetAutoAssignments 测试
// ════════════════════════════════════════════════
describe('resetAutoAssignments — 重置自动排课', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────
  // 1. 重置当前科目（传 course_id）
  // ──────────────────────────────────────────────
  it('传入 course_id 应仅重置该科目的自动安排', async () => {
    mockPrisma.teaching_assignments.deleteMany.mockResolvedValue({ count: 5 });

    const req = mockReq({ course_id: 3, semester: '2025-2026-2' });
    const res = mockRes();
    const next = vi.fn();

    await resetAutoAssignments(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.teaching_assignments.deleteMany).toHaveBeenCalledWith({
      where: { course_id: 3, semester: '2025-2026-2', is_auto: true },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: { deletedCount: 5 },
        message: '已重置5条自动安排',
      })
    );
  });

  // ──────────────────────────────────────────────
  // 2. 重置全部科目（不传 course_id）
  // ──────────────────────────────────────────────
  it('不传 course_id 应重置当前学期全部科目的自动安排', async () => {
    mockPrisma.teaching_assignments.deleteMany.mockResolvedValue({ count: 42 });

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    const next = vi.fn();

    await resetAutoAssignments(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // where 条件不应包含 course_id
    expect(mockPrisma.teaching_assignments.deleteMany).toHaveBeenCalledWith({
      where: { semester: '2025-2026-2', is_auto: true },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: { deletedCount: 42 },
        message: '已重置42条自动安排',
      })
    );
  });

  // ──────────────────────────────────────────────
  // 3. 无自动安排记录时
  // ──────────────────────────────────────────────
  it('无自动安排记录时 deletedCount 应为 0', async () => {
    mockPrisma.teaching_assignments.deleteMany.mockResolvedValue({ count: 0 });

    const req = mockReq({ course_id: 3, semester: '2025-2026-2' });
    const res = mockRes();
    const next = vi.fn();

    await resetAutoAssignments(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: { deletedCount: 0 },
        message: '已重置0条自动安排',
      })
    );
  });

  // ──────────────────────────────────────────────
  // 4. 审计日志记录
  // ──────────────────────────────────────────────
  it('重置当前科目时应记录含 course_id 的审计日志', async () => {
    mockPrisma.teaching_assignments.deleteMany.mockResolvedValue({ count: 3 });

    const req = mockReq({ course_id: 7, semester: '2025-2026-1' });
    const res = mockRes();
    const next = vi.fn();

    await resetAutoAssignments(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        module: 'teachingArrange',
        details: expect.objectContaining({
          course_id: 7,
          semester: '2025-2026-1',
          deletedCount: 3,
        }),
        result: 'success',
        message: expect.stringContaining('课程7'),
      })
    );
  });

  it('重置全部科目时审计日志 course_id 应为 null', async () => {
    mockPrisma.teaching_assignments.deleteMany.mockResolvedValue({ count: 15 });

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    const next = vi.fn();

    await resetAutoAssignments(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          course_id: null,
          semester: '2025-2026-2',
          deletedCount: 15,
        }),
        message: expect.stringContaining('全部课程'),
      })
    );
  });

  // ──────────────────────────────────────────────
  // 5. 缺少学期参数
  // ──────────────────────────────────────────────
  it('缺少 semester 参数应返回错误', async () => {
    const req = mockReq({ course_id: 3 }); // 无 semester
    const res = mockRes();
    const next = vi.fn();

    await resetAutoAssignments(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '缺少学期参数',
      })
    );
    expect(mockPrisma.teaching_assignments.deleteMany).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // 6. 数据库异常
  // ──────────────────────────────────────────────
  it('数据库异常应传递给 next', async () => {
    mockPrisma.teaching_assignments.deleteMany.mockRejectedValue(new Error('数据库连接失败'));

    const req = mockReq({ course_id: 3, semester: '2025-2026-2' });
    const res = mockRes();
    const next = vi.fn();

    await resetAutoAssignments(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toBe('数据库连接失败');
  });

  // ──────────────────────────────────────────────
  // 7. 不影响手动安排（仅删除 is_auto=true）
  // ──────────────────────────────────────────────
  it('重置时 where 条件必须包含 is_auto:true，不影响手动安排', async () => {
    mockPrisma.teaching_assignments.deleteMany.mockResolvedValue({ count: 2 });

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    const next = vi.fn();

    await resetAutoAssignments(req, res, next);

    const deleteCall = mockPrisma.teaching_assignments.deleteMany.mock.calls[0][0];
    expect(deleteCall.where.is_auto).toBe(true);
  });
});

// ════════════════════════════════════════════════
// getStatistics — 合班去重回归
// ════════════════════════════════════════════════
describe('getStatistics', () => {
  const teacher = {
    id: 1,
    name: '王五',
    personnel_type: 'full_time',
    affiliated_college: { id: 1, name: '教育学院' },
    courses: [{ course: { id: 10, name: '数学' } }],
    scheduling_colleges: [{ college: { id: 1, name: '教育学院' } }],
    scheduling_levels: [],
  };

  // 合班 A+B（combination_id=99，同课程同教师）+ 独立班 C
  const rawAssignments = [
    {
      teacher_id: 1,
      class_id: 1,
      course_id: 10,
      weekly_hours: 4,
      is_auto: false,
      class: {
        id: 1,
        name: 'A班',
        college_id: 1,
        training_level_id: 2,
        combination_id: 99,
        colleges: { id: 1, name: '教育学院' },
      },
      course: { id: 10, name: '数学' },
    },
    {
      teacher_id: 1,
      class_id: 2,
      course_id: 10,
      weekly_hours: 4,
      is_auto: false,
      class: {
        id: 2,
        name: 'B班',
        college_id: 1,
        training_level_id: 2,
        combination_id: 99,
        colleges: { id: 1, name: '教育学院' },
      },
      course: { id: 10, name: '数学' },
    },
    {
      teacher_id: 1,
      class_id: 3,
      course_id: 20,
      weekly_hours: 2,
      is_auto: false,
      class: {
        id: 3,
        name: 'C班',
        college_id: 1,
        training_level_id: 2,
        combination_id: null,
        colleges: { id: 1, name: '教育学院' },
      },
      course: { id: 20, name: '英语' },
    },
  ];

  beforeEach(() => {
    // 不调用 clearAllMocks，避免清掉模块级 mock 工厂；直接覆盖所需 mock
    mockPrisma.teaching_assignments.findMany.mockResolvedValue(rawAssignments);
    mockPrisma.teachers.findMany.mockResolvedValue([teacher]);
    mockPrisma.training_levels.findMany.mockResolvedValue([]);
    mockPrisma.plan_courses.findMany.mockResolvedValue([]);
    mockPrisma.textbooks.findMany.mockResolvedValue([]);
    parseSemester.mockReturnValue({
      startYear: 2025,
      endYear: 2026,
      semesterIndex: 2,
      raw: '2025-2026-2',
    });
  });

  it('合班教学应去重：总周课时与班级数不虚高', async () => {
    const req = mockReq({}, { query: { semester: '2025-2026-2' } });
    const res = mockRes();
    await getStatistics(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    // 合班(A+B)合并为 1 个逻辑教学班 4 课时 + 独立班(C)2 课时 = 6，而非 10
    expect(data.teachers).toHaveLength(1);
    expect(data.teachers[0].totalWeeklyHours).toBe(6);
    // 班级数：合班=1 个逻辑班 + 独立班=1 = 2，而非 3
    expect(data.teachers[0].totalClassCount).toBe(2);
    expect(data.summary.totalWeeklyHours).toBe(6);
    expect(data.summary.totalClasses).toBe(2);
  });

  it('合班单元在课程明细中标记 isCombined=true 并合并班级名', async () => {
    const req = mockReq({}, { query: { semester: '2025-2026-2' } });
    const res = mockRes();
    await getStatistics(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    const math = data.teachers[0].details.find((d) => d.course.id === 10);
    expect(math.classes).toHaveLength(1);
    expect(math.classes[0].isCombined).toBe(true);
    expect(math.classes[0].className).toBe('A班、B班');
    expect(math.weeklyHours).toBe(4);
  });

  it('无学期参数 → 返回错误', async () => {
    const req = mockReq({}, { query: {} });
    const res = mockRes();
    await getStatistics(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '请选择学期' })
    );
  });
});

// ──────────────────────────────────────────────
// 合班联动 / 级联（P0：合班成员班教师一致）
// ──────────────────────────────────────────────
const { getClassesWithCourse } = await import('../../services/teaching-arrange.service.js');

describe('assignTeacher — 合班联动', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb) => cb(mockPrisma));
  });

  it('班级属合班时，应将同一教师同步到所有开设该课程的合班伙伴', async () => {
    const req = mockReq({
      class_id: 10,
      course_id: 3,
      semester: '2025-2026-2',
      teacher_id: 5,
      weekly_hours: 4,
    });
    const res = mockRes();

    mockPrisma.classes.findFirst.mockResolvedValue({ id: 10, combination_id: 99 });
    getClassesWithCourse.mockResolvedValue([{ classId: 10 }, { classId: 20 }]);
    mockPrisma.classes.findMany.mockResolvedValue([{ id: 20 }]); // 伙伴班
    mockPrisma.teachers.findUnique.mockResolvedValue(ACTIVE_TEACHER);
    mockPrisma.teacher_courses.findUnique.mockResolvedValue({});
    mockPrisma.teaching_assignments.upsert.mockResolvedValue(UPSERTED_ASSIGNMENT);
    mockPrisma.teaching_assignments.groupBy.mockResolvedValue([]);

    await assignTeacher(req, res, vi.fn());

    // 主班级 + 1 个合班伙伴，各 upsert 一次
    expect(mockPrisma.teaching_assignments.upsert).toHaveBeenCalledTimes(2);
    const calls = mockPrisma.teaching_assignments.upsert.mock.calls;
    // 两次调用的 teacher_id 必须相同（合班一致性）
    expect(calls[0][0].create.teacher_id).toBe(5);
    expect(calls[1][0].create.teacher_id).toBe(5);
    // 伙伴班的 class_id 应为 20
    expect(calls[1][0].create.class_id).toBe(20);
  });

  it('班级无合班时，仅 upsert 主班级一次', async () => {
    const req = mockReq({
      class_id: 10,
      course_id: 3,
      semester: '2025-2026-2',
      teacher_id: 5,
      weekly_hours: 4,
    });
    const res = mockRes();

    mockPrisma.classes.findFirst.mockResolvedValue({ id: 10, combination_id: null });
    mockPrisma.teachers.findUnique.mockResolvedValue(ACTIVE_TEACHER);
    mockPrisma.teacher_courses.findUnique.mockResolvedValue({});
    mockPrisma.teaching_assignments.upsert.mockResolvedValue(UPSERTED_ASSIGNMENT);
    mockPrisma.teaching_assignments.groupBy.mockResolvedValue([]);

    await assignTeacher(req, res, vi.fn());

    expect(mockPrisma.teaching_assignments.upsert).toHaveBeenCalledTimes(1);
    expect(getClassesWithCourse).not.toHaveBeenCalled();
  });
});

describe('deleteAssignment — 合班级联', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb) => cb(mockPrisma));
  });

  it('合班成员班的安排被删除时，应级联删除所有成员班同课程的安排', async () => {
    const req = { params: { id: '1' } };
    const res = mockRes();
    const next = vi.fn();

    mockPrisma.teaching_assignments.findUnique.mockResolvedValue({
      id: 1,
      course_id: 3,
      semester: '2025-2026-2',
      is_auto: false,
      teacher: { name: '张老师' },
      class: { name: '2024级学前1班', combination_id: 99 },
    });
    mockPrisma.teaching_assignments.delete.mockResolvedValue({});
    mockPrisma.classes.findMany.mockResolvedValue([{ id: 10 }, { id: 20 }]);
    mockPrisma.teaching_assignments.deleteMany.mockResolvedValue({ count: 2 });

    await deleteAssignment(req, res, next);

    expect(mockPrisma.teaching_assignments.delete).toHaveBeenCalledTimes(1);
    expect(mockPrisma.teaching_assignments.deleteMany).toHaveBeenCalledTimes(1);
    const dmCall = mockPrisma.teaching_assignments.deleteMany.mock.calls[0][0];
    expect(dmCall).toMatchObject({
      where: {
        course_id: 3,
        semester: '2025-2026-2',
        class_id: { in: [10, 20] },
        id: { not: 1 },
      },
    });
  });

  it('非合班班级的安排被删除时，不应级联', async () => {
    const req = { params: { id: '1' } };
    const res = mockRes();
    const next = vi.fn();

    mockPrisma.teaching_assignments.findUnique.mockResolvedValue({
      id: 1,
      course_id: 3,
      semester: '2025-2026-2',
      is_auto: false,
      teacher: { name: '张老师' },
      class: { name: '2024级学前1班', combination_id: null },
    });
    mockPrisma.teaching_assignments.delete.mockResolvedValue({});

    await deleteAssignment(req, res, next);

    expect(mockPrisma.teaching_assignments.delete).toHaveBeenCalledTimes(1);
    expect(mockPrisma.teaching_assignments.deleteMany).not.toHaveBeenCalled();
  });
});
