import { Router } from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { sanitizeBody } from '../middleware/xss.js';
import {
  validateIdParam,
  validateAssignTeacher,
  validateAutoArrange,
  validateBatchAutoArrange,
  validateResetAuto,
  validateHourSettings,
} from '../middleware/validation.js';
import {
  getCourseClasses,
  getCourseOverview,
  getCourseTeachers,
  assignTeacher,
  deleteAssignment,
  runAutoArrange,
  runBatchAutoArrange,
  resetAutoAssignments,
  getStatistics,
  getHourSettings,
  saveHourSettings,
  toggleLock,
  batchLock,
  runOptimizeSchedule,
  applyOptimizeResult,
} from '../controllers/teaching-arrange.controller.js';

const router = Router();

// GET - 所有登录用户可访问
router.get('/classes', getCourseClasses);
router.get('/course-overview', getCourseOverview);
router.get('/teachers', getCourseTeachers);
router.get('/statistics', getStatistics);
router.get('/hour-settings', getHourSettings);

// POST/PUT/DELETE - 需要admin权限
router.post(
  '/assign',
  roleMiddleware('admin', 'super_admin'),
  validateAssignTeacher,
  sanitizeBody,
  assignTeacher
);
router.post(
  '/auto-arrange',
  roleMiddleware('admin', 'super_admin'),
  validateAutoArrange,
  sanitizeBody,
  runAutoArrange
);
router.post(
  '/batch-auto-arrange',
  roleMiddleware('admin', 'super_admin'),
  validateBatchAutoArrange,
  sanitizeBody,
  runBatchAutoArrange
);
router.post(
  '/reset',
  roleMiddleware('admin', 'super_admin'),
  validateResetAuto,
  sanitizeBody,
  resetAutoAssignments
);
router.put(
  '/hour-settings',
  roleMiddleware('admin', 'super_admin'),
  validateHourSettings,
  sanitizeBody,
  saveHourSettings
);
router.delete(
  '/assignments/:id',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  deleteAssignment
);

// PATCH /assignments/:id/lock - 锁定/解锁单条教学安排
router.patch(
  '/assignments/:id/lock',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  sanitizeBody,
  toggleLock
);

// POST /lock-batch - 批量锁定/解锁
router.post('/lock-batch', roleMiddleware('admin', 'super_admin'), sanitizeBody, batchLock);

// POST /optimize-schedule - 排课优化（预览）
router.post(
  '/optimize-schedule',
  roleMiddleware('admin', 'super_admin'),
  sanitizeBody,
  runOptimizeSchedule
);

// POST /apply-optimize - 应用优化结果
router.post(
  '/apply-optimize',
  roleMiddleware('admin', 'super_admin'),
  sanitizeBody,
  applyOptimizeResult
);

export default router;
