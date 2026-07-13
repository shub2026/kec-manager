/**
 * college.controller.js 单元测试
 *
 * 覆盖：listColleges, createCollege, updateCollege, deleteCollege, getCollegeLevelMapping
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  colleges: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  classes: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
  },
  teacher_scheduling_colleges: {
    count: vi.fn().mockResolvedValue(0),
  },
  training_plans: {
    count: vi.fn().mockResolvedValue(0),
  },
  teachers: {
    count: vi.fn().mockResolvedValue(0),
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

vi.mock('../../utils/sort.js', () => ({
  autoFixSortOrder: vi.fn().mockResolvedValue(false),
  invalidateSortOrderCache: vi.fn(),
  getNextSortOrder: vi.fn().mockResolvedValue(1),
  buildUpdateData: vi.fn((data, allowedFields) => {
    const updateData = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = field === 'sort_order' ? Number(data[field]) : data[field];
      }
    }
    return updateData;
  }),
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { listColleges, createCollege, updateCollege, deleteCollege, getCollegeLevelMapping } =
  await import('../college.controller.js');
const { createAuditLog } = await import('../../services/audit.service.js');
const { invalidateSortOrderCache } = await import('../../utils/sort.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(body = {}, params = {}) {
  return {
    params,
    body,
    user: { id: 1 },
    ip: '127.0.0.1',
  };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

// ════════════════════════════════════════════════
// listColleges
// ════════════════════════════════════════════════
describe('listColleges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应返回格式化后的学院列表，包含 classCount/planCount/schedulingCount/affiliatedCount', async () => {
    mockPrisma.colleges.findMany.mockResolvedValue([
      {
        id: 1,
        name: '教育学院',
        code: 'EDU',
        _count: {
          classes: 5,
          training_plans: 2,
          teacher_scheduling_colleges: 3,
          affiliated_teachers: 10,
        },
      },
    ]);

    const res = mockRes();
    await listColleges({}, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            name: '教育学院',
            classCount: 5,
            planCount: 2,
            schedulingCount: 3,
            affiliatedCount: 10,
          }),
        ]),
      })
    );
  });

  it('无学院时应返回空数组', async () => {
    mockPrisma.colleges.findMany.mockResolvedValue([]);

    const res = mockRes();
    await listColleges({}, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: [] }));
  });

  it('_count 缺失时 counts 应默认为 0', async () => {
    mockPrisma.colleges.findMany.mockResolvedValue([{ id: 1, name: '空学院', _count: {} }]);

    const res = mockRes();
    await listColleges({}, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data[0].classCount).toBe(0);
    expect(data[0].planCount).toBe(0);
  });

  it('数据库异常应通过 next(e) 传递', async () => {
    const error = new Error('DB error');
    mockPrisma.colleges.findMany.mockRejectedValue(error);

    const res = mockRes();
    const next = vi.fn();
    await listColleges({}, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ════════════════════════════════════════════════
// createCollege
// ════════════════════════════════════════════════
describe('createCollege', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.colleges.create.mockResolvedValue({ id: 1, name: '新学院', code: 'NEW' });
  });

  it('正常创建应返回 success 并调用审计日志', async () => {
    const req = mockReq({ name: '新学院', code: 'NEW' });
    const res = mockRes();
    const next = vi.fn();

    await createCollege(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.colleges.create).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '创建成功' })
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', module: 'college', result: 'success' })
    );
  });

  it('创建后应调用 invalidateSortOrderCache', async () => {
    const req = mockReq({ name: '新学院' });
    const res = mockRes();
    const next = vi.fn();

    await createCollege(req, res, next);

    expect(invalidateSortOrderCache).toHaveBeenCalledWith('colleges');
  });

  it('不传 name 应返回 fail', async () => {
    const req = mockReq({ code: 'NO_NAME' });
    const res = mockRes();
    const next = vi.fn();

    await createCollege(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '学院名称不能为空' })
    );
  });

  it('sort_order 传入时应使用传入值', async () => {
    const req = mockReq({ name: '排序学院', sort_order: 99 });
    const res = mockRes();
    const next = vi.fn();

    await createCollege(req, res, next);

    const createArg = mockPrisma.colleges.create.mock.calls[0][0];
    expect(createArg.data.sort_order).toBe(99);
  });

  it('sort_order 未传入时应使用 getNextSortOrder 返回值', async () => {
    const req = mockReq({ name: '自动排序学院' });
    const res = mockRes();
    const next = vi.fn();

    await createCollege(req, res, next);

    const createArg = mockPrisma.colleges.create.mock.calls[0][0];
    expect(createArg.data.sort_order).toBe(1); // mocked getNextSortOrder returns 1
  });

  it('P2002（名称重复）应返回 fail', async () => {
    const error = new Error('Unique constraint');
    error.code = 'P2002';
    mockPrisma.colleges.create.mockRejectedValue(error);

    const req = mockReq({ name: '重复学院' });
    const res = mockRes();
    const next = vi.fn();

    await createCollege(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '该学院名称已存在' })
    );
    // P2002 should not call next(e)
    expect(next).not.toHaveBeenCalled();
  });

  it('其他错误应通过 next(e) 传递', async () => {
    const error = new Error('Unexpected');
    mockPrisma.colleges.create.mockRejectedValue(error);

    const req = mockReq({ name: '异常学院' });
    const res = mockRes();
    const next = vi.fn();

    await createCollege(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ════════════════════════════════════════════════
// updateCollege
// ════════════════════════════════════════════════
describe('updateCollege', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.colleges.update.mockResolvedValue({ id: 1, name: '更新后' });
  });

  it('正常更新应返回 success', async () => {
    const req = mockReq({ name: '更新后' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateCollege(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '更新成功' })
    );
  });

  it('更新后应调用 invalidateSortOrderCache 和审计日志', async () => {
    const req = mockReq({ name: '更新后' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateCollege(req, res, next);

    expect(invalidateSortOrderCache).toHaveBeenCalledWith('colleges');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', module: 'college', result: 'success' })
    );
  });

  it('P2025（学院不存在）应返回 404 fail', async () => {
    const error = new Error('Not found');
    error.code = 'P2025';
    mockPrisma.colleges.update.mockRejectedValue(error);

    const req = mockReq({ name: '不存在' }, { id: '999' });
    const res = mockRes();
    const next = vi.fn();

    await updateCollege(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '学院不存在' })
    );
  });

  it('P2002（名称重复）应返回 fail', async () => {
    const error = new Error('Unique');
    error.code = 'P2002';
    mockPrisma.colleges.update.mockRejectedValue(error);

    const req = mockReq({ name: '重复' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateCollege(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '该学院名称已存在' })
    );
  });

  it('其他错误应通过 next(e) 传递', async () => {
    const error = new Error('Unexpected');
    mockPrisma.colleges.update.mockRejectedValue(error);

    const req = mockReq({ name: '异常' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateCollege(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// ════════════════════════════════════════════════
// deleteCollege
// ════════════════════════════════════════════════
describe('deleteCollege', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.classes.count.mockResolvedValue(0);
    mockPrisma.teacher_scheduling_colleges.count.mockResolvedValue(0);
    mockPrisma.training_plans.count.mockResolvedValue(0);
    mockPrisma.teachers.count.mockResolvedValue(0);
    mockPrisma.colleges.delete.mockResolvedValue({ id: 1, name: '已删学院' });
  });

  it('无关联时删除成功', async () => {
    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteCollege(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '删除成功' })
    );
    expect(invalidateSortOrderCache).toHaveBeenCalledWith('colleges');
  });

  it('存在班级时应阻止删除', async () => {
    mockPrisma.classes.count.mockResolvedValue(3);

    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteCollege(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('班级'),
      })
    );
  });

  it('存在排课偏好/培养方案/教师所属时应阻止删除', async () => {
    mockPrisma.teacher_scheduling_colleges.count.mockResolvedValue(2);
    mockPrisma.training_plans.count.mockResolvedValue(1);
    mockPrisma.teachers.count.mockResolvedValue(3);

    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteCollege(req, res, next);

    const msg = res.json.mock.calls[0][0].message;
    expect(msg).toContain('排课偏好');
    expect(msg).toContain('培养方案');
    expect(msg).toContain('教师所属');
  });

  it('P2025（学院不存在）应返回 404', async () => {
    const error = new Error('Not found');
    error.code = 'P2025';
    mockPrisma.colleges.delete.mockRejectedValue(error);

    const req = mockReq({}, { id: '999' });
    const res = mockRes();
    const next = vi.fn();

    await deleteCollege(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '学院不存在' })
    );
  });

  it('其他删除错误应通过 next(e) 传递', async () => {
    const error = new Error('Unexpected');
    mockPrisma.colleges.delete.mockRejectedValue(error);

    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteCollege(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('删除成功应记录审计日志', async () => {
    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteCollege(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        module: 'college',
        result: 'success',
      })
    );
  });
});

// ════════════════════════════════════════════════
// getCollegeLevelMapping
// ════════════════════════════════════════════════
describe('getCollegeLevelMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应返回 collegeToLevels 和 levelToColleges 映射', async () => {
    mockPrisma.classes.findMany.mockResolvedValue([
      { college_id: 1, training_level_id: 10 },
      { college_id: 1, training_level_id: 20 },
      { college_id: 2, training_level_id: 10 },
    ]);

    const res = mockRes();
    const next = vi.fn();

    await getCollegeLevelMapping({}, res, next);

    expect(next).not.toHaveBeenCalled();
    const data = res.json.mock.calls[0][0].data;
    expect(data.collegeToLevels['1']).toEqual(expect.arrayContaining([10, 20]));
    expect(data.collegeToLevels['2']).toEqual([10]);
    expect(data.levelToColleges['10']).toEqual(expect.arrayContaining([1, 2]));
    expect(data.levelToColleges['20']).toEqual([1]);
  });

  it('无数据时应返回空映射', async () => {
    mockPrisma.classes.findMany.mockResolvedValue([]);

    const res = mockRes();
    await getCollegeLevelMapping({}, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.collegeToLevels).toEqual({});
    expect(data.levelToColleges).toEqual({});
  });

  it('数据库异常应通过 next(e) 传递', async () => {
    const error = new Error('DB error');
    mockPrisma.classes.findMany.mockRejectedValue(error);

    const res = mockRes();
    const next = vi.fn();
    await getCollegeLevelMapping({}, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
