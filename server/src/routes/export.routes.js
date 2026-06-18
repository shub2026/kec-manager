import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
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
} from '../controllers/export/data-export.controller.js';

const router = Router();

// FC2修复：所有导出路由需要认证
router.use(authMiddleware);

// ==================== 模板下载 ====================

// GET /api/export/template/:type - 下载导入模板
router.get('/template/:type', downloadTemplate);

// ==================== 开课情况导出 ====================

// GET /api/export/semester - 导出当前学期开课情况（保留向后兼容）
router.get('/semester', exportSemesterSchedule);

// POST /api/export/semester - 导出开课情况（POST避免token暴露在URL中）
router.post('/semester', exportSemesterSchedulePost);

// ==================== 基础数据导出 ====================

// GET /api/export/courses - 导出课程数据
router.get('/courses', exportCourses);

// GET /api/export/textbooks - 导出教材数据
router.get('/textbooks', exportTextbooks);

// GET /api/export/classes - 导出班级数据
router.get('/classes', exportClasses);

// GET /api/export/teachers - 导出教师数据
router.get('/teachers', exportTeachers);

// ==================== 教学统计导出 ====================

// GET /api/export/statistics - 导出课时统计
router.get('/statistics', exportStatistics);

// ==================== 教材使用导出 ====================

// GET /api/export/textbook/:id - 导出教材使用情况
router.get('/textbook/:id', exportTextbookUsage);

export default router;
