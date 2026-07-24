import { AuthService } from '../services/auth.service.js';
import { prisma } from '../lib/prisma.js';
import { log } from '../utils/logger.js'; // L1修复：使用winston logger
import { consumeDownloadTicket } from '../services/download-ticket.service.js'; // SEC-M2修复

// 用户状态缓存：短期内复用查询结果，避免每个请求都查库（TTL 5s，已从30秒缩短）
const userStatusCache = new Map();
const USER_STATUS_TTL = 5 * 1000;
const CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of userStatusCache) {
    if (value.expireAt <= now) userStatusCache.delete(key);
  }
}, CACHE_CLEANUP_INTERVAL).unref();

// M-2: 用户状态变更时主动清除缓存，避免等待 TTL 过期
export function invalidateUserStatusCache(userId) {
  if (userId != null) userStatusCache.delete(userId);
}

async function getActiveUserStatus(userId) {
  const now = Date.now();
  const cached = userStatusCache.get(userId);
  if (cached && cached.expireAt > now) {
    return cached;
  }
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, role: true, is_active: true, must_change_password: true, token_version: true },
  });
  // M-3: null 用户显式存储 is_active: false，避免 {...null} 产生空对象
  const result = user
    ? {
        role: user.role,
        is_active: user.is_active,
        must_change_password: user.must_change_password,
        token_version: user.token_version,
      }
    : { role: null, is_active: false, must_change_password: false, token_version: null };
  userStatusCache.set(userId, { ...result, expireAt: now + USER_STATUS_TTL });
  return result;
}

// SEC-H2: 强制改密期间仅放行的接口路径（认证自身 + 改密）
const MUST_CHANGE_PASSWORD_ALLOWED_PATHS = new Set([
  '/api/auth/password',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/csrf-token',
]);

export async function authMiddleware(req, res, next) {
  let token = null;

  // 从 Authorization 头获取
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }
  // 备选：从 HttpOnly Cookie 获取（后端 Set-Cookie 设置，JS 不可读）
  if (!token && req.headers.cookie) {
    const cookies = {};
    req.headers.cookie.split(';').forEach((c) => {
      const [name, ...rest] = c.trim().split('=');
      if (name) cookies[name] = decodeURIComponent(rest.join('='));
    });
    if (cookies['token']) {
      token = cookies['token'];
    }
  }
  // 备选：从查询参数获取一次性下载票据（SEC-M2修复，替代 download_token）
  // 票据为 24 字节随机 hex，30s 过期，单次消费，避免 JWT 进入 URL/日志
  if (!token && req.query.ticket) {
    const ticketInfo = consumeDownloadTicket(req.query.ticket);
    if (ticketInfo) {
      try {
        const status = await getActiveUserStatus(ticketInfo.userId);
        if (!status || !status.is_active) {
          return res.status(401).json({
            success: false,
            message: '账号不存在或已被禁用',
          });
        }
        // SEC-H1: 票据签发后若用户 token_version 变化（改密/重置），票据仍可能有效
        // 但票据 30s 过期且一次性，风险可控；这里仍校验用户状态确保账号未被禁用
        // SEC-H2: 强制改密期间禁止下载（导出敏感数据）
        if (status.must_change_password) {
          return res.status(403).json({
            success: false,
            code: 'MUST_CHANGE_PASSWORD',
            message: '请先修改初始密码',
          });
        }
        req.user = {
          id: ticketInfo.userId,
          username: ticketInfo.username,
          role: status.role,
        };
      } catch (err) {
        log.error('下载票据用户状态校验失败', { message: err.message });
        return res.status(500).json({ success: false, message: '服务内部错误' });
      }
      return next();
    }
    return res.status(401).json({
      success: false,
      message: '下载票据无效或已过期',
    });
  }

  // 备选：从查询参数获取短期下载令牌（用于 window.open 等场景，有效期60秒）
  // SEC-M2: 已废弃，保留向后兼容，建议前端迁移到 /api/export/issue-ticket + ?ticket=
  if (!token && req.query.download_token) {
    const decoded = AuthService.verifyDownloadToken(req.query.download_token);
    if (decoded) {
      // S-12 修复：下载令牌也需校验用户状态，防止被禁用用户在令牌有效期内绕过
      try {
        const status = await getActiveUserStatus(decoded.id);
        if (!status || !status.is_active) {
          return res.status(401).json({
            success: false,
            message: '账号不存在或已被禁用',
          });
        }
        // SEC-H1: 下载令牌同样校验 token_version
        if (decoded.v !== undefined && status.token_version !== null && decoded.v !== status.token_version) {
          return res.status(401).json({
            success: false,
            message: '凭证已失效，请重新登录',
          });
        }
        // SEC-H2: 强制改密期间禁止下载（导出敏感数据）
        if (status.must_change_password) {
          return res.status(403).json({
            success: false,
            code: 'MUST_CHANGE_PASSWORD',
            message: '请先修改初始密码',
          });
        }
        req.user = { ...decoded, role: status.role };
      } catch (err) {
        log.error('下载令牌用户状态校验失败', { message: err.message });
        return res.status(500).json({ success: false, message: '服务内部错误' });
      }
      return next();
    }
    return res.status(401).json({
      success: false,
      message: '下载令牌无效或已过期',
    });
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: '未授权，请先登录',
    });
  }

  const decoded = AuthService.verifyToken(token);

  if (!decoded) {
    return res.status(401).json({
      success: false,
      message: 'Token无效或已过期',
    });
  }

  // H2修复：检查Token是否在黑名单中（已登出/已重置的Token）
  try {
    if (decoded.jti && (await AuthService.isBlacklisted(decoded.jti))) {
      return res.status(401).json({
        success: false,
        message: 'Token已失效，请重新登录',
      });
    }
  } catch (err) {
    log.error('Token黑名单检查失败', { message: err.message });
    // 黑名单检查失败不阻断请求（安全降级）
  }

  // 校验用户是否仍存在且处于激活状态，并获取最新角色（防止降级/禁用后旧 token 仍生效）
  try {
    const status = await getActiveUserStatus(decoded.id);
    if (!status || !status.is_active) {
      return res.status(401).json({
        success: false,
        message: '账号不存在或已被禁用，请重新登录',
      });
    }
    // SEC-H1: 校验 token_version，密码重置/会话吊销后旧令牌立即失效
    // （旧令牌 payload 不含 v 字段，decoded.v === undefined；此时若用户 token_version > 0 则视为已吊销）
    if (status.token_version !== null) {
      if (decoded.v === undefined || decoded.v !== status.token_version) {
        return res.status(401).json({
          success: false,
          message: '凭证已失效，请重新登录',
        });
      }
    }
    // SEC-H2: 强制改密期间仅放行认证自身接口
    if (status.must_change_password && !MUST_CHANGE_PASSWORD_ALLOWED_PATHS.has(req.path)) {
      return res.status(403).json({
        success: false,
        code: 'MUST_CHANGE_PASSWORD',
        message: '请先修改初始密码',
      });
    }
    // 使用数据库中的最新角色，避免旧 token 中的角色信息过期
    req.user = { ...decoded, role: status.role };
    next();
  } catch (err) {
    log.error('用户状态校验失败', { message: err.message });
    next(err);
  }
}

export function roleMiddleware(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: '未授权',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      log.warn('用户尝试访问受限资源', { username: req.user.username, role: req.user.role });

      return res.status(403).json({
        success: false,
        message: '权限不足，无法执行此操作',
      });
    }

    next();
  };
}
