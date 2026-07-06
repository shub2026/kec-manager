/**
 * plan-matrix.controller.js — assignTextbookToSemester 单元测试
 *
 * 重点覆盖 REPLACE 语义：
 * 1. 先删除该学期的所有现有教材关联，再创建新关联
 * 2. 创建新关联时参数正确（is_required 默认值、textbook_id）
 * 3. 教材不存在 → 返回错误
 * 4. FK 违规（学期记录不存在）→ 错误通过 next 传播
 * 5. 成功后写审计日志
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockTx = {
  plan_textbooks: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
};

const mockPrisma = {
  $transaction: vi.fn((arg) => (typeof arg === 'function' ? arg(mockTx) : Promise.all(arg))),
  textbooks: {
    findUnique: vi.fn(),
  },
  plan_textbooks: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
};

vi.mock('../../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock audit.service
// ──────────────────────────────────────────────
const mockCreateAuditLog = vi.fn();
vi.mock('../../../services/audit.service.js', () => ({
  createAuditLog: mockCreateAuditLog,
}));

vi.mock('../../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { assignTextbookToSemester } = await import('../plan-matrix.controller.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(body = {}, params = {}) {
  return { body, params, user: { id: 1 }, ip: '127.0.0.1' };
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
describe('assignTextbookToSemester — REPLACE 语义', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.$transaction.mockImplementation((arg) =>
      typeof arg === 'function' ? arg(mockTx) : Promise.all(arg)
    );
    mockTx.plan_textbooks.deleteMany.mockResolvedValue({ count: 0 });
    mockTx.plan_textbooks.create.mockResolvedValue({ id: 1 });
    mockPrisma.textbooks.findUnique.mockResolvedValue(null);
    mockCreateAuditLog.mockResolvedValue({});
  });

  // ── REPLACE 语义：先 deleteMany 再 create ──
  it('REPLACE 语义：先删除该学期所有旧教材关联，再创建新关联', async () => {
    mockPrisma.textbooks.findUnique.mockResolvedValue({
      id: 10,
      title: '高等数学',
      is_active: true,
    });
    mockTx.plan_textbooks.create.mockResolvedValue({
      id: 50,
      semester_id: 5,
      textbook_id: 10,
      textbooks: { id: 10, title: '高等数学' },
    });

    const req = mockReq({ textbook_id: 10 }, { id: '5' });
    const res = mockRes();
    await assignTextbookToSemester(req, res, vi.fn());

    // Verify deleteMany was called with correct semester_id
    expect(mockTx.plan_textbooks.deleteMany).toHaveBeenCalledWith({
      where: { semester_id: 5 },
    });
    // Verify create was called after deleteMany
    expect(mockTx.plan_textbooks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          semester_id: 5,
          textbook_id: 10,
        }),
      })
    );
    // Verify order: deleteMany before create
    const deleteOrder = mockTx.plan_textbooks.deleteMany.mock.invocationCallOrder[0];
    const createOrder = mockTx.plan_textbooks.create.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(createOrder);
  });

  // ── is_required 默认为 true ──
  it('未传 is_required 时默认为 true', async () => {
    mockPrisma.textbooks.findUnique.mockResolvedValue({
      id: 10,
      title: '教材A',
      is_active: true,
    });
    mockTx.plan_textbooks.create.mockResolvedValue({ id: 1 });

    const req = mockReq({ textbook_id: 10 }, { id: '5' });
    const res = mockRes();
    await assignTextbookToSemester(req, res, vi.fn());

    const createCall = mockTx.plan_textbooks.create.mock.calls[0][0];
    expect(createCall.data.is_required).toBe(true);
  });

  // ── is_required=false 正确传递 ──
  it('is_required=false 正确传递', async () => {
    mockPrisma.textbooks.findUnique.mockResolvedValue({
      id: 10,
      title: '参考书',
      is_active: true,
    });
    mockTx.plan_textbooks.create.mockResolvedValue({ id: 1 });

    const req = mockReq({ textbook_id: 10, is_required: false }, { id: '5' });
    const res = mockRes();
    await assignTextbookToSemester(req, res, vi.fn());

    const createCall = mockTx.plan_textbooks.create.mock.calls[0][0];
    expect(createCall.data.is_required).toBe(false);
  });

  // ── 教材不存在 → 返回错误 ──
  it('教材不存在 → 返回错误，不执行事务', async () => {
    mockPrisma.textbooks.findUnique.mockResolvedValue(null);

    const req = mockReq({ textbook_id: 999 }, { id: '5' });
    const res = mockRes();
    await assignTextbookToSemester(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '教材不存在',
    });
    // Transaction should not be called
    expect(mockTx.plan_textbooks.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.plan_textbooks.create).not.toHaveBeenCalled();
  });

  // ── FK 违规（学期记录不存在）→ 错误通过 next 传播 ──
  it('学期记录不存在（FK 违规）→ 错误通过 next 传播', async () => {
    mockPrisma.textbooks.findUnique.mockResolvedValue({
      id: 10,
      title: '教材A',
      is_active: true,
    });
    // Simulate FK constraint violation when creating
    const fkError = new Error('Foreign key constraint failed');
    fkError.code = 'P2003';
    mockTx.plan_textbooks.create.mockRejectedValue(fkError);

    const req = mockReq({ textbook_id: 10 }, { id: '99999' });
    const res = mockRes();
    const next = vi.fn();
    await assignTextbookToSemester(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'P2003' }));
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  // ── 成功后写审计日志 ──
  it('成功后调用审计日志', async () => {
    mockPrisma.textbooks.findUnique.mockResolvedValue({
      id: 10,
      title: '教材A',
      is_active: true,
    });
    mockTx.plan_textbooks.create.mockResolvedValue({
      id: 50,
      semester_id: 5,
      textbook_id: 10,
      textbooks: { id: 10, title: '教材A' },
    });

    const req = mockReq({ textbook_id: 10 }, { id: '5' });
    const res = mockRes();
    await assignTextbookToSemester(req, res, vi.fn());

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'trainingPlan',
        action: 'create',
        result: 'success',
        details: { semester_id: 5, textbook_id: 10 },
      })
    );
  });

  // ── 成功后返回关联数据 ──
  it('成功后返回包含 textbooks 的关联数据', async () => {
    const textbookInfo = {
      id: 10,
      title: '线性代数',
      isbn: '123',
      publisher: '高教社',
      is_active: true,
    };
    mockPrisma.textbooks.findUnique.mockResolvedValue({
      id: 10,
      title: '线性代数',
      is_active: true,
    });
    mockTx.plan_textbooks.create.mockResolvedValue({
      id: 50,
      semester_id: 5,
      textbook_id: 10,
      is_required: true,
      textbooks: textbookInfo,
    });

    const req = mockReq({ textbook_id: 10 }, { id: '5' });
    const res = mockRes();
    await assignTextbookToSemester(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: '关联成功',
        data: expect.objectContaining({
          id: 50,
          textbooks: textbookInfo,
        }),
      })
    );
  });

  // ── 已停用教材 → 返回错误 ──
  it('已停用教材 → 返回错误，不执行事务', async () => {
    mockPrisma.textbooks.findUnique.mockResolvedValue({
      id: 10,
      title: '旧版教材',
      is_active: false,
    });

    const req = mockReq({ textbook_id: 10 }, { id: '5' });
    const res = mockRes();
    await assignTextbookToSemester(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '教材"旧版教材"已停用，无法关联',
    });
    expect(mockTx.plan_textbooks.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.plan_textbooks.create).not.toHaveBeenCalled();
  });

  // ── 缺 textbook_id → 返回错误 ──
  it('缺 textbook_id → 返回错误', async () => {
    const req = mockReq({}, { id: '5' });
    const res = mockRes();
    await assignTextbookToSemester(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '教材为必填项',
    });
    expect(mockPrisma.textbooks.findUnique).not.toHaveBeenCalled();
  });

  // ── REPLACE 语义：旧关联被删除的数量 ──
  it('REPLACE 语义：deleteMany 返回的 count 代表被替换的旧关联数', async () => {
    mockPrisma.textbooks.findUnique.mockResolvedValue({
      id: 10,
      title: '新教材',
      is_active: true,
    });
    // Simulate 3 old associations being deleted
    mockTx.plan_textbooks.deleteMany.mockResolvedValue({ count: 3 });
    mockTx.plan_textbooks.create.mockResolvedValue({
      id: 51,
      semester_id: 5,
      textbook_id: 10,
      textbooks: { id: 10, title: '新教材' },
    });

    const req = mockReq({ textbook_id: 10 }, { id: '5' });
    const res = mockRes();
    await assignTextbookToSemester(req, res, vi.fn());

    // The old associations were deleted (REPLACE semantics)
    expect(mockTx.plan_textbooks.deleteMany).toHaveBeenCalledWith({
      where: { semester_id: 5 },
    });
    // Only one new association created
    expect(mockTx.plan_textbooks.create).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
