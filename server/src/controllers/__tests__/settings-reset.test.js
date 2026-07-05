/**
 * settings.controller.js — resetSystem 单元测试
 *
 * 覆盖场景：
 * 1. 成功重置：所有表按依赖顺序删除
 * 2. 审计日志记录删除前的记录数
 * 3. 所有 deleteMany 调用在事务内
 * 4. 重置过程中出错 → 事务回滚（通过 $transaction 模拟）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockTx = {
  teaching_assignments: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  teacher_courses: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  teacher_scheduling_colleges: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  teacher_training_levels: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  plan_textbooks: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  plan_course_semesters: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  plan_courses: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  teachers: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  classes: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  training_plans: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  textbooks: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  courses: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  majors: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  colleges: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  training_levels: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  system_settings: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  audit_logs: {
    count: vi.fn().mockResolvedValue(42),
    deleteMany: vi.fn().mockResolvedValue({ count: 42 }),
    create: vi.fn().mockResolvedValue({ id: 999 }),
  },
  token_blacklist: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
};

const mockPrisma = {
  $transaction: vi.fn(async (fn) => fn(mockTx)),
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

vi.mock('../../services/class.service.js', () => ({
  invalidateDurationCache: vi.fn(),
}));

vi.mock('../../services/settings.service.js', () => ({
  parseSemesterString: vi.fn(),
  invalidateSemesterCache: vi.fn(),
}));

vi.mock('../../services/auth.service.js', () => ({
  AuthService: {
    verifyToken: vi.fn(),
  },
}));

// ──────────────────────────────────────────────
// 导入被测模块（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const { resetSystem } = await import('../settings.controller.js');
const { createAuditLog } = await import('../../services/audit.service.js');
const { invalidateDurationCache } = await import('../../services/class.service.js');

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

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('resetSystem — 系统重置', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 重建 $transaction 实现
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockTx));

    // 默认 audit_logs.count 返回 42
    mockTx.audit_logs.count.mockResolvedValue(42);
  });

  // ──────────────────────────────────────────────
  // 1. 成功重置：所有表按依赖顺序删除
  // ──────────────────────────────────────────────
  it('成功重置时应删除所有表并返回成功响应', async () => {
    const req = mockReq({ reason: '测试环境清理' });
    const res = mockRes();
    const next = vi.fn();

    await resetSystem(req, res, next);

    expect(next).not.toHaveBeenCalled();

    // 验证所有表都被删除
    expect(mockTx.teaching_assignments.deleteMany).toHaveBeenCalled();
    expect(mockTx.teacher_courses.deleteMany).toHaveBeenCalled();
    expect(mockTx.teacher_scheduling_colleges.deleteMany).toHaveBeenCalled();
    expect(mockTx.teacher_training_levels.deleteMany).toHaveBeenCalled();
    expect(mockTx.plan_textbooks.deleteMany).toHaveBeenCalled();
    expect(mockTx.plan_course_semesters.deleteMany).toHaveBeenCalled();
    expect(mockTx.plan_courses.deleteMany).toHaveBeenCalled();
    expect(mockTx.teachers.deleteMany).toHaveBeenCalled();
    expect(mockTx.classes.deleteMany).toHaveBeenCalled();
    expect(mockTx.training_plans.deleteMany).toHaveBeenCalled();
    expect(mockTx.textbooks.deleteMany).toHaveBeenCalled();
    expect(mockTx.courses.deleteMany).toHaveBeenCalled();
    expect(mockTx.majors.deleteMany).toHaveBeenCalled();
    expect(mockTx.colleges.deleteMany).toHaveBeenCalled();
    expect(mockTx.training_levels.deleteMany).toHaveBeenCalled();
    expect(mockTx.system_settings.deleteMany).toHaveBeenCalled();
    expect(mockTx.audit_logs.deleteMany).toHaveBeenCalled();
    expect(mockTx.token_blacklist.deleteMany).toHaveBeenCalled();

    // 验证 invalidateDurationCache 被调用
    expect(invalidateDurationCache).toHaveBeenCalled();

    // 返回成功响应
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: expect.stringContaining('系统已重置'),
      })
    );
  });

  // ──────────────────────────────────────────────
  // 依赖顺序验证：子表在主表之前删除
  // ──────────────────────────────────────────────
  it('子表应在主表之前删除（依赖顺序）', async () => {
    const callOrder = [];

    // 用 spy 记录调用顺序
    const makeSpy = (obj, method, label) => {
      const orig = obj[method].getMockImplementation() || obj[method];
      obj[method] = vi.fn(async (...args) => {
        callOrder.push(label);
        return orig(...args);
      });
    };

    makeSpy(mockTx.teaching_assignments, 'deleteMany', 'teaching_assignments');
    makeSpy(mockTx.teacher_courses, 'deleteMany', 'teacher_courses');
    makeSpy(mockTx.teachers, 'deleteMany', 'teachers');
    makeSpy(mockTx.classes, 'deleteMany', 'classes');
    makeSpy(mockTx.training_plans, 'deleteMany', 'training_plans');

    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await resetSystem(req, res, next);

    // 关联表(teaching_assignments, teacher_courses) 应在 teachers 之前
    const taIdx = callOrder.indexOf('teaching_assignments');
    const tcIdx = callOrder.indexOf('teacher_courses');
    const tIdx = callOrder.indexOf('teachers');
    expect(taIdx).toBeLessThan(tIdx);
    expect(tcIdx).toBeLessThan(tIdx);

    // classes 应在 training_plans 之前
    const cIdx = callOrder.indexOf('classes');
    const tpIdx = callOrder.indexOf('training_plans');
    expect(cIdx).toBeLessThan(tpIdx);
  });

  // ──────────────────────────────────────────────
  // 2. 审计日志记录删除前的记录数
  // ──────────────────────────────────────────────
  it('事务内应记录审计日志并包含删除前的审计日志数量', async () => {
    mockTx.audit_logs.count.mockResolvedValue(150);

    const req = mockReq({ reason: '年度清理' });
    const res = mockRes();
    const next = vi.fn();

    await resetSystem(req, res, next);

    // 审计日志应在事务内被创建
    expect(mockTx.audit_logs.create).toHaveBeenCalledTimes(1);
    const createCall = mockTx.audit_logs.create.mock.calls[0][0];
    const details = JSON.parse(createCall.data.details);

    expect(details.type).toBe('system_reset');
    expect(details.reason).toBe('年度清理');
    expect(details.archived_audit_count).toBe(150);

    // 消息应包含归档数量
    expect(createCall.data.message).toContain('150');
    expect(createCall.data.message).toContain('年度清理');
  });

  // ──────────────────────────────────────────────
  // 3. 所有 deleteMany 在事务内执行
  // ──────────────────────────────────────────────
  it('所有删除操作应通过 $transaction 在事务内执行', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await resetSystem(req, res, next);

    // $transaction 应被调用一次（回调函数模式）
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    const txArg = mockPrisma.$transaction.mock.calls[0][0];
    expect(typeof txArg).toBe('function');
  });

  // ──────────────────────────────────────────────
  // 4. 错误时事务回滚（$transaction 模拟抛出）
  // ──────────────────────────────────────────────
  it('事务内出错应回滚并调用 next 传递错误', async () => {
    // 模拟事务执行时抛出错误
    mockPrisma.$transaction.mockImplementation(async () => {
      throw new Error('数据库锁定');
    });

    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await resetSystem(req, res, next);

    // next 应被调用并传入错误
    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error.message).toBe('数据库锁定');

    // 成功响应不应被调用
    expect(res.json).not.toHaveBeenCalled();

    // 失败审计日志应被调用
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        module: 'system',
        result: 'failed',
        details: expect.objectContaining({
          type: 'system_reset',
        }),
        message: expect.stringContaining('系统重置失败'),
      })
    );
  });

  // ──────────────────────────────────────────────
  // 补充：不传 reason 时审计日志仍正常
  // ──────────────────────────────────────────────
  it('不传 reason 时事务内审计日志应正常记录', async () => {
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();

    await resetSystem(req, res, next);

    expect(mockTx.audit_logs.create).toHaveBeenCalledTimes(1);
    const createCall = mockTx.audit_logs.create.mock.calls[0][0];
    const details = JSON.parse(createCall.data.details);
    expect(details.reason).toBeNull();
    expect(createCall.data.message).toContain('执行系统重置');
    // 不应包含 "原因" 字样
    expect(createCall.data.message).not.toContain('原因');
  });
});
