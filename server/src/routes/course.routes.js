import { Router } from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { sanitizeBody } from '../middleware/xss.js';
import { validateIdParam, validateCourse, validateSortOrder, validateCourseCreate } from '../middleware/validation.js';
import {
  listCourses,
  createCourse,
  updateCourse,
  deleteCourse,
} from '../controllers/course.controller.js';

const router = Router();

// GET - 所有登录用户可访问
router.get('/', listCourses);

// POST/PUT/DELETE - 需要admin权限
router.post('/', roleMiddleware('admin', 'super_admin'), validateCourseCreate, sanitizeBody, createCourse);
router.put('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, validateSortOrder, sanitizeBody, updateCourse);
router.delete('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, deleteCourse);

export default router;
