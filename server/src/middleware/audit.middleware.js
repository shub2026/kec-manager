import { createAuditLog } from '../services/audit.service.js';
import { log } from '../utils/logger.js';

/**
 * BIZ-H1 修复：路由级审计中间件兜底
 *
 * 设计目标：对所有写操作（POST/PUT/PATCH/DELETE）自动记录审计日志，
 * 避免依赖各控制器手动调用 createAuditLog 导致遗漏。
 *
 * 与控制器内细节审计的关系：
 * - 控制器内的 createAuditLog 仍可保留，记录业务语义级细节（如被删实体名）
 * - 本中间件记录路由级通用信息（方法/路径/状态码/操作人），作为兜底
 * - 通过 req._auditSuppressed 标记可让某路由跳过自动审计（如内部健康检查）
 *
 * 敏感字段脱敏：复用 xss.js 的字段白名单思路，密码/token 类字段不写入 details
 */

// 敏感字段：审计日志中脱敏（不记录原始值，仅记录字段是否存在）
const SENSITIVE_KEYS = new Set([
  'password',
  'old_password',
  'new_password',
  'oldPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'refreshToken',
  'refresh_token',
  'csrfToken',
  'download_token',
  'authorization',
]);

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// 不审计的路径前缀（健康检查、CSRF 获取、登录前的 OPTIONS 等）
const SKIP_PATH_PREFIXES = ['/api/health', '/api/auth/csrf-token'];

function shouldSkip(req) {
  if (req._auditSuppressed) return true;
  if (!WRITE_METHODS.has(req.method)) return true;
  return SKIP_PATH_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'));
}

function maskSensitive(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  const masked = Array.isArray(obj) ? [] : {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      masked[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitive(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

/**
 * 从请求路径推导模块名
 * 例如：/api/classes/123 → classes；/api/teaching-arrange/lock → teaching-arrange
 */
function deriveModule(req) {
  const parts = req.path.split('/').filter(Boolean);
  // /api/{module}/... → parts[1]
  if (parts.length >= 2 && parts[0] === 'api') {
    return parts[1];
  }
  return req.path;
}

/**
 * 审计中间件：在响应发送时记录
 * 注意：必须挂在 authMiddleware 之后（需要 req.user），路由之前
 */
export function auditMiddleware(req, res, next) {
  if (shouldSkip(req)) {
    return next();
  }

  // 拦截 res.send，在响应真正发送时记录审计
  const originalSend = res.send.bind(res);
  res.send = function (body) {
    // 防止重复记录（send 可能被多次调用，但只有首次实际发送）
    if (res._auditRecorded) {
      return originalSend(body);
    }
    res._auditRecorded = true;

    const statusCode = res.statusCode;
    const result = statusCode < 400 ? 'success' : 'failed';
    const module = deriveModule(req);

    // 异步记录，不阻塞响应
    createAuditLog({
      action: req.method.toLowerCase(),
      module,
      userId: req.user?.id,
      ip: req.ip,
      details: {
        path: req.originalUrl,
        method: req.method,
        body: maskSensitive(req.body) || undefined,
        status: statusCode,
      },
      result,
      message: `${req.method} ${req.originalUrl} → ${statusCode}`,
    }).catch((err) => {
      log.error('审计中间件记录失败', { error: err.message, path: req.originalUrl });
    });

    return originalSend(body);
  };

  next();
}
