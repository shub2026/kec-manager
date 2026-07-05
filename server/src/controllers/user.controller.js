import { prisma } from '../lib/prisma.js';
import bcrypt from 'bcryptjs';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { NotFoundError, ValidationError, AuthorizationError } from '../utils/error.js';
import { authConfig } from '../config/auth.config.js';
import { invalidateUserStatusCache } from '../middleware/auth.middleware.js';

/**
 * 获取用户列表
 */
export async function listUsers(req, res, next) {
  try {
    const where = {};
    if (req.user.role === 'admin') {
      where.role = 'viewer';
    }

    const users = await prisma.users.findMany({
      where,
      select: {
        id: true,
        username: true,
        real_name: true,
        email: true,
        role: true,
        is_active: true,
        last_login_at: true,
        created_at: true,
      },
      take: Math.min(req.query.limit ? Number(req.query.limit) : 1000, 1000),
      orderBy: { created_at: 'desc' },
    });

    success(res, users);
  } catch (error) {
    next(error);
  }
}

/**
 * 创建用户
 */
export async function createUser(req, res, next) {
  try {
    const { username, password, real_name, email, role } = req.body;

    if (!username || !password) {
      throw new ValidationError('用户名和密码为必填项');
    }

    if (req.user.role === 'admin' && role !== 'viewer') {
      throw new AuthorizationError('权限不足，管理员只能创建访客账号');
    }

    if (!['super_admin', 'admin', 'viewer'].includes(role)) {
      throw new ValidationError('无效的角色');
    }

    const existingUser = await prisma.users.findUnique({ where: { username } });
    if (existingUser) {
      throw new ValidationError('用户名已存在');
    }

    const hashedPassword = await bcrypt.hash(password, authConfig.bcryptRounds);

    const user = await prisma.users.create({
      data: { username, password: hashedPassword, real_name, email, role, must_change_password: true },
      select: {
        id: true,
        username: true,
        real_name: true,
        email: true,
        role: true,
        is_active: true,
      },
    });

    await createAuditLog({
      action: 'create',
      module: 'user',
      userId: req.user.id,
      ip: req.ip,
      details: { id: user.id, username, role },
      result: 'success',
      message: `创建用户：${username}`,
    });

    success(res, user, '创建成功');
  } catch (error) {
    await createAuditLog({
      action: 'create',
      module: 'user',
      userId: req.user?.id,
      ip: req.ip,
      details: { username: req.body.username, error: error.message },
      result: 'failed',
      message: `创建用户失败：${error.message}`,
    });
    next(error);
  }
}

/**
 * 更新用户信息
 */
export async function updateUser(req, res, next) {
  try {
    const { id } = req.params;
    const { real_name, email, role } = req.body;

    if (parseInt(id) === req.user.id && role) {
      throw new AuthorizationError('不能修改自己的角色');
    }

    const user = await prisma.users.findUnique({ where: { id: parseInt(id) } });
    if (!user) {
      throw new NotFoundError('用户不存在');
    }

    // 禁止编辑超级管理员（防止误改角色）
    if (user.role === 'super_admin' && req.user.id !== user.id) {
      throw new AuthorizationError('不允许修改超级管理员账号');
    }

    if (req.user.role === 'admin' && user.role !== 'viewer') {
      throw new AuthorizationError('权限不足，管理员只能管理访客账号');
    }

    const updateData = {};
    if (real_name !== undefined) updateData.real_name = real_name;
    if (email !== undefined) updateData.email = email;

    if (req.user.role === 'super_admin' && role !== undefined) {
      updateData.role = role;
    }

    const updated = await prisma.users.update({
      where: { id: parseInt(id) },
      data: updateData,
      select: {
        id: true,
        username: true,
        real_name: true,
        email: true,
        role: true,
      },
    });

    // M-2: 角色变更时立即清除认证缓存
    if (role) invalidateUserStatusCache(parseInt(id));

    await createAuditLog({
      action: 'update',
      module: 'user',
      userId: req.user.id,
      ip: req.ip,
      details: { id: user.id, username: user.username, changes: updateData },
      result: 'success',
      message: `更新用户：${user.username}`,
    });

    success(res, updated, '更新成功');
  } catch (error) {
    await createAuditLog({
      action: 'update',
      module: 'user',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: req.params.id, changes: req.body, error: error.message },
      result: 'failed',
      message: `更新用户失败：${error.message}`,
    });
    next(error);
  }
}

/**
 * 更新用户状态
 */
export async function updateUserStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (parseInt(id) === req.user.id) {
      throw new AuthorizationError('不能禁用自己');
    }

    const user = await prisma.users.findUnique({ where: { id: parseInt(id) } });
    if (!user) {
      throw new NotFoundError('用户不存在');
    }

    if (user.role === 'super_admin') {
      throw new AuthorizationError('不能操作超级管理员账户');
    }

    if (req.user.role === 'admin' && user.role !== 'viewer') {
      throw new AuthorizationError('权限不足，管理员只能管理访客账号');
    }

    await prisma.users.update({
      where: { id: parseInt(id) },
      data: { is_active },
    });

    // M-2: 状态变更时立即清除认证缓存，使禁用/启用立即生效
    invalidateUserStatusCache(parseInt(id));

    await createAuditLog({
      action: 'update',
      module: 'user',
      userId: req.user.id,
      ip: req.ip,
      details: { id: user.id, username: user.username, is_active },
      result: 'success',
      message: `${is_active ? '激活' : '禁用'}用户：${user.username}`,
    });

    success(res, null, `${is_active ? '激活' : '禁用'}成功`);
  } catch (error) {
    await createAuditLog({
      action: 'update',
      module: 'user',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: req.params.id, is_active: req.body.is_active, error: error.message },
      result: 'failed',
      message: `更新用户状态失败：${error.message}`,
    });
    next(error);
  }
}

/**
 * 删除用户
 *
 * P2-9: 删除用户后未对仍有效的活跃 JWT 做黑名单处理。
 * 安全兜底：auth.middleware.js#getActiveUserStatus 对 null 用户返回 is_active=false，
 * 被删用户的后续请求在 30s 缓存 TTL 内即会被拦截（401）。
 * 如需更严格可引入 Redis 黑名单，当前 TTL 内安全可接受。
 */
export async function deleteUser(req, res, next) {
  try {
    const { id } = req.params;

    if (parseInt(id) === req.user.id) {
      throw new AuthorizationError('不能删除自己');
    }

    const user = await prisma.users.findUnique({ where: { id: parseInt(id) } });
    if (!user) {
      throw new NotFoundError('用户不存在');
    }

    if (user.role === 'super_admin') {
      throw new AuthorizationError('不能删除超级管理员账户');
    }

    if (req.user.role === 'admin' && user.role !== 'viewer') {
      throw new AuthorizationError('权限不足，管理员只能删除访客账号');
    }

    await prisma.users.delete({ where: { id: parseInt(id) } });

    // S-09修复：删除用户后立即清除缓存，使该用户的token在下次请求时失效
    invalidateUserStatusCache(user.id);

    await createAuditLog({
      action: 'delete',
      module: 'user',
      userId: req.user.id,
      ip: req.ip,
      details: { id: user.id, username: user.username },
      result: 'success',
      message: `删除用户：${user.username}`,
    });

    success(res, null, '删除成功');
  } catch (error) {
    await createAuditLog({
      action: 'delete',
      module: 'user',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: req.params.id, error: error.message },
      result: 'failed',
      message: `删除用户失败：${error.message}`,
    });
    next(error);
  }
}
