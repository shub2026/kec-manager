/**
 * auth.service.js 单元测试
 *
 * 策略：设置环境变量 + mock auth.config.js，双重保证使用固定测试密钥
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// ──────────────────────────────────────────────
// 审计修复后必须在模块加载前设置环境变量，确保 auth.config.js 使用可预测的密钥
// ──────────────────────────────────────────────
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-entropy-check';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-for-check';
process.env.JWT_DOWNLOAD_SECRET = 'test-download-secret-that-is-long-enough-for-check';

// ──────────────────────────────────────────────
// Mock auth.config（提供固定测试密钥，不依赖 .env）
// ──────────────────────────────────────────────
const TEST_SECRET = 'test-jwt-secret-that-is-long-enough-for-entropy-check';
const TEST_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-for-check';
const TEST_DOWNLOAD_SECRET = 'test-download-secret-that-is-long-enough-for-check';

vi.mock('../config/auth.config.js', () => ({
  authConfig: {
    jwtSecret: 'test-jwt-secret-that-is-long-enough-for-entropy-check',
    jwtRefreshSecret: 'test-refresh-secret-that-is-long-enough-for-check',
    jwtDownloadSecret: 'test-download-secret-that-is-long-enough-for-check',
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

const mockTokenBlacklist = {
  upsert: vi.fn(),
  findUnique: vi.fn(),
  deleteMany: vi.fn(),
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    users: mockPrismaUsers,
    token_blacklist: mockTokenBlacklist,
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
    constructor(msg) {
      super(msg);
      this.name = 'AuthenticationError';
    }
  },
  ValidationError: class ValidationError extends Error {
    constructor(msg) {
      super(msg);
      this.name = 'ValidationError';
    }
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
    const token = jwt.sign({ id: 1, username: 'admin', role: 'super_admin' }, TEST_SECRET, {
      expiresIn: '1h',
    });
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
// generateToken / generateRefreshToken
// ──────────────────────────────────────────────
describe('AuthService token generation', () => {
  it('generateToken 应生成用 jwtSecret 签名的 token', () => {
    const user = { id: 1, username: 'admin', role: 'super_admin' };
    const token = AuthService.generateToken(user);
    const decoded = jwt.verify(token, TEST_SECRET);
    expect(decoded.id).toBe(1);
    expect(decoded.username).toBe('admin');
    // H2修复：Token应包含唯一jti
    expect(decoded.jti).toBeTruthy();
    expect(typeof decoded.jti).toBe('string');
  });

  it('generateRefreshToken 应设置 type=refresh', () => {
    const user = { id: 1, username: 'admin', role: 'super_admin' };
    const token = AuthService.generateRefreshToken(user);
    const decoded = jwt.verify(token, TEST_REFRESH_SECRET);
    expect(decoded.type).toBe('refresh');
    expect(decoded.id).toBe(1);
    // H2修复：Refresh Token也应包含唯一jti
    expect(decoded.jti).toBeTruthy();
    expect(typeof decoded.jti).toBe('string');
  });

  it('两次生成的 token 应有不同的 jti', () => {
    const user = { id: 1, username: 'admin', role: 'super_admin' };
    const token1 = AuthService.generateToken(user);
    const token2 = AuthService.generateToken(user);
    const decoded1 = jwt.verify(token1, TEST_SECRET);
    const decoded2 = jwt.verify(token2, TEST_SECRET);
    expect(decoded1.jti).not.toBe(decoded2.jti);
  });
});

// ──────────────────────────────────────────────
// Token 黑名单管理
// ──────────────────────────────────────────────
describe('AuthService Token Blacklist', () => {
  beforeEach(() => vi.clearAllMocks());

  it('addToBlacklist 应将 jti 写入数据库', async () => {
    mockTokenBlacklist.upsert.mockResolvedValue({});
    const expiresAt = Date.now() + 60000;
    await AuthService.addToBlacklist('test-jti-1', expiresAt);
    expect(mockTokenBlacklist.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jti: 'test-jti-1' },
      })
    );
  });

  it('addToBlacklist jti 为空时不应查库', async () => {
    await AuthService.addToBlacklist(null, Date.now());
    await AuthService.addToBlacklist('', Date.now());
    await AuthService.addToBlacklist(undefined, Date.now());
    expect(mockTokenBlacklist.upsert).not.toHaveBeenCalled();
  });

  it('isBlacklisted 命中黑名单时应返回 true', async () => {
    mockTokenBlacklist.findUnique.mockResolvedValue({ jti: 'blacklisted-jti' });
    const result = await AuthService.isBlacklisted('blacklisted-jti');
    expect(result).toBe(true);
  });

  it('isBlacklisted 未命中时应返回 false 并写入负缓存', async () => {
    mockTokenBlacklist.findUnique.mockResolvedValue(null);
    const result = await AuthService.isBlacklisted('clean-jti');
    expect(result).toBe(false);

    // 第二次调用应命中负缓存，不再查库
    const result2 = await AuthService.isBlacklisted('clean-jti');
    expect(result2).toBe(false);
    // findUnique 只应被调用一次（第二次走负缓存）
    expect(mockTokenBlacklist.findUnique).toHaveBeenCalledTimes(1);
  });

  it('isBlacklisted jti 为空时应返回 false', async () => {
    expect(await AuthService.isBlacklisted(null)).toBe(false);
    expect(await AuthService.isBlacklisted('')).toBe(false);
    expect(await AuthService.isBlacklisted(undefined)).toBe(false);
    expect(mockTokenBlacklist.findUnique).not.toHaveBeenCalled();
  });

  it('addToBlacklist 后应清除对应负缓存并写入内存缓存', async () => {
    // 先检查一个jti，建立负缓存
    mockTokenBlacklist.findUnique.mockResolvedValue(null);
    await AuthService.isBlacklisted('jti-to-blacklist');
    expect(mockTokenBlacklist.findUnique).toHaveBeenCalledTimes(1);

    // 将该jti加入黑名单（S-03: 同时写入内存正缓存）
    mockTokenBlacklist.upsert.mockResolvedValue({});
    await AuthService.addToBlacklist('jti-to-blacklist', Date.now() + 60000);

    // 再次检查，应从内存正缓存直接返回true（不再查库）
    const result = await AuthService.isBlacklisted('jti-to-blacklist');
    expect(result).toBe(true);
    // S-03: findUnique仍为1次，因为内存缓存命中跳过了DB查询
    expect(mockTokenBlacklist.findUnique).toHaveBeenCalledTimes(1);
  });

  it('cleanExpiredBlacklist 应删除过期记录', async () => {
    mockTokenBlacklist.deleteMany.mockResolvedValue({ count: 5 });
    await AuthService.cleanExpiredBlacklist();
    expect(mockTokenBlacklist.deleteMany).toHaveBeenCalled();
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
    const user = {
      id: 1,
      username: 'admin',
      role: 'super_admin',
      is_active: true,
      token_version: 0,
      must_change_password: false,
    };
    const refreshToken = AuthService.generateRefreshToken(user);
    mockPrismaUsers.findUnique.mockResolvedValue(user);

    const result = await AuthService.refreshToken(refreshToken);
    expect(result.token).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it('type 不为 refresh 的 token 应抛 AuthenticationError', async () => {
    const accessToken = AuthService.generateToken({
      id: 1,
      username: 'admin',
      role: 'super_admin',
    });
    // generateToken 生成的 token 用 jwtSecret 签名，refreshToken 验证用 jwtRefreshSecret
    // 所以 jwt.verify 会失败，进入 catch，抛 'Refresh Token已过期或无效'
    await expect(AuthService.refreshToken(accessToken)).rejects.toThrow(
      'Refresh Token已过期或无效'
    );
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

    await expect(AuthService.changePassword(1, 'wrongold', 'newpass', ip)).rejects.toThrow(
      '原密码错误'
    );
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
