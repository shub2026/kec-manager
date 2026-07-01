import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  importClasses,
  importCourses,
  importTextbooks,
  importTeachers,
  upload,
} from '../controllers/import.controller.js';

const router = Router();

// authMiddleware + roleMiddleware 已在 app.js 挂载处统一应用

// 导入接口独立限流：每分钟最多 5 次，防止频繁导入压垮数据库
const importLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: '导入操作过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/import/classes - 批量导入班级
 */
router.post('/classes', importLimiter, upload.single('file'), importClasses);

/**
 * POST /api/import/courses - 批量导入课程
 */
router.post('/courses', importLimiter, upload.single('file'), importCourses);

/**
 * POST /api/import/textbooks - 批量导入教材
 */
router.post('/textbooks', importLimiter, upload.single('file'), importTextbooks);

/**
 * POST /api/import/teachers - 批量导入教师
 */
router.post('/teachers', importLimiter, upload.single('file'), importTeachers);

export default router;
