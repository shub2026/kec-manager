import { Router } from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { sanitizeBody } from '../middleware/xss.js';
import { validateIdParam, validateTextbook, validateTextbookStatus } from '../middleware/validation.js';
import {
  listTextbooks,
  createTextbook,
  updateTextbook,
  deleteTextbook,
  toggleTextbookStatus,
} from '../controllers/textbook.controller.js';

const router = Router();

// GET - 所有登录用户可访问
router.get('/', listTextbooks);

// POST/PUT/DELETE - 需要admin权限
router.post('/', roleMiddleware('admin', 'super_admin'), validateTextbook, sanitizeBody, createTextbook);
router.put('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, validateTextbook, sanitizeBody, updateTextbook);
router.delete('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, deleteTextbook);
router.post('/:id/toggle-status', roleMiddleware('admin', 'super_admin'), validateIdParam, validateTextbookStatus, sanitizeBody, toggleTextbookStatus);

export default router;
