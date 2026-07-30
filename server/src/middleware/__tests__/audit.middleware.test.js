/**
 * audit.middleware 单元测试
 *
 * 覆盖：
 * - shouldSkip: 只读方法、_auditSuppressed、跳过路径前缀
 * - res.send 拦截：成功/失败结果、模块推导、敏感字段脱敏、重复 send 只记录一次
 * - createAuditLog 异步失败被吞没并记录日志
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockCreateAuditLog = vi.fn();
vi.mock('../../services/audit.service.js', () => ({
  createAuditLog: (...a) => mockCreateAuditLog(...a),
}));

const mockLogError = vi.fn();
vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn() },
  log: { error: (...a) => mockLogError(...a), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { auditMiddleware } = await import('../audit.middleware.js');

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    path: '/api/classes',
    originalUrl: '/api/classes',
    ip: '127.0.0.1',
    user: { id: 7 },
    body: { name: '软件2401' },
    ...overrides,
  };
}

function makeRes(statusCode = 200) {
  const res = { statusCode };
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

/** 等待异步审计写入的微任务落地 */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('auditMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAuditLog.mockResolvedValue({});
  });

  describe('跳过条件', () => {
    it('只读方法（GET）不拦截 send', () => {
      const req = makeReq({ method: 'GET' });
      const res = makeRes();
      const originalSend = res.send;
      const next = vi.fn();

      auditMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.send).toBe(originalSend);
    });

    it('_auditSuppressed 标记的请求跳过审计', () => {
      const res = makeRes();
      const originalSend = res.send;

      auditMiddleware(makeReq({ _auditSuppressed: true }), res, vi.fn());

      expect(res.send).toBe(originalSend);
    });

    it('跳过路径前缀（含子路径）不审计', () => {
      for (const path of ['/api/health', '/api/auth/csrf-token', '/api/health/db']) {
        const res = makeRes();
        const originalSend = res.send;
        auditMiddleware(makeReq({ path }), res, vi.fn());
        expect(res.send).toBe(originalSend);
      }
    });
  });

  describe('审计记录', () => {
    it('写操作成功响应记录 success 结果与模块名', async () => {
      const req = makeReq();
      const res = makeRes(201);

      auditMiddleware(req, res, vi.fn());
      res.send('{"ok":true}');
      await flush();

      expect(mockCreateAuditLog).toHaveBeenCalledTimes(1);
      const entry = mockCreateAuditLog.mock.calls[0][0];
      expect(entry).toMatchObject({
        action: 'post',
        module: 'classes',
        userId: 7,
        ip: '127.0.0.1',
        result: 'success',
        message: 'POST /api/classes → 201',
      });
      expect(entry.details.status).toBe(201);
    });

    it('状态码 >= 400 记录 failed 结果', async () => {
      const res = makeRes(422);

      auditMiddleware(makeReq({ method: 'DELETE' }), res, vi.fn());
      res.send('err');
      await flush();

      expect(mockCreateAuditLog.mock.calls[0][0].result).toBe('failed');
      expect(mockCreateAuditLog.mock.calls[0][0].action).toBe('delete');
    });

    it('敏感字段脱敏为 [REDACTED]，嵌套对象递归处理', async () => {
      const req = makeReq({
        path: '/api/auth/change-password',
        originalUrl: '/api/auth/change-password',
        body: {
          oldPassword: 'secret1',
          newPassword: 'secret2',
          nested: { token: 'jwt-token', keep: 'visible' },
          normal: 'value',
        },
      });
      const res = makeRes();

      auditMiddleware(req, res, vi.fn());
      res.send('ok');
      await flush();

      const details = mockCreateAuditLog.mock.calls[0][0].details;
      expect(details.body).toEqual({
        oldPassword: '[REDACTED]',
        newPassword: '[REDACTED]',
        nested: { token: '[REDACTED]', keep: 'visible' },
        normal: 'value',
      });
      expect(mockCreateAuditLog.mock.calls[0][0].module).toBe('auth');
    });

    it('非 /api 前缀路径以完整路径作为模块名', async () => {
      const req = makeReq({ path: '/internal/task', originalUrl: '/internal/task' });
      const res = makeRes();

      auditMiddleware(req, res, vi.fn());
      res.send('ok');
      await flush();

      expect(mockCreateAuditLog.mock.calls[0][0].module).toBe('/internal/task');
    });

    it('重复调用 send 只记录一次审计', async () => {
      const res = makeRes();

      auditMiddleware(makeReq(), res, vi.fn());
      res.send('first');
      res.send('second');
      await flush();

      expect(mockCreateAuditLog).toHaveBeenCalledTimes(1);
    });

    it('createAuditLog 失败被吞没并记录错误日志，不影响响应', async () => {
      mockCreateAuditLog.mockRejectedValue(new Error('db unavailable'));
      const res = makeRes();

      auditMiddleware(makeReq(), res, vi.fn());
      expect(() => res.send('ok')).not.toThrow();
      await flush();

      expect(mockLogError).toHaveBeenCalledWith(
        '审计中间件记录失败',
        expect.objectContaining({ error: 'db unavailable' })
      );
    });

    it('匿名请求 userId 为 undefined 仍正常记录', async () => {
      const res = makeRes();

      auditMiddleware(makeReq({ user: undefined }), res, vi.fn());
      res.send('ok');
      await flush();

      expect(mockCreateAuditLog.mock.calls[0][0].userId).toBeUndefined();
    });
  });
});
