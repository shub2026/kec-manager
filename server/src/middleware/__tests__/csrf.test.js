/**
 * validateCsrf 中间件单元测试
 *
 * 覆盖场景：
 * - 安全方法（GET/HEAD/OPTIONS）跳过验证
 * - POST 请求：header+cookie token 匹配 → 通过
 * - POST 请求：token 不匹配 → 403
 * - POST 请求：无任何 token → 403（服务端登录时已设置 XSRF-TOKEN cookie）
 * - POST 请求：仅有 header token 无 cookie → 403
 * - POST 请求：仅有 cookie token 无 header → 403
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

const { generateSignedCsrfToken } = await import('../../utils/csrf.js');
const { validateCsrf } = await import('../csrf.js');

// ──────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    method: 'POST',
    headers: {},
    ip: '127.0.0.1',
    path: '/api/test',
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
describe('validateCsrf — CSRF 验证中间件', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────
  // 安全方法应跳过 CSRF 验证
  // ──────────────────────────────────────────────
  it('GET 请求应跳过验证并调用 next', () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();
    const next = vi.fn();

    validateCsrf(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('HEAD 请求应跳过验证并调用 next', () => {
    const req = makeReq({ method: 'HEAD' });
    const res = makeRes();
    const next = vi.fn();

    validateCsrf(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('OPTIONS 请求应跳过验证并调用 next', () => {
    const req = makeReq({ method: 'OPTIONS' });
    const res = makeRes();
    const next = vi.fn();

    validateCsrf(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // POST 请求：无 token → 403（服务端登录时已设置 cookie）
  // ──────────────────────────────────────────────
  it('POST 无任何 token 时应返回 403', () => {
    const req = makeReq({
      method: 'POST',
      headers: {},
    });
    const res = makeRes();
    const next = vi.fn();

    validateCsrf(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('CSRF');
    expect(next).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // POST 请求：header+cookie 匹配 → 通过
  // ──────────────────────────────────────────────
  it('POST header+cookie token 匹配时应通过', () => {
    const token = generateSignedCsrfToken();
    const req = makeReq({
      method: 'POST',
      headers: {
        'x-csrf-token': token,
        cookie: `XSRF-TOKEN=${token}`,
      },
    });
    const res = makeRes();
    const next = vi.fn();

    validateCsrf(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  // ──────────────────────────────────────────────
  // POST 请求：header+cookie 不匹配 → 403
  // ──────────────────────────────────────────────
  it('POST header+cookie token 不匹配时应返回 403', () => {
    const req = makeReq({
      method: 'POST',
      headers: {
        'x-csrf-token': 'header-value',
        cookie: 'XSRF-TOKEN=cookie-value',
      },
    });
    const res = makeRes();
    const next = vi.fn();

    validateCsrf(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('CSRF');
    expect(next).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // POST 请求：仅有 header token 无 cookie → 403
  // ──────────────────────────────────────────────
  it('POST 仅有 header token 无 cookie 时应返回 403', () => {
    const req = makeReq({
      method: 'POST',
      headers: {
        'x-csrf-token': 'some-token',
      },
    });
    const res = makeRes();
    const next = vi.fn();

    validateCsrf(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // POST 请求：仅有 cookie token 无 header → 403
  // ──────────────────────────────────────────────
  it('POST 仅有 cookie token 无 header 时应返回 403', () => {
    const req = makeReq({
      method: 'POST',
      headers: {
        cookie: 'XSRF-TOKEN=some-token',
      },
    });
    const res = makeRes();
    const next = vi.fn();

    validateCsrf(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // Cookie 解析：多个 cookie 时正确提取 XSRF-TOKEN
  // ──────────────────────────────────────────────
  it('多个 cookie 中应正确提取 XSRF-TOKEN 并验证通过', () => {
    const token = generateSignedCsrfToken();
    const req = makeReq({
      method: 'POST',
      headers: {
        'x-csrf-token': token,
        cookie: `session=abc; XSRF-TOKEN=${token}; other=xyz`,
      },
    });
    const res = makeRes();
    const next = vi.fn();

    validateCsrf(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // PUT/DELETE/PATCH 等非安全方法也需要验证
  // ──────────────────────────────────────────────
  it('PUT 请求也需要 CSRF 验证', () => {
    const req = makeReq({
      method: 'PUT',
      headers: {
        'x-csrf-token': 'token-a',
        cookie: 'XSRF-TOKEN=token-b',
      },
    });
    const res = makeRes();
    const next = vi.fn();

    validateCsrf(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('DELETE 请求无 token 时应返回 403', () => {
    const req = makeReq({
      method: 'DELETE',
      headers: {},
    });
    const res = makeRes();
    const next = vi.fn();

    validateCsrf(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
