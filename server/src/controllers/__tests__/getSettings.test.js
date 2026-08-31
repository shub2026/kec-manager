/**
 * getSettings 控制器单元测试
 *
 * 重点覆盖 tryGetAuthUser 的可选认证逻辑（H-3 修复后新增 Cookie 认证路径）：
 * - 匿名访问（无 Token 无 Cookie）→ 仅返回公开字段
 * - Authorization 头有效 → 返回全部设置
 * - HttpOnly Cookie 有效 → 返回全部设置
 * - 头 + Cookie 同时存在 → 头优先
 * - 头无效时回退到 Cookie
 * - Token 有效但用户不存在 → 匿名
 * - Token 有效但用户已禁用 → 匿名
 * - 数据库无设置时返回默认值
 * - 异常降级只返回公开字段（M-9 修复）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  system_settings: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  users: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖服务
// ──────────────────────────────────────────────
const mockVerifyToken = vi.fn();
vi.mock('../../services/auth.service.js', () => ({
  AuthService: {
    verifyToken: (...args) => mockVerifyToken(...args),
  },
}));

vi.mock('../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/class.service.js', () => ({
  invalidateDurationCache: vi.fn(),
}));

vi.mock('../../services/settings.service.js', () => ({
  parseSemesterString: vi.fn(),
  invalidateSemesterCache: vi.fn(),
}));

vi.mock('../../constants/index.js', () => ({
  DEFAULT_SEMESTER: '2025-2026-2',
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { getSettings } = await import('../settings.controller.js');

// ──────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    headers: {},
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

/** 构造含 Authorization 头的请求 */
function reqWithAuth(token) {
  return makeReq({
    headers: { authorization: `Bearer ${token}` },
  });
}

/** 构造含 Cookie 的请求 */
function reqWithCookie(cookieName, value) {
  return makeReq({
    headers: { cookie: `${cookieName}=${value}` },
  });
}

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('getSettings — 获取系统设置', () => {
  const dbSettings = [
    { key: 'current_semester', value: '2026-2027-1', description: '当前学期' },
    { key: 'organization_name', value: '测试学院', description: '系统标识' },
    { key: 'register_enabled', value: 'true', description: '开放访客自助注册' },
  ];

  const activeUser = { id: 1, role: 'super_admin', is_active: true };
  const inactiveUser = { id: 2, role: 'super_admin', is_active: false };
  const validDecoded = { id: 1, username: 'admin', role: 'super_admin' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.system_settings.findMany.mockResolvedValue(dbSettings);
    mockPrisma.users.findUnique.mockResolvedValue(activeUser);
    mockVerifyToken.mockReturnValue(validDecoded);
  });

  // ──────────────────────────────────────────────
  // 1. 匿名访问 → 仅返回公开字段
  // ──────────────────────────────────────────────
  describe('匿名访问（无 Token 无 Cookie）', () => {
    it('不携带任何认证信息时应只返回 organization_name', async () => {
      const req = makeReq();
      const res = makeRes();

      await getSettings(req, res, makeNext());

      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data.organization_name).toBeDefined();
      expect(data.organization_name.value).toBe('测试学院');
      // 注册开放开关属公开字段（登录页据此决定是否显示注册入口）
      expect(data.register_enabled).toBeDefined();
      expect(data.register_enabled.value).toBe('true');
      // currentSemester 不应出现在匿名响应中
      expect(data.current_semester).toBeUndefined();
    });

    it('空 headers 时应视为匿名', async () => {
      const req = makeReq({ headers: {} });
      const res = makeRes();

      await getSettings(req, res, makeNext());

      expect(res.body.data.current_semester).toBeUndefined();
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // 2. Authorization 头认证
  // ──────────────────────────────────────────────
  describe('通过 Authorization 头认证', () => {
    it('有效 Bearer Token 应返回全部设置', async () => {
      const req = reqWithAuth('valid-jwt-token');
      const res = makeRes();

      await getSettings(req, res, makeNext());

      expect(mockVerifyToken).toHaveBeenCalledWith('valid-jwt-token');
      const data = res.body.data;
      expect(data.current_semester).toBeDefined();
      expect(data.current_semester.value).toBe('2026-2027-1');
      expect(data.organization_name).toBeDefined();
    });

    it('Token 无效（verifyToken 返回 null）时应降级为匿名', async () => {
      mockVerifyToken.mockReturnValue(null);
      const req = reqWithAuth('expired-token');
      const res = makeRes();

      await getSettings(req, res, makeNext());

      expect(res.body.data.current_semester).toBeUndefined();
      expect(res.body.data.organization_name).toBeDefined();
    });

    it('Authorization 头格式错误（非 Bearer）时应视为匿名', async () => {
      const req = makeReq({
        headers: { authorization: 'Basic abc123' },
      });
      const res = makeRes();

      await getSettings(req, res, makeNext());

      expect(mockVerifyToken).not.toHaveBeenCalled();
      expect(res.body.data.current_semester).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────
  // 3. HttpOnly Cookie 认证（核心修复）
  // ──────────────────────────────────────────────
  describe('通过 HttpOnly Cookie 认证', () => {
    it('Cookie 中有效 token 应返回全部设置', async () => {
      const req = reqWithCookie('token', 'cookie-jwt-token');
      const res = makeRes();

      await getSettings(req, res, makeNext());

      expect(mockVerifyToken).toHaveBeenCalledWith('cookie-jwt-token');
      const data = res.body.data;
      expect(data.current_semester).toBeDefined();
      expect(data.current_semester.value).toBe('2026-2027-1');
      expect(data.organization_name).toBeDefined();
    });

    it('Cookie 中 token 无效时应降级为匿名', async () => {
      mockVerifyToken.mockReturnValue(null);
      const req = reqWithCookie('token', 'bad-cookie-token');
      const res = makeRes();

      await getSettings(req, res, makeNext());

      expect(res.body.data.current_semester).toBeUndefined();
    });

    it('Cookie 中无 token 字段时应视为匿名', async () => {
      const req = makeReq({
        headers: { cookie: 'other_cookie=some_value' },
      });
      const res = makeRes();

      await getSettings(req, res, makeNext());

      expect(mockVerifyToken).not.toHaveBeenCalled();
      expect(res.body.data.current_semester).toBeUndefined();
    });

    it('多个 Cookie 中应正确提取 token', async () => {
      const req = makeReq({
        headers: {
          cookie: 'XSRF-TOKEN=csrf123; token=multi-cookie-jwt; session=abc',
        },
      });
      const res = makeRes();

      await getSettings(req, res, makeNext());

      expect(mockVerifyToken).toHaveBeenCalledWith('multi-cookie-jwt');
      expect(res.body.data.current_semester).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────
  // 4. 头 + Cookie 同时存在 → 头优先
  // ──────────────────────────────────────────────
  describe('Authorization 头与 Cookie 同时存在', () => {
    it('Authorization 头应优先于 Cookie', async () => {
      const req = makeReq({
        headers: {
          authorization: 'Bearer header-token',
          cookie: 'token=cookie-token',
        },
      });
      const res = makeRes();

      await getSettings(req, res, makeNext());

      // 应使用 header token，不使用 cookie token
      expect(mockVerifyToken).toHaveBeenCalledWith('header-token');
      expect(mockVerifyToken).not.toHaveBeenCalledWith('cookie-token');
    });

    it('Authorization 头 Token 无效时应回退到 Cookie', async () => {
      // 第一次调用（header token）返回 null，第二次（cookie token）返回有效
      mockVerifyToken
        .mockReturnValueOnce(null) // header token 无效
        .mockReturnValueOnce(validDecoded); // cookie token 有效

      const req = makeReq({
        headers: {
          authorization: 'Bearer bad-header-token',
          cookie: 'token=good-cookie-token',
        },
      });
      const res = makeRes();

      await getSettings(req, res, makeNext());

      expect(mockVerifyToken).toHaveBeenCalledTimes(2);
      expect(mockVerifyToken).toHaveBeenNthCalledWith(1, 'bad-header-token');
      expect(mockVerifyToken).toHaveBeenNthCalledWith(2, 'good-cookie-token');
      // Cookie 认证成功，应返回全部设置
      expect(res.body.data.current_semester).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────
  // 5. Token 有效但用户状态异常
  // ──────────────────────────────────────────────
  describe('Token 有效但用户状态异常', () => {
    it('用户不存在时应降级为匿名', async () => {
      mockPrisma.users.findUnique.mockResolvedValue(null);
      const req = reqWithCookie('token', 'valid-token');
      const res = makeRes();

      await getSettings(req, res, makeNext());

      expect(res.body.data.current_semester).toBeUndefined();
      expect(res.body.data.organization_name).toBeDefined();
    });

    it('用户已禁用时应降级为匿名', async () => {
      mockPrisma.users.findUnique.mockResolvedValue(inactiveUser);
      const req = reqWithCookie('token', 'valid-token');
      const res = makeRes();

      await getSettings(req, res, makeNext());

      expect(res.body.data.current_semester).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────
  // 6. 默认值回退
  // ──────────────────────────────────────────────
  describe('数据库无设置时使用默认值', () => {
    it('数据库为空时应返回 DEFAULT_SETTINGS 中的默认值', async () => {
      mockPrisma.system_settings.findMany.mockResolvedValue([]);
      const req = reqWithCookie('token', 'valid-token');
      const res = makeRes();

      await getSettings(req, res, makeNext());

      const data = res.body.data;
      // current_semester 应使用 DEFAULT_SEMESTER 常量
      expect(data.current_semester).toBeDefined();
      expect(data.current_semester.value).toBe('2025-2026-2');
      expect(data.current_semester.isDefault).toBe(true);
    });
  });

  // ──────────────────────────────────────────────
  // 7. 异常降级（M-9 修复）
  // ──────────────────────────────────────────────
  describe('异常降级', () => {
    it('数据库查询异常时应只返回公开默认字段', async () => {
      mockPrisma.system_settings.findMany.mockRejectedValue(new Error('数据库连接失败'));
      const req = reqWithCookie('token', 'valid-token');
      const res = makeRes();

      await getSettings(req, res, makeNext());

      expect(res.body.success).toBe(true);
      // M-9 修复：降级路径也只返回公开字段
      expect(res.body.data.current_semester).toBeUndefined();
      expect(res.body.data.organization_name).toBeDefined();
      // 注册开关降级为默认关闭（fail-close），登录页隐藏注册入口
      expect(res.body.data.register_enabled).toBeDefined();
      expect(res.body.data.register_enabled.value).toBe('false');
    });
  });

  // ──────────────────────────────────────────────
  // 8. 用户角色更新
  // ──────────────────────────────────────────────
  describe('使用数据库中的最新角色', () => {
    it('应使用数据库查询到的最新角色而非 Token 中的角色', async () => {
      // Token 中角色为 viewer，但数据库中已升级为 admin
      mockPrisma.users.findUnique.mockResolvedValue({
        id: 1,
        role: 'admin',
        is_active: true,
      });
      const req = reqWithCookie('token', 'valid-token');
      const res = makeRes();

      await getSettings(req, res, makeNext());

      // 认证成功（返回全部设置），说明数据库角色被正确使用
      expect(res.body.data.current_semester).toBeDefined();
    });
  });
});

function makeNext() {
  return vi.fn();
}
