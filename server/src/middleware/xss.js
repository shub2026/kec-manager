import xss from 'xss';

/**
 * 敏感字段白名单：这些字段不进行 XSS 清洗
 * 密码只会被哈希存储，不会输出到 HTML，清洗会篡改用户原始密码导致登录失败
 */
const SKIP_SANITIZE_KEYS = new Set([
  'password',
  'old_password',
  'new_password',
  'oldPassword',
  'newPassword',
  'confirmPassword',
]);

/**
 * XSS防护中间件
 * 对请求体中的字符串数据进行XSS清洗
 */
export function sanitizeBody(req, res, next) {
  if (!req.body || typeof req.body !== 'object') {
    return next();
  }

  // 原地清洗 body 的属性，避免整体赋值在某些 Express 版本下受限
  for (const key of Object.keys(req.body)) {
    // 跳过密码类字段，防止篡改用户原始输入
    if (SKIP_SANITIZE_KEYS.has(key)) continue;
    req.body[key] = sanitizeObject(req.body[key]);
  }
  next();
}

/**
 * 递归清洗对象中的字符串值
 * 嵌套对象中的密码字段同样跳过
 */
function sanitizeObject(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return xss(obj.trim());
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item));
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      // 嵌套对象中也跳过密码字段
      if (SKIP_SANITIZE_KEYS.has(key)) {
        sanitized[key] = value;
      } else {
        sanitized[key] = sanitizeObject(value);
      }
    }
    return sanitized;
  }

  return obj;
}

/**
 * 查询参数XSS清洗中间件
 * 注意：Express 5 中 req.query 是 getter-only，不能整体赋值，需原地修改属性
 */
export function sanitizeQuery(req, res, next) {
  if (!req.query || typeof req.query !== 'object') {
    return next();
  }

  // 原地清洗每个查询参数，避免整体赋值触发 Express 5 getter-only 限制
  for (const key of Object.keys(req.query)) {
    try {
      req.query[key] = sanitizeObject(req.query[key]);
    } catch (e) {
      // 某些属性可能只读，跳过
    }
  }
  next();
}
