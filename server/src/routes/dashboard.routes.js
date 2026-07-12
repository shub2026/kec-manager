import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { getDashboardStats, getDashboardInsights } from '../controllers/dashboard.controller.js';

const router = Router();

// 路由级认证中间件（纵深防御，即使 app.js 挂载时遗漏也能保护）
router.use(authMiddleware);

router.get('/stats', getDashboardStats);
router.get('/insights', getDashboardInsights);

export default router;
