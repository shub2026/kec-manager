import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  listDocuments,
  uploadDocument,
  downloadDocument,
  renameDocument,
  deleteDocument,
  handleDocumentUpload,
} from '../controllers/documents.controller.js';

const router = Router();

// authMiddleware + roleMiddleware('super_admin') 已在 app.js 挂载处统一应用

// 上传接口独立限流：每分钟最多 10 次，防止刷接口占满磁盘
const isDev = process.env.NODE_ENV === 'development';
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  skip: () => isDev,
  message: { success: false, message: '上传操作过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /api/documents - 文档列表（支持关键词、类型分组、分页）
 */
router.get('/', listDocuments);

/**
 * POST /api/documents/upload - 上传文档（multipart, field: file）
 */
router.post('/upload', uploadLimiter, handleDocumentUpload, uploadDocument);

/**
 * GET /api/documents/:id/download - 下载文档
 */
router.get('/:id/download', downloadDocument);

/**
 * PATCH /api/documents/:id - 重命名文档
 */
router.patch('/:id', renameDocument);

/**
 * DELETE /api/documents/:id - 删除文档
 */
router.delete('/:id', deleteDocument);

export default router;
