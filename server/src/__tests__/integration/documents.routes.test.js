/**
 * documents.routes 集成测试
 *
 * 保留真实中间件链（helmet/cors/naming/xss/csrf/auth/error），
 * mock prisma 与 logger，验证：
 * - 未登录 401、非 super_admin 403（app.js 挂载处的角色收口）
 * - 列表接口的命名转换（请求 camelCase → snake_case，响应反向）
 * - multipart 上传全链路（multer 落盘 + 魔数校验 + 入库）
 * - 扩展名白名单拒绝
 * - 下载接口磁盘文件缺失 404
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
const mockPrismaUsers = {
  findUnique: vi.fn(),
};
const mockPrismaDocuments = {
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  count: vi.fn(),
};
const mockPrismaAuditLogs = { create: vi.fn() };
const mockPrismaTokenBlacklist = { findUnique: vi.fn() };

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    users: mockPrismaUsers,
    documents: mockPrismaDocuments,
    audit_logs: mockPrismaAuditLogs,
    token_blacklist: mockPrismaTokenBlacklist,
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
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

// ──────────────────────────────────────────────
// 测试数据与工具
// ──────────────────────────────────────────────
const TEST_SECRET = 'test-jwt-secret-that-is-long-enough-for-entropy-check';

function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role, v: 0 }, TEST_SECRET, {
    expiresIn: '1h',
  });
}

const SUPER_ADMIN = {
  id: 1,
  username: 'root',
  role: 'super_admin',
  is_active: true,
  token_version: 0,
  must_change_password: false,
};
const ADMIN = { ...SUPER_ADMIN, id: 2, username: 'admin', role: 'admin' };

beforeEach(() => {
  vi.clearAllMocks();
  invalidateUserStatusCache(SUPER_ADMIN.id);
  invalidateUserStatusCache(ADMIN.id);
  mockPrismaTokenBlacklist.findUnique.mockResolvedValue(null);
  mockPrismaAuditLogs.create.mockResolvedValue({});
});

// ════════════════════════════════════════════════
// 权限收口
// ════════════════════════════════════════════════
describe('权限控制', () => {
  it('未携带 token → 401', async () => {
    const res = await request(app).get('/api/documents');
    expect(res.status).toBe(401);
  });

  it('普通管理员 → 403', async () => {
    mockPrismaUsers.findUnique.mockResolvedValue(ADMIN);
    const res = await request(app)
      .get('/api/documents')
      .set('Authorization', `Bearer ${makeToken(ADMIN)}`);
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════
// GET /api/documents
// ════════════════════════════════════════════════
describe('GET /api/documents', () => {
  beforeEach(() => {
    mockPrismaUsers.findUnique.mockResolvedValue(SUPER_ADMIN);
  });

  it('camelCase 查询参数转换为 snake_case where，响应字段转回 camelCase', async () => {
    mockPrismaDocuments.findMany.mockResolvedValue([
      {
        id: 1,
        original_name: '教学计划.pdf',
        file_ext: 'pdf',
        file_size: 1024,
        users: { id: 1, username: 'root', real_name: '管理员' },
      },
    ]);
    mockPrismaDocuments.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/documents')
      .query({ fileType: 'pdf', pageSize: 20, keyword: '教学' })
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`);

    expect(res.status).toBe(200);

    // 请求侧：命名中间件应把 fileType 转为 file_type，控制器生成 file_ext in ['pdf']
    const findManyCall = mockPrismaDocuments.findMany.mock.calls[0][0];
    expect(findManyCall.where.file_ext).toEqual({ in: ['pdf'] });
    expect(findManyCall.where.original_name).toEqual({ contains: '教学' });
    expect(findManyCall.take).toBe(20);

    // 响应侧：snake_case 字段应转为 camelCase
    const item = res.body.data.items[0];
    expect(item.originalName).toBe('教学计划.pdf');
    expect(item.fileSize).toBe(1024);
    expect(item.uploaderName).toBe('管理员');
    expect(res.body.data.pageSize).toBe(20);
  });
});

// ════════════════════════════════════════════════
// POST /api/documents/upload
// ════════════════════════════════════════════════
describe('POST /api/documents/upload', () => {
  beforeEach(() => {
    mockPrismaUsers.findUnique.mockResolvedValue(SUPER_ADMIN);
  });

  it('合法 PDF 上传成功并写审计', async () => {
    mockPrismaDocuments.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 10, ...data, users: { id: 1, username: 'root', real_name: '管理员' } })
    );

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`)
      .attach('file', Buffer.from('%PDF-1.4\nintegration test content'), '集成测试文档.pdf');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.originalName).toBe('集成测试文档.pdf');
    expect(res.body.data.mimeType).toBe('application/pdf');

    const createData = mockPrismaDocuments.create.mock.calls[0][0].data;
    expect(createData.file_ext).toBe('pdf');
    expect(createData.stored_name).toMatch(/\.pdf$/);
    expect(createData.uploader_id).toBe(SUPER_ADMIN.id);

    expect(mockPrismaAuditLogs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ module: 'documents', action: 'create' }),
    });
  });

  it('扩展名不在白名单 → 422 友好提示', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`)
      .attach('file', Buffer.from('MZ executable bytes'), 'malware.exe');

    expect(res.status).toBe(422);
    expect(res.body.message).toContain('仅支持');
    expect(mockPrismaDocuments.create).not.toHaveBeenCalled();
  });

  it('伪装扩展名（内容不符）→ 魔数校验拒绝', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`)
      .attach('file', Buffer.from('plain text, not a pdf'), '伪装.pdf');

    expect(res.status).toBe(422);
    expect(res.body.message).toContain('不匹配');
    expect(mockPrismaDocuments.create).not.toHaveBeenCalled();
  });

  it('未上传文件 → 422', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`);

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('请上传文件');
  });

  it('内容重复 → 422 提示已存在且不入库', async () => {
    mockPrismaDocuments.findFirst.mockResolvedValue({ id: 7, original_name: '已有文件.pdf' });

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`)
      .attach('file', Buffer.from('%PDF-1.4\nintegration test content'), '副本.pdf');

    expect(res.status).toBe(422);
    expect(res.body.message).toContain('该文件已存在（已有文件.pdf）');
    expect(mockPrismaDocuments.create).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════
// GET /api/documents/:id/download
// ════════════════════════════════════════════════
describe('GET /api/documents/:id/download', () => {
  beforeEach(() => {
    mockPrismaUsers.findUnique.mockResolvedValue(SUPER_ADMIN);
  });

  it('记录不存在 → 404', async () => {
    mockPrismaDocuments.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/documents/999/download')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`);
    expect(res.status).toBe(404);
  });

  it('磁盘文件缺失 → 404', async () => {
    mockPrismaDocuments.findUnique.mockResolvedValue({
      id: 5,
      original_name: '丢失的文件.pdf',
      stored_name: 'definitely-not-exist-12345.pdf',
      mime_type: 'application/pdf',
    });
    const res = await request(app)
      .get('/api/documents/5/download')
      .set('Authorization', `Bearer ${makeToken(SUPER_ADMIN)}`);
    expect(res.status).toBe(404);
  });
});
