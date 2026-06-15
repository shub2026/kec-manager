import { Router } from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { validatePagination } from '../middleware/pagination.js';
import { listAuditLogs } from '../controllers/audit.controller.js';

const router = Router();

/**
 * GET /api/audit/logs - 查询操作日志（需要super_admin权限）
 */
router.get('/logs', roleMiddleware('super_admin'), validatePagination(100), listAuditLogs);

export default router;
