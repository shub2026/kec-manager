import { Router } from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { sanitizeBody } from '../middleware/xss.js';
import {
  validateIdParam,
  validateCollege,
  validateCollegeCreate,
} from '../middleware/validation.js';
import {
  listColleges,
  createCollege,
  updateCollege,
  deleteCollege,
  getCollegeLevelMapping,
} from '../controllers/college.controller.js';

const router = Router();

// GET - 所有登录用户可访问
router.get('/', listColleges);
router.get('/level-mapping', getCollegeLevelMapping);

// POST/PUT/DELETE - 需要admin权限
router.post(
  '/',
  roleMiddleware('admin', 'super_admin'),
  validateCollegeCreate,
  sanitizeBody,
  createCollege
);
router.put(
  '/:id',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  validateCollege,
  sanitizeBody,
  updateCollege
);
router.delete('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, deleteCollege);

export default router;
