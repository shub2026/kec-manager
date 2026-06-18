import { Router } from 'express';
import {
  importClasses,
  importCourses,
  importTextbooks,
  importTeachers,
  upload,
} from '../controllers/import.controller.js';

const router = Router();

// authMiddleware + roleMiddleware 已在 app.js 挂载处统一应用

/**
 * POST /api/import/classes - 批量导入班级
 */
router.post('/classes', upload.single('file'), importClasses);

/**
 * POST /api/import/courses - 批量导入课程
 */
router.post('/courses', upload.single('file'), importCourses);

/**
 * POST /api/import/textbooks - 批量导入教材
 */
router.post('/textbooks', upload.single('file'), importTextbooks);

/**
 * POST /api/import/teachers - 批量导入教师
 */
router.post('/teachers', upload.single('file'), importTeachers);

export default router;
