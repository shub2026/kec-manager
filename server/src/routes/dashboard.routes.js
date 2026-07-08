import { Router } from 'express';
import { getDashboardStats, getDashboardInsights } from '../controllers/dashboard.controller.js';

const router = Router();

router.get('/stats', getDashboardStats);
router.get('/insights', getDashboardInsights);

export default router;
