/**
 * documents.controller 单元测试
 *
 * 覆盖文档资料的列表、上传、下载、重命名、删除控制器：
 * - 列表筛选（关键词 / 类型分组）与分页、上传人展示
 * - 上传：扩展名白名单、文件头魔数校验、成功后入库与审计
 * - 下载：不存在 404、磁盘文件缺失容错、中文文件名 Content-Disposition
 * - 重命名：空名拒绝、扩展名强制保留
 * - 删除：磁盘文件缺失不阻塞元数据清理
 *
 * Mock 策略：mock prisma / audit service / logger，
 * 文件读写使用真实临时目录（os.tmpdir）验证磁盘行为。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  documents: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
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

vi.mock('../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入被测模块（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const {
  listDocuments,
  uploadDocument,
  downloadDocument,
  renameDocument,
  deleteDocument,
  documentFileFilter,
  verifyDocumentMagic,
  DOCUMENT_DIR,
} = await import('../documents.controller.js');
const { createAuditLog } = await import('../../services/audit.service.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq({ params = {}, body = {}, query = {}, user = { id: 1 }, file } = {}) {
  return { params, body, query, user, file, ip: '127.0.0.1' };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  res.setHeader = vi.fn();
  res.sendFile = vi.fn();
  return res;
}

// 在真实存储目录写入临时文件，返回路径
async function writeTempFile(name, buffer) {
  fs.mkdirSync(DOCUMENT_DIR, { recursive: true });
  const filePath = path.join(DOCUMENT_DIR, name);
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

function removeTempFile(name) {
  try {
    fs.unlinkSync(path.join(DOCUMENT_DIR, name));
  } catch {
    /* 忽略 */
  }
}

const PDF_BUF = Buffer.from('%PDF-1.4\nfake pdf content');
const JPEG_BUF = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const ZIP_BUF = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
const OLE2_BUF = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]);
const PLAIN_BUF = Buffer.from('just plain text, not a document');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const name of [
    'test-ok.pdf',
    'test-bad.pdf',
    'test-dl.pdf',
    'test-del.pdf',
    'test-magic.pdf',
    'test-magic.jpg',
    'test-magic.docx',
    'test-magic.doc',
    'test-magic-tiny.pdf',
    'test-dup.pdf',
  ]) {
    removeTempFile(name);
  }
});

// ════════════════════════════════════════════════
// documentFileFilter（扩展名白名单）
// ════════════════════════════════════════════════
describe('documentFileFilter', () => {
  it.each(['doc', 'docx', 'xls', 'xlsx', 'pdf', 'jpg', 'jpeg'])(
    '允许 .%s 扩展名',
    (ext) => {
      const cb = vi.fn();
      documentFileFilter({}, { originalname: `文件.${ext}` }, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    }
  );

  it.each(['exe', 'txt', 'png', ''])(
    '拒绝 .%s 或无扩展名',
    (ext) => {
      const cb = vi.fn();
      const name = ext ? `file.${ext}` : 'file';
      documentFileFilter({}, { originalname: name }, cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
    }
  );

  it('扩展名大小写不敏感', () => {
    const cb = vi.fn();
    documentFileFilter({}, { originalname: 'FILE.PDF' }, cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });
});

// ════════════════════════════════════════════════
// verifyDocumentMagic（文件头魔数）
// ════════════════════════════════════════════════
describe('verifyDocumentMagic', () => {
  it('PDF 魔数通过', async () => {
    const p = await writeTempFile('test-magic.pdf', PDF_BUF);
    await expect(verifyDocumentMagic(p, 'pdf')).resolves.toBeUndefined();
  });

  it('JPG 魔数通过', async () => {
    const p = await writeTempFile('test-magic.jpg', JPEG_BUF);
    await expect(verifyDocumentMagic(p, 'jpg')).resolves.toBeUndefined();
  });

  it('docx 需 ZIP 签名', async () => {
    const p = await writeTempFile('test-magic.docx', ZIP_BUF);
    await expect(verifyDocumentMagic(p, 'docx')).resolves.toBeUndefined();
  });

  it('doc 需 OLE2 签名', async () => {
    const p = await writeTempFile('test-magic.doc', OLE2_BUF);
    await expect(verifyDocumentMagic(p, 'doc')).resolves.toBeUndefined();
  });

  it('内容与扩展名不符时拒绝', async () => {
    const p = await writeTempFile('test-bad.pdf', PLAIN_BUF);
    await expect(verifyDocumentMagic(p, 'pdf')).rejects.toThrow('文件内容与扩展名不匹配');
  });

  it('文件过小拒绝', async () => {
    const p = await writeTempFile('test-magic-tiny.pdf', Buffer.from('%P'));
    await expect(verifyDocumentMagic(p, 'pdf')).rejects.toThrow();
  });

  it('未知扩展名拒绝', async () => {
    await expect(verifyDocumentMagic('whatever', 'exe')).rejects.toThrow('不支持的文件类型');
  });
});

// ════════════════════════════════════════════════
// listDocuments
// ════════════════════════════════════════════════
describe('listDocuments', () => {
  beforeEach(() => {
    mockPrisma.documents.count.mockResolvedValue(1);
  });

  it('无筛选条件返回全部并附带上传人展示名', async () => {
    mockPrisma.documents.findMany.mockResolvedValue([
      {
        id: 1,
        original_name: '方案.pdf',
        file_ext: 'pdf',
        users: { id: 1, username: 'admin', real_name: '管理员' },
      },
    ]);

    const req = mockReq({ query: {} });
    const res = mockRes();
    await listDocuments(req, res, vi.fn());

    expect(mockPrisma.documents.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, orderBy: { created_at: 'desc' } })
    );
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.items[0].uploader_name).toBe('管理员');
  });

  it('关键词与类型分组转为 where 条件', async () => {
    mockPrisma.documents.findMany.mockResolvedValue([]);

    const req = mockReq({ query: { keyword: '教学', file_type: 'excel' } });
    const res = mockRes();
    await listDocuments(req, res, vi.fn());

    const where = mockPrisma.documents.findMany.mock.calls[0][0].where;
    expect(where.original_name).toEqual({ contains: '教学' });
    expect(where.file_ext).toEqual({ in: ['xls', 'xlsx'] });
  });

  it('real_name 缺失时回退 username', async () => {
    mockPrisma.documents.findMany.mockResolvedValue([
      { id: 2, original_name: 'a.pdf', users: { id: 1, username: 'admin', real_name: null } },
    ]);

    const req = mockReq({ query: {} });
    const res = mockRes();
    await listDocuments(req, res, vi.fn());

    expect(res.json.mock.calls[0][0].data.items[0].uploader_name).toBe('admin');
  });

  it('分页参数越界被约束', async () => {
    mockPrisma.documents.findMany.mockResolvedValue([]);

    const req = mockReq({ query: { page: '0', page_size: '999' } });
    const res = mockRes();
    await listDocuments(req, res, vi.fn());

    const call = mockPrisma.documents.findMany.mock.calls[0][0];
    expect(call.take).toBe(100);
    expect(call.skip).toBe(0);
  });
});

// ════════════════════════════════════════════════
// uploadDocument
// ════════════════════════════════════════════════
describe('uploadDocument', () => {
  it('无文件 → ValidationError', async () => {
    const next = vi.fn();
    await uploadDocument(mockReq({}), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: '请上传文件' }));
  });

  it('合法 PDF 上传成功：入库字段正确并写审计', async () => {
    const filePath = await writeTempFile('test-ok.pdf', PDF_BUF);
    mockPrisma.documents.create.mockResolvedValue({
      id: 9,
      original_name: '教学计划.pdf',
      stored_name: 'test-ok.pdf',
      file_ext: 'pdf',
      users: { id: 1, username: 'admin', real_name: '管理员' },
    });

    const req = mockReq({
      file: { originalname: '教学计划.pdf', path: filePath, size: PDF_BUF.length, filename: 'test-ok.pdf' },
    });
    const res = mockRes();
    await uploadDocument(req, res, vi.fn());

    expect(mockPrisma.documents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          original_name: '教学计划.pdf',
          stored_name: 'test-ok.pdf',
          file_ext: 'pdf',
          mime_type: 'application/pdf',
          uploader_id: 1,
        }),
      })
    );
    expect(res.json.mock.calls[0][0].success).toBe(true);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', module: 'documents', result: 'success' })
    );
  });

  it('拉丁1乱码的中文文件名被还原为 UTF-8', async () => {
    const filePath = await writeTempFile('test-ok.pdf', PDF_BUF);
    // 模拟 busboy 按 latin1 解析产生的乱码文件名
    const garbled = Buffer.from('中文报告.pdf', 'utf8').toString('latin1');
    mockPrisma.documents.create.mockResolvedValue({
      id: 9,
      original_name: '中文报告.pdf',
      stored_name: 'test-ok.pdf',
      file_ext: 'pdf',
      users: null,
    });

    const req = mockReq({
      file: { originalname: garbled, path: filePath, size: PDF_BUF.length, filename: 'test-ok.pdf' },
    });
    await uploadDocument(req, mockRes(), vi.fn());

    expect(mockPrisma.documents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ original_name: '中文报告.pdf' }),
      })
    );
  });

  it('魔数不匹配 → 拒绝并清理磁盘文件', async () => {
    const filePath = await writeTempFile('test-bad.pdf', PLAIN_BUF);
    const req = mockReq({
      file: { originalname: '伪装.pdf', path: filePath, size: PLAIN_BUF.length, filename: 'test-bad.pdf' },
    });
    const next = vi.fn();

    await uploadDocument(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('不匹配') }));
    expect(mockPrisma.documents.create).not.toHaveBeenCalled();
    // unlink 为异步回调，等待一个宏任务周期
    await new Promise((r) => setTimeout(r, 30));
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('内容重复 → 拒绝入库并清理磁盘文件', async () => {
    const filePath = await writeTempFile('test-dup.pdf', PDF_BUF);
    mockPrisma.documents.findFirst.mockResolvedValue({ id: 5, original_name: '已有文件.pdf' });
    const req = mockReq({
      file: { originalname: '副本.pdf', path: filePath, size: PDF_BUF.length, filename: 'test-dup.pdf' },
    });
    const next = vi.fn();

    await uploadDocument(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('该文件已存在（已有文件.pdf）') })
    );
    expect(mockPrisma.documents.create).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 30));
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('上传成功写入内容哈希供后续去重', async () => {
    const filePath = await writeTempFile('test-ok.pdf', PDF_BUF);
    mockPrisma.documents.findFirst.mockResolvedValue(null);
    mockPrisma.documents.create.mockResolvedValue({
      id: 9,
      original_name: '教学计划.pdf',
      stored_name: 'test-ok.pdf',
      file_ext: 'pdf',
      users: { id: 1, username: 'admin', real_name: '管理员' },
    });
    const req = mockReq({
      file: { originalname: '教学计划.pdf', path: filePath, size: PDF_BUF.length, filename: 'test-ok.pdf' },
    });
    await uploadDocument(req, mockRes(), vi.fn());

    const createData = mockPrisma.documents.create.mock.calls[0][0].data;
    expect(createData.file_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ════════════════════════════════════════════════
// downloadDocument
// ════════════════════════════════════════════════
describe('downloadDocument', () => {
  it('记录不存在 → 404', async () => {
    mockPrisma.documents.findUnique.mockResolvedValue(null);
    const next = vi.fn();
    await downloadDocument(mockReq({ params: { id: '1' } }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('磁盘文件缺失 → 404 且不 sendFile', async () => {
    mockPrisma.documents.findUnique.mockResolvedValue({
      id: 1,
      original_name: '丢失.pdf',
      stored_name: 'not-exist-file.pdf',
      mime_type: 'application/pdf',
    });
    const res = mockRes();
    const next = vi.fn();
    await downloadDocument(mockReq({ params: { id: '1' } }), res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('正常下载：中文文件名以 UTF-8 编码输出并写审计', async () => {
    await writeTempFile('test-dl.pdf', PDF_BUF);
    mockPrisma.documents.findUnique.mockResolvedValue({
      id: 1,
      original_name: '教学计划.pdf',
      stored_name: 'test-dl.pdf',
      mime_type: 'application/pdf',
    });

    const res = mockRes();
    await downloadDocument(mockReq({ params: { id: '1' } }), res, vi.fn());

    const disposition = res.setHeader.mock.calls.find(([k]) => k === 'Content-Disposition')[1];
    expect(disposition).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('教学计划.pdf')}`);
    expect(res.sendFile).toHaveBeenCalledWith(path.join(DOCUMENT_DIR, 'test-dl.pdf'));
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'export', module: 'documents' })
    );
  });
});

// ════════════════════════════════════════════════
// renameDocument
// ════════════════════════════════════════════════
describe('renameDocument', () => {
  const baseDoc = { id: 3, original_name: '旧名.pdf', file_ext: 'pdf', stored_name: 'x.pdf' };

  beforeEach(() => {
    mockPrisma.documents.findUnique.mockResolvedValue({ ...baseDoc });
    mockPrisma.documents.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...baseDoc, ...data, users: { id: 1, username: 'admin', real_name: null } })
    );
  });

  it('记录不存在 → 404', async () => {
    mockPrisma.documents.findUnique.mockResolvedValue(null);
    const next = vi.fn();
    await renameDocument(mockReq({ params: { id: '3' }, body: { original_name: '新名' } }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('空文件名 → ValidationError', async () => {
    const next = vi.fn();
    await renameDocument(mockReq({ params: { id: '3' }, body: { original_name: '   ' } }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: '文件名不能为空' }));
  });

  it('未带扩展名时强制补回原扩展名', async () => {
    const res = mockRes();
    await renameDocument(mockReq({ params: { id: '3' }, body: { original_name: '新名字' } }), res, vi.fn());
    expect(mockPrisma.documents.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { original_name: '新名字.pdf' } })
    );
  });

  it('携带不同扩展名时替换为原扩展名', async () => {
    const res = mockRes();
    await renameDocument(mockReq({ params: { id: '3' }, body: { original_name: '新名.docx' } }), res, vi.fn());
    expect(mockPrisma.documents.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { original_name: '新名.pdf' } })
    );
  });

  it('正常重命名写审计', async () => {
    const res = mockRes();
    await renameDocument(mockReq({ params: { id: '3' }, body: { original_name: '新名.pdf' } }), res, vi.fn());
    expect(res.json.mock.calls[0][0].success).toBe(true);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', module: 'documents' })
    );
  });
});

// ════════════════════════════════════════════════
// deleteDocument
// ════════════════════════════════════════════════
describe('deleteDocument', () => {
  it('记录不存在 → 404', async () => {
    mockPrisma.documents.findUnique.mockResolvedValue(null);
    const next = vi.fn();
    await deleteDocument(mockReq({ params: { id: '1' } }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('正常删除：磁盘文件与记录均被移除', async () => {
    await writeTempFile('test-del.pdf', PDF_BUF);
    mockPrisma.documents.findUnique.mockResolvedValue({
      id: 1,
      original_name: '待删.pdf',
      stored_name: 'test-del.pdf',
    });
    mockPrisma.documents.delete.mockResolvedValue({});

    const res = mockRes();
    await deleteDocument(mockReq({ params: { id: '1' } }), res, vi.fn());

    await new Promise((r) => setTimeout(r, 30));
    expect(fs.existsSync(path.join(DOCUMENT_DIR, 'test-del.pdf'))).toBe(false);
    expect(mockPrisma.documents.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', module: 'documents' })
    );
  });

  it('磁盘文件缺失不阻塞元数据删除', async () => {
    mockPrisma.documents.findUnique.mockResolvedValue({
      id: 2,
      original_name: '文件已丢.pdf',
      stored_name: 'no-such-file.pdf',
    });
    mockPrisma.documents.delete.mockResolvedValue({});

    const res = mockRes();
    const next = vi.fn();
    await deleteDocument(mockReq({ params: { id: '2' } }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.documents.delete).toHaveBeenCalledWith({ where: { id: 2 } });
  });
});
