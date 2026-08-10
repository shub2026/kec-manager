/**
 * teaching-arrange.controller.js — getCourseOverview 单元测试
 *
 * 重点覆盖：
 * 1. 缺 semester → 400 错误
 * 2. 多课程聚合：assignedCount/lockedCount/teacherCount 去重、课时与剩余课时计算
 * 3. 无任何安排的课程 → 计数全 0 不报错
 * 4. DB 异常 → next(error)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  courses: {
    findMany: vi.fn(),
  },
  teaching_assignments: {
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

vi.mock('../../constants/index.js', () => ({
  DEFAULT_HOUR_SETTINGS: { full_time: { min: 4, max: 20 } },
  HOUR_SETTINGS_PREFIX: 'hour_settings',
  TEXTBOOK_COHESION: {},
}));

const mockGetClassesWithCourse = vi.fn();
vi.mock('../../services/teaching-arrange.service.js', () => ({
  getClassesWithCourse: (...args) => mockGetClassesWithCourse(...args),
  getTeachersForCourse: vi.fn(),
  autoArrange: vi.fn(),
  batchAutoArrange: vi.fn(),
  parseSemester: vi.fn(),
  validateHourSettings: vi.fn(),
}));

vi.mock('../../services/plan.service.js', () => ({
  findBestMatchPlan: vi.fn(),
}));

vi.mock('../../services/semester.service.js', () => ({
  calcClassSemester: vi.fn(),
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { getCourseOverview } = await import('../teaching-arrange.controller.js');

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

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('getCourseOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('缺 semester → 返回 400 错误', async () => {
    const req = mockReq({});
    const res = mockRes();
    await getCourseOverview(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '请选择学期' })
    );
    expect(mockPrisma.courses.findMany).not.toHaveBeenCalled();
  });

  it('多课程聚合：计数/教师去重/锁定/课时与剩余课时计算正确', async () => {
    mockPrisma.courses.findMany.mockResolvedValue([
      { id: 1, name: '语文', type: 'public' },
      { id: 2, name: '数学', type: 'professional' },
    ]);
    // 课程1：3 条安排，2 名教师（10 重复），1 条锁定，课时 4+4+6=14
    // 课程2：1 条安排，课时 2
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([
      { course_id: 1, class_id: 101, teacher_id: 10, weekly_hours: 4, is_locked: false },
      { course_id: 1, class_id: 102, teacher_id: 10, weekly_hours: 4, is_locked: true },
      { course_id: 1, class_id: 103, teacher_id: 11, weekly_hours: 6, is_locked: false },
      { course_id: 2, class_id: 201, teacher_id: 20, weekly_hours: 2, is_locked: false },
    ]);
    mockGetClassesWithCourse.mockImplementation((courseId) =>
      Promise.resolve(
        courseId === 1
          ? [
              { classId: 101, weeklyHours: 4 },
              { classId: 102, weeklyHours: 4 },
              { classId: 103, weeklyHours: 6 },
            ]
          : [{ classId: 201, weeklyHours: 2 }]
      )
    );

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getCourseOverview(req, res, vi.fn());

    expect(mockPrisma.teaching_assignments.findMany).toHaveBeenCalledWith({
      where: { semester: '2025-2026-2' },
      select: expect.any(Object),
    });
    expect(mockGetClassesWithCourse).toHaveBeenCalledTimes(2);

    const data = res.json.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({
      courseId: 1,
      courseName: '语文',
      courseType: 'public',
      teacherCount: 2,
      totalClasses: 3,
      assignedCount: 3,
      lockedCount: 1,
      totalCourseHours: 14,
      assignedHours: 14,
      remainingHours: 0,
    });
    expect(data[1]).toEqual({
      courseId: 2,
      courseName: '数学',
      courseType: 'professional',
      teacherCount: 1,
      totalClasses: 1,
      assignedCount: 1,
      lockedCount: 0,
      totalCourseHours: 2,
      assignedHours: 2,
      remainingHours: 0,
    });
  });

  it('无任何安排的课程 → 计数全 0，剩余课时等于总课时', async () => {
    mockPrisma.courses.findMany.mockResolvedValue([{ id: 3, name: '英语', type: 'elective' }]);
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([]);
    mockGetClassesWithCourse.mockResolvedValue([
      { classId: 301, weeklyHours: 3 },
      { classId: 302, weeklyHours: 3 },
    ]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getCourseOverview(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data[0]).toEqual({
      courseId: 3,
      courseName: '英语',
      courseType: 'elective',
      teacherCount: 0,
      totalClasses: 2,
      assignedCount: 0,
      lockedCount: 0,
      totalCourseHours: 6,
      assignedHours: 0,
      remainingHours: 6,
    });
  });

  it('快照课时过期（安排行课时 > 当前方案）→ 以当前方案为准，剩余课时不为负', async () => {
    mockPrisma.courses.findMany.mockResolvedValue([{ id: 4, name: '体育', type: 'public' }]);
    // 安排行快照 weekly_hours=8，但当前方案周课时已调整为 2
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([
      { course_id: 4, class_id: 401, teacher_id: 40, weekly_hours: 8, is_locked: false },
    ]);
    mockGetClassesWithCourse.mockResolvedValue([{ classId: 401, weeklyHours: 2 }]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getCourseOverview(req, res, vi.fn());

    const item = res.json.mock.calls[0][0].data[0];
    expect(item.assignedHours).toBe(2);
    expect(item.remainingHours).toBe(0);
  });

  it('孤儿安排（班级已不在应排列表）→ 不计入聚合', async () => {
    mockPrisma.courses.findMany.mockResolvedValue([{ id: 5, name: '化学', type: 'public' }]);
    // class 502 的安排为离校/方案调整后的遗留记录，应被忽略
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([
      { course_id: 5, class_id: 501, teacher_id: 50, weekly_hours: 4, is_locked: false },
      { course_id: 5, class_id: 502, teacher_id: 51, weekly_hours: 4, is_locked: false },
    ]);
    mockGetClassesWithCourse.mockResolvedValue([{ classId: 501, weeklyHours: 4 }]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getCourseOverview(req, res, vi.fn());

    expect(res.json.mock.calls[0][0].data[0]).toEqual({
      courseId: 5,
      courseName: '化学',
      courseType: 'public',
      teacherCount: 1,
      totalClasses: 1,
      assignedCount: 1,
      lockedCount: 0,
      totalCourseHours: 4,
      assignedHours: 4,
      remainingHours: 0,
    });
  });

  it('DB 异常 → next 收到错误', async () => {
    const dbError = new Error('db down');
    mockPrisma.courses.findMany.mockRejectedValue(dbError);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    const next = vi.fn();
    await getCourseOverview(req, res, next);

    expect(next).toHaveBeenCalledWith(dbError);
  });
});
