/**
 * textbook.routes 集成测试
 *
 * 保留真实中间件链（helmet/cors/naming/xss/validation/auth/error）与真实
 * buildUpdateData，mock prisma 与 logger，验证"清空字段"缺陷修复的完整 HTTP 链路：
 * - 前端发 null 的字段最终落到 prisma.update 的 data 上为 null（旧值被清掉）
 * - express-validator 的 .trim() 把 null 归一成 '' 后，控制器再归一为 null
 * - 缺席字段不进 data（保留"不修改"语义，不得误清空）
 * - price=0 是合法值，不得被存成 null
 * - 命名中间件把 camelCase（publishDate/isActive）转成 snake_case 且不丢 null
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// ──────────────────────────────────────────────
// 在所有模块加载前设置环境变量，确保 auth.config.js 使用可预测的密钥
// ──────────────────────────────────────────────
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-entropy-check';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-for-check';
process.env.JWT_DOWNLOAD_SECRET = 'test-download-secret-that-is-long-enough-for-check';

// ──────────────────────────────────────────────
// Mock prisma client
// ──────────────────────────────────────────────
const mockPrismaUsers = { findUnique: vi.fn() };
const mockPrismaTextbooks = {
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  aggregate: vi.fn(),
};
const mockPrismaAuditLogs = { create: vi.fn() };
const mockPrismaTokenBlacklist = { findUnique: vi.fn() };

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    users: mockPrismaUsers,
    textbooks: mockPrismaTextbooks,
    audit_logs: mockPrismaAuditLogs,
    token_blacklist: mockPrismaTokenBlacklist,
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    $transaction: vi.fn((arg) =>
      Array.isArray(arg) ? Promise.all(arg) : arg({ textbooks: mockPrismaTextbooks })
    ),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入 app（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const app = (await import('../../app.js')).default;
const { invalidateUserStatusCache } = await import('../../middleware/auth.middleware.js');
const { invalidateSortOrderCache } = await import('../../utils/sort.js');

// ──────────────────────────────────────────────
// 测试数据与工具
// ──────────────────────────────────────────────
const TEST_SECRET = 'test-jwt-secret-that-is-long-enough-for-entropy-check';

const ADMIN = {
  id: 1,
  username: 'admin',
  role: 'admin',
  is_active: true,
  token_version: 0,
  must_change_password: false,
};

function makeToken(user = ADMIN) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role, v: 0 }, TEST_SECRET, {
    expiresIn: '1h',
  });
}

/** 取 prisma.textbooks.update 实际收到的 data */
function updatedData() {
  return mockPrismaTextbooks.update.mock.calls[0][0].data;
}

/** 取 prisma.textbooks.create 实际收到的 data */
function createdData() {
  return mockPrismaTextbooks.create.mock.calls[0][0].data;
}

function put(id, body) {
  return request(app)
    .put(`/api/textbooks/${id}`)
    .set('Authorization', `Bearer ${makeToken()}`)
    .send(body);
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateUserStatusCache(ADMIN.id);
  invalidateSortOrderCache('textbooks');
  mockPrismaUsers.findUnique.mockResolvedValue(ADMIN);
  mockPrismaTokenBlacklist.findUnique.mockResolvedValue(null);
  mockPrismaAuditLogs.create.mockResolvedValue({});
  mockPrismaTextbooks.findFirst.mockResolvedValue(null);
  mockPrismaTextbooks.aggregate.mockResolvedValue({ _max: { sort_order: 0 } });
  mockPrismaTextbooks.update.mockImplementation(({ data }) =>
    Promise.resolve({ id: 1, title: '测试教材', ...data })
  );
  mockPrismaTextbooks.create.mockImplementation(({ data }) =>
    Promise.resolve({ id: 9, ...data })
  );
});

// ════════════════════════════════════════════════
// PUT /api/textbooks/:id — 清空字段
// ════════════════════════════════════════════════
describe('PUT /api/textbooks/:id 清空字段', () => {
  it('发 null 的可空文本字段最终以 null 落库（旧值被清掉）', async () => {
    const res = await put(1, {
      publisher: null,
      isbn: null,
      author: null,
      edition: null,
      category: null,
      description: null,
    });

    expect(res.status).toBe(200);
    const data = updatedData();
    expect(data).toHaveProperty('publisher', null);
    expect(data).toHaveProperty('isbn', null);
    expect(data).toHaveProperty('author', null);
    expect(data).toHaveProperty('edition', null);
    expect(data).toHaveProperty('category', null);
    expect(data).toHaveProperty('description', null);
  });

  it('空前端值（null 被 .trim() 归一为 \'\'）由控制器归一为 null', async () => {
    const res = await put(1, { publisher: '', author: '' });

    expect(res.status).toBe(200);
    expect(updatedData()).toHaveProperty('publisher', null);
    expect(updatedData()).toHaveProperty('author', null);
  });

  it('缺席字段不进 data（不吃掉"不修改"语义）', async () => {
    const res = await put(1, { publisher: null });

    expect(res.status).toBe(200);
    const data = updatedData();
    expect(data).toHaveProperty('publisher', null);
    expect(data).not.toHaveProperty('isbn');
    expect(data).not.toHaveProperty('price');
    expect(data).not.toHaveProperty('publish_date');
  });

  it('price=0 是合法值，不得被存成 null', async () => {
    const res = await put(1, { price: 0 });

    expect(res.status).toBe(200);
    expect(updatedData()).toHaveProperty('price', 0);
  });

  it('price=null 清空定价', async () => {
    const res = await put(1, { price: null });

    expect(res.status).toBe(200);
    expect(updatedData()).toHaveProperty('price', null);
  });

  it('camelCase 字段经命名中间件转为 snake_case 且 null 不丢失', async () => {
    const res = await put(1, { publishDate: null, isActive: false });

    expect(res.status).toBe(200);
    const data = updatedData();
    expect(data).toHaveProperty('publish_date', null);
    expect(data).toHaveProperty('is_active', false);
    expect(data).not.toHaveProperty('publishDate');
  });

  it('无 Bearer 的写请求被 CSRF 中间件拦截 → 403', async () => {
    const res = await request(app).put('/api/textbooks/1').send({ publisher: null });
    expect(res.status).toBe(403);
  });

  it('Bearer 令牌无效 → 401', async () => {
    const res = await request(app)
      .put('/api/textbooks/1')
      .set('Authorization', 'Bearer invalid.token.value')
      .send({ publisher: null });
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════
// POST /api/textbooks — 创建时空值处理
// ════════════════════════════════════════════════
describe('POST /api/textbooks 清空/空值处理', () => {
  it('可选文本字段空串归一为 null，price=0 原样保存', async () => {
    const res = await request(app)
      .post('/api/textbooks')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ title: '新教材', publisher: '', author: '', price: 0 });

    expect(res.status).toBe(200);
    const data = createdData();
    expect(data).toHaveProperty('publisher', null);
    expect(data).toHaveProperty('author', null);
    expect(data).toHaveProperty('price', 0);
  });

  it('书名缺失 → 校验拦截，不入库', async () => {
    const res = await request(app)
      .post('/api/textbooks')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ publisher: '某出版社' });

    expect(res.status).toBe(422);
    expect(mockPrismaTextbooks.create).not.toHaveBeenCalled();
  });
});
