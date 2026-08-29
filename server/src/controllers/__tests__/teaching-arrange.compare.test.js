/**
 * teaching-arrange.controller.js — compareTeacherAssignments 单元测试
 *
 * 覆盖场景：
 * 1. 正常对比：双方逐班清单 + 合班标记/组号 + 课时汇总（合班去重）
 * 2. 缺参 → 400
 * 3. 教师不存在 → 404；未关联课程 → 400；两教师相同 → 400
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  teachers: {
    findUnique: vi.fn(),
  },
  teacher_courses: {
    findUnique: vi.fn(),
  },
  teaching_assignments: {
    findMany: vi.fn(),
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

vi.mock('../../services/class-combination.service.js', () => ({
  buildCombinationMemberMap: vi.fn(),
  buildCombinationNoMap: vi.fn(),
  formatPartnerNames: vi.fn(),
}));

const { compareTeacherAssignments } = await import('../teaching-arrange.controller.js');
const { getClassesWithCourse } = await import('../../services/teaching-arrange.service.js');
const {
  buildCombinationMemberMap,
  buildCombinationNoMap,
  formatPartnerNames,
} = await import('../../services/class-combination.service.js');

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

const SEMESTER = '2026-2027-1';
const QUERY = {
  course_id: '3',
  semester: SEMESTER,
  teacher_id_a: '5',
  teacher_id_b: '6',
};

const TEACHER_A = { id: 5, name: '张老师', status: 'active' };
const TEACHER_B = { id: 6, name: '李老师', status: 'active' };

function makeAssignment(id, teacherId, classId, hours, overrides = {}) {
  return {
    id,
    teacher_id: teacherId,
    class_id: classId,
    course_id: 3,
    semester: SEMESTER,
    weekly_hours: hours,
    is_locked: false,
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
  getClassesWithCourse.mockResolvedValue([]);
  buildCombinationMemberMap.mockResolvedValue(new Map());
  buildCombinationNoMap.mockResolvedValue(new Map());
  formatPartnerNames.mockReturnValue('');
});

describe('compareTeacherAssignments', () => {
  it('正常对比：逐班清单、合班标记/组号、锁定标记、课时合班去重', async () => {
    setupTeachers();
    const combCls = (id, combId) => ({ id, name: `班级${id}`, combination_id: combId });
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([
      // 张老师：合班9两成员（各4h，课时只计1次）+ 1个锁定班（2h）
      makeAssignment(11, 5, 101, 4, { class: combCls(101, 9) }),
      makeAssignment(12, 5, 102, 4, { class: combCls(102, 9) }),
      makeAssignment(13, 5, 103, 2, { is_locked: true }),
      // 李老师：1个普通班（4h）
      makeAssignment(21, 6, 201, 4),
    ]);
    getClassesWithCourse.mockResolvedValue([
      {
        classId: 101,
        collegeName: '信息学院',
        majorName: '软件',
        grade: 2,
        textbooks: [{ id: 5, title: '教材五' }],
      },
      { classId: 102, collegeName: '信息学院', majorName: '软件', grade: 2, textbooks: [] },
      { classId: 103, collegeName: '基础部', majorName: null, grade: 1, textbooks: [] },
      { classId: 201, collegeName: '机电学院', majorName: '机械', grade: 3, textbooks: [] },
    ]);
    buildCombinationMemberMap.mockResolvedValue(
      new Map([[9, [{ id: 101, name: '班级101' }, { id: 102, name: '班级102' }]]])
    );
    buildCombinationNoMap.mockResolvedValue(new Map([[9, 1]]));
    formatPartnerNames.mockImplementation((partners) => partners.map((p) => p.name).join('、'));

    const res = mockRes();
    await compareTeacherAssignments(mockReq(QUERY), res, vi.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    const { teacherA, teacherB } = payload.data;

    // 张老师：3 班（含合班2行），课时 = 合班单元4 + 锁定班2 = 6（合班不重复计数）
    expect(teacherA.name).toBe('张老师');
    expect(teacherA.classCount).toBe(3);
    expect(teacherA.totalHours).toBe(6);
    expect(teacherA.lockedCount).toBe(1);

    const c101 = teacherA.classes.find((c) => c.classId === 101);
    expect(c101.isCombined).toBe(true);
    expect(c101.combinationNo).toBe(1);
    expect(c101.partnerClassNames).toBe('班级102');
    expect(c101.collegeName).toBe('信息学院');
    expect(c101.textbookTitles).toEqual(['教材五']);

    const c103 = teacherA.classes.find((c) => c.classId === 103);
    expect(c103.isLocked).toBe(true);
    expect(c103.isCombined).toBe(false);

    // 李老师：1 班 / 4 课时
    expect(teacherB.classCount).toBe(1);
    expect(teacherB.totalHours).toBe(4);
    expect(teacherB.classes[0].className).toBe('班级201');
  });

  it('缺少参数 → 400', async () => {
    const res = mockRes();
    await compareTeacherAssignments(mockReq({ semester: SEMESTER }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('请选择课程') })
    );
  });

  it('两位教师相同 → 400', async () => {
    const res = mockRes();
    await compareTeacherAssignments(
      mockReq({ ...QUERY, teacher_id_b: '5' }),
      res,
      vi.fn()
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('不能相同') })
    );
  });

  it('教师不存在 → 404；未关联课程 → 400', async () => {
    mockPrisma.teachers.findUnique.mockResolvedValue(null);
    const res404 = mockRes();
    await compareTeacherAssignments(mockReq(QUERY), res404, vi.fn());
    expect(res404.status).toHaveBeenCalledWith(404);

    setupTeachers();
    mockPrisma.teacher_courses.findUnique
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(null);
    const res400 = mockRes();
    await compareTeacherAssignments(mockReq(QUERY), res400, vi.fn());
    expect(res400.status).toHaveBeenCalledWith(400);
    expect(res400.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('未关联此课程') })
    );
  });
});
