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
  classes: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  teachers: {
    findUnique: vi.fn(),
  },
  teacher_courses: {
    findUnique: vi.fn(),
  },
  teaching_assignments: {
    upsert: vi.fn(),
    groupBy: vi.fn(),
    deleteMany: vi.fn(),
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
const { assignTeacher, resetAutoAssignments } = await import('../teaching-arrange.controller.js');
const { createAuditLog } = await import('../../services/audit.service.js');
const { findBestMatchPlan } = await import('../../services/plan.service.js');
const { parseSemester } = await import('../../services/teaching-arrange.service.js');
const { calcClassSemester } = await import('../../services/semester.service.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(body = {}) {
  return { body, user: { id: 1 }, ip: '127.0.0.1' };
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
    // 模拟总课时超过 full_time 的 max (20)
    mockPrisma.teaching_assignments.groupBy.mockResolvedValue([
      { teacher_id: 5, _sum: { weekly_hours: 25 } },
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
