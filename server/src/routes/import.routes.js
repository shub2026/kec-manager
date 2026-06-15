import { Router } from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import {
  importClasses,
  importCourses,
  importTextbooks,
  upload,
} from '../controllers/import.controller.js';

const router = Router();

/**
 * POST /api/import/classes - 批量导入班级
 */
router.post('/classes', roleMiddleware('admin', 'super_admin'), upload.single('file'), importClasses);

/**
 * POST /api/import/courses - 批量导入课程
 */
router.post('/courses', roleMiddleware('admin', 'super_admin'), upload.single('file'), importCourses);

/**
 * POST /api/import/textbooks - 批量导入教材
 */
router.post('/textbooks', roleMiddleware('admin', 'super_admin'), upload.single('file'), importTextbooks);

export default router;
