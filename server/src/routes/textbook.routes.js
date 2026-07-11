import { Router } from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { sanitizeBody } from '../middleware/xss.js';
import {
  validateIdParam,
  validateTextbook,
  validateTextbookStatus,
  validateTextbookCreate,
} from '../middleware/validation.js';
import {
  listTextbooks,
  createTextbook,
  updateTextbook,
  deleteTextbook,
  toggleTextbookStatus,
  batchUpdateTextbooks,
  batchDeleteTextbooks,
} from '../controllers/textbook.controller.js';

const router = Router();

// GET - 所有登录用户可访问
router.get('/', listTextbooks);

// 批量操作（须在 /:id 前注册，避免参数捕获）
router.post(
  '/batch-update',
  roleMiddleware('admin', 'super_admin'),
  batchUpdateTextbooks
);
router.post(
  '/batch-delete',
  roleMiddleware('admin', 'super_admin'),
  batchDeleteTextbooks
);

// POST/PUT/DELETE - 需要admin权限
router.post(
  '/',
  roleMiddleware('admin', 'super_admin'),
  validateTextbookCreate,
  sanitizeBody,
  createTextbook
);
router.put(
  '/:id',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  validateTextbook,
  sanitizeBody,
  updateTextbook
);
router.delete('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, deleteTextbook);
router.post(
  '/:id/toggle-status',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  validateTextbookStatus,
  sanitizeBody,
  toggleTextbookStatus
);

export default router;
