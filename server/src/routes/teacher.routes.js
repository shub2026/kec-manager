import { Router } from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { sanitizeBody } from '../middleware/xss.js';
import {
  validateIdParam,
  validateTeacherCreate,
  validateTeacherUpdate,
  validateBatchUpdateHours,
} from '../middleware/validation.js';
import {
  listTeachers,
  createTeacher,
  updateTeacher,
  deleteTeacher,
  batchUpdateDefaultHours,
  toggleTeacherStatus,
} from '../controllers/teacher.controller.js';

const router = Router();

// GET - 所有登录用户可访问
router.get('/', listTeachers);

// POST/PUT/DELETE - 需要admin权限
router.post(
  '/',
  roleMiddleware('admin', 'super_admin'),
  validateTeacherCreate,
  sanitizeBody,
  createTeacher
);

// 批量修改自定义课时（必须在 /:id 之前注册）
router.put(
  '/batch/default-hours',
  roleMiddleware('admin', 'super_admin'),
  validateBatchUpdateHours,
  sanitizeBody,
  batchUpdateDefaultHours
);

// 切换教师启用/禁用状态
router.patch(
  '/:id/status',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  sanitizeBody,
  toggleTeacherStatus
);

router.put(
  '/:id',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  validateTeacherUpdate,
  sanitizeBody,
  updateTeacher
);
router.delete('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, deleteTeacher);

export default router;
