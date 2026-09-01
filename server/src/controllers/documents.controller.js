import multer from 'multer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Buffer } from 'buffer';
import { prisma } from '../lib/prisma.js';
import { success } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { NotFoundError, ValidationError } from '../utils/error.js';
import { log } from '../utils/logger.js';

// ── 文档类型与存储配置 ──────────────────────────────

// 支持的扩展名白名单（小写，不含点）
const ALLOWED_EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx', 'pdf', 'jpg', 'jpeg'];

// 文件类型分组（前端筛选使用）
const FILE_TYPE_GROUPS = {
  word: ['doc', 'docx'],
  excel: ['xls', 'xlsx'],
  pdf: ['pdf'],
  image: ['jpg', 'jpeg'],
};

// 按扩展名归一化 MIME 类型（客户端上报的 mimetype 不可信，统一由服务端决定）
const MIME_BY_EXT = {
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

// 文件头魔数签名
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 — .docx/.xlsx
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // \xD0\xCF\x11\xE0 — .doc/.xls
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

// 扩展名 → 允许的魔数集合
const MAGIC_BY_EXT = {
  doc: [OLE2_MAGIC],
  docx: [ZIP_MAGIC],
  xls: [OLE2_MAGIC],
  xlsx: [ZIP_MAGIC],
  pdf: [PDF_MAGIC],
  jpg: [JPEG_MAGIC],
  jpeg: [JPEG_MAGIC],
};

// 文档大小上限：DOCUMENT_MAX_SIZE 环境变量配置（单位 MB，默认 50）
const DOCUMENT_MAX_SIZE = (parseInt(process.env.DOCUMENT_MAX_SIZE) || 50) * 1024 * 1024;

// 存储目录：沿用 UPLOAD_DIR 持久化卷，文档集中存放于 documents 子目录
export const DOCUMENT_DIR = path.join(
  process.env.UPLOAD_DIR || path.join(os.tmpdir(), 'kec-uploads'),
  'documents'
);

/**
 * 安全的磁盘路径拼接：仅取 basename 防路径穿越
 */
function resolveStoredPath(storedName) {
  return path.join(DOCUMENT_DIR, path.basename(storedName));
}

/**
 * 修复 multipart 文件名编码：busboy 默认按 latin1 解析 Content-Disposition 参数，
 * 浏览器实际以 UTF-8 发送，中文文件名会乱码（如"集成"→"éæ"）。
 * 启发式还原：仅当字符均落在 0x00-0xff 且重编码后无替换符时才采信。
 */
function fixFilenameEncoding(name) {
  if (/[\u0080-\u00ff]/.test(name)) {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (!fixed.includes('\ufffd')) return fixed;
  }
  return name;
}

/**
 * 清洗原始文件名：修复编码、取 basename、去控制字符、限长 255
 */
function sanitizeFilename(rawName) {
  const base = path.basename(fixFilenameEncoding(String(rawName || '')));
  // 去除控制字符（有意为之，防止文件名注入不可见字符）
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned.slice(0, 255);
}

/**
 * 流式计算文件内容 SHA-256（大文件不占内存），用于上传内容去重
 * @param {string} filePath - 落盘后的文件路径
 */
export function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * 读取文件头校验魔数，确保内容与扩展名一致
 * @param {string} filePath - 落盘后的文件路径
 * @param {string} ext - 扩展名（小写，不含点）
 */
export async function verifyDocumentMagic(filePath, ext) {
  const allowed = MAGIC_BY_EXT[ext];
  if (!allowed) throw new ValidationError('不支持的文件类型');

  const buf = Buffer.alloc(8);
  let fd;
  try {
    fd = await fs.promises.open(filePath, 'r');
    const { bytesRead } = await fd.read(buf, 0, 8, 0);
    const matched = allowed.some((magic) => bytesRead >= magic.length && magic.every((b, i) => buf[i] === b));
    if (!matched) {
      throw new ValidationError('文件内容与扩展名不匹配，请上传真实的文档文件');
    }
  } finally {
    if (fd) {
      try {
        await fd.close();
      } catch {
        /* 忽略关闭错误 */
      }
    }
  }
}

// ── multer 配置 ──────────────────────────────

/**
 * 扩展名白名单过滤器（导出供单测直接验证）
 */
export function documentFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase().slice(1);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error('仅支持 Word、Excel、PDF、JPG 格式（.doc/.docx/.xls/.xlsx/.pdf/.jpg/.jpeg）'));
  }
  cb(null, true);
}

export const documentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        fs.mkdirSync(DOCUMENT_DIR, { recursive: true });
        cb(null, DOCUMENT_DIR);
      } catch (e) {
        cb(e);
      }
    },
    filename: (req, file, cb) => {
      // 扩展名已在 fileFilter 校验；存储名用时间戳+随机串，防冲突与推测
      const ext = path.extname(file.originalname).toLowerCase().slice(1);
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`);
    },
  }),
  limits: { fileSize: DOCUMENT_MAX_SIZE },
  fileFilter: documentFileFilter,
});

// ── 控制器 ──────────────────────────────

/**
 * multer 上传中间件包装：将 MulterError/fileFilter 错误转为友好的 ValidationError，
 * 避免落入全局错误中间件返回 500 通用提示
 */
export function handleDocumentUpload(req, res, next) {
  documentUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new ValidationError(`文件大小超出限制（单文件上限 ${Math.round(DOCUMENT_MAX_SIZE / 1024 / 1024)} MB）`)
        );
      }
      return next(new ValidationError(err.message || '文件上传失败'));
    }
    next();
  });
}

/**
 * 获取文档列表
 * GET /api/documents?keyword=&fileType=&page=&pageSize=
 */
export async function listDocuments(req, res, next) {
  try {
    const { page, page_size, keyword, file_type } = req.query;
    const currentPage = Number(page) || 1;
    const pageSize = Math.min(Math.max(Number(page_size) || 20, 1), 100);
    const skip = (currentPage - 1) * pageSize;

    const where = {};
    const kw = typeof keyword === 'string' ? keyword.trim() : '';
    if (kw) {
      where.original_name = { contains: kw };
    }
    if (file_type && FILE_TYPE_GROUPS[file_type]) {
      where.file_ext = { in: FILE_TYPE_GROUPS[file_type] };
    }

    const [items, total] = await Promise.all([
      prisma.documents.findMany({
        where,
        include: { users: { select: { id: true, username: true, real_name: true } } },
        skip,
        take: pageSize,
        orderBy: { created_at: 'desc' },
      }),
      prisma.documents.count({ where }),
    ]);

    success(res, {
      items: items.map((doc) => ({
        ...doc,
        uploader_name: doc.users?.real_name || doc.users?.username || '未知用户',
      })),
      total,
      page: currentPage,
      pageSize,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 上传文档
 * POST /api/documents/upload（multipart/form-data, field: file）
 */
export async function uploadDocument(req, res, next) {
  try {
    if (!req.file) {
      throw new ValidationError('请上传文件');
    }

    const ext = path.extname(req.file.originalname || '').toLowerCase().slice(1);
    try {
      await verifyDocumentMagic(req.file.path, ext);
    } catch (e) {
      // 校验失败：清理已落盘文件后抛出
      fs.unlink(req.file.path, () => {});
      throw e;
    }

    const originalName = sanitizeFilename(req.file.originalname);
    if (!originalName) {
      fs.unlink(req.file.path, () => {});
      throw new ValidationError('文件名无效');
    }

    // 内容去重：已有相同内容文档时拒绝入库，避免浪费磁盘与列表冗余
    const fileHash = await computeFileHash(req.file.path);
    const existing = await prisma.documents.findFirst({
      where: { file_hash: fileHash },
      orderBy: { created_at: 'asc' },
    });
    if (existing) {
      fs.unlink(req.file.path, () => {});
      throw new ValidationError(`该文件已存在（${existing.original_name}），请勿重复上传`);
    }

    const doc = await prisma.documents.create({
      data: {
        original_name: originalName,
        stored_name: req.file.filename,
        file_ext: ext,
        file_size: req.file.size,
        mime_type: MIME_BY_EXT[ext] || 'application/octet-stream',
        file_hash: fileHash,
        uploader_id: req.user?.id ?? null,
      },
      include: { users: { select: { id: true, username: true, real_name: true } } },
    });

    await createAuditLog({
      action: 'create',
      module: 'documents',
      userId: req.user?.id,
      ip: req.ip,
      details: { documentId: doc.id, originalName, size: req.file.size },
      result: 'success',
      message: `上传文档"${originalName}"`,
    });

    success(res, { ...doc, uploader_name: doc.users?.real_name || doc.users?.username || '未知用户' }, '上传成功');
  } catch (error) {
    // 兜底清理：异常路径下避免残留磁盘文件
    if (req.file?.path && !error.isOperational) {
      fs.unlink(req.file.path, () => {});
    }
    next(error);
  }
}

/**
 * 下载文档
 * GET /api/documents/:id/download
 */
export async function downloadDocument(req, res, next) {
  try {
    const id = Number(req.params.id);
    const doc = await prisma.documents.findUnique({ where: { id } });
    if (!doc) {
      throw new NotFoundError('文档');
    }

    const filePath = resolveStoredPath(doc.stored_name);
    if (!fs.existsSync(filePath)) {
      log.error('文档磁盘文件缺失', { documentId: doc.id, storedName: doc.stored_name });
      throw new NotFoundError('文档文件');
    }

    await createAuditLog({
      action: 'export',
      module: 'documents',
      userId: req.user?.id,
      ip: req.ip,
      details: { documentId: doc.id, originalName: doc.original_name },
      result: 'success',
      message: `下载文档"${doc.original_name}"`,
    });

    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`
    );
    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
}

/**
 * 重命名文档（仅修改显示名，保留原扩展名）
 * PATCH /api/documents/:id
 */
export async function renameDocument(req, res, next) {
  try {
    const id = Number(req.params.id);
    const doc = await prisma.documents.findUnique({ where: { id } });
    if (!doc) {
      throw new NotFoundError('文档');
    }

    const rawName = req.body?.original_name;
    let newName = sanitizeFilename(rawName);
    if (!newName) {
      throw new ValidationError('文件名不能为空');
    }
    // 强制保留原扩展名，避免类型标识被篡改
    const expectedExt = `.${doc.file_ext}`;
    if (!newName.toLowerCase().endsWith(expectedExt)) {
      newName = newName.replace(/\.[^.]*$/, '') + expectedExt;
    }

    const updated = await prisma.documents.update({
      where: { id },
      data: { original_name: newName },
      include: { users: { select: { id: true, username: true, real_name: true } } },
    });

    await createAuditLog({
      action: 'update',
      module: 'documents',
      userId: req.user?.id,
      ip: req.ip,
      details: { documentId: id, oldName: doc.original_name, newName },
      result: 'success',
      message: `重命名文档"${doc.original_name}"为"${newName}"`,
    });

    success(
      res,
      { ...updated, uploader_name: updated.users?.real_name || updated.users?.username || '未知用户' },
      '重命名成功'
    );
  } catch (error) {
    next(error);
  }
}

/**
 * 删除文档（先删磁盘文件再删记录，文件缺失不阻塞）
 * DELETE /api/documents/:id
 */
export async function deleteDocument(req, res, next) {
  try {
    const id = Number(req.params.id);
    const doc = await prisma.documents.findUnique({ where: { id } });
    if (!doc) {
      throw new NotFoundError('文档');
    }

    // 磁盘文件容错删除：缺失时仅记录日志，不影响元数据清理
    const filePath = resolveStoredPath(doc.stored_name);
    try {
      await fs.promises.unlink(filePath);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        log.warn('删除文档磁盘文件失败', { documentId: id, error: e.message });
      }
    }

    await prisma.documents.delete({ where: { id } });

    await createAuditLog({
      action: 'delete',
      module: 'documents',
      userId: req.user?.id,
      ip: req.ip,
      details: { documentId: id, originalName: doc.original_name },
      result: 'success',
      message: `删除文档"${doc.original_name}"`,
    });

    success(res, null, '删除成功');
  } catch (error) {
    next(error);
  }
}
