import { Router } from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware.js';
import { sanitizeBody } from '../middleware/xss.js';
import { validateReset } from '../middleware/validation.js';
import {
  getSettings,
  updateSettings,
  initializeSettings,
  resetBasic,
  resetMajors,
  resetColleges,
  resetLevels,
  resetCourses,
  resetTextbooks,
  resetClasses,
  resetPlans,
  resetSystem,
  resetAuditLogs,
} from '../controllers/settings.controller.js';

const router = Router();

// GET - 公开访问（登录页需要读取系统标识）
router.get('/', getSettings);

// PUT - 需要登录且为super_admin权限
router.put('/', authMiddleware, roleMiddleware('super_admin'), sanitizeBody, updateSettings);

// POST /api/settings/initialize - 初始化接口
router.post('/initialize', authMiddleware, roleMiddleware('super_admin'), initializeSettings);

// 重置接口 - 需要super_admin权限和确认验证
router.post('/reset/basic', authMiddleware, roleMiddleware('super_admin'), validateReset, resetBasic);
router.post('/reset/majors', authMiddleware, roleMiddleware('super_admin'), validateReset, resetMajors);
router.post('/reset/colleges', authMiddleware, roleMiddleware('super_admin'), validateReset, resetColleges);
router.post('/reset/levels', authMiddleware, roleMiddleware('super_admin'), validateReset, resetLevels);
router.post('/reset/courses', authMiddleware, roleMiddleware('super_admin'), validateReset, resetCourses);
router.post('/reset/textbooks', authMiddleware, roleMiddleware('super_admin'), validateReset, resetTextbooks);
router.post('/reset/classes', authMiddleware, roleMiddleware('super_admin'), validateReset, resetClasses);
router.post('/reset/plans', authMiddleware, roleMiddleware('super_admin'), validateReset, resetPlans);
router.post('/reset/settings', authMiddleware, roleMiddleware('super_admin'), validateReset, resetSystem);
router.post('/reset/audit-logs', authMiddleware, roleMiddleware('super_admin'), validateReset, resetAuditLogs);

export default router;
