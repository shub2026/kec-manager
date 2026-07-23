import { log } from '../utils/logger.js';
import { verifyCsrfSignature } from '../utils/csrf.js';

/**
 * CSRF Token 验证中间件（Double Submit Cookie + HMAC 签名模式）
 * H-5修复：在原有 Double Submit 基础上增加 HMAC 签名验证，
 * 防止攻击者通过 XSS 自行设置匹配的 XSRF-TOKEN cookie + X-CSRF-Token 头绕过验证。
 * 验证流程：
 * 1. 请求头 X-CSRF-Token 与 Cookie XSRF-TOKEN 一致（Double Submit）
 * 2. token 的 HMAC 签名有效（服务端密钥签名，攻击者无法伪造）
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
    log.warn('CSRF验证失败（Double Submit不一致）', {
      hasHeaderToken: !!headerToken,
      hasCookieToken: !!cookieToken,
      ip: req.ip,
      path: req.path,
    });
    return res.status(403).json({ success: false, message: 'CSRF验证失败，请刷新页面后重试' });
  }

  // H-5修复：HMAC签名验证，防止攻击者伪造token
  if (!verifyCsrfSignature(cookieToken)) {
    log.warn('CSRF验证失败（HMAC签名无效）', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(403).json({ success: false, message: 'CSRF令牌无效，请刷新页面后重试' });
  }

  next();
}
