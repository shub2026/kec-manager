import { Router } from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware.js';
import { sanitizeBody } from '../middleware/xss.js';
import { validateReset } from '../middleware/validation.js';
import { validateAuditLogReset } from '../middleware/validation-audit.js';
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
  resetTeachers,
  resetPlans,
  resetSystem,
  resetAuditLogs,
} from '../controllers/settings.controller.js';

const router = Router();

// GET - 公开访问（登录页需要读取系统标识）
router.get('/', getSettings);

// M-15: 统一挂载认证 + 权限中间件，所有后续路由均需 super_admin
router.use(authMiddleware, roleMiddleware('super_admin'));

// PUT - 需要登录且为super_admin权限
router.put('/', sanitizeBody, updateSettings);

// POST /api/settings/initialize - 初始化接口
router.post('/initialize', initializeSettings);

// 重置接口 - 需要super_admin权限和确认验证
router.post('/reset/basic', validateReset, resetBasic);
router.post('/reset/majors', validateReset, resetMajors);
router.post('/reset/colleges', validateReset, resetColleges);
router.post('/reset/levels', validateReset, resetLevels);
router.post('/reset/courses', validateReset, resetCourses);
router.post('/reset/textbooks', validateReset, resetTextbooks);
router.post('/reset/classes', validateReset, resetClasses);
router.post('/reset/teachers', validateReset, resetTeachers);
router.post('/reset/plans', validateReset, resetPlans);
router.post('/reset/settings', validateReset, resetSystem);
router.post('/reset/audit-logs', validateAuditLogReset, resetAuditLogs);

export default router;
