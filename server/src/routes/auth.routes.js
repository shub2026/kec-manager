import express from 'express';
import crypto from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { AuthService } from '../services/auth.service.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { success, fail } from '../utils/response.js';
import { prisma } from '../lib/prisma.js';
import jwt from 'jsonwebtoken';
import { authConfig } from '../config/auth.config.js';
import { createAuditLog } from '../services/audit.service.js';
import { AuthenticationError, ValidationError } from '../utils/error.js';
import { sanitizeBody } from '../middleware/xss.js'; // H7修复：XSS防护中间件
import { validateChangePassword, validateLogin } from '../middleware/validation.js';

const router = express.Router();

const isSecure = process.env.NODE_ENV === 'production';

function setAuthCookies(res, { token, refreshToken, csrfToken }) {
  if (token) {
    res.cookie('token', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
      path: '/',
    });
  }
  if (refreshToken) {
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }
  if (csrfToken) {
    res.cookie('XSRF-TOKEN', csrfToken, {
      secure: isSecure,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }
}

function clearAuthCookies(res) {
  const opts = { httpOnly: true, secure: isSecure, sameSite: 'strict', path: '/' };
  res.clearCookie('token', opts);
  res.clearCookie('refreshToken', opts);
  res.clearCookie('XSRF-TOKEN', { secure: isSecure, sameSite: 'strict', path: '/' });
}

function parseCookies(req) {
  const cookies = {};
  if (req.headers.cookie) {
    req.headers.cookie.split(';').forEach((c) => {
      const [name, ...rest] = c.trim().split('=');
      if (name) cookies[name] = decodeURIComponent(rest.join('='));
    });
  }
  return cookies;
}

// 速率限制配置
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 10, // 每个IP最多10次
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '登录尝试过于频繁，请15分钟后再试' },
});

// 基于用户名的登录限流：防止针对单一账号的暴力破解
const usernameLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req, res) => req.body?.username || ipKeyGenerator(req, res),
  message: { success: false, message: '该账号登录尝试过于频繁，请15分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '刷新Token请求过于频繁，请稍后再试' },
});

// 自定义限流key生成器：优先使用用户ID，降级到IP
const generateKeyByUserOrIp = (req) => {
  // 如果用户已认证，使用用户ID作为限流key
  if (req.user && req.user.id) {
    return `user:${req.user.id}`;
  }
  // 否则返回null，让express-rate-limit使用默认的IP检测
  return null;
};

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 每个用户/IP最多10次
  keyGenerator: generateKeyByUserOrIp,
  validate: false, // 禁用IPv6验证警告
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '修改密码请求过于频繁，请15分钟后再试' },
});

const logoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '登出请求过于频繁，请稍后再试' },
});

router.post('/login', loginLimiter, usernameLimiter, validateLogin, async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      throw new ValidationError('请输入用户名和密码');
    }

    const result = await AuthService.login(username, password, req.ip);

    const csrfToken = crypto.randomBytes(32).toString('hex');
    setAuthCookies(res, {
      token: result.token,
      refreshToken: result.refreshToken,
      csrfToken,
    });

    success(res, { ...result, csrfToken }, '登录成功');
  } catch (error) {
    next(error);
  }
});

router.post('/refresh', refreshLimiter, async (req, res, next) => {
  try {
    const cookies = parseCookies(req);
    const refresh_token = req.body.refresh_token || cookies['refreshToken'];

    if (!refresh_token) {
      throw new ValidationError('请提供Refresh Token');
    }

    const result = await AuthService.refreshToken(refresh_token);

    // H2+M4修复：将旧Refresh Token加入黑名单，防止重放攻击
    try {
      const oldDecoded = jwt.verify(refresh_token, authConfig.jwtRefreshSecret);
      if (oldDecoded.jti) {
        await AuthService.addToBlacklist(oldDecoded.jti, (oldDecoded.exp || 0) * 1000);
      }
    } catch {
      // 旧token已过期或无效，无需黑名单
    }

    const csrfToken = crypto.randomBytes(32).toString('hex');
    setAuthCookies(res, {
      token: result.token,
      refreshToken: result.refreshToken,
      csrfToken,
    });

    success(res, { ...result, csrfToken });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', logoutLimiter, async (req, res, next) => {
  try {
    const cookies = parseCookies(req);
    const headerToken = req.headers.authorization?.substring(7);
    const token = headerToken || cookies['token'] || null;
    const decoded = token ? AuthService.verifyToken(token) : null;

    if (decoded) {
      // H2修复：将Access Token加入黑名单
      if (decoded.jti) {
        await AuthService.addToBlacklist(decoded.jti, (decoded.exp || 0) * 1000);
      }

      await createAuditLog({
        action: 'logout',
        module: 'auth',
        userId: decoded.id,
        ip: req.ip,
        details: { username: decoded.username },
        result: 'success',
        message: `${decoded.username} 登出系统`,
      });
    }

    clearAuthCookies(res);
    success(res, null, '登出成功');
  } catch (error) {
    next(error);
  }
});

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await prisma.users.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        username: true,
        role: true,
        real_name: true,
        email: true,
        must_change_password: true,
        last_login_at: true,
        created_at: true,
      },
    });

    success(res, user);
  } catch (error) {
    next(error);
  }
});

// 生成短期下载令牌（用于 window.open 等无法设置 Authorization 头的场景）
router.post('/download-token', authMiddleware, async (req, res, next) => {
  try {
    const downloadToken = AuthService.generateDownloadToken(req.user);

    await createAuditLog({
      action: 'generate_token',
      module: 'auth',
      userId: req.user.id,
      ip: req.ip,
      details: { username: req.user.username, token_type: 'download' },
      result: 'success',
      message: `${req.user.username} 生成下载令牌`,
    });

    success(res, { downloadToken });
  } catch (error) {
    next(error);
  }
});

router.put(
  '/password',
  authMiddleware,
  passwordLimiter,
  validateChangePassword,
  sanitizeBody,
  async (req, res, next) => {
    try {
      const { old_password, new_password } = req.body;

      if (!old_password || !new_password) {
        throw new ValidationError('请提供原密码和新密码');
      }

      if (new_password.length < 8) {
        throw new ValidationError('新密码长度至少8位');
      }

      await AuthService.changePassword(req.user.id, old_password, new_password, req.ip);

      // H2修复：密码修改后将当前Token加入黑名单
      const cookies = parseCookies(req);
      const headerToken = req.headers.authorization?.substring(7);
      const token = headerToken || cookies['token'] || null;
      if (token) {
        const decoded = AuthService.verifyToken(token);
        if (decoded?.jti) {
          await AuthService.addToBlacklist(decoded.jti, (decoded.exp || 0) * 1000);
        }
      }

      clearAuthCookies(res);
      success(res, null, '密码修改成功，请重新登录');
    } catch (error) {
      next(error);
    }
  }
);

export default router;
