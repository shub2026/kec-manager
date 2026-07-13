/**
 * updateSettings 控制器单元测试
 *
 * 覆盖场景：
 * - 更新合法设置项 → 成功
 * - 更新非法设置项（不在白名单中）→ 400
 * - 更新 current_semester 格式正确 → 成功
 * - 更新 current_semester 格式错误 → 400
 * - 更新 current_semester 为空字符串 → 400
 * - Upsert 行为（创建或更新）
 * - 缓存失效（invalidateSemesterCache + invalidateDurationCache）
 * - 事务包装（$transaction）
 * - 异常时调用 next 并记录失败审计日志
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockTx = {
  system_settings: {
    upsert: vi.fn().mockResolvedValue({}),
  },
};

const mockPrisma = {
  $transaction: vi.fn(async (fn) => fn(mockTx)),
  system_settings: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖服务
// ──────────────────────────────────────────────
const mockCreateAuditLog = vi.fn().mockResolvedValue({});
vi.mock('../../services/audit.service.js', () => ({
  createAuditLog: (...args) => mockCreateAuditLog(...args),
}));

vi.mock('../../services/auth.service.js', () => ({
  AuthService: {
    verifyToken: vi.fn(),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockInvalidateDurationCache = vi.fn();
vi.mock('../../services/class.service.js', () => ({
  invalidateDurationCache: mockInvalidateDurationCache,
}));

const mockParseSemesterString = vi.fn();
const mockInvalidateSemesterCache = vi.fn();
vi.mock('../../services/settings.service.js', () => ({
  parseSemesterString: mockParseSemesterString,
  invalidateSemesterCache: mockInvalidateSemesterCache,
}));

// ──────────────────────────────────────────────
// Mock constants — 使用固定默认值
// ──────────────────────────────────────────────
vi.mock('../../constants/index.js', () => ({
  DEFAULT_SEMESTER: '2025-2026-2',
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { updateSettings } = await import('../settings.controller.js');

// ──────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────
function makeReq(body = {}, overrides = {}) {
  return {
    body,
    user: { id: 1 },
    ip: '127.0.0.1',
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
describe('updateSettings — 更新系统设置', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockTx));
    mockTx.system_settings.upsert.mockResolvedValue({});
    mockCreateAuditLog.mockResolvedValue({});
    mockInvalidateDurationCache.mockClear();
    mockInvalidateSemesterCache.mockClear();
  });

  // ──────────────────────────────────────────────
  // 1. 更新合法设置项 → 成功
  // ──────────────────────────────────────────────
  it('更新 organization_name 应成功', async () => {
    const req = makeReq({ organization_name: '教务管理系统' });
    const res = makeRes();
    const next = vi.fn();

    await updateSettings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.body).toBeDefined();
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('设置已更新');
  });

  // ──────────────────────────────────────────────
  // 2. 更新非法设置项 → 400
  // ──────────────────────────────────────────────
  it('更新不在白名单中的设置项应返回 400', async () => {
    const req = makeReq({ invalid_key: 'some_value' });
    const res = makeRes();
    const next = vi.fn();

    await updateSettings(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('不允许的设置项');
    expect(res.body.message).toContain('invalid_key');
    expect(next).not.toHaveBeenCalled();
  });

  it('混合合法和非法设置项时应返回 400', async () => {
    const req = makeReq({ organization_name: '正常', hack_key: '恶意' });
    const res = makeRes();
    const next = vi.fn();

    await updateSettings(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('hack_key');
    expect(next).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // 2b. allow_historical_edit 开关（今日新增）
  // ──────────────────────────────────────────────
  it('更新 allow_historical_edit=true 应成功（白名单已注册该 key）', async () => {
    const req = makeReq({ allow_historical_edit: 'true' });
    const res = makeRes();
    const next = vi.fn();

    await updateSettings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    // 白名单校验通过后应持久化该 key
    expect(mockTx.system_settings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'allow_historical_edit' },
        update: { value: 'true' },
        create: expect.objectContaining({ key: 'allow_historical_edit', value: 'true' }),
      })
    );
  });

  it('更新 allow_historical_edit=false 也应被接受', async () => {
    const req = makeReq({ allow_historical_edit: 'false' });
    const res = makeRes();
    const next = vi.fn();

    await updateSettings(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockTx.system_settings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'allow_historical_edit' },
        update: { value: 'false' },
      })
    );
  });

  // ──────────────────────────────────────────────
  // 3. current_semester 格式正确 → 成功
  // ──────────────────────────────────────────────
  it('current_semester 格式正确应成功更新', async () => {
    mockParseSemesterString.mockReturnValue({
      success: true,
      data: { startYear: 2025, endYear: 2026, semesterIndex: 1 },
    });

    const req = makeReq({ current_semester: '2025-2026-1' });
    const res = makeRes();
    const next = vi.fn();

    await updateSettings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.body.success).toBe(true);
    expect(mockParseSemesterString).toHaveBeenCalledWith('2025-2026-1');
  });

  // ──────────────────────────────────────────────
  // 4. current_semester 格式错误 → 400
  // ──────────────────────────────────────────────
  it('current_semester 格式错误应返回 400', async () => {
    mockParseSemesterString.mockReturnValue({
      success: false,
      error: '学期格式错误',
    });

    const req = makeReq({ current_semester: '2025-2027-3' });
    const res = makeRes();
    const next = vi.fn();

    await updateSettings(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('格式错误');
    expect(next).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // 5. current_semester 为空字符串 → 400
  // ──────────────────────────────────────────────
  it('current_semester 为空字符串应返回 400', async () => {
    const req = makeReq({ current_semester: '' });
    const res = makeRes();
    const next = vi.fn();

    await updateSettings(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('不能为空');
    expect(next).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // 6. Upsert 行为
  // ──────────────────────────────────────────────
  it('应对每个设置项执行 upsert（创建或更新）', async () => {
    const req = makeReq({
      current_semester: '2025-2026-1',
      organization_name: '新名称',
    });
    mockParseSemesterString.mockReturnValue({ success: true, data: {} });
    const res = makeRes();
    const next = vi.fn();

    await updateSettings(req, res, next);

    expect(mockTx.system_settings.upsert).toHaveBeenCalledTimes(2);

    // 验证 upsert 调用参数结构
    const calls = mockTx.system_settings.upsert.mock.calls;
    const keys = calls.map((c) => c[0].where.key);
    expect(keys).toContain('current_semester');
    expect(keys).toContain('organization_name');
  });

  // ──────────────────────────────────────────────
  // 7. 缓存失效
  // ──────────────────────────────────────────────
  it('更新成功后应调用缓存失效', async () => {
    const req = makeReq({ organization_name: '新名称' });
    const res = makeRes();
    const next = vi.fn();

    await updateSettings(req, res, next);

    expect(mockInvalidateSemesterCache).toHaveBeenCalled();
    expect(mockInvalidateDurationCache).toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // 8. 事务包装
  // ──────────────────────────────────────────────
  it('应在 $transaction 中执行 upsert', async () => {
    const req = makeReq({ organization_name: '事务测试' });
    const res = makeRes();
    const next = vi.fn();

    await updateSettings(req, res, next);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    const txArg = mockPrisma.$transaction.mock.calls[0][0];
    expect(typeof txArg).toBe('function');
  });

  // ──────────────────────────────────────────────
  // 9. 审计日志
  // ──────────────────────────────────────────────
  it('成功时应记录成功审计日志', async () => {
    const req = makeReq({ organization_name: '审计测试' });
    const res = makeRes();
    const next = vi.fn();

    await updateSettings(req, res, next);

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        module: 'system',
        userId: 1,
        result: 'success',
        details: expect.objectContaining({
          keys: ['organization_name'],
        }),
      })
    );
  });

  // ──────────────────────────────────────────────
  // 10. 异常时调用 next 并记录失败审计
  // ──────────────────────────────────────────────
  it('事务内出错应调用 next 并记录失败审计日志', async () => {
    mockPrisma.$transaction.mockImplementation(async () => {
      throw new Error('数据库连接失败');
    });

    const req = makeReq({ organization_name: '失败测试' });
    const res = makeRes();
    const next = vi.fn();

    await updateSettings(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error.message).toBe('数据库连接失败');

    // 成功响应不应被调用
    expect(res.body).toBeNull();

    // 失败审计日志应被记录
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        module: 'system',
        result: 'failed',
        message: expect.stringContaining('更新系统设置失败'),
      })
    );
  });

  // ──────────────────────────────────────────────
  // 11. current_semester 为 null 时不触发校验
  // ──────────────────────────────────────────────
  it('current_semester 为 null 时应跳过格式校验', async () => {
    const req = makeReq({ organization_name: '仅更新名称' });
    const res = makeRes();
    const next = vi.fn();

    await updateSettings(req, res, next);

    expect(mockParseSemesterString).not.toHaveBeenCalled();
    expect(res.body.success).toBe(true);
  });
});
