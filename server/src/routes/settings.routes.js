import { Router } from 'express';
import rateLimit from 'express-rate-limit';
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

// M-7修复：重置接口严格速率限制，每用户每小时最多 3 次
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 小时
  max: 3,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : req.ip),
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '重置操作过于频繁，请1小时后再试' },
});

// GET - 公开访问（登录页需要读取系统标识）
router.get('/', getSettings);

// M-15: 统一挂载认证 + 权限中间件，所有后续路由均需 super_admin
router.use(authMiddleware, roleMiddleware('super_admin'));

// PUT - 需要登录且为super_admin权限
router.put('/', sanitizeBody, updateSettings);

// POST /api/settings/initialize - 初始化接口
router.post('/initialize', initializeSettings);

// 重置接口 - 需要super_admin权限和确认验证 + 严格速率限制
router.post('/reset/basic', resetLimiter, validateReset, resetBasic);
router.post('/reset/majors', resetLimiter, validateReset, resetMajors);
router.post('/reset/colleges', resetLimiter, validateReset, resetColleges);
router.post('/reset/levels', resetLimiter, validateReset, resetLevels);
router.post('/reset/courses', resetLimiter, validateReset, resetCourses);
router.post('/reset/textbooks', resetLimiter, validateReset, resetTextbooks);
router.post('/reset/classes', resetLimiter, validateReset, resetClasses);
router.post('/reset/teachers', resetLimiter, validateReset, resetTeachers);
router.post('/reset/plans', resetLimiter, validateReset, resetPlans);
router.post('/reset/settings', resetLimiter, validateReset, resetSystem);
router.post('/reset/audit-logs', resetLimiter, validateAuditLogReset, resetAuditLogs);

export default router;
