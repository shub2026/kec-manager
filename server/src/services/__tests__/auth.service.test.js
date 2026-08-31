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
  create: vi.fn(),
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
vi.mock('../../utils/logger.js', () => ({
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
const { log } = await import('../../utils/logger.js');

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

  it('账号未激活/被禁用时应抛 AuthenticationError', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password: await bcrypt.hash('pass', 10),
      is_active: false,
      role: 'super_admin',
    });

    await expect(AuthService.login('admin', 'pass', ip)).rejects.toThrow(
      '账号待激活或已被禁用，请联系管理员'
    );
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

  it('登录成功应重置失败计数与锁定状态（SEC-M4）', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password: await bcrypt.hash('pass', 10),
      is_active: true,
      role: 'super_admin',
      failed_login_count: 3,
      locked_until: null,
    });
    mockPrismaUsers.update.mockResolvedValue({});

    await AuthService.login('admin', 'pass', ip);
    const updateCall = mockPrismaUsers.update.mock.calls[0][0];
    expect(updateCall.data.failed_login_count).toBe(0);
    expect(updateCall.data.locked_until).toBeNull();
    expect(updateCall.data.last_login_at).toBeInstanceOf(Date);
  });

  it('账号处于锁定期内应拒绝登录并提示剩余分钟（SEC-M4）', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password: await bcrypt.hash('pass', 10),
      is_active: true,
      role: 'super_admin',
      locked_until: new Date(Date.now() + 5 * 60 * 1000), // 5 分钟后
    });

    await expect(AuthService.login('admin', 'pass', ip)).rejects.toThrow(/账号已锁定/);
    // 锁定期间不做密码校验，不应触发 users.update
    expect(mockPrismaUsers.update).not.toHaveBeenCalled();
  });

  it('密码错误达 5 次应锁定账号 15 分钟（SEC-M4）', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password: await bcrypt.hash('rightpass', 10),
      is_active: true,
      role: 'super_admin',
      failed_login_count: 4, // 再错一次即达阈值 5
      locked_until: null,
    });
    mockPrismaUsers.update.mockResolvedValue({});

    await expect(AuthService.login('admin', 'wrongpass', ip)).rejects.toThrow(
      '密码错误次数过多，账号已被锁定 15 分钟'
    );
    const updateCall = mockPrismaUsers.update.mock.calls[0][0];
    expect(updateCall.data.failed_login_count).toBe(5);
    expect(updateCall.data.locked_until).toBeInstanceOf(Date);
  });

  it('密码错误未达阈值仅累计失败次数，不锁定', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password: await bcrypt.hash('rightpass', 10),
      is_active: true,
      role: 'super_admin',
      failed_login_count: 1,
      locked_until: null,
    });
    mockPrismaUsers.update.mockResolvedValue({});

    await expect(AuthService.login('admin', 'wrongpass', ip)).rejects.toThrow('用户名或密码错误');
    const updateCall = mockPrismaUsers.update.mock.calls[0][0];
    expect(updateCall.data.failed_login_count).toBe(2);
    expect(updateCall.data.locked_until).toBeNull();
  });
});

// ──────────────────────────────────────────────
// register（访客自助注册）
// ──────────────────────────────────────────────
describe('AuthService.register', () => {
  beforeEach(() => vi.clearAllMocks());

  const ip = '127.0.0.1';

  it('用户名已存在时应抛 ValidationError 且不创建用户', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue({ id: 1, username: 'dup' });

    await expect(AuthService.register('dup', 'Passw0rd', '张三', null, ip)).rejects.toThrow(
      '用户名已存在'
    );
    expect(mockPrismaUsers.create).not.toHaveBeenCalled();
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', result: 'failed' })
    );
  });

  it('成功注册应创建待激活的访客账号', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue(null);
    mockPrismaUsers.create.mockResolvedValue({ id: 9, username: 'newbie' });

    const result = await AuthService.register('newbie', 'Passw0rd', '李四', 'a@b.com', ip);
    expect(result).toEqual({ id: 9, username: 'newbie' });

    const createCall = mockPrismaUsers.create.mock.calls[0][0];
    expect(createCall.data).toMatchObject({
      username: 'newbie',
      real_name: '李四',
      email: 'a@b.com',
      role: 'viewer',
      is_active: false,
      must_change_password: false,
    });
    // 密码必须哈希存储
    expect(createCall.data.password).not.toBe('Passw0rd');
    expect(await bcrypt.compare('Passw0rd', createCall.data.password)).toBe(true);

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', module: 'auth', result: 'success' })
    );
  });

  it('选填字段缺省时应落 null', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue(null);
    mockPrismaUsers.create.mockResolvedValue({ id: 10, username: 'minimal' });

    await AuthService.register('minimal', 'Passw0rd', '', '', ip);
    const createCall = mockPrismaUsers.create.mock.calls[0][0];
    expect(createCall.data.real_name).toBeNull();
    expect(createCall.data.email).toBeNull();
  });

  it('注册成功的账号未激活前应无法登录', async () => {
    const password = await bcrypt.hash('Passw0rd', 10);
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 9,
      username: 'newbie',
      password,
      is_active: false,
      role: 'viewer',
    });

    await expect(AuthService.login('newbie', 'Passw0rd', ip)).rejects.toThrow(
      '账号待激活或已被禁用，请联系管理员'
    );
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
    await expect(AuthService.refreshToken(refreshToken)).rejects.toThrow(
      '账号待激活或已被禁用，请联系管理员'
    );

    mockPrismaUsers.findUnique.mockResolvedValue({ ...user, is_active: false });
    await expect(AuthService.refreshToken(refreshToken)).rejects.toThrow(
      '账号待激活或已被禁用，请联系管理员'
    );
  });

  it('重用已加入黑名单的 refreshToken 应吊销全部会话并拒绝（SEC-M1）', async () => {
    const user = {
      id: 7,
      username: 'admin',
      role: 'super_admin',
      is_active: true,
      token_version: 0,
      must_change_password: false,
    };
    const refreshToken = AuthService.generateRefreshToken(user);
    const { jti } = jwt.verify(refreshToken, TEST_REFRESH_SECRET);

    // 模拟该 refresh token 已被登出/轮换加入黑名单
    mockTokenBlacklist.upsert.mockResolvedValue({});
    await AuthService.addToBlacklist(jti, Date.now() + 60000);

    mockPrismaUsers.update.mockResolvedValue({});
    await expect(AuthService.refreshToken(refreshToken)).rejects.toThrow(
      '检测到凭证异常，请重新登录'
    );
    // 重用检测应递增 token_version 吊销该用户全部会话
    expect(mockPrismaUsers.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { token_version: { increment: 1 } },
    });
  });

  it('token_version 不匹配应拒绝刷新（SEC-H1 密码重置后旧令牌失效）', async () => {
    // 令牌签发时 token_version=0，但库中已递增到 5（改密/吊销）
    const staleUser = { id: 1, username: 'admin', role: 'super_admin', token_version: 0 };
    const refreshToken = AuthService.generateRefreshToken(staleUser);
    mockTokenBlacklist.findUnique.mockResolvedValue(null); // 未黑名单
    mockPrismaUsers.findUnique.mockResolvedValue({
      ...staleUser,
      is_active: true,
      token_version: 5,
      must_change_password: false,
    });

    await expect(AuthService.refreshToken(refreshToken)).rejects.toThrow('凭证已失效，请重新登录');
  });

  it('强制改密期间应拒绝刷新，要求重新登录（SEC-H2）', async () => {
    const user = {
      id: 1,
      username: 'admin',
      role: 'super_admin',
      is_active: true,
      token_version: 0,
      must_change_password: true,
    };
    const refreshToken = AuthService.generateRefreshToken(user);
    mockTokenBlacklist.findUnique.mockResolvedValue(null);
    mockPrismaUsers.findUnique.mockResolvedValue(user);

    await expect(AuthService.refreshToken(refreshToken)).rejects.toThrow('请先修改初始密码');
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

  it('用户不存在时应抛 AuthenticationError', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue(null);
    await expect(AuthService.changePassword(999, 'old', 'new', ip)).rejects.toThrow('用户不存在');
  });

  it('改密成功应递增 token_version 并解除强制改密标记（SEC-H1）', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password: await bcrypt.hash('oldpass', 10),
      must_change_password: true,
      failed_login_count: 2,
    });
    mockPrismaUsers.update.mockResolvedValue({});

    await AuthService.changePassword(1, 'oldpass', 'newpass', ip);
    const updateCall = mockPrismaUsers.update.mock.calls[0][0];
    expect(updateCall.data).toMatchObject({
      must_change_password: false,
      token_version: { increment: 1 },
      failed_login_count: 0,
      locked_until: null,
    });
  });
});

// ──────────────────────────────────────────────
// 黑名单容错与降级（H2/S-03）
// ──────────────────────────────────────────────
describe('AuthService 黑名单容错降级', () => {
  beforeEach(() => vi.clearAllMocks());

  it('addToBlacklist 写库失败不阻断主流程，仅记录错误日志', async () => {
    mockTokenBlacklist.upsert.mockRejectedValue(new Error('db down'));
    await expect(AuthService.addToBlacklist('jti-w', Date.now() + 1000)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      'Token黑名单写入失败',
      expect.objectContaining({ error: 'db down' })
    );
  });

  it('isBlacklisted 内存缓存过期后回落数据库查询', async () => {
    const jti = 'jti-expired-mem';
    // 写入一条已过期的内存正缓存
    mockTokenBlacklist.upsert.mockResolvedValue({});
    await AuthService.addToBlacklist(jti, Date.now() - 1000);

    // DB 中已无记录（过期被清理）→ 返回 false 并查库
    mockTokenBlacklist.findUnique.mockResolvedValue(null);
    const result = await AuthService.isBlacklisted(jti);
    expect(result).toBe(false);
    expect(mockTokenBlacklist.findUnique).toHaveBeenCalledWith({ where: { jti } });
  });

  it('DB 查询失败且内存缓存未命中时默认拒绝（fail-close）', async () => {
    mockTokenBlacklist.findUnique.mockRejectedValue(new Error('db down'));
    const result = await AuthService.isBlacklisted('jti-unknown-state');
    expect(result).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      'Token黑名单DB查询失败，默认拒绝（fail-close策略）',
      expect.objectContaining({ jti: 'jti-unknown-state' })
    );
  });

  it('DB 查询失败但内存正缓存有效时仍判定为黑名单', async () => {
    const jti = 'jti-mem-fallback';
    mockTokenBlacklist.upsert.mockResolvedValue({});
    await AuthService.addToBlacklist(jti, Date.now() + 60000); // 内存正缓存

    mockTokenBlacklist.findUnique.mockRejectedValue(new Error('db down'));
    expect(await AuthService.isBlacklisted(jti)).toBe(true);
  });

  it('cleanExpiredBlacklist 失败时记录日志不抛出', async () => {
    mockTokenBlacklist.deleteMany.mockRejectedValue(new Error('db down'));
    await expect(AuthService.cleanExpiredBlacklist()).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      '清理过期黑名单失败',
      expect.objectContaining({ error: 'db down' })
    );
  });

  it('cleanExpiredBlacklist 无过期记录时不输出清理日志', async () => {
    mockTokenBlacklist.deleteMany.mockResolvedValue({ count: 0 });
    await AuthService.cleanExpiredBlacklist();
    expect(log.info).not.toHaveBeenCalled();
  });
});
