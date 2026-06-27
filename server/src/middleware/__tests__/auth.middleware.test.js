/**
 * auth.middleware.js 单元测试
 *
 * 覆盖：
 * - authMiddleware（无 token / 无效 token / 禁用用户 / 合法 token）
 * - roleMiddleware（无用户 / 权限不足 / 权限通过）
 * - invalidateUserStatusCache（缓存失效）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma —— mock 对象定义在工厂内，避免 hoisting 引用问题
// ──────────────────────────────────────────────
const mockPrismaUsers = { findUnique: vi.fn() };
vi.mock('../../lib/prisma.js', () => ({
  prisma: { users: mockPrismaUsers },
}));

// ──────────────────────────────────────────────
// Mock AuthService
// ──────────────────────────────────────────────
const mockVerifyToken = vi.fn();
const mockVerifyDownloadToken = vi.fn();
vi.mock('../../services/auth.service.js', () => ({
  AuthService: {
    verifyToken: (...args) => mockVerifyToken(...args),
    verifyDownloadToken: (...args) => mockVerifyDownloadToken(...args),
  },
}));

// ──────────────────────────────────────────────
// Mock logger
// ──────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  default: {
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(),
  },
  log: {
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(),
  },
}));

const { authMiddleware, roleMiddleware, invalidateUserStatusCache } =
  await import('../auth.middleware.js');

// ──────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    headers: {},
    query: {},
    ...overrides,
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
  return res;
}

// ──────────────────────────────────────────────
// authMiddleware
// ──────────────────────────────────────────────
describe('authMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // invalidateUserStatusCache(userId) 只清指定用户，需逐个清
    // 测试中用到的 userId：1, 999
    invalidateUserStatusCache(1);
    invalidateUserStatusCache(999);
  });

  it('无 Authorization 头时应返回 401', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toContain('未授权');
    expect(next).not.toHaveBeenCalled();
  });

  it('verifyToken 返回 null 时应返回 401', async () => {
    const req = makeReq({ headers: { authorization: 'Bearer invalid-token' } });
    const res = makeRes();
    const next = vi.fn();

    mockVerifyToken.mockReturnValue(null);

    await authMiddleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toContain('Token');
    expect(next).not.toHaveBeenCalled();
  });

  it('用户被禁用时应返回 401', async () => {
    const req = makeReq({ headers: { authorization: 'Bearer valid' } });
    const res = makeRes();
    const next = vi.fn();

    mockVerifyToken.mockReturnValue({ id: 1, username: 'admin' });
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1, role: 'admin', is_active: false,
    });

    await authMiddleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toContain('禁用');
    expect(next).not.toHaveBeenCalled();
  });

  it('用户不存在时应返回 401', async () => {
    const req = makeReq({ headers: { authorization: 'Bearer valid' } });
    const res = makeRes();
    const next = vi.fn();

    mockVerifyToken.mockReturnValue({ id: 999, username: 'ghost' });
    mockPrismaUsers.findUnique.mockResolvedValue(null);

    await authMiddleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('合法 token 且用户激活时应调用 next 并设置 req.user', async () => {
    const req = makeReq({ headers: { authorization: 'Bearer valid' } });
    const res = makeRes();
    const next = vi.fn();

    mockVerifyToken.mockReturnValue({ id: 1, username: 'admin', role: 'super_admin' });
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1, role: 'super_admin', is_active: true,
    });

    await authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe(1);
    // 应使用数据库中的最新角色（防止旧 token 角色过期）
    expect(req.user.role).toBe('super_admin');
  });

  it('用户状态缓存生效时第二次不应查库', async () => {
    mockVerifyToken.mockReturnValue({ id: 1, username: 'admin', role: 'admin' });
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1, role: 'admin', is_active: true,
    });

    // 第一次请求，查库
    const req1 = makeReq({ headers: { authorization: 'Bearer valid' } });
    await authMiddleware(req1, makeRes(), vi.fn());
    expect(mockPrismaUsers.findUnique).toHaveBeenCalledTimes(1);

    // 第二次请求（同一用户），应命中缓存
    const req2 = makeReq({ headers: { authorization: 'Bearer valid' } });
    await authMiddleware(req2, makeRes(), vi.fn());
    expect(mockPrismaUsers.findUnique).toHaveBeenCalledTimes(1); // 仍为 1
  });

  it('invalidateUserStatusCache 后应重新查库', async () => {
    mockVerifyToken.mockReturnValue({ id: 1, username: 'admin', role: 'admin' });
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1, role: 'admin', is_active: true,
    });

    await authMiddleware(makeReq({ headers: { authorization: 'Bearer valid' } }), makeRes(), vi.fn());
    expect(mockPrismaUsers.findUnique).toHaveBeenCalledTimes(1);

    invalidateUserStatusCache(1);

    await authMiddleware(makeReq({ headers: { authorization: 'Bearer valid' } }), makeRes(), vi.fn());
    expect(mockPrismaUsers.findUnique).toHaveBeenCalledTimes(2);
  });

  it('downloadToken 合法且用户激活时应通过', async () => {
    const req = makeReq({ query: { downloadToken: 'valid-download' } });
    const res = makeRes();
    const next = vi.fn();

    mockVerifyDownloadToken.mockReturnValue({ id: 1, username: 'admin' });
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1, role: 'super_admin', is_active: true,
    });

    await authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe(1);
  });

  it('downloadToken 无效时应返回 401', async () => {
    const req = makeReq({ query: { downloadToken: 'invalid' } });
    const res = makeRes();
    const next = vi.fn();

    mockVerifyDownloadToken.mockReturnValue(null);

    await authMiddleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────
// roleMiddleware
// ──────────────────────────────────────────────
describe('roleMiddleware', () => {
  it('req.user 不存在时应返回 401', () => {
    const req = makeReq(); // 无 req.user
    const res = makeRes();
    const next = vi.fn();

    const middleware = roleMiddleware('admin', 'super_admin');
    middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('用户角色不在允许列表时应返回 403', () => {
    const req = makeReq();
    req.user = { role: 'viewer' };
    const res = makeRes();
    const next = vi.fn();

    const middleware = roleMiddleware('admin', 'super_admin');
    middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain('权限不足');
    expect(next).not.toHaveBeenCalled();
  });

  it('用户角色在允许列表时应调用 next', () => {
    const req = makeReq();
    req.user = { role: 'admin' };
    const res = makeRes();
    const next = vi.fn();

    const middleware = roleMiddleware('admin', 'super_admin');
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('super_admin 角色不在 admin-only 列表时应返回 403（需显式列出）', () => {
    // roleMiddleware 不做隐式提权，super_admin 必须被显式列入 allowedRoles
    const req = makeReq();
    req.user = { role: 'super_admin' };
    const res = makeRes();
    const next = vi.fn();

    const middleware = roleMiddleware('admin');
    middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('super_admin 在 allowedRoles 列表时应通过', () => {
    const req = makeReq();
    req.user = { role: 'super_admin' };
    const res = makeRes();
    const next = vi.fn();

    const middleware = roleMiddleware('admin', 'super_admin');
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
