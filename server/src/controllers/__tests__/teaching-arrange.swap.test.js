/**
 * teaching-arrange.controller.js — swapTeacherAssignments 单元测试
 *
 * 覆盖场景：
 * 1. 正常互换（双向 updateMany 按记录 id，is_auto/is_inherent 归零）
 * 2. 锁定记录跳过并在结果中报告名单
 * 3. 单教材开关教师交换后将持 2 本教材 → 400 拦截
 * 4. 一方无安排时单向换入
 * 5. 教师不存在 / 未关联课程 → 错误
 * 6. 超课时软警告不阻塞
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  $transaction: vi.fn(async (cb) => cb(mockPrisma)),
  teachers: {
    findUnique: vi.fn(),
  },
  teacher_courses: {
    findUnique: vi.fn(),
  },
  teaching_assignments: {
    findMany: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  system_settings: {
    findUnique: vi.fn(),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
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

const { swapTeacherAssignments } = await import('../teaching-arrange.controller.js');
const { getClassesWithCourse } = await import('../../services/teaching-arrange.service.js');

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

const SEMESTER = '2026-2027-1';
const BODY = { course_id: 3, semester: SEMESTER, teacher_id_a: 5, teacher_id_b: 6 };

const TEACHER_A = { id: 5, name: '张老师', status: 'active', personnel_type: 'full_time' };
const TEACHER_B = { id: 6, name: '李老师', status: 'active', personnel_type: 'full_time' };

function makeAssignment(id, teacherId, classId, overrides = {}) {
  return {
    id,
    teacher_id: teacherId,
    class_id: classId,
    course_id: BODY.course_id,
    semester: SEMESTER,
    weekly_hours: 4,
    is_auto: true,
    is_locked: false,
    is_inherent: false,
    class: { id: classId, name: `班级${classId}` },
    ...overrides,
  };
}

/** 标准前置：两教师存在且均可教 */
function setupTeachers(a = TEACHER_A, b = TEACHER_B) {
  mockPrisma.teachers.findUnique.mockImplementation(({ where }) =>
    Promise.resolve(where.id === a.id ? a : where.id === b.id ? b : null)
  );
  mockPrisma.teacher_courses.findUnique.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (cb) => cb(mockPrisma));
  mockPrisma.teaching_assignments.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.system_settings.findUnique.mockResolvedValue(null);
});

describe('swapTeacherAssignments', () => {
  it('正常互换：按记录 id 双向 updateMany，is_auto/is_inherent 归零', async () => {
    setupTeachers();
    mockPrisma.teaching_assignments.findMany
      .mockResolvedValueOnce([
        makeAssignment(11, 5, 101),
        makeAssignment(12, 5, 102),
        makeAssignment(21, 6, 201),
        makeAssignment(22, 6, 202),
        makeAssignment(23, 6, 203),
      ])
      .mockResolvedValue([]) // 工作量查询（默认不超限）
      .mockResolvedValue([]);

    const res = mockRes();
    await swapTeacherAssignments(mockReq(BODY), res, vi.fn());

    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: [11, 12] } },
      data: { teacher_id: 6, is_auto: false, is_inherent: false },
    });
    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: [21, 22, 23] } },
      data: { teacher_id: 5, is_auto: false, is_inherent: false },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ swappedCountA: 2, swappedCountB: 3, skippedLocked: [] }),
      })
    );
  });

  it('锁定记录跳过并在结果中报告名单', async () => {
    setupTeachers();
    mockPrisma.teaching_assignments.findMany
      .mockResolvedValueOnce([
        makeAssignment(11, 5, 101),
        makeAssignment(12, 5, 102, { is_locked: true }),
        makeAssignment(21, 6, 201),
      ])
      .mockResolvedValue([])
      .mockResolvedValue([]);

    const res = mockRes();
    await swapTeacherAssignments(mockReq(BODY), res, vi.fn());

    // 锁定记录 12 不参与交换
    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: [11] } },
      data: { teacher_id: 6, is_auto: false, is_inherent: false },
    });
    const data = res.json.mock.calls[0][0].data;
    expect(data.swappedCountA).toBe(1);
    expect(data.skippedLocked).toEqual([{ classId: 102, className: '班级102' }]);
  });

  it('单教材开关：交换后锁定保留 + 换入将持 2 本教材 → 400 拦截', async () => {
    setupTeachers({ ...TEACHER_A, single_textbook_only: true }, TEACHER_B);
    mockPrisma.teaching_assignments.findMany.mockResolvedValueOnce([
      makeAssignment(11, 5, 101, { is_locked: true }), // 锁定保留，教材5
      makeAssignment(12, 5, 102), // 换出
      makeAssignment(21, 6, 201), // 换入，教材6
    ]);
    getClassesWithCourse.mockResolvedValue([
      { classId: 101, textbooks: [{ id: 5, title: '教材五' }] },
      { classId: 102, textbooks: [{ id: 5, title: '教材五' }] },
      { classId: 201, textbooks: [{ id: 6, title: '教材六' }] },
    ]);

    const res = mockRes();
    await swapTeacherAssignments(mockReq(BODY), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringContaining('只带一本教材') })
    );
    expect(mockPrisma.teaching_assignments.updateMany).not.toHaveBeenCalled();
  });

  it('一方无安排时单向换入', async () => {
    setupTeachers();
    mockPrisma.teaching_assignments.findMany
      .mockResolvedValueOnce([makeAssignment(21, 6, 201), makeAssignment(22, 6, 202)])
      .mockResolvedValue([])
      .mockResolvedValue([]);

    const res = mockRes();
    await swapTeacherAssignments(mockReq(BODY), res, vi.fn());

    // idsA 为空 → 只执行 B→A 一条 updateMany
    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [21, 22] } },
      data: { teacher_id: 5, is_auto: false, is_inherent: false },
    });
    const data = res.json.mock.calls[0][0].data;
    expect(data.swappedCountA).toBe(0);
    expect(data.swappedCountB).toBe(2);
  });

  it('教师不存在 → 404；未关联课程 → 400', async () => {
    // 教师不存在
    mockPrisma.teachers.findUnique.mockResolvedValue(null);
    const res404 = mockRes();
    await swapTeacherAssignments(mockReq(BODY), res404, vi.fn());
    expect(res404.status).toHaveBeenCalledWith(404);

    // 未关联课程
    setupTeachers();
    mockPrisma.teacher_courses.findUnique
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(null);
    const res400 = mockRes();
    await swapTeacherAssignments(mockReq(BODY), res400, vi.fn());
    expect(res400.status).toHaveBeenCalledWith(400);
    expect(res400.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('未关联此课程') })
    );
  });

  it('超课时软警告不阻塞交换', async () => {
    setupTeachers({ ...TEACHER_A, personnel_type: 'full_time' }, TEACHER_B);
    mockPrisma.teaching_assignments.findMany
      .mockResolvedValueOnce([makeAssignment(11, 5, 101), makeAssignment(21, 6, 201)])
      // 工作量查询：张老师 20h > 标准 16h；李老师 8h 正常
      .mockResolvedValueOnce([
        {
          teacher_id: 5,
          course_id: 3,
          weekly_hours: 20,
          class_id: 101,
          class: { combination_id: null },
        },
      ])
      .mockResolvedValueOnce([
        {
          teacher_id: 6,
          course_id: 3,
          weekly_hours: 8,
          class_id: 201,
          class: { combination_id: null },
        },
      ]);

    const res = mockRes();
    await swapTeacherAssignments(mockReq(BODY), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const data = res.json.mock.calls[0][0].data;
    expect(data.warnings).toHaveLength(1);
    expect(data.warnings[0]).toContain('张老师');
    expect(data.swappedCountA).toBe(1);
  });
});
