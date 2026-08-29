/**
 * teaching-arrange.controller.js — swapSelectiveClasses 单元测试
 *
 * 覆盖场景：
 * 1. 正常按名单互换（仅选中的记录互换，未选中记录不动）
 * 2. 锁定记录跳过并在结果中报告
 * 3. 合班成员班选中时整组联动换出
 * 4. 合班组内含锁定成员时整组跳过
 * 5. 所选班级不属于对应教师 → 400
 * 6. 双方名单均为空 → 400
 * 7. 单教材开关：交换后将持多本教材 → 400 拦截
 * 8. 所选班级全部锁定 → 400
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

const { swapSelectiveClasses } = await import('../teaching-arrange.controller.js');
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
const BASE_BODY = {
  course_id: 3,
  semester: SEMESTER,
  teacher_id_a: 5,
  teacher_id_b: 6,
};

const TEACHER_A = { id: 5, name: '张老师', status: 'active', personnel_type: 'full_time' };
const TEACHER_B = { id: 6, name: '李老师', status: 'active', personnel_type: 'full_time' };

function makeAssignment(id, teacherId, classId, overrides = {}) {
  return {
    id,
    teacher_id: teacherId,
    class_id: classId,
    course_id: BASE_BODY.course_id,
    semester: SEMESTER,
    weekly_hours: 4,
    is_auto: true,
    is_locked: false,
    is_inherent: false,
    class: { id: classId, name: `班级${classId}`, combination_id: null },
    ...overrides,
  };
}

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

describe('swapSelectiveClasses', () => {
  it('正常按名单互换：仅选中记录互换，未选中记录不动', async () => {
    setupTeachers();
    mockPrisma.teaching_assignments.findMany
      .mockResolvedValueOnce([
        makeAssignment(11, 5, 101),
        makeAssignment(12, 5, 102),
        makeAssignment(21, 6, 201),
        makeAssignment(22, 6, 202),
      ])
      .mockResolvedValue([])
      .mockResolvedValue([]);

    const res = mockRes();
    await swapSelectiveClasses(
      mockReq({ ...BASE_BODY, class_ids_a: [101], class_ids_b: [201] }),
      res,
      vi.fn()
    );

    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: [11] } },
      data: { teacher_id: 6, is_auto: false, is_inherent: false },
    });
    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: [21] } },
      data: { teacher_id: 5, is_auto: false, is_inherent: false },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ swappedCountA: 1, swappedCountB: 1, skippedLocked: [] }),
      })
    );
  });

  it('锁定记录跳过并报告，未锁定记录照常互换', async () => {
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
    await swapSelectiveClasses(
      mockReq({ ...BASE_BODY, class_ids_a: [101, 102], class_ids_b: [201] }),
      res,
      vi.fn()
    );

    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: [11] } },
      data: { teacher_id: 6, is_auto: false, is_inherent: false },
    });
    const data = res.json.mock.calls[0][0].data;
    expect(data.swappedCountA).toBe(1);
    expect(data.skippedLocked).toEqual([{ classId: 102, className: '班级102' }]);
  });

  it('合班成员班选中时整组联动换出', async () => {
    setupTeachers();
    const combCls = (id, combId) => ({ id, name: `班级${id}`, combination_id: combId });
    mockPrisma.teaching_assignments.findMany
      .mockResolvedValueOnce([
        makeAssignment(11, 5, 101, { class: combCls(101, 9) }),
        makeAssignment(12, 5, 102, { class: combCls(102, 9) }),
        makeAssignment(21, 6, 201),
      ])
      .mockResolvedValue([])
      .mockResolvedValue([]);

    const res = mockRes();
    // 只勾选成员班 101，整组（101+102）都应换出
    await swapSelectiveClasses(
      mockReq({ ...BASE_BODY, class_ids_a: [101], class_ids_b: [201] }),
      res,
      vi.fn()
    );

    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: [11, 12] } },
      data: { teacher_id: 6, is_auto: false, is_inherent: false },
    });
    const data = res.json.mock.calls[0][0].data;
    expect(data.swappedCountA).toBe(2);
  });

  it('合班组内含锁定成员时整组跳过', async () => {
    setupTeachers();
    const combCls = (id, combId) => ({ id, name: `班级${id}`, combination_id: combId });
    mockPrisma.teaching_assignments.findMany
      .mockResolvedValueOnce([
        makeAssignment(11, 5, 101, { class: combCls(101, 9) }),
        makeAssignment(12, 5, 102, { class: combCls(102, 9), is_locked: true }),
        makeAssignment(21, 6, 201),
      ])
      .mockResolvedValue([])
      .mockResolvedValue([]);

    const res = mockRes();
    await swapSelectiveClasses(
      mockReq({ ...BASE_BODY, class_ids_a: [101], class_ids_b: [201] }),
      res,
      vi.fn()
    );

    // A 侧整组跳过，仅执行 B→A 一条
    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [21] } },
      data: { teacher_id: 5, is_auto: false, is_inherent: false },
    });
    const data = res.json.mock.calls[0][0].data;
    expect(data.swappedCountA).toBe(0);
    expect(data.skippedLocked).toEqual([
      { classId: 101, className: '班级101' },
      { classId: 102, className: '班级102' },
    ]);
  });

  it('所选班级不属于对应教师 → 400', async () => {
    setupTeachers();
    mockPrisma.teaching_assignments.findMany.mockResolvedValueOnce([
      makeAssignment(11, 5, 101),
      makeAssignment(21, 6, 201),
    ]);

    const res = mockRes();
    await swapSelectiveClasses(
      mockReq({ ...BASE_BODY, class_ids_a: [999], class_ids_b: [] }),
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('未安排给张老师'),
      })
    );
    expect(mockPrisma.teaching_assignments.updateMany).not.toHaveBeenCalled();
  });

  it('双方名单均为空 → 400', async () => {
    const res = mockRes();
    await swapSelectiveClasses(
      mockReq({ ...BASE_BODY, class_ids_a: [], class_ids_b: [] }),
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('至少选择一个') })
    );
    expect(mockPrisma.teachers.findUnique).not.toHaveBeenCalled();
  });

  it('单教材开关：交换后保留班与换入班教材不同 → 400 拦截', async () => {
    setupTeachers({ ...TEACHER_A, single_textbook_only: true }, TEACHER_B);
    mockPrisma.teaching_assignments.findMany.mockResolvedValueOnce([
      makeAssignment(11, 5, 101), // 保留，教材5
      makeAssignment(12, 5, 102), // 选中换出，教材5
      makeAssignment(21, 6, 201), // 选中换入，教材6
    ]);
    getClassesWithCourse.mockResolvedValue([
      { classId: 101, textbooks: [{ id: 5, title: '教材五' }] },
      { classId: 102, textbooks: [{ id: 5, title: '教材五' }] },
      { classId: 201, textbooks: [{ id: 6, title: '教材六' }] },
    ]);

    const res = mockRes();
    await swapSelectiveClasses(
      mockReq({ ...BASE_BODY, class_ids_a: [102], class_ids_b: [201] }),
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringContaining('只带一本教材') })
    );
    expect(mockPrisma.teaching_assignments.updateMany).not.toHaveBeenCalled();
  });

  it('所选班级全部锁定 → 400', async () => {
    setupTeachers();
    mockPrisma.teaching_assignments.findMany.mockResolvedValueOnce([
      makeAssignment(12, 5, 102, { is_locked: true }),
      makeAssignment(21, 6, 201),
    ]);

    const res = mockRes();
    await swapSelectiveClasses(
      mockReq({ ...BASE_BODY, class_ids_a: [102], class_ids_b: [] }),
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('均已锁定') })
    );
    expect(mockPrisma.teaching_assignments.updateMany).not.toHaveBeenCalled();
  });
});
