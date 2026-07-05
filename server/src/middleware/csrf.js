import { log } from '../utils/logger.js';

/**
 * CSRF Token 验证中间件（Double Submit Cookie 模式）
 * 后端登录时通过 Set-Cookie 设置 XSRF-TOKEN（非 HttpOnly，JS 可读），
 * 前端请求拦截器从该 Cookie 读取并设置 X-CSRF-Token 请求头，
 * 此中间件验证请求头与 Cookie 中的 token 一致。
 */
export function validateCsrf(req, res, next) {
  // 安全方法不需要CSRF验证
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // 从请求头获取CSRF token
  const headerToken = req.headers['x-csrf-token'];

  // 从cookie获取CSRF token（解析cookie，不依赖cookie-parser）
  const cookies = {};
  if (req.headers.cookie) {
    req.headers.cookie.split(';').forEach((cookie) => {
      const [name, ...rest] = cookie.trim().split('=');
      if (name) cookies[name] = decodeURIComponent(rest.join('='));
    });
  }
  const cookieToken = cookies['XSRF-TOKEN'];

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
