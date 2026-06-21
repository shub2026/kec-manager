import { prisma } from '../lib/prisma.js';
import bcrypt from 'bcryptjs';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { NotFoundError, ValidationError, AuthorizationError } from '../utils/error.js';
import { authConfig } from '../config/auth.config.js';

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
      data: { username, password: hashedPassword, real_name, email, role },
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

    if (req.user.role === 'admin' && user.role !== 'viewer') {
      throw new AuthorizationError('权限不足，管理员只能管理访客账号');
    }

    const updateData = { real_name, email };

    if (req.user.role === 'super_admin' && role) {
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

    await createAuditLog({
      action: 'update',
      module: 'user',
      userId: req.user.id,
      ip: req.ip,
      details: { id: user.id, username, changes: updateData },
      result: 'success',
      message: `更新用户：${user.username}`,
    });

    success(res, updated, '更新成功');
  } catch (error) {
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
    next(error);
  }
}

/**
 * 删除用户
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
    next(error);
  }
}
