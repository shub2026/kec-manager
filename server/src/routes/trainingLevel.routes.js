import { Router } from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { sanitizeBody } from '../middleware/xss.js';
import { validateIdParam, validateTrainingLevel, validateSortOrder, validateTrainingLevelCreate } from '../middleware/validation.js';
import {
  listTrainingLevels,
  createTrainingLevel,
  updateTrainingLevel,
  deleteTrainingLevel,
} from '../controllers/trainingLevel.controller.js';

const router = Router();

// GET - 所有登录用户可访问
router.get('/', listTrainingLevels);

// POST/PUT/DELETE - 需要admin权限
router.post('/', roleMiddleware('admin', 'super_admin'), validateTrainingLevelCreate, sanitizeBody, createTrainingLevel);
router.put('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, validateTrainingLevel, sanitizeBody, updateTrainingLevel);
router.delete('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, deleteTrainingLevel);

export default router;
