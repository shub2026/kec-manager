import { Router } from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { sanitizeBody } from '../middleware/xss.js';
import { validatePagination } from '../middleware/pagination.js';
import { validateIdParam, validateClass, validateClassUpdate } from '../middleware/validation.js';
import {
  listClasses,
  createClass,
  updateClass,
  deleteClass,
  batchDeleteClasses,
  batchUpdateClasses,
} from '../controllers/class.controller.js';

const router = Router();

/**
 * POST /api/classes/batch-delete - 批量删除班级（须在 /:id 前注册）
 */
router.post('/batch-delete', roleMiddleware('admin', 'super_admin'), batchDeleteClasses);

/**
 * POST /api/classes/batch-update - 批量更新班级（须在 /:id 前注册）
 */
router.post('/batch-update', roleMiddleware('admin', 'super_admin'), batchUpdateClasses);

router.get('/', validatePagination(100), listClasses);
router.post('/', roleMiddleware('admin', 'super_admin'), validateClass, sanitizeBody, createClass);
router.put(
  '/:id',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  validateClassUpdate,
  sanitizeBody,
  updateClass
);
router.delete('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, deleteClass);

export default router;
