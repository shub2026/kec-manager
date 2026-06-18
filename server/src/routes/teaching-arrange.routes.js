import { Router } from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { sanitizeBody } from '../middleware/xss.js';
import { validateIdParam } from '../middleware/validation.js';
import {
  getCourseClasses,
  getCourseTeachers,
  assignTeacher,
  deleteAssignment,
  runAutoArrange,
  runBatchAutoArrange,
  resetAutoAssignments,
  getStatistics,
  getHourSettings,
  saveHourSettings,
} from '../controllers/teaching-arrange.controller.js';

const router = Router();

// GET - 所有登录用户可访问
router.get('/classes', getCourseClasses);
router.get('/teachers', getCourseTeachers);
router.get('/statistics', getStatistics);
router.get('/hour-settings', getHourSettings);

// POST/PUT/DELETE - 需要admin权限
router.post('/assign', roleMiddleware('admin', 'super_admin'), sanitizeBody, assignTeacher);
router.post('/auto-arrange', roleMiddleware('admin', 'super_admin'), sanitizeBody, runAutoArrange);
router.post('/batch-auto-arrange', roleMiddleware('admin', 'super_admin'), sanitizeBody, runBatchAutoArrange);
router.post('/reset', roleMiddleware('admin', 'super_admin'), sanitizeBody, resetAutoAssignments);
router.put('/hour-settings', roleMiddleware('admin', 'super_admin'), sanitizeBody, saveHourSettings);
router.delete('/assignments/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, deleteAssignment);

export default router;
