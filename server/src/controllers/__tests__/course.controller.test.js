/**
 * course.controller.js 单元测试
 *
 * 覆盖（deleteCourse 的守卫分支已由 delete-guards.test.js 覆盖）：
 * - listCourses：类型过滤、排序自愈调用、_count 格式化、异常透传
 * - createCourse：默认值（type=public、排序自增）、显式排序、重名校验、P2002、失败审计
 * - updateCourse：改名查重、无 name 跳过查重、P2025/P2002、失败审计
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  courses: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
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

vi.mock('../../utils/sort.js', () => ({
  autoFixSortOrder: vi.fn().mockResolvedValue(false),
  invalidateSortOrderCache: vi.fn(),
  getNextSortOrder: vi.fn().mockResolvedValue(7),
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
const { listCourses, createCourse, updateCourse } = await import('../course.controller.js');
const { createAuditLog } = await import('../../services/audit.service.js');
const { autoFixSortOrder, getNextSortOrder, invalidateSortOrderCache } = await import(
  '../../utils/sort.js'
);

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(extra = {}) {
  return { body: {}, params: {}, query: {}, user: { id: 1 }, ip: '127.0.0.1', ...extra };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

function prismaError(code) {
  const e = new Error(`prisma ${code}`);
  e.code = code;
  return e;
}

// ════════════════════════════════════════════════
// listCourses
// ════════════════════════════════════════════════
describe('listCourses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无类型过滤时 where 为空并触发排序自愈', async () => {
    mockPrisma.courses.findMany.mockResolvedValue([]);
    const res = mockRes();
    await listCourses(mockReq(), res, vi.fn());

    expect(autoFixSortOrder).toHaveBeenCalledWith('courses', {});
    expect(mockPrisma.courses.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, orderBy: { sort_order: 'asc' } })
    );
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it('type 过滤透传到查询与排序自愈', async () => {
    mockPrisma.courses.findMany.mockResolvedValue([]);
    await listCourses(mockReq({ query: { type: 'public' } }), mockRes(), vi.fn());

    expect(autoFixSortOrder).toHaveBeenCalledWith('courses', { type: 'public' });
    expect(mockPrisma.courses.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: 'public' } })
    );
  });

  it('_count 映射为计数字段，缺失时兜底 0', async () => {
    mockPrisma.courses.findMany.mockResolvedValue([
      {
        id: 1,
        name: '语文',
        _count: { plan_courses: 2, teaching_assignments: 3, teacher_courses: 4 },
      },
      { id: 2, name: '数学' },
    ]);
    const res = mockRes();
    await listCourses(mockReq(), res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({ planCount: 2, assignmentCount: 3, teacherCourseCount: 4 });
    expect(data[1]).toMatchObject({ planCount: 0, assignmentCount: 0, teacherCourseCount: 0 });
  });

  it('查询异常透传给 next', async () => {
    const err = new Error('db down');
    mockPrisma.courses.findMany.mockRejectedValue(err);
    const next = vi.fn();
    await listCourses(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ════════════════════════════════════════════════
// createCourse
// ════════════════════════════════════════════════
describe('createCourse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.courses.findFirst.mockResolvedValue(null);
    getNextSortOrder.mockResolvedValue(7);
  });

  it('创建成功：默认 type=public、排序取自自增、写审计并失效缓存', async () => {
    mockPrisma.courses.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 10, ...data })
    );
    const res = mockRes();
    await createCourse(mockReq({ body: { name: '物理' } }), res, vi.fn());

    expect(mockPrisma.courses.create).toHaveBeenCalledWith({
      data: {
        name: '物理',
        code: undefined,
        type: 'public',
        description: undefined,
        sort_order: 7,
      },
    });
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', module: 'course', result: 'success' })
    );
    expect(invalidateSortOrderCache).toHaveBeenCalledWith('courses');
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, message: '创建成功' });
  });

  it('显式 sort_order 优先于自增值', async () => {
    mockPrisma.courses.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 10, ...data })
    );
    await createCourse(mockReq({ body: { name: '物理', sort_order: 3 } }), mockRes(), vi.fn());
    expect(mockPrisma.courses.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sort_order: 3 }) })
    );
  });

  it('缺少名称直接失败，不触达数据库', async () => {
    const res = mockRes();
    await createCourse(mockReq({ body: {} }), res, vi.fn());
    expect(mockPrisma.courses.findFirst).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: '课程名称不能为空',
    });
  });

  it('查重命中返回 409', async () => {
    mockPrisma.courses.findFirst.mockResolvedValue({ id: 1, name: '物理' });
    const res = mockRes();
    await createCourse(mockReq({ body: { name: '物理' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toBe('该课程名称已存在');
    expect(mockPrisma.courses.create).not.toHaveBeenCalled();
  });

  it('数据库唯一冲突（P2002）返回 409 并记录失败审计', async () => {
    mockPrisma.courses.create.mockRejectedValue(prismaError('P2002'));
    const res = mockRes();
    await createCourse(mockReq({ body: { name: '物理' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', result: 'failed' })
    );
  });

  it('其他异常透传 next 并记录失败审计', async () => {
    const err = new Error('boom');
    mockPrisma.courses.create.mockRejectedValue(err);
    const next = vi.fn();
    await createCourse(mockReq({ body: { name: '物理' } }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(err);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', result: 'failed' })
    );
  });
});

// ════════════════════════════════════════════════
// updateCourse
// ════════════════════════════════════════════════
describe('updateCourse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.courses.findFirst.mockResolvedValue(null);
  });

  it('更新成功返回课程并写审计', async () => {
    mockPrisma.courses.update.mockResolvedValue({ id: 1, name: '物理（改名）' });
    const res = mockRes();
    await updateCourse(
      mockReq({ params: { id: '1' }, body: { name: '物理（改名）' } }),
      res,
      vi.fn()
    );

    expect(mockPrisma.courses.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { name: '物理（改名）' },
    });
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', result: 'success' })
    );
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, message: '更新成功' });
  });

  it('改名命中其他课程返回 409 且不执行更新', async () => {
    mockPrisma.courses.findFirst.mockResolvedValue({ id: 2, name: '化学' });
    const res = mockRes();
    await updateCourse(mockReq({ params: { id: '1' }, body: { name: '化学' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockPrisma.courses.update).not.toHaveBeenCalled();
  });

  it('未传 name 时跳过查重直接更新', async () => {
    mockPrisma.courses.update.mockResolvedValue({ id: 1, name: '物理', code: 'PHY' });
    await updateCourse(mockReq({ params: { id: '1' }, body: { code: 'PHY' } }), mockRes(), vi.fn());
    expect(mockPrisma.courses.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.courses.update).toHaveBeenCalled();
  });

  it('记录不存在（P2025）返回 404 并记录失败审计', async () => {
    mockPrisma.courses.update.mockRejectedValue(prismaError('P2025'));
    const res = mockRes();
    await updateCourse(mockReq({ params: { id: '99' }, body: { code: 'X' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toBe('课程不存在');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', result: 'failed' })
    );
  });

  it('唯一冲突（P2002）返回 409', async () => {
    mockPrisma.courses.update.mockRejectedValue(prismaError('P2002'));
    const res = mockRes();
    await updateCourse(mockReq({ params: { id: '1' }, body: { code: 'X' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('其他异常透传 next', async () => {
    const err = new Error('boom');
    mockPrisma.courses.update.mockRejectedValue(err);
    const next = vi.fn();
    await updateCourse(mockReq({ params: { id: '1' }, body: { code: 'X' } }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
