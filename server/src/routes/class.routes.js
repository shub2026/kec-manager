import { Router } from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { sanitizeBody } from '../middleware/xss.js';
import { validatePagination } from '../middleware/pagination.js';
import { validateIdParam, validateClass, validateClassUpdate } from '../middleware/validation.js';
import {
  getClassStats,
  listClasses,
  createClass,
  updateClass,
  deleteClass,
} from '../controllers/class.controller.js';

const router = Router();

/**
 * GET /api/classes/stats - 轻量级统计接口
 */
router.get('/stats', getClassStats);

router.get('/', validatePagination(100), listClasses);
router.post('/', roleMiddleware('admin', 'super_admin'), validateClass, sanitizeBody, createClass);
router.put('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, validateClassUpdate, sanitizeBody, updateClass);
router.delete('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, deleteClass);

export default router;
