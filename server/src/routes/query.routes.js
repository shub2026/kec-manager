import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { validateIdParam } from '../middleware/validation.js';
import { querySemester, queryTextbookUsage } from '../controllers/query.controller.js';

const router = Router();

// 路由级认证中间件（纵深防御）
router.use(authMiddleware);

/**
 * GET /api/query/semester - 当前学期开课查询
 */
router.get('/semester', querySemester);

/**
 * GET /api/query/textbook/:id - 教材使用情况查询
 */
router.get('/textbook/:id', validateIdParam, queryTextbookUsage);

export default router;
