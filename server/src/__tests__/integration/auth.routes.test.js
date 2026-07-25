/**
 * 认证路由 API 集成测试
 *
 * 使用 supertest 对 Express app 做端到端 HTTP 测试，
 * 覆盖路由 → 中间件（命名转换/XSS/验证/认证）→ 控制器 → 服务 → 错误处理 完整链路。
 *
 * Mock 策略：mock prisma 和 audit.service，隔离数据库依赖，
 *           保留真实中间件链（helmet/cors/naming/xss/validation/auth/error）。
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// ──────────────────────────────────────────────
// 审计修复：在所有模块加载前设置环境变量，确保 auth.config.js 使用可预测的密钥
// ──────────────────────────────────────────────
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-entropy-check';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-for-check';
process.env.JWT_DOWNLOAD_SECRET = 'test-download-secret-that-is-long-enough-for-check';

// ──────────────────────────────────────────────
// Mock prisma client
// ──────────────────────────────────────────────
const mockPrismaUsers = {
  findUnique: vi.fn(),
  update: vi.fn(),
};
const mockPrismaAuditLogs = {
  create: vi.fn(),
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    users: mockPrismaUsers,
    audit_logs: mockPrismaAuditLogs,
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
  },
}));

// ──────────────────────────────────────────────
// Mock logger（避免 winston 输出干扰测试）
// ──────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ──────────────────────────────────────────────
// 导入 app（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const app = (await import('../../app.js')).default;

// 导入缓存清理函数（auth middleware 有 30s TTL 缓存，需在测试间清理）
const { invalidateUserStatusCache } = await import('../../middleware/auth.middleware.js');

// ──────────────────────────────────────────────
// 测试数据
// ──────────────────────────────────────────────
const TEST_SECRET = 'test-jwt-secret-that-is-long-enough-for-entropy-check';
const TEST_USER = {
  id: 1,
  username: 'admin',
  role: 'super_admin',
  is_active: true,
  real_name: '管理员',
  email: 'admin@test.com',
};

// 全局 beforeEach：清理 mock 和 auth middleware 缓存
beforeEach(() => {
  vi.clearAllMocks();
  invalidateUserStatusCache(1);
  mockPrismaUsers.update.mockResolvedValue({});
  mockPrismaAuditLogs.create.mockResolvedValue({});
});

function makeToken(user = TEST_USER) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role, v: 0 }, TEST_SECRET, {
    expiresIn: '1h',
  });
}

// 导入 CSRF 签名工具（H-5修复后，token 必须带有效 HMAC 签名）
const { generateSignedCsrfToken } = await import('../../utils/csrf.js');
const CSRF_TOKEN = generateSignedCsrfToken();
function withCsrf(req) {
  return req.set('Cookie', `XSRF-TOKEN=${CSRF_TOKEN}`).set('X-CSRF-Token', CSRF_TOKEN);
}

// ════════════════════════════════════════════════
// 健康检查
// ════════════════════════════════════════════════
describe('GET /api/health', () => {
  it('应返回 200 和 ok 状态', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
  });
});

// ════════════════════════════════════════════════
// POST /api/auth/login
// ════════════════════════════════════════════════
describe('POST /api/auth/login', () => {
  it('合法凭证应返回 200 和 token', async () => {
    const password = await bcrypt.hash('Admin@123456', 10);
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password,
      is_active: true,
      role: 'super_admin',
      real_name: '管理员',
      email: 'admin@test.com',
    });

    const res = await withCsrf(request(app).post('/api/auth/login')).send({
      username: 'admin',
      password: 'Admin@123456',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.user.username).toBe('admin');
  });

  it('用户不存在应返回认证错误', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue(null);

    const res = await withCsrf(request(app).post('/api/auth/login')).send({
      username: 'nouser',
      password: 'Admin@123456',
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('用户名或密码错误');
  });

  it('密码错误应返回认证错误', async () => {
    const password = await bcrypt.hash('correctpass', 10);
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password,
      is_active: true,
      role: 'super_admin',
    });

    const res = await withCsrf(request(app).post('/api/auth/login')).send({
      username: 'admin',
      password: 'wrongpass123',
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('用户名或密码错误');
  });

  it('账号禁用应返回认证错误', async () => {
    const password = await bcrypt.hash('Admin@123456', 10);
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password,
      is_active: false,
      role: 'super_admin',
    });

    const res = await withCsrf(request(app).post('/api/auth/login')).send({
      username: 'admin',
      password: 'Admin@123456',
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('禁用');
  });

  it('密码过短应返回 422 验证错误', async () => {
    const res = await withCsrf(request(app).post('/api/auth/login')).send({
      username: 'pwtest',
      password: '123',
    });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.data.code).toBe('VALIDATION_ERROR');
  });

  it('用户名缺失应返回 422 验证错误', async () => {
    const res = await withCsrf(request(app).post('/api/auth/login')).send({ password: '12345678' });

    expect(res.status).toBe(422);
  });

  it('空 body 应返回 422 验证错误', async () => {
    const res = await withCsrf(request(app).post('/api/auth/login')).send({});

    expect(res.status).toBe(422);
  });
});

// ════════════════════════════════════════════════
// POST /api/auth/refresh
// ════════════════════════════════════════════════
describe('POST /api/auth/refresh', () => {
  it('合法 refreshToken 应返回新 token 对', async () => {
    const refreshToken = jwt.sign(
      { id: 1, username: 'admin', role: 'super_admin', type: 'refresh' },
      'test-refresh-secret-that-is-long-enough-for-check',
      { expiresIn: '7d' }
    );
    mockPrismaUsers.findUnique.mockResolvedValue(TEST_USER);

    const res = await withCsrf(request(app).post('/api/auth/refresh')).send({
      refresh_token: refreshToken,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
  });

  it('无效 refreshToken 应返回 401', async () => {
    const res = await withCsrf(request(app).post('/api/auth/refresh')).send({
      refresh_token: 'invalid-token',
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('缺失 refresh_token 应返回验证错误', async () => {
    const res = await withCsrf(request(app).post('/api/auth/refresh')).send({});

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });
});

// ════════════════════════════════════════════════
// GET /api/auth/me（需认证）
// ════════════════════════════════════════════════
describe('GET /api/auth/me', () => {
  it('无 token 应返回 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('无效 token 应返回 401', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer invalid-token');

    expect(res.status).toBe(401);
  });

  it('合法 token 应返回当前用户信息', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'super_admin',
      is_active: true,
      must_change_password: false,
      token_version: 0,
      real_name: '管理员',
      email: 'admin@test.com',
      last_login_at: null,
      created_at: new Date(),
    });

    const token = makeToken();
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.username).toBe('admin');
    // 响应应经过 snakeToCamel 转换（last_login_at → lastLoginAt）
    expect(res.body.data.lastLoginAt).toBeDefined();
  });
});

// ════════════════════════════════════════════════
// PUT /api/auth/password（需认证 + 验证）
// ════════════════════════════════════════════════
describe('PUT /api/auth/password', () => {
  it('无 token 应返回 401', async () => {
    const res = await withCsrf(request(app).put('/api/auth/password')).send({
      old_password: 'OldPass1!',
      new_password: 'NewPass1!',
    });

    expect(res.status).toBe(401);
  });

  it('新密码不符合正则应返回 422', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      role: 'super_admin',
      is_active: true,
      must_change_password: false,
      token_version: 0,
    });
    const token = makeToken();
    const res = await withCsrf(request(app).put('/api/auth/password'))
      .set('Authorization', `Bearer ${token}`)
      .send({
        old_password: 'OldPass1!',
        new_password: 'weakpassword',
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('原密码错误应返回认证错误', async () => {
    const oldHashed = await bcrypt.hash('OldPass1!', 10);
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password: oldHashed,
      is_active: true,
      role: 'super_admin',
      must_change_password: false,
      token_version: 0,
    });

    const token = makeToken();
    const res = await withCsrf(request(app).put('/api/auth/password'))
      .set('Authorization', `Bearer ${token}`)
      .send({
        old_password: 'WrongPass1!',
        new_password: 'NewPass1!',
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('原密码错误');
  });

  it('合法请求应成功修改密码', async () => {
    const oldHashed = await bcrypt.hash('OldPass1!', 10);
    mockPrismaUsers.findUnique.mockResolvedValue({
      id: 1,
      username: 'admin',
      password: oldHashed,
      is_active: true,
      role: 'super_admin',
      must_change_password: false,
      token_version: 0,
    });
    mockPrismaUsers.update.mockResolvedValue({});

    const token = makeToken();
    const res = await withCsrf(request(app).put('/api/auth/password'))
      .set('Authorization', `Bearer ${token}`)
      .send({
        old_password: 'OldPass1!',
        new_password: 'NewPass1!',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('密码修改成功');

    // 验证新密码已加密（不是明文）
    const updateCall = mockPrismaUsers.update.mock.calls[0][0];
    const newHashed = updateCall.data.password;
    expect(newHashed).not.toBe('NewPass1!');
    expect(await bcrypt.compare('NewPass1!', newHashed)).toBe(true);
  });
});

// ════════════════════════════════════════════════
// POST /api/auth/logout
// ════════════════════════════════════════════════
describe('POST /api/auth/logout', () => {
  it('应返回 200 登出成功', async () => {
    const token = makeToken();
    const res = await withCsrf(request(app).post('/api/auth/logout')).set(
      'Authorization',
      `Bearer ${token}`
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('登出成功');
  });

  it('无 token 也应返回 200（logout 不强制认证）', async () => {
    const res = await withCsrf(request(app).post('/api/auth/logout'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ════════════════════════════════════════════════
// 未认证路由保护
// ════════════════════════════════════════════════
describe('认证保护', () => {
  it('GET /api/users 无 token 应返回 401', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('GET /api/teachers 无 token 应返回 401', async () => {
    const res = await request(app).get('/api/teachers');
    expect(res.status).toBe(401);
  });

  it('GET /api/dashboard 无 token 应返回 401', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
  });

  it('GET /api/audit 无 token 应返回 401', async () => {
    const res = await request(app).get('/api/audit');
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════
// SEC-H2: 首次登录强制改密流程（端到端）
// ════════════════════════════════════════════════
describe('SEC-H2: 首次登录强制改密', () => {
  const FORCE_USER = {
    id: 1,
    username: 'newuser',
    role: 'admin',
    real_name: '新用户',
    email: 'new@test.com',
    is_active: true,
    must_change_password: true,
    token_version: 0,
  };

  it('登录 must_change_password=true 的用户应成功登录并标记强制改密', async () => {
    const password = await bcrypt.hash('Initial@123', 10);
    mockPrismaUsers.findUnique.mockResolvedValue({
      ...FORCE_USER,
      password,
    });

    const res = await withCsrf(request(app).post('/api/auth/login')).send({
      username: 'newuser',
      password: 'Initial@123',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    // 前端依赖此字段弹出强制改密对话框
    expect(res.body.data.user.mustChangePassword).toBe(true);
  });

  it('must_change_password=true 用户访问 GET /api/auth/me 应放行（白名单）', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue(FORCE_USER);
    const token = makeToken({ ...FORCE_USER });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.username).toBe('newuser');
  });

  it('must_change_password=true 用户访问 PUT /api/auth/password 应放行（白名单）', async () => {
    const oldHashed = await bcrypt.hash('Initial@123', 10);
    mockPrismaUsers.findUnique.mockResolvedValue({
      ...FORCE_USER,
      password: oldHashed,
    });
    mockPrismaUsers.update.mockResolvedValue({});

    const token = makeToken({ ...FORCE_USER });
    const res = await withCsrf(request(app).put('/api/auth/password'))
      .set('Authorization', `Bearer ${token}`)
      .send({
        old_password: 'Initial@123',
        new_password: 'NewSecure@456',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('密码修改成功');
  });

  it('must_change_password=true 用户访问 GET /api/dashboard/stats 应返回 403', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue(FORCE_USER);
    const token = makeToken({ ...FORCE_USER });

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MUST_CHANGE_PASSWORD');
    expect(res.body.message).toContain('修改初始密码');
  });

  it('must_change_password=true 用户访问 POST /api/users 应返回 403', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue(FORCE_USER);
    const token = makeToken({ ...FORCE_USER });

    const res = await withCsrf(request(app).post('/api/users'))
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'test', password: 'Test@123456' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MUST_CHANGE_PASSWORD');
  });

  it('must_change_password=true 用户访问 POST /api/auth/logout 应放行（白名单）', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue(FORCE_USER);
    const token = makeToken({ ...FORCE_USER });

    const res = await withCsrf(request(app).post('/api/auth/logout')).set(
      'Authorization',
      `Bearer ${token}`
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
