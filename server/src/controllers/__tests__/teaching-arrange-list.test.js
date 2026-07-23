/**
 * teaching-arrange.controller.js — getCourseClasses 单元测试
 *
 * 重点覆盖：
 * 1. 返回正确的 summary 计算（totalCourseHours, assignedHours, remainingHours）
 * 2. 已安排/未安排班级的计数
 * 3. 空班级列表 → 全部为 0
 * 4. 缺参数 → 返回错误
 * 5. assignment 信息正确映射
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
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
const { getCourseClasses } = await import('../teaching-arrange.controller.js');

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
describe('getCourseClasses — 课时汇总', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 场景 1: 有已安排和未安排班级 → 正确计算 summary ──
  it('有已安排和未安排班级 → summary 计算正确', async () => {
    const classes = [
      { classId: 1, className: '班级A', weeklyHours: 4 },
      { classId: 2, className: '班级B', weeklyHours: 6 },
      { classId: 3, className: '班级C', weeklyHours: 2 },
    ];
    mockGetClassesWithCourse.mockResolvedValue(classes);

    // Only classId=1 has an assignment
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([
      {
        class_id: 1,
        teacher_id: 10,
        is_auto: false,
        is_locked: false,
        teacher: { id: 10, name: '王老师', personnel_type: 'full_time' },
      },
    ]);

    const req = mockReq({ course_id: '1', semester: '2025-2026-2' });
    const res = mockRes();
    await getCourseClasses(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.classes).toHaveLength(3);

    // Class 1 has assignment, classes 2 and 3 don't
    expect(data.classes[0].assignment).not.toBeNull();
    expect(data.classes[0].assignment.teacherName).toBe('王老师');
    expect(data.classes[1].assignment).toBeNull();
    expect(data.classes[2].assignment).toBeNull();

    // Summary calculations
    expect(data.summary.totalClasses).toBe(3);
    expect(data.summary.assignedCount).toBe(1);
    expect(data.summary.unassignedCount).toBe(2);
    expect(data.summary.lockedCount).toBe(0);
    expect(data.summary.totalCourseHours).toBe(12); // 4+6+2
    expect(data.summary.assignedHours).toBe(4); // only class 1
    expect(data.summary.remainingHours).toBe(8); // 12-4
  });

  // ── 场景 2: 所有班级都已安排 ──
  it('所有班级都已安排 → remainingHours = 0', async () => {
    const classes = [
      { classId: 1, className: '班级A', weeklyHours: 4 },
      { classId: 2, className: '班级B', weeklyHours: 6 },
    ];
    mockGetClassesWithCourse.mockResolvedValue(classes);

    mockPrisma.teaching_assignments.findMany.mockResolvedValue([
      {
        class_id: 1,
        teacher_id: 10,
        is_auto: true,
        is_locked: false,
        teacher: { id: 10, name: '王老师', personnel_type: 'full_time' },
      },
      {
        class_id: 2,
        teacher_id: 11,
        is_auto: false,
        is_locked: false,
        teacher: { id: 11, name: '李老师', personnel_type: 'part_time' },
      },
    ]);

    const req = mockReq({ course_id: '1', semester: '2025-2026-2' });
    const res = mockRes();
    await getCourseClasses(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.summary.totalClasses).toBe(2);
    expect(data.summary.assignedCount).toBe(2);
    expect(data.summary.unassignedCount).toBe(0);
    expect(data.summary.totalCourseHours).toBe(10);
    expect(data.summary.assignedHours).toBe(10);
    expect(data.summary.remainingHours).toBe(0);
  });

  // ── 场景 3: 空班级列表 → summary 全为 0 ──
  it('空班级列表 → summary 全为 0', async () => {
    mockGetClassesWithCourse.mockResolvedValue([]);
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([]);

    const req = mockReq({ course_id: '1', semester: '2025-2026-2' });
    const res = mockRes();
    await getCourseClasses(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.classes).toHaveLength(0);
    expect(data.summary.totalClasses).toBe(0);
    expect(data.summary.assignedCount).toBe(0);
    expect(data.summary.unassignedCount).toBe(0);
    expect(data.summary.totalCourseHours).toBe(0);
    expect(data.summary.assignedHours).toBe(0);
    expect(data.summary.remainingHours).toBe(0);
  });

  // ── 场景 4: 缺 course_id → 返回错误 ──
  it('缺 course_id → 返回错误', async () => {
    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await getCourseClasses(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '请选择课程',
    });
  });

  // ── 场景 5: 缺 semester → 返回错误 ──
  it('缺 semester → 返回错误', async () => {
    const req = mockReq({ course_id: '1' });
    const res = mockRes();
    await getCourseClasses(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '请选择学期',
    });
  });

  // ── 场景 6: assignment 信息正确映射 ──
  it('assignment 信息包含 teacherId、teacherName、isAuto、isLocked 等字段', async () => {
    mockGetClassesWithCourse.mockResolvedValue([
      { classId: 1, className: '班级A', weeklyHours: 4 },
    ]);

    mockPrisma.teaching_assignments.findMany.mockResolvedValue([
      {
        id: 100,
        class_id: 1,
        teacher_id: 10,
        is_auto: true,
        is_locked: true,
        teacher: { id: 10, name: '赵老师', personnel_type: 'full_time' },
      },
    ]);

    const req = mockReq({ course_id: '1', semester: '2025-2026-2' });
    const res = mockRes();
    await getCourseClasses(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    const assignment = data.classes[0].assignment;
    expect(assignment.id).toBe(100);
    expect(assignment.teacherId).toBe(10);
    expect(assignment.teacherName).toBe('赵老师');
    expect(assignment.teacherPersonnelType).toBe('full_time');
    expect(assignment.isAuto).toBe(true);
    expect(assignment.isLocked).toBe(true);
  });

  // ── 场景 7: 锁定计数 lockedCount ──
  it('有锁定安排时 lockedCount 应正确计数', async () => {
    mockGetClassesWithCourse.mockResolvedValue([
      { classId: 1, className: '班级A', weeklyHours: 4 },
      { classId: 2, className: '班级B', weeklyHours: 6 },
      { classId: 3, className: '班级C', weeklyHours: 2 },
    ]);

    mockPrisma.teaching_assignments.findMany.mockResolvedValue([
      {
        class_id: 1,
        teacher_id: 10,
        is_auto: true,
        is_locked: true,
        teacher: { id: 10, name: '王老师', personnel_type: 'full_time' },
      },
      {
        class_id: 2,
        teacher_id: 11,
        is_auto: true,
        is_locked: false,
        teacher: { id: 11, name: '李老师', personnel_type: 'full_time' },
      },
      {
        class_id: 3,
        teacher_id: 12,
        is_auto: false,
        is_locked: false,
        teacher: { id: 12, name: '赵老师', personnel_type: 'full_time' },
      },
    ]);

    const req = mockReq({ course_id: '1', semester: '2025-2026-2' });
    const res = mockRes();
    await getCourseClasses(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.summary.assignedCount).toBe(3);
    expect(data.summary.lockedCount).toBe(1); // 仅班级A锁定
    expect(data.classes[0].assignment.isLocked).toBe(true);
    expect(data.classes[1].assignment.isLocked).toBe(false);
  });
});
