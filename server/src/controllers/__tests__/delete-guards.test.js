/**
 * delete-guards 单元测试
 *
 * 覆盖 5 个控制器的删除守卫逻辑：
 * - deleteCollege: 班级 + 排课偏好 + 培养方案 + 教师所属
 * - deleteCourse: 培养方案 + 排课记录 + 教师关联
 * - deleteMajor: 班级 + 培养方案
 * - deleteTrainingLevel: 班级 + 排课偏好 + 培养方案
 * - deleteTeacher: 教学安排
 *
 * 每个控制器均验证：
 * - 无引用 → 删除成功
 * - 有引用 → 阻止删除并返回具体错误消息
 * - 不存在（P2025）→ 404
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  colleges: {
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
  courses: {
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
  majors: {
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
  training_levels: {
    delete: vi.fn(),
  },
  teachers: {
    findUnique: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  classes: {
    count: vi.fn(),
  },
  teacher_scheduling_colleges: {
    count: vi.fn(),
  },
  training_plans: {
    count: vi.fn(),
  },
  teacher_training_levels: {
    count: vi.fn(),
  },
  plan_courses: {
    count: vi.fn(),
  },
  teaching_assignments: {
    count: vi.fn(),
  },
  teacher_courses: {
    count: vi.fn(),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖
// ──────────────────────────────────────────────
vi.mock('../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../utils/sort.js', () => ({
  autoFixSortOrder: vi.fn().mockResolvedValue(false),
  invalidateSortOrderCache: vi.fn(),
  getNextSortOrder: vi.fn().mockResolvedValue(1),
  buildUpdateData: vi.fn((data, fields) => {
    const out = {};
    for (const f of fields) if (data[f] !== undefined) out[f] = data[f];
    return out;
  }),
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  default: { error: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { deleteCollege } = await import('../college.controller.js');
const { deleteCourse } = await import('../course.controller.js');
const { deleteMajor } = await import('../major.controller.js');
const { deleteTrainingLevel } = await import('../trainingLevel.controller.js');
const { deleteTeacher } = await import('../teacher.controller.js');
const { createAuditLog } = await import('../../services/audit.service.js');
const { invalidateSortOrderCache } = await import('../../utils/sort.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(params = {}) {
  return { params, user: { id: 1 }, ip: '127.0.0.1' };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

// ════════════════════════════════════════════════
// deleteCollege
// ════════════════════════════════════════════════
describe('deleteCollege', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认所有 count 为 0（无引用）
    mockPrisma.classes.count.mockResolvedValue(0);
    mockPrisma.teacher_scheduling_colleges.count.mockResolvedValue(0);
    mockPrisma.training_plans.count.mockResolvedValue(0);
    mockPrisma.teachers.count.mockResolvedValue(0);
    mockPrisma.colleges.findUnique.mockResolvedValue({ id: 1, name: '计算机学院' });
    mockPrisma.colleges.delete.mockResolvedValue({});
  });

  it('无引用 → 删除成功', async () => {
    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteCollege(req, res, vi.fn());

    expect(mockPrisma.colleges.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '删除成功' })
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', module: 'college', result: 'success' })
    );
    expect(invalidateSortOrderCache).toHaveBeenCalledWith('colleges');
  });

  it('存在班级 → 阻止删除', async () => {
    mockPrisma.classes.count.mockResolvedValue(3);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteCollege(req, res, vi.fn());

    expect(mockPrisma.colleges.delete).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '该学院下存在班级，无法删除',
      })
    );
  });

  it('存在排课偏好 → 阻止删除并列出引用', async () => {
    mockPrisma.teacher_scheduling_colleges.count.mockResolvedValue(2);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteCollege(req, res, vi.fn());

    expect(mockPrisma.colleges.delete).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('2位教师排课偏好'),
      })
    );
  });

  it('存在培养方案 → 阻止删除并列出引用', async () => {
    mockPrisma.training_plans.count.mockResolvedValue(5);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteCollege(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('5个培养方案'),
      })
    );
  });

  it('存在教师所属 → 阻止删除并列出引用', async () => {
    mockPrisma.teachers.count.mockResolvedValue(10);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteCollege(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('10位教师所属'),
      })
    );
  });

  it('多个引用同时存在 → 错误消息列出全部引用', async () => {
    mockPrisma.teacher_scheduling_colleges.count.mockResolvedValue(2);
    mockPrisma.training_plans.count.mockResolvedValue(3);
    mockPrisma.teachers.count.mockResolvedValue(5);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteCollege(req, res, vi.fn());

    const message = res.json.mock.calls[0][0].message;
    expect(message).toContain('2位教师排课偏好');
    expect(message).toContain('3个培养方案');
    expect(message).toContain('5位教师所属');
  });

  it('删除不存在学院（P2025） → 404', async () => {
    mockPrisma.colleges.delete.mockRejectedValue({ code: 'P2025' });

    const req = mockReq({ id: '999' });
    const res = mockRes();
    await deleteCollege(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '学院不存在' })
    );
  });
});

// ════════════════════════════════════════════════
// deleteCourse
// ════════════════════════════════════════════════
describe('deleteCourse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.plan_courses.count.mockResolvedValue(0);
    mockPrisma.teaching_assignments.count.mockResolvedValue(0);
    mockPrisma.teacher_courses.count.mockResolvedValue(0);
    mockPrisma.courses.findUnique.mockResolvedValue({ id: 1, name: '高等数学' });
    mockPrisma.courses.delete.mockResolvedValue({});
  });

  it('无引用 → 删除成功', async () => {
    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteCourse(req, res, vi.fn());

    expect(mockPrisma.courses.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '删除成功' })
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', module: 'course', result: 'success' })
    );
    expect(invalidateSortOrderCache).toHaveBeenCalledWith('courses');
  });

  it('被培养方案使用 → 阻止删除', async () => {
    mockPrisma.plan_courses.count.mockResolvedValue(2);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteCourse(req, res, vi.fn());

    expect(mockPrisma.courses.delete).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '该课程已被培养方案使用，无法删除',
      })
    );
  });

  it('有排课记录 → 阻止删除', async () => {
    mockPrisma.teaching_assignments.count.mockResolvedValue(3);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteCourse(req, res, vi.fn());

    expect(mockPrisma.courses.delete).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '该课程已有排课记录，请先删除排课后再删除课程',
      })
    );
  });

  it('已关联教师 → 阻止删除', async () => {
    mockPrisma.teacher_courses.count.mockResolvedValue(4);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteCourse(req, res, vi.fn());

    expect(mockPrisma.courses.delete).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '该课程已关联教师，请先解除教师关联后再删除课程',
      })
    );
  });

  it('删除不存在课程（P2025） → 404', async () => {
    mockPrisma.courses.delete.mockRejectedValue({ code: 'P2025' });

    const req = mockReq({ id: '999' });
    const res = mockRes();
    await deleteCourse(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '课程不存在' })
    );
  });
});

// ════════════════════════════════════════════════
// deleteMajor
// ════════════════════════════════════════════════
describe('deleteMajor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.classes.count.mockResolvedValue(0);
    mockPrisma.training_plans.count.mockResolvedValue(0);
    mockPrisma.majors.findUnique.mockResolvedValue({ id: 1, name: '软件工程' });
    mockPrisma.majors.delete.mockResolvedValue({});
  });

  it('无引用 → 删除成功', async () => {
    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteMajor(req, res, vi.fn());

    expect(mockPrisma.majors.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '删除成功' })
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', module: 'major', result: 'success' })
    );
    expect(invalidateSortOrderCache).toHaveBeenCalledWith('majors');
  });

  it('存在班级 → 阻止删除', async () => {
    mockPrisma.classes.count.mockResolvedValue(5);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteMajor(req, res, vi.fn());

    expect(mockPrisma.majors.delete).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '该专业下存在班级，无法删除',
      })
    );
  });

  it('被培养方案引用 → 阻止删除并含方案数量', async () => {
    mockPrisma.training_plans.count.mockResolvedValue(3);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteMajor(req, res, vi.fn());

    expect(mockPrisma.majors.delete).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('3个培养方案'),
      })
    );
  });

  it('删除不存在专业（P2025） → 404', async () => {
    mockPrisma.majors.delete.mockRejectedValue({ code: 'P2025' });

    const req = mockReq({ id: '999' });
    const res = mockRes();
    await deleteMajor(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '专业不存在' })
    );
  });
});

// ════════════════════════════════════════════════
// deleteTrainingLevel
// ════════════════════════════════════════════════
describe('deleteTrainingLevel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.classes.count.mockResolvedValue(0);
    mockPrisma.teacher_training_levels.count.mockResolvedValue(0);
    mockPrisma.training_plans.count.mockResolvedValue(0);
    mockPrisma.training_levels.delete.mockResolvedValue({});
  });

  it('无引用 → 删除成功', async () => {
    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteTrainingLevel(req, res, vi.fn());

    expect(mockPrisma.training_levels.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '删除成功' })
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', module: 'training_level', result: 'success' })
    );
    expect(invalidateSortOrderCache).toHaveBeenCalledWith('training_levels');
  });

  it('存在班级 → 阻止删除', async () => {
    mockPrisma.classes.count.mockResolvedValue(2);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteTrainingLevel(req, res, vi.fn());

    expect(mockPrisma.training_levels.delete).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '该层次下存在班级，无法删除',
      })
    );
  });

  it('存在排课偏好 → 阻止删除并列出引用', async () => {
    mockPrisma.teacher_training_levels.count.mockResolvedValue(4);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteTrainingLevel(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('4位教师排课偏好'),
      })
    );
  });

  it('存在培养方案 → 阻止删除并列出引用', async () => {
    mockPrisma.training_plans.count.mockResolvedValue(2);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteTrainingLevel(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('2个培养方案'),
      })
    );
  });

  it('多个引用同时存在 → 错误消息列出全部', async () => {
    mockPrisma.teacher_training_levels.count.mockResolvedValue(3);
    mockPrisma.training_plans.count.mockResolvedValue(7);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteTrainingLevel(req, res, vi.fn());

    const message = res.json.mock.calls[0][0].message;
    expect(message).toContain('3位教师排课偏好');
    expect(message).toContain('7个培养方案');
  });

  it('删除不存在层次（P2025） → 404', async () => {
    mockPrisma.training_levels.delete.mockRejectedValue({ code: 'P2025' });

    const req = mockReq({ id: '999' });
    const res = mockRes();
    await deleteTrainingLevel(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '层次不存在' })
    );
  });
});

// ════════════════════════════════════════════════
// deleteTeacher
// ════════════════════════════════════════════════
describe('deleteTeacher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teaching_assignments.count.mockResolvedValue(0);
    mockPrisma.teachers.findUnique.mockResolvedValue({ id: 1, name: '张三' });
    mockPrisma.teachers.delete.mockResolvedValue({});
  });

  it('无教学安排 → 删除成功', async () => {
    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteTeacher(req, res, vi.fn());

    expect(mockPrisma.teachers.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '删除成功' })
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', module: 'teacher', result: 'success' })
    );
    expect(invalidateSortOrderCache).toHaveBeenCalledWith('teachers');
  });

  it('存在教学安排 → 阻止删除', async () => {
    mockPrisma.teaching_assignments.count.mockResolvedValue(5);

    const req = mockReq({ id: '1' });
    const res = mockRes();
    await deleteTeacher(req, res, vi.fn());

    expect(mockPrisma.teachers.delete).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '该教师存在教学安排，无法删除',
      })
    );
  });

  it('删除不存在教师（P2025） → 404', async () => {
    mockPrisma.teachers.delete.mockRejectedValue({ code: 'P2025' });

    const req = mockReq({ id: '999' });
    const res = mockRes();
    await deleteTeacher(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '教师不存在' })
    );
  });
});
