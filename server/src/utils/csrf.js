import crypto from 'crypto';
import { authConfig } from '../config/auth.config.js';

/**
 * H-5修复：CSRF Token HMAC 签名工具
 *
 * 原实现仅使用 Double Submit Cookie（cookie == header），
 * 攻击者若通过 XSS 可自行设置 XSRF-TOKEN cookie 和 X-CSRF-Token 头绕过验证。
 * 新增 HMAC 签名层：token = random(32B).hex + hmac-sha256(random, secret).hex，
 * 验证时先校验 cookie==header，再校验 HMAC 签名有效，攻击者无法伪造签名。
 */

const RANDOM_HEX_LEN = 64; // 32 bytes = 64 hex chars
const HMAC_HEX_LEN = 64; // sha256 = 32 bytes = 64 hex chars
const TOKEN_LEN = RANDOM_HEX_LEN + HMAC_HEX_LEN;

/**
 * 生成带 HMAC 签名的 CSRF token
 * 格式：random(64hex) + hmac(64hex) = 128 hex chars
 */
export function generateSignedCsrfToken() {
  const random = crypto.randomBytes(32).toString('hex');
  const hmac = crypto.createHmac('sha256', authConfig.jwtSecret).update(random).digest('hex');
  return random + hmac;
}

/**
 * 验证 CSRF token 的 HMAC 签名是否有效
 * 使用 timingSafeEqual 防止时序攻击
 */
export function verifyCsrfSignature(token) {
  if (!token || typeof token !== 'string' || token.length !== TOKEN_LEN) return false;

  const random = token.substring(0, RANDOM_HEX_LEN);
  const providedHmac = token.substring(RANDOM_HEX_LEN);

  const expectedHmac = crypto
    .createHmac('sha256', authConfig.jwtSecret)
    .update(random)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(providedHmac, 'hex'),
      Buffer.from(expectedHmac, 'hex')
    );
  } catch {
    return false;
  }
}
