/**
 * auth.service.js 单元测试
 *
 * 策略：直接 mock auth.config.js，避免依赖 .env 文件
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// ──────────────────────────────────────────────
// Mock auth.config（提供固定测试密钥，不依赖 .env）
// ──────────────────────────────────────────────
const TEST_SECRET = 'test-jwt-secret';
const TEST_REFRESH_SECRET = 'test-refresh-secret';
const TEST_DOWNLOAD_SECRET = 'test-download-secret';

vi.mock('../config/auth.config.js', () => ({
  authConfig: {
    jwtSecret: 'test-jwt-secret',
    jwtRefreshSecret: 'test-refresh-secret',
    jwtDownloadSecret: 'test-download-secret',
    jwtExpiresIn: '1h',
    jwtRefreshExpiresIn: '7d',
    jwtDownloadExpiresIn: '60s',
    bcryptRounds: 10,
  },
}));

// ──────────────────────────────────────────────
// Mock prisma client
// ──────────────────────────────────────────────
const mockPrismaUsers = {
  findUnique: vi.fn(),
  update: vi.fn(),
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    users: mockPrismaUsers,
  },
}));

// ──────────────────────────────────────────────
// Mock audit.service
// ──────────────────────────────────────────────
const mockCreateAuditLog = vi.fn();
vi.mock('../audit.service.js', () => ({
  createAuditLog: mockCreateAuditLog,
}));

// ──────────────────────────────────────────────
// Mock error util
// ──────────────────────────────────────────────
vi.mock('../utils/error.js', () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(msg) { super(msg); this.name = 'AuthenticationError'; }
  },
  ValidationError: class ValidationError extends Error {
    constructor(msg) { super(msg); this.name = 'ValidationError'; }
  },
}));

// ──────────────────────────────────────────────
// Mock logger（避免 winston 在测试时输出）
// ──────────────────────────────────────────────
vi.mock('../utils/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ──────────────────────────────────────────────
// 动态 import（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const { AuthService } = await import('../auth.service.js');

// ──────────────────────────────────────────────
// verifyToken / generateToken
// ──────────────────────────────────────────────
describe('AuthService.verifyToken', () => {
  it('应正确验证合法 token 并返回 payload', () => {
    const token = jwt.sign(
      { id: 1, username: 'admin', role: 'super_admin' },
      TEST_SECRET,
      { expiresIn: '1h' }
    );
    const result = AuthService.verifyToken(token);
    expect(result.id).toBe(1);
    expect(result.username).toBe('admin');
  });

  it('过期或非法 token 应返回 null', () => {
    expect(AuthService.verifyToken('invalid-token')).toBeNull();
    expect(AuthService.verifyToken('')).toBeNull();
    expect(AuthService.verifyToken(null)).toBeNull();
  });
});

// ──────────────────────────────────────────────
// generateToken / generateRefreshToken / generateDownloadToken
// ──────────────────────────────────────────────
describe('AuthService token generation', () => {
  it('generateToken 应生成用 jwtSecret 签名的 token', () => {
    const user = { id: 1, username: 'admin', role: 'super_admin' };
    const token = AuthService.generateToken(user);
    const decoded = jwt.verify(token, TEST_SECRET);
    expect(decoded.id).toBe(1);
    expect(decoded.username).toBe('admin');
  });

  it('generateRefreshToken 应设置 type=refresh', () => {
    const user = { id: 1, username: 'admin', role: 'super_admin' };
    const token = AuthService.generateRefreshToken(user);
    const decoded = jwt.verify(token, TEST_REFRESH_SECRET);
    expect(decoded.type).toBe('refresh');
    expect(decoded.id).toBe(1);
  });

  it('verifyDownloadToken 用独立 downloadSecret 验证', () => {
    const user = { id: 1, username: 'admin', role: 'super_admin' };
    const token = AuthService.generateDownloadToken(user);
    const decoded = AuthService.verifyDownloadToken(token);
    expect(decoded.id).toBe(1);

    // 用 jwtSecret 验证 downloadToken 应失败（独立密钥）
    expect(() => jwt.verify(token, TEST_SECRET)).toThrow();
  });
});

// ──────────────────────────────────────────────
// login
// ──────────────────────────────────────────────
describe('AuthService.login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ip = '127.0.0.1';

  it('用户不存在时应抛 AuthenticationError', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue(null);

    await expect(AuthService.login('nouser', 'pass', ip)).rejects.toThrow('用户名或密码错误');
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'login', result: 'failed' })
    );
  });

  it('密码错误时应抛 AuthenticationError', async () => {
    const hashed = await bcrypt.hash('rightpass', 10);
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password: hashed,
      is_active: true,
      role: 'super_admin',
    });

    await expect(AuthService.login('admin', 'wrongpass', ip)).rejects.toThrow('用户名或密码错误');
  });

  it('账号被禁用时应抛 AuthenticationError', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password: await bcrypt.hash('pass', 10),
      is_active: false,
      role: 'super_admin',
    });

    await expect(AuthService.login('admin', 'pass', ip)).rejects.toThrow('账号已被禁用');
  });

  it('合法凭证应返回 token + refreshToken + user 信息', async () => {
    const password = await bcrypt.hash('pass', 10);
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password,
      is_active: true,
      role: 'super_admin',
      real_name: 'Admin',
      email: 'a@b.com',
    });
    mockPrismaUsers.update.mockResolvedValue({});

    const result = await AuthService.login('admin', 'pass', ip);
    expect(result.user.username).toBe('admin');
    expect(result.token).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(mockPrismaUsers.update).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────
// refreshToken
// ──────────────────────────────────────────────
describe('AuthService.refreshToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('合法 refreshToken 应返回新 token 对', async () => {
    const user = { id: 1, username: 'admin', role: 'super_admin', is_active: true };
    const refreshToken = AuthService.generateRefreshToken(user);
    mockPrismaUsers.findUnique.mockResolvedValue(user);

    const result = await AuthService.refreshToken(refreshToken);
    expect(result.token).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

    it('type 不为 refresh 的 token 应抛 AuthenticationError', async () => {
      const accessToken = AuthService.generateToken({ id: 1, username: 'admin', role: 'super_admin' });
      // generateToken 生成的 token 用 jwtSecret 签名，refreshToken 验证用 jwtRefreshSecret
      // 所以 jwt.verify 会失败，进入 catch，抛 'Refresh Token已过期或无效'
      await expect(AuthService.refreshToken(accessToken)).rejects.toThrow('Refresh Token已过期或无效');
    });

  it('用户不存在或已禁用时应抛 AuthenticationError', async () => {
    const user = { id: 1, username: 'admin', role: 'super_admin', is_active: true };
    const refreshToken = AuthService.generateRefreshToken(user);

    mockPrismaUsers.findUnique.mockResolvedValue(null);
    await expect(AuthService.refreshToken(refreshToken)).rejects.toThrow('用户不存在或已被禁用');

    mockPrismaUsers.findUnique.mockResolvedValue({ ...user, is_active: false });
    await expect(AuthService.refreshToken(refreshToken)).rejects.toThrow('用户不存在或已被禁用');
  });
});

// ──────────────────────────────────────────────
// changePassword
// ──────────────────────────────────────────────
describe('AuthService.changePassword', () => {
  beforeEach(() => vi.clearAllMocks());

  const ip = '127.0.0.1';

  it('原密码错误时应抛 AuthenticationError', async () => {
    const hashed = await bcrypt.hash('oldpass', 10);
    mockPrismaUsers.findUnique.mockResolvedValue({ id: 1, password: hashed });

    await expect(AuthService.changePassword(1, 'wrongold', 'newpass', ip)).rejects.toThrow('原密码错误');
  });

  it('合法请求应成功修改密码', async () => {
    const oldHashed = await bcrypt.hash('oldpass', 10);
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password: oldHashed,
    });
    mockPrismaUsers.update.mockResolvedValue({});

    const result = await AuthService.changePassword(1, 'oldpass', 'newpass', ip);
    expect(result.message).toBe('密码修改成功');
    expect(mockPrismaUsers.update).toHaveBeenCalled();

    // 验证新密码已加密
    const updateCall = mockPrismaUsers.update.mock.calls[0][0];
    const newHashed = updateCall.data.password;
    expect(newHashed).not.toBe('newpass');
    expect(await bcrypt.compare('newpass', newHashed)).toBe(true);
  });
});
