import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validateIdParam } from '../middleware/validation.js';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { downloadTemplate } from '../controllers/export/export-template.controller.js';
import {
  exportSemesterSchedule,
  exportSemesterSchedulePost,
} from '../controllers/export/semester-export.controller.js';
import {
  exportCourses,
  exportTextbooks,
  exportClasses,
  exportTextbookUsage,
  exportTeachers,
  exportStatistics,
  exportTeachingArrange,
  exportCoursePlans,
} from '../controllers/export/data-export.controller.js';
import { issueDownloadTicket } from '../services/download-ticket.service.js'; // SEC-M2修复
import { success } from '../utils/response.js';

// 导出接口限流：防止并发全量导出导致 OOM（H-10 修复）
// S-11修复：Viewer角色导出同样受此10/min限流保护，如需更严格限制可后续增加角色感知的分级限流中间件
const isDev = process.env.NODE_ENV === 'development';
const exportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  skip: () => isDev,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '导出请求过于频繁，请稍后再试' },
});

const router = Router();

// authMiddleware 已在 app.js 挂载处统一应用
router.use(exportLimiter);

// SEC-M2修复：签发一次性下载票据
// 前端调用导出接口前先 POST 此端点获取 ticket，再用 ?ticket=<hex> 通过 window.open 下载
// 票据 30s 过期且单次消费，避免 JWT 进入 URL/日志/Referer
// 审计结论修正（保留，非死代码）：auth.middleware.js 的票据鉴权分支明确以此为
// 导出鉴权迁移目标端点，前端将逐步从 ?token= 切换到票据模式
router.post('/issue-ticket', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: '未授权' });
  }
  const ticket = issueDownloadTicket(req.user.id, req.user.role, req.user.username);
  success(res, { ticket, expires_in: 30 }, '票据签发成功，30秒内有效，仅可使用一次');
});

// ==================== 模板下载 ====================

// GET /api/export/template/:type - 下载导入模板（M-12修复：限制为admin+）
router.get('/template/:type', roleMiddleware('admin', 'super_admin'), downloadTemplate);

// ==================== 开课情况导出 ====================

// GET /api/export/semester - 导出当前学期开课情况（M-12修复：限制为admin+）
router.get('/semester', roleMiddleware('admin', 'super_admin'), exportSemesterSchedule);

// POST /api/export/semester - 导出开课情况（M-12修复：限制为admin+）
router.post('/semester', roleMiddleware('admin', 'super_admin'), exportSemesterSchedulePost);

// ==================== 基础数据导出 ====================

// GET /api/export/courses - 导出课程数据（M-12修复：限制为admin+）
router.get('/courses', roleMiddleware('admin', 'super_admin'), exportCourses);

// GET /api/export/textbooks - 导出教材数据（M-12修复：限制为admin+）
router.get('/textbooks', roleMiddleware('admin', 'super_admin'), exportTextbooks);

// GET /api/export/classes - 导出班级数据（M-12修复：限制为admin+）
router.get('/classes', roleMiddleware('admin', 'super_admin'), exportClasses);

// GET /api/export/teachers - 导出教师数据（含PII，需admin权限）
router.get('/teachers', roleMiddleware('admin', 'super_admin'), exportTeachers);

// ==================== 教学统计导出 ====================

// GET /api/export/statistics - 导出课时统计（含教师负荷，需admin权限）
router.get('/statistics', roleMiddleware('admin', 'super_admin'), exportStatistics);

// GET /api/export/teaching-arrange - 导出教学安排
router.get('/teaching-arrange', roleMiddleware('admin', 'super_admin'), exportTeachingArrange);

// ==================== 教材使用导出 ====================

// GET /api/export/textbook-usage - 导出全部教材使用情况（与单教材同控制器，缺省 id 即全量；限 admin+）
router.get('/textbook-usage', roleMiddleware('admin', 'super_admin'), exportTextbookUsage);

// GET /api/export/course-plans - 导出课程方案查询（与课程查询页同口径；限 admin+）
router.get('/course-plans', roleMiddleware('admin', 'super_admin'), exportCoursePlans);

// GET /api/export/textbook/:id - 导出教材使用情况（M-12修复：限制为admin+）
router.get(
  '/textbook/:id',
  validateIdParam,
  roleMiddleware('admin', 'super_admin'),
  exportTextbookUsage
);

export default router;
