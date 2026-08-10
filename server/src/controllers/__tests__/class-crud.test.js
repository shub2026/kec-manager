/**
 * class.controller.js — createClass, deleteClass, updateClass (left_school cascade) 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockTx = {
  classes: {
    update: vi.fn(),
    delete: vi.fn(),
  },
  teaching_assignments: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
};

const mockPrisma = {
  classes: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn().mockResolvedValue(null),
    delete: vi.fn(),
  },
  teaching_assignments: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
  },
  $transaction: vi.fn(async (fn) => fn(mockTx)),
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖服务
// ──────────────────────────────────────────────
vi.mock('../../services/settings.service.js', () => ({
  getCurrentSemesterInfo: vi.fn(),
  getSemesterStartMonth: vi.fn().mockResolvedValue(8),
}));

vi.mock('../../services/class.service.js', () => ({
  getActiveClassFilter: vi.fn(),
  invalidateDurationCache: vi.fn(),
}));

vi.mock('../../services/class-filter.service.js', () => ({
  buildClassFilter: vi.fn(),
}));

vi.mock('../../services/plan.service.js', () => ({
  findBestMatchPlan: vi.fn(),
  isClassMatchPlan: vi.fn(),
}));

vi.mock('../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { createClass, deleteClass, updateClass } = await import('../class.controller.js');
const { getCurrentSemesterInfo } = await import('../../services/settings.service.js');
const { invalidateDurationCache } = await import('../../services/class.service.js');
const { createAuditLog } = await import('../../services/audit.service.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(body, params = {}) {
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

const SEMESTER_INFO = {
  startYear: 2025,
  endYear: 2026,
  semesterIndex: 2,
  raw: '2025-2026-2',
};

const CREATED_CLASS = {
  id: 10,
  name: '2024级学前1班',
  enrollment_year: 2024,
  duration_years: 3,
  major_id: 1,
  college_id: 1,
  training_level_id: 2,
  student_count: 40,
  custom_plan_id: null,
  is_left_school: false,
  status: 'active',
  majors: {},
  colleges: {},
  training_levels: {},
  training_plans: null,
};

const EXISTING_CLASS = {
  id: 1,
  name: '2024级学前1班',
  enrollment_year: 2024,
  duration_years: 3,
  major_id: 1,
  college_id: 1,
  training_level_id: 2,
  student_count: 40,
  custom_plan_id: null,
  combination_id: null,
  is_left_school: false,
  status: 'active',
};

const UPDATED_CLASS = {
  ...EXISTING_CLASS,
  majors: {},
  colleges: {},
  training_levels: {},
  training_plans: null,
};

// ════════════════════════════════════════════════
// createClass
// ════════════════════════════════════════════════
describe('createClass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSemesterInfo.mockResolvedValue(SEMESTER_INFO);
    mockPrisma.classes.create.mockResolvedValue({ ...CREATED_CLASS });
    mockPrisma.classes.findFirst.mockResolvedValue(null);
  });

  it('所有字段齐全时调用 prisma.classes.create 并传入正确数据', async () => {
    const req = mockReq({
      name: '2024级学前1班',
      enrollment_year: 2024,
      duration_years: 3,
      major_id: 1,
      college_id: 1,
      training_level_id: 2,
      student_count: 40,
      custom_plan_id: 5,
      is_left_school: false,
    });
    const res = mockRes();
    const next = vi.fn();

    await createClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.classes.create).toHaveBeenCalledOnce();
    const createArg = mockPrisma.classes.create.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      name: '2024级学前1班',
      enrollment_year: 2024,
      duration_years: 3,
      major_id: 1,
      college_id: 1,
      training_level_id: 2,
      student_count: 40,
      custom_plan_id: 5,
      is_left_school: false,
    });
  });

  it('is_left_school=true → status 强制为 left_school', async () => {
    const req = mockReq({
      name: '离校班',
      enrollment_year: 2024,
      duration_years: 3,
      training_level_id: 2,
      is_left_school: true,
    });
    const res = mockRes();
    const next = vi.fn();

    await createClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const createArg = mockPrisma.classes.create.mock.calls[0][0];
    expect(createArg.data.status).toBe('left_school');
    expect(createArg.data.is_left_school).toBe(true);
  });

  it('is_left_school=false → status 通过 calculateClassStatus 计算', async () => {
    const req = mockReq({
      name: '在校班',
      enrollment_year: 2024,
      duration_years: 3,
      training_level_id: 2,
      is_left_school: false,
    });
    const res = mockRes();
    const next = vi.fn();

    await createClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const createArg = mockPrisma.classes.create.mock.calls[0][0];
    // enrollment_year=2024, startYear=2025, grade=2025-2024+1=2, duration=3 → active
    expect(createArg.data.status).toBe('active');
  });

  it('custom_plan_id 传入时存为 Number', async () => {
    const req = mockReq({
      name: '测试班',
      enrollment_year: 2024,
      duration_years: 3,
      training_level_id: 2,
      custom_plan_id: '7',
    });
    const res = mockRes();
    const next = vi.fn();

    await createClass(req, res, next);

    const createArg = mockPrisma.classes.create.mock.calls[0][0];
    expect(createArg.data.custom_plan_id).toBe(7);
  });

  it('不传 custom_plan_id → 存为 null', async () => {
    const req = mockReq({
      name: '测试班',
      enrollment_year: 2024,
      duration_years: 3,
      training_level_id: 2,
    });
    const res = mockRes();
    const next = vi.fn();

    await createClass(req, res, next);

    const createArg = mockPrisma.classes.create.mock.calls[0][0];
    expect(createArg.data.custom_plan_id).toBeNull();
  });

  it('缺少必填字段 name → ValidationError', async () => {
    const req = mockReq({
      enrollment_year: 2024,
      duration_years: 3,
      training_level_id: 2,
    });
    const res = mockRes();
    const next = vi.fn();

    await createClass(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(422);
  });

  it('缺少必填字段 enrollment_year → ValidationError', async () => {
    const req = mockReq({
      name: '测试班',
      duration_years: 3,
      training_level_id: 2,
    });
    const res = mockRes();
    const next = vi.fn();

    await createClass(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });

  it('缺少 training_level_id → ValidationError', async () => {
    const req = mockReq({
      name: '测试班',
      enrollment_year: 2024,
      duration_years: 3,
    });
    const res = mockRes();
    const next = vi.fn();

    await createClass(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });

  it('创建成功后调用审计日志', async () => {
    const req = mockReq({
      name: '2024级学前1班',
      enrollment_year: 2024,
      duration_years: 3,
      training_level_id: 2,
    });
    const res = mockRes();
    const next = vi.fn();

    await createClass(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        module: 'class',
        result: 'success',
      })
    );
  });

  it('创建成功后调用 invalidateDurationCache', async () => {
    const req = mockReq({
      name: '2024级学前1班',
      enrollment_year: 2024,
      duration_years: 3,
      training_level_id: 2,
    });
    const res = mockRes();
    const next = vi.fn();

    await createClass(req, res, next);

    expect(invalidateDurationCache).toHaveBeenCalled();
  });

  it('班级名称已存在 → ValidationError，不调用 create', async () => {
    mockPrisma.classes.findFirst.mockResolvedValue({ id: 99 });
    const req = mockReq({
      name: '2024级学前1班',
      enrollment_year: 2024,
      duration_years: 3,
      training_level_id: 2,
    });
    const res = mockRes();
    const next = vi.fn();

    await createClass(req, res, next);

    expect(mockPrisma.classes.create).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(422);
    expect(err.message).toContain('已存在');
  });

  it('名称两端空格 → trim 后参与查重与存储', async () => {
    const req = mockReq({
      name: '  新班级  ',
      enrollment_year: 2024,
      duration_years: 3,
      training_level_id: 2,
    });
    const res = mockRes();
    const next = vi.fn();

    await createClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.classes.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: '新班级' } })
    );
    expect(mockPrisma.classes.create.mock.calls[0][0].data.name).toBe('新班级');
  });

  it('并发竞态 P2002（唯一约束冲突）→ 转为友好 ValidationError', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['name'] },
    });
    mockPrisma.classes.create.mockRejectedValue(p2002);
    const req = mockReq({
      name: '并发班',
      enrollment_year: 2024,
      duration_years: 3,
      training_level_id: 2,
    });
    const res = mockRes();
    const next = vi.fn();

    await createClass(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(422);
    expect(err.message).toContain('已存在');
  });
});

// ════════════════════════════════════════════════
// deleteClass
// ════════════════════════════════════════════════
describe('deleteClass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teaching_assignments.count.mockResolvedValue(0);
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([]);
    mockPrisma.classes.findUnique.mockResolvedValue({ ...EXISTING_CLASS });
    mockTx.classes.delete.mockResolvedValue({ ...EXISTING_CLASS });
  });

  it('无排课记录时删除成功', async () => {
    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.classes.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '删除成功' })
    );
  });

  it('存在排课记录时阻止删除并返回错误信息', async () => {
    mockPrisma.teaching_assignments.count.mockResolvedValue(3);
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([
      { semester: '2025-2026-1' },
      { semester: '2025-2026-2' },
    ]);

    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteClass(req, res, next);

    expect(mockTx.classes.delete).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('排课记录'),
      })
    );
  });

  it('阻止删除时消息包含涉及的学期列表', async () => {
    mockPrisma.teaching_assignments.count.mockResolvedValue(2);
    mockPrisma.teaching_assignments.findMany.mockResolvedValue([
      { semester: '2025-2026-1' },
      { semester: '2025-2026-2' },
    ]);

    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteClass(req, res, next);

    const msg = res.json.mock.calls[0][0].message;
    expect(msg).toContain('2025-2026-1');
    expect(msg).toContain('2025-2026-2');
  });

  it('删除不存在的班级 → 404', async () => {
    // findUnique 返回 null → NotFoundError
    mockPrisma.classes.findUnique.mockResolvedValue(null);

    const req = mockReq({}, { id: '999' });
    const res = mockRes();
    const next = vi.fn();

    await deleteClass(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(404);
  });

  it('删除成功后调用 invalidateDurationCache', async () => {
    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteClass(req, res, next);

    expect(invalidateDurationCache).toHaveBeenCalled();
  });

  it('删除成功后记录审计日志', async () => {
    const req = mockReq({}, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await deleteClass(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        module: 'class',
        result: 'success',
      })
    );
  });
});

// ════════════════════════════════════════════════
// updateClass — left_school 级联删除
// ════════════════════════════════════════════════
describe('updateClass — left_school 级联', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.classes.findUnique.mockResolvedValue({ ...EXISTING_CLASS });
    getCurrentSemesterInfo.mockResolvedValue(SEMESTER_INFO);
    mockTx.classes.update.mockResolvedValue({ ...UPDATED_CLASS });
    mockTx.teaching_assignments.deleteMany.mockResolvedValue({ count: 0 });
  });

  it('设置 is_left_school=true 且有 semesterInfo → 级联删除当前及未来学期排课', async () => {
    mockTx.teaching_assignments.deleteMany.mockResolvedValue({ count: 5 });

    const req = mockReq({ is_left_school: true }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.teaching_assignments.deleteMany).toHaveBeenCalledWith({
      where: { class_id: 1, semester: { gte: '2025-2026-2' } },
    });
  });

  it('设置 is_left_school=false → 不执行级联删除', async () => {
    mockPrisma.classes.findUnique.mockResolvedValue({
      ...EXISTING_CLASS,
      is_left_school: true,
    });

    const req = mockReq({ is_left_school: false }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.teaching_assignments.deleteMany).not.toHaveBeenCalled();
  });

  it('级联删除数量记录在审计日志中', async () => {
    mockTx.teaching_assignments.deleteMany.mockResolvedValue({ count: 3 });

    const req = mockReq({ is_left_school: true, name: '测试班' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        module: 'class',
        result: 'success',
        details: expect.objectContaining({
          deletedAssignments: 3,
        }),
      })
    );
  });

  it('级联删除时审计日志 message 包含删除数量', async () => {
    mockTx.teaching_assignments.deleteMany.mockResolvedValue({ count: 2 });

    const req = mockReq({ is_left_school: true, name: '测试班' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('级联删除 2 条排课记录'),
      })
    );
  });

  it('事务中同时包含 update 和级联 deleteMany', async () => {
    mockTx.teaching_assignments.deleteMany.mockResolvedValue({ count: 1 });

    const req = mockReq({ is_left_school: true }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    // $transaction 被调用，内部同时执行了 update 和 deleteMany
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    expect(mockTx.classes.update).toHaveBeenCalledOnce();
    expect(mockTx.teaching_assignments.deleteMany).toHaveBeenCalledOnce();
  });

  it('无级联删除时审计日志 message 不包含删除信息', async () => {
    mockTx.teaching_assignments.deleteMany.mockResolvedValue({ count: 0 });

    const req = mockReq({ is_left_school: true, name: '测试班' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    const auditCall = createAuditLog.mock.calls[0][0];
    expect(auditCall.message).not.toContain('级联删除');
    expect(auditCall.details.deletedAssignments).toBe(0);
  });
});

// ══════════════════════════════════════════════
// updateClass — 班级名称唯一性
// ══════════════════════════════════════════════
describe('updateClass — 班级名称唯一性', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.classes.findUnique.mockResolvedValue({ ...EXISTING_CLASS });
    mockPrisma.classes.findFirst.mockResolvedValue(null);
    getCurrentSemesterInfo.mockResolvedValue(SEMESTER_INFO);
    mockTx.classes.update.mockResolvedValue({ ...UPDATED_CLASS });
  });

  it('改名撞已有班级 → ValidationError，不执行 update', async () => {
    mockPrisma.classes.findFirst.mockResolvedValue({ id: 99 });

    const req = mockReq({ name: '别的班' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(mockPrisma.classes.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: '别的班', id: { not: 1 } } })
    );
    expect(mockTx.classes.update).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });

  it('名称未变（含 trim 后相同）→ 跳过查重正常更新', async () => {
    const req = mockReq({ name: ' 2024级学前1班 ' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(mockPrisma.classes.findFirst).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(mockTx.classes.update).toHaveBeenCalledOnce();
  });

  it('改名成功后 updateData.name 为 trim 后的名称', async () => {
    const req = mockReq({ name: ' 新名字 ' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.classes.update.mock.calls[0][0].data.name).toBe('新名字');
  });

  it('事务中 P2002（唯一约束冲突）→ 转为友好 ValidationError', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['name'] },
    });
    mockTx.classes.update.mockRejectedValue(p2002);

    const req = mockReq({ name: '并发改名' }, { id: '1' });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(422);
    expect(err.message).toContain('已存在');
  });
});
