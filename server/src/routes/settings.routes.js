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
  resetSystem,
  resetAuditLogs,
} from '../controllers/settings.controller.js';

const router = Router();

// 重置接口速率限制：每用户每小时最多 5 次（按操作类型独立计数）
// 设计说明：原实现提供 10 个分类清空按钮（教师/班级/课程/教材/专业/学院/层次/培养方案/系统重置/操作日志），
// 共享 max:3/小时 配额时，依次清空多个类型会触发 429 误伤（"清空班级失效"问题的根因）。
// 现已精简为 2 个端点（系统重置 + 清空操作日志），基础数据精细删除请使用基础数据页逐条删除。
const isDev = process.env.NODE_ENV === 'development';
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 小时
  max: 5,
  skip: () => isDev,
  keyGenerator: (req) => {
    // 按操作类型独立计数，避免不同类型相互影响
    const resetType = req.path.split('/').pop() || 'unknown';
    return req.user?.id ? `user:${req.user.id}:reset:${resetType}` : `${req.ip}:reset:${resetType}`;
  },
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '该操作过于频繁，请1小时后再试' },
});

// GET - 公开访问（登录页需要读取系统标识）
router.get('/', getSettings);

// M-15: 统一挂载认证 + 权限中间件，所有后续路由均需 super_admin
router.use(authMiddleware, roleMiddleware('super_admin'));

// PUT - 需要登录且为 super_admin 权限
router.put('/', sanitizeBody, updateSettings);

// POST /api/settings/initialize - 初始化接口
// 审计结论修正（保留，非死代码）：运维初始化入口，用于新环境部署时
// 一次性写入默认系统设置（幂等，已存在时跳过），供部署脚本/运维手动调用
router.post('/initialize', initializeSettings);

// 重置接口 - 需要super_admin权限和确认验证 + 严格速率限制
// 设计变更：仅保留「系统重置」和「清空操作日志」两个端点
// - 系统重置：清空所有业务数据（保留用户账号），适用于全量初始化场景
// - 清空操作日志：运维操作，与业务数据清空概念不同
// 其他分类清空（教师/班级/课程/教材/专业/学院/层次/培养方案）已移除，
// 如需精细删除请使用基础数据页（CollegeList/MajorList/...）的逐条删除功能（含级联保护）。
router.post('/reset/settings', resetLimiter, validateReset, resetSystem);
router.post('/reset/audit-logs', resetLimiter, validateAuditLogReset, resetAuditLogs);

export default router;
