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

  // 小程序 / API 客户端路径：
  // 使用 Authorization: Bearer <jwt> 做无状态认证。CSRF 只防御"浏览器自动携带 Cookie 的会话劫持"，
  // Bearer Token 由客户端（JS / 小程序）显式附加，跨站攻击者无法读取并自动携带，
  // 因此天然免疫 CSRF。只要请求带 Bearer 即放行，真实鉴权由 authMiddleware 校验签名完成。
  // WEB 端同样在请求头携带 Bearer（来自 localStorage），故 WEB 端行为完全不变；
  // 即便某次 WEB 请求未带 Bearer，下方仍走完整 Double Submit，不回归。
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    return next();
  }

  // 从cookie获取CSRF token（解析cookie，不依赖cookie-parser）
  const cookies = {};
  if (req.headers.cookie) {
    req.headers.cookie.split(';').forEach((cookie) => {
      const [name, ...rest] = cookie.trim().split('=');
      if (name) cookies[name] = decodeURIComponent(rest.join('='));
    });
  }
  const cookieToken = cookies['XSRF-TOKEN'];

  // 引导端点（登录 / 刷新）：小程序此时尚未取得 Bearer，且无法回传 SameSite=Strict 的
  // XSRF-TOKEN cookie（wx.request 不自动回传跨站 Strict cookie）。它携带的 X-CSRF-Token 头
  // 来自 GET /api/auth/csrf-token，是服务端 HMAC 签名的、攻击者无法伪造，仅校验头签名即等价安全。
  // WEB 端浏览器登录仍走完整 Double Submit，行为不变。
  const url = req.originalUrl || req.url || '';
  const isBootstrap = url.startsWith('/api/auth/login') || url.startsWith('/api/auth/refresh');
  if (isBootstrap) {
    const headerOk = !!headerToken && verifyCsrfSignature(headerToken);
    const doubleOk =
      !!headerToken &&
      !!cookieToken &&
      headerToken === cookieToken &&
      verifyCsrfSignature(cookieToken);
    if (headerOk || doubleOk) {
      return next();
    }
    log.warn('CSRF验证失败（引导端点）', {
      hasHeaderToken: !!headerToken,
      hasCookieToken: !!cookieToken,
      ip: req.ip,
      path: req.path,
    });
    return res.status(403).json({ success: false, message: 'CSRF验证失败，请刷新页面后重试' });
  }

  // 标准 Double Submit（WEB 端 Cookie 会话路径）
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
