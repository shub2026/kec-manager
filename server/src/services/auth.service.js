import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { authConfig } from '../config/auth.config.js';
import { createAuditLog } from './audit.service.js';
import { AuthenticationError, ValidationError } from '../utils/error.js';
import { invalidateUserStatusCache } from '../middleware/auth.middleware.js';
import { log } from '../utils/logger.js';

// H2修复：Token黑名单负缓存，减少DB查询频率（10s TTL）
const blacklistNegativeCache = new Map();
const BLACKLIST_NEGATIVE_TTL = 10 * 1000;

// S-03修复：内存级黑名单正缓存，作为DB故障时的二级防护
const blacklistMemoryCache = new Map(); // jti -> expiresAt (ms timestamp)
const MEMORY_CACHE_MAX_SIZE = 10000;

// 定时清理过期黑名单记录（每小时一次）
setInterval(
  () => {
    AuthService.cleanExpiredBlacklist();
    // 同时清理负缓存中的过期条目
    const now = Date.now();
    for (const [key, value] of blacklistNegativeCache) {
      if (value.expireAt <= now) blacklistNegativeCache.delete(key);
    }
    // S-03: 清理内存正缓存中的过期条目
    const memNow = Date.now();
    for (const [k, exp] of blacklistMemoryCache) {
      if (exp <= memNow) blacklistMemoryCache.delete(k);
    }
  },
  60 * 60 * 1000
).unref();

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
        must_change_password: user.must_change_password,
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

  // H2修复：Token黑名单管理
  static async addToBlacklist(jti, expiresAt) {
    if (!jti) return;
    try {
      await prisma.token_blacklist.upsert({
        where: { jti },
        update: {},
        create: { jti, expires_at: new Date(expiresAt) },
      });
      // 从负缓存中移除（如果存在），确保下次检查命中DB
      blacklistNegativeCache.delete(jti);
      // S-03: 同时写入内存缓存
      const expiresMs = new Date(expiresAt).getTime();
      blacklistMemoryCache.set(jti, expiresMs);
      // 内存缓存容量保护：超过上限时清理过期条目
      if (blacklistMemoryCache.size > MEMORY_CACHE_MAX_SIZE) {
        const now = Date.now();
        for (const [k, exp] of blacklistMemoryCache) {
          if (exp <= now) blacklistMemoryCache.delete(k);
        }
      }
    } catch (error) {
      // 黑名单写入失败不应阻断主流程，但需记录日志
      log.error('Token黑名单写入失败', { error: error.message });
    }
  }

  static async isBlacklisted(jti) {
    if (!jti) return false;
    const now = Date.now();
    // S-03: 先查内存正缓存
    const memExpires = blacklistMemoryCache.get(jti);
    if (memExpires && memExpires > now) return true;
    if (memExpires && memExpires <= now) blacklistMemoryCache.delete(jti);
    // 检查负缓存：已知非黑名单的jti在TTL内直接返回false
    const cached = blacklistNegativeCache.get(jti);
    if (cached && cached.expireAt > now) return false;
    try {
      const entry = await prisma.token_blacklist.findUnique({ where: { jti } });
      if (entry) {
        // 同时写入内存正缓存
        blacklistMemoryCache.set(jti, new Date(entry.expires_at).getTime());
        return true;
      }
      // 记录负缓存，10s内不再查库
      blacklistNegativeCache.set(jti, { expireAt: now + BLACKLIST_NEGATIVE_TTL });
      return false;
    } catch {
      // DB异常时依赖内存缓存降级
      const memExp = blacklistMemoryCache.get(jti);
      if (memExp && memExp > now) return true;
      // 内存缓存也未命中，安全降级允许通过
      log.warn('Token黑名单DB查询失败，降级为内存缓存模式', { jti });
      return false;
    }
  }

  static async cleanExpiredBlacklist() {
    try {
      const result = await prisma.token_blacklist.deleteMany({
        where: { expires_at: { lt: new Date() } },
      });
      if (result.count > 0) {
        log.info(`已清理 ${result.count} 条过期黑名单记录`);
      }
    } catch (error) {
      log.error('清理过期黑名单失败', { error: error.message });
    }
  }

  static generateToken(user) {
    return jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        jti: crypto.randomUUID(),
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
        jti: crypto.randomUUID(),
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
      data: { password: hashedPassword, must_change_password: false },
    });

    // H3修复：密码修改后立即清除用户状态缓存，使后续请求重新查库验证
    invalidateUserStatusCache(userId);

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
