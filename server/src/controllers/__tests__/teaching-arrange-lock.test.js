/**
 * teaching-arrange.controller.js — toggleLock / batchLock 单元测试
 *
 * 覆盖场景：
 * 1. toggleLock: 成功锁定单条安排
 * 2. toggleLock: 成功解锁单条安排
 * 3. toggleLock: 合班联动锁定
 * 4. toggleLock: 安排不存在 → 404
 * 5. toggleLock: locked 参数非布尔值 → 错误
 * 6. batchLock: 按科目批量锁定
 * 7. batchLock: 按科目批量解锁
 * 8. batchLock: 全学期批量锁定
 * 9. batchLock: 缺少学期参数 → 错误
 * 10. batchLock: locked 参数非布尔值 → 错误
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  $transaction: vi.fn(async (cb) => cb(mockPrisma)),
  classes: {
    findMany: vi.fn(),
  },
  teaching_assignments: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
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
// 导入被测模块
// ──────────────────────────────────────────────
const { toggleLock, batchLock } = await import('../teaching-arrange.controller.js');
const { createAuditLog } = await import('../../services/audit.service.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(body = {}, overrides = {}) {
  return { body, params: overrides.params || {}, user: { id: 1 }, ip: '127.0.0.1', ...overrides };
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
const BASE_ASSIGNMENT = {
  id: 100,
  teacher_id: 5,
  class_id: 10,
  course_id: 3,
  semester: '2025-2026-2',
  is_auto: true,
  is_locked: false,
  teacher: { name: '张老师' },
  class: { name: '2024级学前1班', combination_id: null },
  course: { name: '高等数学' },
};

// ════════════════════════════════════════════════
// toggleLock 测试
// ════════════════════════════════════════════════
describe('toggleLock — 锁定/解锁单条教学安排', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teaching_assignments.findUnique.mockResolvedValue({ ...BASE_ASSIGNMENT });
    mockPrisma.teaching_assignments.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.classes.findMany.mockResolvedValue([]);
  });

  it('成功锁定一条未锁定的自动安排', async () => {
    const req = mockReq({ locked: true }, { params: { id: '100' } });
    const res = mockRes();
    const next = vi.fn();

    await toggleLock(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [100] } },
      data: { is_locked: true },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: '锁定成功',
        data: expect.objectContaining({ locked: true, affectedCount: 1 }),
      })
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        module: 'teachingArrange',
        details: expect.objectContaining({ id: 100, locked: true }),
        result: 'success',
        message: expect.stringContaining('锁定'),
      })
    );
  });

  it('成功解锁一条已锁定的安排', async () => {
    mockPrisma.teaching_assignments.findUnique.mockResolvedValue({
      ...BASE_ASSIGNMENT,
      is_locked: true,
    });

    const req = mockReq({ locked: false }, { params: { id: '100' } });
    const res = mockRes();
    const next = vi.fn();

    await toggleLock(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [100] } },
      data: { is_locked: false },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: '解锁成功',
        data: expect.objectContaining({ locked: false }),
      })
    );
  });

  it('合班安排锁定时应同步所有合班成员', async () => {
    mockPrisma.teaching_assignments.findUnique.mockResolvedValue({
      ...BASE_ASSIGNMENT,
      class: { name: 'A班', combination_id: 99 },
    });
    mockPrisma.classes.findMany.mockResolvedValue([{ id: 10 }, { id: 20 }, { id: 30 }]);
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([{ id: 101 }, { id: 102 }]);
    mockPrisma.teaching_assignments.updateMany.mockResolvedValue({ count: 3 });

    const req = mockReq({ locked: true }, { params: { id: '100' } });
    const res = mockRes();
    const next = vi.fn();

    await toggleLock(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // 应查询合班成员
    expect(mockPrisma.classes.findMany).toHaveBeenCalledWith({
      where: { combination_id: 99 },
      select: { id: true },
    });
    // 应查询伙伴班的安排
    expect(mockPrisma.teaching_assignments.findMany).toHaveBeenCalled();
    // updateMany 应包含主安排 + 伙伴安排
    const updateCall = mockPrisma.teaching_assignments.updateMany.mock.calls[0][0];
    expect(updateCall.where.id.in).toContain(100); // 主安排
    expect(updateCall.data.is_locked).toBe(true);
    // 审计日志应记录合班数量
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('含合班'),
      })
    );
  });

  it('安排不存在 → 404', async () => {
    mockPrisma.teaching_assignments.findUnique.mockResolvedValue(null);

    const req = mockReq({ locked: true }, { params: { id: '999' } });
    const res = mockRes();
    const next = vi.fn();

    await toggleLock(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '安排记录不存在',
      })
    );
    expect(mockPrisma.teaching_assignments.updateMany).not.toHaveBeenCalled();
  });

  it('locked 参数非布尔值 → 返回错误', async () => {
    const req = mockReq({ locked: 'yes' }, { params: { id: '100' } });
    const res = mockRes();
    const next = vi.fn();

    await toggleLock(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'locked 参数必须是布尔值',
      })
    );
    expect(mockPrisma.teaching_assignments.updateMany).not.toHaveBeenCalled();
  });

  it('数据库异常应传递给 next', async () => {
    mockPrisma.teaching_assignments.updateMany.mockRejectedValue(new Error('DB error'));

    const req = mockReq({ locked: true }, { params: { id: '100' } });
    const res = mockRes();
    const next = vi.fn();

    await toggleLock(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ════════════════════════════════════════════════
// batchLock 测试
// ════════════════════════════════════════════════
describe('batchLock — 批量锁定/解锁', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teaching_assignments.updateMany.mockResolvedValue({ count: 5 });
  });

  it('按科目批量锁定应传 course_id 到 WHERE', async () => {
    const req = mockReq({
      semester: '2025-2026-2',
      course_id: 3,
      locked: true,
    });
    const res = mockRes();
    const next = vi.fn();

    await batchLock(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenCalledWith({
      where: { semester: '2025-2026-2', is_auto: true, course_id: 3 },
      data: { is_locked: true },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: expect.stringContaining('已锁定5条'),
      })
    );
  });

  it('按科目批量解锁', async () => {
    mockPrisma.teaching_assignments.updateMany.mockResolvedValue({ count: 3 });

    const req = mockReq({
      semester: '2025-2026-2',
      course_id: 3,
      locked: false,
    });
    const res = mockRes();
    const next = vi.fn();

    await batchLock(req, res, next);

    expect(mockPrisma.teaching_assignments.updateMany).toHaveBeenCalledWith({
      where: { semester: '2025-2026-2', is_auto: true, course_id: 3 },
      data: { is_locked: false },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: expect.stringContaining('已解锁3条'),
      })
    );
  });

  it('不传 course_id 应锁定整个学期', async () => {
    mockPrisma.teaching_assignments.updateMany.mockResolvedValue({ count: 42 });

    const req = mockReq({
      semester: '2025-2026-2',
      locked: true,
    });
    const res = mockRes();
    const next = vi.fn();

    await batchLock(req, res, next);

    const updateCall = mockPrisma.teaching_assignments.updateMany.mock.calls[0][0];
    // WHERE 不应包含 course_id
    expect(updateCall.where).not.toHaveProperty('course_id');
    expect(updateCall.where).toEqual({ semester: '2025-2026-2', is_auto: true });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ updatedCount: 42 }),
      })
    );
    // 审计日志应记录"全部课程"
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('全部课程'),
      })
    );
  });

  it('缺少 semester → 返回错误', async () => {
    const req = mockReq({ locked: true });
    const res = mockRes();
    const next = vi.fn();

    await batchLock(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: '缺少学期参数',
      })
    );
    expect(mockPrisma.teaching_assignments.updateMany).not.toHaveBeenCalled();
  });

  it('locked 参数非布尔值 → 返回错误', async () => {
    const req = mockReq({ semester: '2025-2026-2', locked: 1 });
    const res = mockRes();
    const next = vi.fn();

    await batchLock(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'locked 参数必须是布尔值',
      })
    );
  });

  it('数据库异常应传递给 next', async () => {
    mockPrisma.teaching_assignments.updateMany.mockRejectedValue(new Error('DB error'));

    const req = mockReq({ semester: '2025-2026-2', locked: true });
    const res = mockRes();
    const next = vi.fn();

    await batchLock(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
