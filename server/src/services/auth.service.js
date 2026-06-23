import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { authConfig } from '../config/auth.config.js';
import { createAuditLog } from './audit.service.js';
import { AuthenticationError, ValidationError } from '../utils/error.js';

export class AuthService {
  static async login(username, password, ip) {
    const user = await prisma.users.findUnique({
      where: { username },
    });

    if (!user) {
      await createAuditLog({
        action: 'login',
        module: 'auth',
        ip,
        details: { username },
        result: 'failed',
        message: `登录失败：用户 ${username} 不存在`,
      });
      throw new AuthenticationError('用户名或密码错误');
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      await createAuditLog({
        action: 'login',
        module: 'auth',
        userId: user.id,
        ip,
        details: { username },
        result: 'failed',
        message: `登录失败：密码错误`,
      });
      throw new AuthenticationError('用户名或密码错误');
    }

    if (!user.is_active) {
      await createAuditLog({
        action: 'login',
        module: 'auth',
        userId: user.id,
        ip,
        details: { username },
        result: 'failed',
        message: `登录失败：账号已被禁用`,
      });
      throw new AuthenticationError('账号已被禁用');
    }

    const token = this.generateToken(user);
    const refreshToken = this.generateRefreshToken(user);

    await prisma.users.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    await createAuditLog({
      action: 'login',
      module: 'auth',
      userId: user.id,
      ip,
      details: { username: user.username },
      result: 'success',
      message: `${user.username} 登录系统`,
    });

    return {
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        real_name: user.real_name,
        email: user.email,
      },
      token,
      refreshToken,
    };
  }

  static async refreshToken(refreshTokenValue) {
    let decoded;
    try {
      decoded = jwt.verify(refreshTokenValue, authConfig.jwtRefreshSecret);
    } catch (error) {
      throw new AuthenticationError('Refresh Token已过期或无效');
    }

    if (decoded.type !== 'refresh') {
      throw new AuthenticationError('无效的Token类型');
    }

    const user = await prisma.users.findUnique({
      where: { id: decoded.id },
    });

    if (!user || !user.is_active) {
      throw new AuthenticationError('用户不存在或已被禁用');
    }

    // M-9: DB 查询异常不再被包装为 AuthenticationError，保留原始错误类型
    const newToken = this.generateToken(user);
    const newRefreshToken = this.generateRefreshToken(user);
    return { token: newToken, refreshToken: newRefreshToken };
  }

  static generateToken(user) {
    return jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      authConfig.jwtSecret,
      { expiresIn: authConfig.jwtExpiresIn }
    );
  }

  static generateRefreshToken(user) {
    return jwt.sign(
      {
        id: user.id,
        type: 'refresh',
      },
      authConfig.jwtRefreshSecret, // M10修复：使用独立的Refresh密钥
      { expiresIn: authConfig.jwtRefreshExpiresIn }
    );
  }

  static verifyToken(token) {
    try {
      return jwt.verify(token, authConfig.jwtSecret);
    } catch (error) {
      return null;
    }
  }

  static generateDownloadToken(user) {
    return jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      authConfig.jwtDownloadSecret, // M10修复：使用独立的Download密钥
      { expiresIn: authConfig.jwtDownloadExpiresIn }
    );
  }

  static verifyDownloadToken(token) {
    try {
      return jwt.verify(token, authConfig.jwtDownloadSecret); // M10修复：使用独立的Download密钥
    } catch (error) {
      return null;
    }
  }

  static async changePassword(userId, oldPassword, newPassword, ip) {
    const user = await prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AuthenticationError('用户不存在');
    }

    const isValid = await bcrypt.compare(oldPassword, user.password);
    if (!isValid) {
      await createAuditLog({
        action: 'update',
        module: 'auth',
        userId,
        ip,
        details: { username: user.username, type: 'changePassword' },
        result: 'failed',
        message: `修改密码失败：原密码错误`,
      });
      throw new AuthenticationError('原密码错误');
    }

    const hashedPassword = await bcrypt.hash(newPassword, authConfig.bcryptRounds); // M9修复：使用配置的迭代次数
    await prisma.users.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    await createAuditLog({
      action: 'update',
      module: 'auth',
      userId,
      ip,
      details: { username: user.username, type: 'changePassword' },
      result: 'success',
      message: `${user.username} 修改密码`,
    });

    return { message: '密码修改成功' };
  }
}
