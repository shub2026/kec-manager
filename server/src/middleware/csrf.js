import { log } from '../utils/logger.js';

/**
 * S-04修复：CSRF Token 验证中间件
 * 前端已在请求拦截器中发送 X-CSRF-Token 头（从cookie读取）
 * 此中间件验证该token与服务端cookie中存储的csrf_token一致（Double Submit Cookie模式）
 */
export function validateCsrf(req, res, next) {
  // 安全方法不需要CSRF验证
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // 从请求头获取CSRF token
  const headerToken = req.headers['x-csrf-token'];

  // 从cookie获取CSRF token
  // 解析cookie（不依赖cookie-parser，手动解析）
  const cookies = {};
  if (req.headers.cookie) {
    req.headers.cookie.split(';').forEach((cookie) => {
      const [name, ...rest] = cookie.trim().split('=');
      if (name) cookies[name] = decodeURIComponent(rest.join('='));
    });
  }
  const cookieToken = cookies['csrf_token'];

  // 如果前端还没有设置csrf_token cookie（首次登录等场景），跳过验证
  // 这确保了向下兼容
  if (!cookieToken && !headerToken) {
    return next();
  }

  // Double Submit: 头中的token必须与cookie中的token一致
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    log.warn('CSRF验证失败', {
      hasHeaderToken: !!headerToken,
      hasCookieToken: !!cookieToken,
      ip: req.ip,
      path: req.path,
    });
    return res.status(403).json({ success: false, message: 'CSRF验证失败，请刷新页面后重试' });
  }

  next();
}
