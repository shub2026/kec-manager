import { Router } from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { sanitizeBody } from '../middleware/xss.js';
import { validateIdParam, validateMajor, validateSortOrder, validateMajorCreate } from '../middleware/validation.js';
import {
  listMajors,
  createMajor,
  updateMajor,
  deleteMajor,
} from '../controllers/major.controller.js';

const router = Router();

// GET - 所有登录用户可访问
router.get('/', listMajors);

// POST/PUT/DELETE - 需要admin权限
router.post('/', roleMiddleware('admin', 'super_admin'), validateMajorCreate, sanitizeBody, createMajor);
router.put('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, validateSortOrder, sanitizeBody, updateMajor);
router.delete('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, deleteMajor);

export default router;;
