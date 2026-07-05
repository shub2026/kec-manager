/**
 * getDashboardStats 单元测试
 *
 * 覆盖场景：
 * - 正确聚合统计数据
 * - 在职教师过滤 (teacher.status = 'active')
 * - 排除 0 课时排课 (weekly_hours > 0)
 * - totalWeeklyHours 四舍五入
 * - 无学期参数 → 返回错误
 * - 在读班级和学生数计算
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  majors: { count: vi.fn() },
  training_plans: { count: vi.fn() },
  textbooks: { count: vi.fn() },
  classes: { findMany: vi.fn() },
  teaching_assignments: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
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

vi.mock('../../services/semester.service.js', () => ({
  getSemesterInfoFromRequest: vi.fn(),
  calcClassSemester: vi.fn(),
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
const { getDashboardStats } = await import('../dashboard.controller.js');
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

// ════════════════════════════════════════════════
// getDashboardStats
// ════════════════════════════════════════════════
describe('getDashboardStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 默认 semesterInfo
    getSemesterInfoFromRequest.mockResolvedValue({
      startYear: 2025,
      endYear: 2026,
      semesterIndex: 2,
      raw: '2025-2026-2',
    });

    // 默认 activeFilter
    getActiveClassFilter.mockResolvedValue({ enrollment_year: { gte: 2023 } });

    // 默认 prisma 返回
    mockPrisma.majors.count.mockResolvedValue(10);
    mockPrisma.training_plans.count.mockResolvedValue(25);
    mockPrisma.textbooks.count.mockResolvedValue(50);
    mockPrisma.classes.findMany.mockResolvedValue([
      { student_count: 40 },
      { student_count: 35 },
      { student_count: 45 },
    ]);
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([
      { course_id: 1 },
      { course_id: 2 },
      { course_id: 3 },
    ]);
    mockPrisma.teaching_assignments.groupBy.mockResolvedValue([
      { teacher_id: 1, _sum: { weekly_hours: 12 } },
      { teacher_id: 2, _sum: { weekly_hours: 8 } },
    ]);
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
          courses: 3,
          classes: 3,
          textbooks: 50,
          plans: 25,
          totalStudents: 120,
          teachingTeachers: 2,
          totalWeeklyHours: 20,
        }),
      })
    );
  });

  it('在读学生数为各班级 student_count 之和', async () => {
    mockPrisma.classes.findMany.mockResolvedValue([
      { student_count: 30 },
      { student_count: 0 },
      { student_count: 50 },
    ]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.totalStudents).toBe(80);
  });

  it('student_count 为 null 时按 0 计算', async () => {
    mockPrisma.classes.findMany.mockResolvedValue([
      { student_count: null },
      { student_count: 25 },
    ]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.totalStudents).toBe(25);
  });

  it('active teacher 过滤 → 查询条件含 teacher.status=active', async () => {
    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    // 验证 teaching_assignments.findMany（课程统计）的 where 条件
    const courseCallArgs = mockPrisma.teaching_assignments.findMany.mock.calls[0][0];
    expect(courseCallArgs.where).toEqual(
      expect.objectContaining({
        semester: '2025-2026-2',
        weekly_hours: { gt: 0 },
        teacher: { status: 'active' },
      })
    );

    // 验证 teaching_assignments.groupBy（教师统计）的 where 条件
    const teacherCallArgs = mockPrisma.teaching_assignments.groupBy.mock.calls[0][0];
    expect(teacherCallArgs.where).toEqual(
      expect.objectContaining({
        semester: '2025-2026-2',
        weekly_hours: { gt: 0 },
        teacher: { status: 'active' },
      })
    );
  });

  it('排除 0 课时排课 → weekly_hours > 0', async () => {
    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const courseCallArgs = mockPrisma.teaching_assignments.findMany.mock.calls[0][0];
    expect(courseCallArgs.where.weekly_hours).toEqual({ gt: 0 });

    const teacherCallArgs = mockPrisma.teaching_assignments.groupBy.mock.calls[0][0];
    expect(teacherCallArgs.where.weekly_hours).toEqual({ gt: 0 });
  });

  it('totalWeeklyHours 四舍五入到一位小数', async () => {
    mockPrisma.teaching_assignments.groupBy.mockResolvedValue([
      { teacher_id: 1, _sum: { weekly_hours: 7.33 } },
      { teacher_id: 2, _sum: { weekly_hours: 5.44 } },
    ]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    // 7.33 + 5.44 = 12.77, Math.round(12.77 * 10) / 10 = 12.8 (nearest)
    expect(data.totalWeeklyHours).toBe(12.8);
  });

  it('无排课时 totalWeeklyHours 为 0', async () => {
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([]);
    mockPrisma.teaching_assignments.groupBy.mockResolvedValue([]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.courses).toBe(0);
    expect(data.teachingTeachers).toBe(0);
    expect(data.totalWeeklyHours).toBe(0);
  });

  it('无在读班级时 classes 和 totalStudents 为 0', async () => {
    mockPrisma.classes.findMany.mockResolvedValue([]);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.classes).toBe(0);
    expect(data.totalStudents).toBe(0);
  });

  it('教材统计仅计算活跃教材 (is_active: true)', async () => {
    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getDashboardStats(req, res, vi.fn());

    expect(mockPrisma.textbooks.count).toHaveBeenCalledWith({
      where: { is_active: true },
    });
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
