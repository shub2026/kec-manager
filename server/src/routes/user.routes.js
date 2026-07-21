import express from 'express';
import { roleMiddleware } from '../middleware/auth.middleware.js';
import { validatePagination } from '../middleware/pagination.js';
import { sanitizeBody } from '../middleware/xss.js';
import {
  validateIdParam,
  validateUser,
  validateUserUpdate,
  validateUserStatus,
  validateResetPassword,
} from '../middleware/validation.js';
import {
  listUsers,
  createUser,
  updateUser,
  updateUserStatus,
  resetUserPassword,
  deleteUser,
} from '../controllers/user.controller.js';

const router = express.Router();

/**
 * GET /api/users
 * 获取用户列表
 */
router.get('/', roleMiddleware('super_admin'), validatePagination(100), listUsers);

/**
 * POST /api/users
 * 创建用户
 */
router.post('/', roleMiddleware('super_admin'), validateUser, sanitizeBody, createUser);

/**
 * PUT /api/users/:id
 * 更新用户信息
 */
router.put(
  '/:id',
  roleMiddleware('super_admin'),
  validateIdParam,
  validateUserUpdate,
  sanitizeBody,
  updateUser
);

/**
 * PUT /api/users/:id/status
 * 更新用户状态（激活/禁用）
 */
router.put(
  '/:id/status',
  roleMiddleware('super_admin'),
  validateIdParam,
  validateUserStatus,
  updateUserStatus
);

/**
 * PUT /api/users/:id/password
 * 重置用户密码（管理员操作，重置后用户下次登录须修改密码）
 */
router.put(
  '/:id/password',
  roleMiddleware('super_admin'),
  validateIdParam,
  validateResetPassword,
  resetUserPassword
);

/**
 * DELETE /api/users/:id
 * 删除用户
 */
router.delete('/:id', roleMiddleware('super_admin'), validateIdParam, deleteUser);

export default router;
