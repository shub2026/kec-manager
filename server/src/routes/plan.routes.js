import { Router } from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { sanitizeBody } from '../middleware/xss.js'; // H7修复：XSS防护中间件
import {
  validateIdParam,
  validatePlan,
  validatePlanCourse,
  validateSemester,
  validatePlanTextbook,
  validatePlanCreate,
} from '../middleware/validation.js';
import { param } from 'express-validator';
import { handleValidationErrors } from '../middleware/validation.js';
import {
  listPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
} from '../controllers/plan/plan.controller.js';
import {
  listPlanCourses,
  addCourseToPlan,
  updatePlanCourse,
  updatePlanCourseSortOrder,
  deletePlanCourse,
  upsertSemester,
  updateSemester,
  listPlanSemesters,
  assignTextbookToSemester,
  removeSemesterTextbooks,
  deletePlanTextbook,
} from '../controllers/plan/plan-matrix.controller.js';

const router = Router();

// ==================== 培养方案CRUD ====================

// GET /api/plans - 获取方案列表（所有登录用户）
router.get('/', listPlans);

// GET /api/plans/:id - 获取单个方案（所有登录用户）
router.get('/:id', getPlanById);

// POST /api/plans - 创建方案（admin/super_admin）
router.post(
  '/',
  roleMiddleware('admin', 'super_admin'),
  validatePlanCreate,
  sanitizeBody,
  createPlan
);

// PUT /api/plans/:id - 更新方案（admin/super_admin）
router.put(
  '/:id',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  validatePlan,
  sanitizeBody,
  updatePlan
);

// DELETE /api/plans/:id - 删除方案（admin/super_admin）
router.delete('/:id', roleMiddleware('admin', 'super_admin'), validateIdParam, deletePlan);

// ==================== 方案课程管理 ====================

// GET /api/plans/:id/courses - 获取方案课程列表（所有登录用户）
router.get('/:id/courses', listPlanCourses);

// POST /api/plans/:id/courses - 添加课程到方案（admin/super_admin）
router.post(
  '/:id/courses',
  roleMiddleware('admin', 'super_admin'),
  validatePlanCourse,
  sanitizeBody,
  addCourseToPlan
);

// PUT /api/plans/courses/:id - 更新方案课程（admin/super_admin）
router.put(
  '/courses/:id',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  validatePlanCourse,
  sanitizeBody,
  updatePlanCourse
);

// PATCH /api/plans/courses/:id/sort-order - 仅更新课程排序（admin/super_admin）
// 严重-1 修复：排序走轻量端点，不触发学期记录重建，避免教材关联丢失
router.patch(
  '/courses/:id/sort-order',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  sanitizeBody,
  updatePlanCourseSortOrder
);

// DELETE /api/plans/courses/:id - 删除方案课程（admin/super_admin）
router.delete(
  '/courses/:id',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  deletePlanCourse
);

// ==================== 学期管理 ====================

// GET /api/plans/:id/semesters - 获取方案学期列表（所有登录用户）
router.get('/:id/semesters', listPlanSemesters);

// POST /api/plans/:planId/courses/:courseId/semesters - 添加/更新学期安排（admin/super_admin）
router.post(
  '/:planId/courses/:courseId/semesters',
  roleMiddleware('admin', 'super_admin'),
  [
    param('planId').isInt({ min: 1 }).withMessage('方案ID必须为正整数'),
    param('courseId').isInt({ min: 1 }).withMessage('课程ID必须为正整数'),
    handleValidationErrors,
  ],
  validateSemester,
  sanitizeBody,
  upsertSemester
);

// PUT /api/plans/semesters/:id - 更新学期安排（admin/super_admin）
router.put(
  '/semesters/:id',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  validateSemester,
  sanitizeBody,
  updateSemester
);

// ==================== 教材关联 ====================

// POST /api/plans/semesters/:id/textbooks - 关联教材到学期（admin/super_admin）
router.post(
  '/semesters/:id/textbooks',
  roleMiddleware('admin', 'super_admin'),
  validatePlanTextbook,
  sanitizeBody,
  assignTextbookToSemester
);

// DELETE /api/plans/semesters/:id/textbooks - 取消学期教材关联（admin/super_admin）
router.delete(
  '/semesters/:id/textbooks',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  removeSemesterTextbooks
);

// DELETE /api/plans/textbooks/:id - 删除教材关联记录（admin/super_admin）
router.delete(
  '/textbooks/:id',
  roleMiddleware('admin', 'super_admin'),
  validateIdParam,
  deletePlanTextbook
);

export default router;
