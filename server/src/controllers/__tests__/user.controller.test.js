/**
 * user.controller 单元测试
 *
 * 覆盖 createUser / updateUser / updateUserStatus / deleteUser 四个控制器：
 * - 角色权限控制（super_admin / admin / viewer 的越权检查）
 * - 自身操作限制（不能修改自己角色、不能禁用/删除自己）
 * - 超级管理员保护（不能被 admin 修改/禁用/删除）
 * - 输入校验（必填字段、重复用户名）
 * - 密码哈希、缓存失效、审计日志等横切关注点
 *
 * Mock 策略：mock prisma / bcryptjs / audit service / auth middleware / logger，
 * 直接调用控制器函数验证行为。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  users: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock bcryptjs
// ──────────────────────────────────────────────
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed-password-123'),
    compare: vi.fn(),
  },
  hash: vi.fn().mockResolvedValue('hashed-password-123'),
  compare: vi.fn(),
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

vi.mock('../../config/auth.config.js', () => ({
  authConfig: {
    bcryptRounds: 10,
    jwtSecret: 'test-secret',
    jwtExpiresIn: '1h',
  },
}));

vi.mock('../../middleware/auth.middleware.js', () => ({
  invalidateUserStatusCache: vi.fn(),
}));

// ──────────────────────────────────────────────
// 导入被测模块（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const { listUsers, createUser, updateUser, updateUserStatus, resetUserPassword, deleteUser } =
  await import('../user.controller.js');
const { createAuditLog } = await import('../../services/audit.service.js');
const { invalidateUserStatusCache } = await import('../../middleware/auth.middleware.js');
const bcrypt = (await import('bcryptjs')).default;

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq({
  params = {},
  body = {},
  user = { id: 1, role: 'super_admin' },
  query = {},
} = {}) {
  return { params, body, user, query, ip: '127.0.0.1' };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

// ════════════════════════════════════════════════
// createUser
// ════════════════════════════════════════════════
describe('createUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.users.findUnique.mockResolvedValue(null); // 默认无重复用户
    mockPrisma.users.create.mockResolvedValue({
      id: 10,
      username: 'newuser',
      real_name: '新用户',
      email: 'new@test.com',
      role: 'viewer',
      is_active: true,
    });
  });

  // ── super_admin 创建各角色 ──────────────────
  it('super_admin 创建 admin → 成功', async () => {
    const req = mockReq({
      body: { username: 'admin1', password: 'pass123', role: 'admin' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await createUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.users.create).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '创建成功' })
    );
  });

  it('super_admin 创建 viewer → 成功', async () => {
    const req = mockReq({
      body: { username: 'viewer1', password: 'pass123', role: 'viewer' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await createUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('super_admin 创建 super_admin → 成功', async () => {
    const req = mockReq({
      body: { username: 'sa1', password: 'pass123', role: 'super_admin' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await createUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  // ── admin 权限限制 ──────────────────────────
  it('admin 创建 viewer → 成功', async () => {
    const req = mockReq({
      body: { username: 'viewer2', password: 'pass123', role: 'viewer' },
      user: { id: 2, role: 'admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await createUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('admin 创建 admin → 403 forbidden (权限提升)', async () => {
    const req = mockReq({
      body: { username: 'admin2', password: 'pass123', role: 'admin' },
      user: { id: 2, role: 'admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await createUser(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain('权限不足');
  });

  it('admin 创建 super_admin → 403 forbidden', async () => {
    const req = mockReq({
      body: { username: 'sa2', password: 'pass123', role: 'super_admin' },
      user: { id: 2, role: 'admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await createUser(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
  });

  // ── 输入校验 ────────────────────────────────
  it('重复用户名 → ValidationError', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({ id: 5, username: 'taken' });

    const req = mockReq({
      body: { username: 'taken', password: 'pass123', role: 'viewer' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await createUser(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(422);
    expect(error.message).toContain('用户名已存在');
  });

  it('缺少必填字段 (username) → ValidationError', async () => {
    const req = mockReq({
      body: { password: 'pass123', role: 'viewer' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await createUser(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(422);
    expect(error.message).toContain('用户名和密码为必填项');
  });

  it('缺少必填字段 (password) → ValidationError', async () => {
    const req = mockReq({
      body: { username: 'nopass', role: 'viewer' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await createUser(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(422);
    expect(error.message).toContain('用户名和密码为必填项');
  });

  // ── 密码哈希 ────────────────────────────────
  it('创建用户时调用 bcrypt.hash 进行密码哈希', async () => {
    const req = mockReq({
      body: { username: 'hashuser', password: 'plain-pass', role: 'viewer' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await createUser(req, res, next);

    expect(bcrypt.hash).toHaveBeenCalledWith('plain-pass', 10);
    expect(mockPrisma.users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ password: 'hashed-password-123' }),
      })
    );
  });

  // ── 审计日志 ────────────────────────────────
  it('创建成功后记录审计日志', async () => {
    const req = mockReq({
      body: { username: 'audituser', password: 'pass123', role: 'viewer' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await createUser(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        module: 'user',
        result: 'success',
        userId: 1,
      })
    );
  });
});

// ════════════════════════════════════════════════
// updateUser
// ════════════════════════════════════════════════
describe('updateUser', () => {
  const existingViewer = {
    id: 10,
    username: 'viewer1',
    real_name: '访客一',
    email: 'v1@test.com',
    role: 'viewer',
    is_active: true,
  };

  const existingAdmin = {
    id: 20,
    username: 'admin1',
    real_name: '管理员一',
    email: 'a1@test.com',
    role: 'admin',
    is_active: true,
  };

  const existingSuperAdmin = {
    id: 30,
    username: 'superadmin',
    real_name: '超管',
    email: 'sa@test.com',
    role: 'super_admin',
    is_active: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.users.findUnique.mockResolvedValue({ ...existingViewer });
    mockPrisma.users.update.mockResolvedValue({
      id: 10,
      username: 'viewer1',
      real_name: '更新后',
      email: 'updated@test.com',
      role: 'viewer',
    });
  });

  it('用户更新自己的 profile（非 role）→ 成功', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({
      id: 1,
      username: 'me',
      real_name: '我',
      email: 'me@test.com',
      role: 'viewer',
      is_active: true,
    });
    mockPrisma.users.update.mockResolvedValue({
      id: 1,
      username: 'me',
      real_name: '更新后',
      email: 'me@test.com',
      role: 'viewer',
    });

    const req = mockReq({
      params: { id: '1' },
      body: { real_name: '更新后' },
      user: { id: 1, role: 'viewer' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '更新成功' })
    );
  });

  it('用户尝试修改自己的角色 → 403 blocked', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({
      id: 1,
      username: 'me',
      real_name: '我',
      email: 'me@test.com',
      role: 'viewer',
      is_active: true,
    });

    const req = mockReq({
      params: { id: '1' },
      body: { role: 'admin' },
      user: { id: 1, role: 'viewer' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUser(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain('不能修改自己的角色');
  });

  it('super_admin 更新任意用户 → 成功', async () => {
    const req = mockReq({
      params: { id: '10' },
      body: { real_name: '超管改名', role: 'admin' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    // super_admin 可以改 role
    const updateCall = mockPrisma.users.update.mock.calls[0][0];
    expect(updateCall.data.role).toBe('admin');
  });

  it('admin 更新 viewer → 成功', async () => {
    const req = mockReq({
      params: { id: '10' },
      body: { real_name: '改名' },
      user: { id: 2, role: 'admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('admin 更新 admin → 403 forbidden', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({ ...existingAdmin });

    const req = mockReq({
      params: { id: '20' },
      body: { real_name: '想改' },
      user: { id: 2, role: 'admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUser(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain('权限不足');
  });

  it('admin 试图修改 super_admin → 403 forbidden', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({ ...existingSuperAdmin });

    const req = mockReq({
      params: { id: '30' },
      body: { real_name: '想改超管' },
      user: { id: 2, role: 'admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUser(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
  });

  it('更新不存在的用户 → 404', async () => {
    mockPrisma.users.findUnique.mockResolvedValue(null);

    const req = mockReq({
      params: { id: '999' },
      body: { real_name: '不存在' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUser(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(404);
    expect(error.message).toContain('用户不存在');
  });

  it('角色变更时清除认证缓存 (invalidateUserStatusCache)', async () => {
    const req = mockReq({
      params: { id: '10' },
      body: { role: 'admin' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUser(req, res, next);

    expect(invalidateUserStatusCache).toHaveBeenCalledWith(10);
  });

  it('更新成功后记录审计日志', async () => {
    const req = mockReq({
      params: { id: '10' },
      body: { real_name: '新名字' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUser(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        module: 'user',
        result: 'success',
        userId: 1,
      })
    );
  });
});

// ════════════════════════════════════════════════
// updateUserStatus
// ════════════════════════════════════════════════
describe('updateUserStatus', () => {
  const viewerUser = {
    id: 10,
    username: 'viewer1',
    real_name: '访客一',
    email: 'v1@test.com',
    role: 'viewer',
    is_active: true,
  };

  const adminUser = {
    id: 20,
    username: 'admin1',
    real_name: '管理员一',
    email: 'a1@test.com',
    role: 'admin',
    is_active: true,
  };

  const superAdminUser = {
    id: 30,
    username: 'superadmin',
    real_name: '超管',
    email: 'sa@test.com',
    role: 'super_admin',
    is_active: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.users.findUnique.mockResolvedValue({ ...viewerUser });
    mockPrisma.users.update.mockResolvedValue({});
  });

  it('禁用用户 → 成功，token 缓存被清除', async () => {
    const req = mockReq({
      params: { id: '10' },
      body: { is_active: false },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUserStatus(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '禁用成功' })
    );
    expect(invalidateUserStatusCache).toHaveBeenCalledWith(10);
  });

  it('启用用户 → 成功', async () => {
    const req = mockReq({
      params: { id: '10' },
      body: { is_active: true },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUserStatus(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '激活成功' })
    );
  });

  it('自我禁用 → blocked (不能禁用自己)', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({
      id: 1,
      username: 'me',
      role: 'super_admin',
      is_active: true,
    });

    const req = mockReq({
      params: { id: '1' },
      body: { is_active: false },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUserStatus(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain('不能禁用自己');
  });

  it('修改 super_admin 状态 → 403 forbidden', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({ ...superAdminUser });

    const req = mockReq({
      params: { id: '30' },
      body: { is_active: false },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUserStatus(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain('不能操作超级管理员账户');
  });

  it('admin 禁用 viewer → 成功', async () => {
    const req = mockReq({
      params: { id: '10' },
      body: { is_active: false },
      user: { id: 2, role: 'admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUserStatus(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('admin 禁用 admin → 403 forbidden', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({ ...adminUser });

    const req = mockReq({
      params: { id: '20' },
      body: { is_active: false },
      user: { id: 2, role: 'admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUserStatus(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain('权限不足');
  });

  it('状态变更时调用 invalidateUserStatusCache', async () => {
    const req = mockReq({
      params: { id: '10' },
      body: { is_active: false },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUserStatus(req, res, next);

    expect(invalidateUserStatusCache).toHaveBeenCalledWith(10);
  });

  it('操作成功后记录审计日志', async () => {
    const req = mockReq({
      params: { id: '10' },
      body: { is_active: false },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await updateUserStatus(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        module: 'user',
        result: 'success',
        userId: 1,
      })
    );
  });
});

// ════════════════════════════════════════════════
// deleteUser
// ════════════════════════════════════════════════
describe('deleteUser', () => {
  const viewerUser = {
    id: 10,
    username: 'viewer1',
    real_name: '访客一',
    email: 'v1@test.com',
    role: 'viewer',
    is_active: true,
  };

  const adminUser = {
    id: 20,
    username: 'admin1',
    real_name: '管理员一',
    email: 'a1@test.com',
    role: 'admin',
    is_active: true,
  };

  const superAdminUser = {
    id: 30,
    username: 'superadmin',
    real_name: '超管',
    email: 'sa@test.com',
    role: 'super_admin',
    is_active: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.users.findUnique.mockResolvedValue({ ...viewerUser });
    mockPrisma.users.delete.mockResolvedValue({});
  });

  it('删除普通用户 → 成功', async () => {
    const req = mockReq({
      params: { id: '10' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await deleteUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.users.delete).toHaveBeenCalledWith({ where: { id: 10 } });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '删除成功' })
    );
  });

  it('自我删除 → blocked', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({
      id: 1,
      username: 'me',
      role: 'super_admin',
      is_active: true,
    });

    const req = mockReq({
      params: { id: '1' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await deleteUser(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain('不能删除自己');
  });

  it('删除 super_admin → 403 forbidden', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({ ...superAdminUser });

    const req = mockReq({
      params: { id: '30' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await deleteUser(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain('不能删除超级管理员账户');
  });

  it('admin 删除 viewer → 成功', async () => {
    const req = mockReq({
      params: { id: '10' },
      user: { id: 2, role: 'admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await deleteUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('admin 删除 admin → 403 forbidden', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({ ...adminUser });

    const req = mockReq({
      params: { id: '20' },
      user: { id: 2, role: 'admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await deleteUser(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain('权限不足');
  });

  it('删除不存在的用户 → 404', async () => {
    mockPrisma.users.findUnique.mockResolvedValue(null);

    const req = mockReq({
      params: { id: '999' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await deleteUser(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(404);
    expect(error.message).toContain('用户不存在');
  });

  it('删除后清除认证缓存 (invalidateUserStatusCache)', async () => {
    const req = mockReq({
      params: { id: '10' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await deleteUser(req, res, next);

    expect(invalidateUserStatusCache).toHaveBeenCalledWith(10);
  });

  it('删除成功后记录审计日志', async () => {
    const req = mockReq({
      params: { id: '10' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await deleteUser(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        module: 'user',
        result: 'success',
        userId: 1,
      })
    );
  });
});

// ════════════════════════════════════════════════
// resetUserPassword
// ════════════════════════════════════════════════
describe('resetUserPassword', () => {
  const viewerUser = {
    id: 10,
    username: 'viewer1',
    real_name: '访客一',
    email: 'v1@test.com',
    role: 'viewer',
    is_active: true,
  };

  const adminUser = {
    id: 20,
    username: 'admin1',
    real_name: '管理员一',
    email: 'a1@test.com',
    role: 'admin',
    is_active: true,
  };

  const superAdminUser = {
    id: 30,
    username: 'superadmin',
    real_name: '超管',
    email: 'sa@test.com',
    role: 'super_admin',
    is_active: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.users.findUnique.mockResolvedValue({ ...viewerUser });
    mockPrisma.users.update.mockResolvedValue({});
  });

  it('super_admin 重置 viewer 密码 → 成功，密码被哈希且置 must_change_password=true', async () => {
    const req = mockReq({
      params: { id: '10' },
      body: { new_password: 'NewPass@123' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await resetUserPassword(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(bcrypt.hash).toHaveBeenCalledWith('NewPass@123', 10);
    expect(mockPrisma.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: expect.objectContaining({
          password: 'hashed-password-123',
          must_change_password: true,
        }),
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: '密码重置成功，该用户其他设备已被强制下线，下次登录须修改密码',
      })
    );
  });

  it('admin 重置 viewer 密码 → 成功', async () => {
    const req = mockReq({
      params: { id: '10' },
      body: { new_password: 'NewPass@123' },
      user: { id: 2, role: 'admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await resetUserPassword(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('重置自己的密码 → 403 blocked', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({
      id: 1,
      username: 'me',
      role: 'super_admin',
      is_active: true,
    });

    const req = mockReq({
      params: { id: '1' },
      body: { new_password: 'NewPass@123' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await resetUserPassword(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain('不能重置自己的密码');
  });

  it('重置 super_admin 密码 → 403 forbidden', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({ ...superAdminUser });

    const req = mockReq({
      params: { id: '30' },
      body: { new_password: 'NewPass@123' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await resetUserPassword(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain('不能重置超级管理员账户的密码');
  });

  it('admin 重置 admin 密码 → 403 forbidden', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({ ...adminUser });

    const req = mockReq({
      params: { id: '20' },
      body: { new_password: 'NewPass@123' },
      user: { id: 2, role: 'admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await resetUserPassword(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain('权限不足');
  });

  it('重置不存在的用户 → 404', async () => {
    mockPrisma.users.findUnique.mockResolvedValue(null);

    const req = mockReq({
      params: { id: '999' },
      body: { new_password: 'NewPass@123' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await resetUserPassword(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(404);
    expect(error.message).toContain('用户不存在');
  });

  it('重置成功后记录审计日志', async () => {
    const req = mockReq({
      params: { id: '10' },
      body: { new_password: 'NewPass@123' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await resetUserPassword(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        module: 'user',
        result: 'success',
        userId: 1,
      })
    );
  });
});

// ════════════════════════════════════════════
// listUsers（审计修复：keyword 服务端过滤）
// ════════════════════════════════════════════
describe('listUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.users.findMany.mockResolvedValue([]);
    mockPrisma.users.count.mockResolvedValue(0);
  });

  it('keyword 传入时 where.OR 对用户名/姓名/邮箱做 contains 过滤', async () => {
    const req = mockReq({
      query: { page: '1', page_size: '20', keyword: ' 张三 ' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await listUsers(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const expectedWhere = {
      OR: [
        { username: { contains: '张三' } },
        { real_name: { contains: '张三' } },
        { email: { contains: '张三' } },
      ],
    };
    expect(mockPrisma.users.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere })
    );
    // count 与 findMany 使用同一 where，保证分页 total 与过滤结果一致
    expect(mockPrisma.users.count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('keyword 为空白时不追加 OR 条件', async () => {
    const req = mockReq({
      query: { keyword: '   ' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await listUsers(req, res, next);

    const where = mockPrisma.users.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
  });

  it('admin 角色限定 role=viewer 且与 keyword 过滤共存', async () => {
    const req = mockReq({
      query: { keyword: 'test' },
      user: { id: 2, role: 'admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await listUsers(req, res, next);

    const where = mockPrisma.users.findMany.mock.calls[0][0].where;
    expect(where.role).toBe('viewer');
    expect(where.OR).toEqual([
      { username: { contains: 'test' } },
      { real_name: { contains: 'test' } },
      { email: { contains: 'test' } },
    ]);
  });

  it('返回分页结构 items/total/page/pageSize', async () => {
    const rows = [{ id: 1, username: 'u1' }];
    mockPrisma.users.findMany.mockResolvedValue(rows);
    mockPrisma.users.count.mockResolvedValue(35);
    const req = mockReq({
      query: { page: '2', page_size: '20' },
      user: { id: 1, role: 'super_admin' },
    });
    const res = mockRes();
    const next = vi.fn();

    await listUsers(req, res, next);

    expect(mockPrisma.users.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: { items: rows, total: 35, page: 2, pageSize: 20 },
      })
    );
  });
});
