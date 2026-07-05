/**
 * errorHandler 中间件单元测试
 *
 * 覆盖场景：
 * - AppError（isOperational=true/false）
 * - Prisma P2002（唯一约束）、P2025（记录不存在）、P2003（外键）
 * - 本地请求 vs 外部请求（showDetails 控制）
 * - 无状态码时默认 500
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock logger
// ──────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ──────────────────────────────────────────────
// Mock prisma（errorHandler 不直接用，但避免副作用）
// ──────────────────────────────────────────────
vi.mock('../../lib/prisma.js', () => ({
  prisma: {},
}));

const { errorHandler } = await import('../error.js');
const { AppError } = await import('../../utils/error.js');

// ──────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    ip: '127.0.0.1', // 默认本地请求
    ...overrides,
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('errorHandler — 全局错误处理中间件', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────
  // Prisma P2025 — 记录不存在
  // ──────────────────────────────────────────────
  it('Prisma P2025 错误应返回 404 和"记录不存在"', () => {
    const err = Object.assign(new Error('Record not found'), { code: 'P2025' });
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('记录不存在');
    expect(next).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // Prisma P2002 — 唯一约束冲突
  // ──────────────────────────────────────────────
  it('Prisma P2002 在本地请求时应返回 409 并显示详细 target 信息', () => {
    const err = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['username', 'email'] },
    });
    const req = makeReq({ ip: '127.0.0.1' });
    const res = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('唯一约束冲突');
    expect(res.body.message).toContain('username');
    expect(next).not.toHaveBeenCalled();
  });

  it('Prisma P2002 在外部请求时应返回 409 并隐藏详情', () => {
    const err = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['username'] },
    });
    const req = makeReq({ ip: '192.168.1.100' });
    const res = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('该记录已存在，请修改后重试');
    expect(next).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // Prisma P2003 — 外键约束
  // ──────────────────────────────────────────────
  it('Prisma P2003 外键错误应返回关联数据提示', () => {
    const err = Object.assign(new Error('Foreign key constraint failed'), {
      code: 'P2003',
    });
    const req = makeReq({ ip: '192.168.1.100' }); // 外部请求
    const res = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(500); // 未特殊处理状态码
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('关联数据不存在，请检查后重试');
    expect(next).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // AppError — isOperational=true
  // ──────────────────────────────────────────────
  it('AppError（isOperational=true）在本地请求时应返回原始消息', () => {
    const err = new AppError('参数验证失败', 422, 'VALIDATION_ERROR');
    const req = makeReq({ ip: '127.0.0.1' });
    const res = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('参数验证失败');
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(next).not.toHaveBeenCalled();
  });

  it('AppError（isOperational=true）在外部请求时也应返回操作消息', () => {
    const err = new AppError('参数验证失败', 422, 'VALIDATION_ERROR');
    const req = makeReq({ ip: '192.168.1.100' }); // 外部请求
    const res = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(422);
    expect(res.body.success).toBe(false);
    // isOperational=true 即使非 showDetails 也返回原始消息
    expect(res.body.message).toBe('参数验证失败');
    expect(res.body.code).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // AppError — isOperational=false
  // ──────────────────────────────────────────────
  it('AppError（isOperational=false）在外部请求时应返回安全消息', () => {
    const err = new AppError('内部敏感错误', 500, 'INTERNAL');
    err.isOperational = false;
    const req = makeReq({ ip: '192.168.1.100' }); // 外部请求
    const res = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    // isOperational=false + 非 showDetails → getSafeMessage
    expect(res.body.message).toBe('操作失败，请稍后重试');
    expect(res.body.code).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });

  it('AppError（isOperational=false）在本地请求时应返回详细消息', () => {
    const err = new AppError('内部敏感错误详情', 500, 'INTERNAL');
    err.isOperational = false;
    const req = makeReq({ ip: '::1' }); // 本地请求
    const res = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe('内部敏感错误详情');
    expect(res.body.code).toBe('INTERNAL');
    expect(next).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // 未知错误 — 默认 500
  // ──────────────────────────────────────────────
  it('未知错误无状态码时应默认 500', () => {
    const err = new Error('Unexpected crash');
    const req = makeReq({ ip: '192.168.1.100' }); // 外部请求
    const res = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('操作失败，请稍后重试');
    expect(next).not.toHaveBeenCalled();
  });

  it('未知错误在本地请求时应显示详细信息', () => {
    const err = new Error('Unexpected crash details');
    const req = makeReq({ ip: '127.0.0.1' }); // 本地请求
    const res = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Unexpected crash details');
    expect(next).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // 未知错误 — 有 statusCode 属性
  // ──────────────────────────────────────────────
  it('未知错误有 statusCode 属性时应使用该状态码', () => {
    const err = Object.assign(new Error('Bad request'), { statusCode: 400 });
    const req = makeReq({ ip: '192.168.1.100' });
    const res = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // ::ffff:127.0.0.1 也视为本地请求
  // ──────────────────────────────────────────────
  it('::ffff:127.0.0.1 应被视为本地请求并显示详情', () => {
    const err = new AppError('本地调试信息', 400, 'DEBUG');
    const req = makeReq({ ip: '::ffff:127.0.0.1' });
    const res = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.body.message).toBe('本地调试信息');
    expect(res.body.code).toBe('DEBUG');
    expect(next).not.toHaveBeenCalled();
  });
});
