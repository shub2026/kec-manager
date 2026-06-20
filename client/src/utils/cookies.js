/**
 * Cookie工具函数
 * 用于安全地存储token等敏感信息
 *
 * 安全说明：JavaScript 无法设置 HttpOnly Cookie（防 XSS 窃取 token）。
 * 生产环境最佳实践是后端登录接口通过 Set-Cookie 头设置 HttpOnly+Secure+SameSite=Strict，
 * 前端仅依赖 withCredentials 自动携带。当前实现仍由 JS 写入 Cookie，属过渡方案，
 * 建议后续与后端配合迁移为 HttpOnly Cookie 模式。
 */

/**
 * 判断当前是否 HTTPS 环境（生产环境应部署在 HTTPS 下）
 */
function isSecureContext() {
  return window.location.protocol === 'https:'
}

/**
 * 设置Cookie
 * @param {string} name - Cookie名称
 * @param {string} value - Cookie值
 * @param {number} days - 过期天数（默认7天）
 */
export function setCookie(name, value, days = 7) {
  const expires = new Date()
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000)
  // HttpOnly无法通过JS设置，需要后端配合；HTTPS 环境下增加 Secure 标志防止明文传输
  const secureFlag = isSecureContext() ? ';Secure' : ''
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Strict${secureFlag}`
}

/**
 * 获取Cookie
 * @param {string} name - Cookie名称
 * @returns {string|null} Cookie值
 */
export function getCookie(name) {
  const nameEQ = name + '='
  const ca = document.cookie.split(';')
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i]
    while (c.charAt(0) === ' ') c = c.substring(1, c.length)
    if (c.indexOf(nameEQ) === 0) {
      return decodeURIComponent(c.substring(nameEQ.length, c.length))
    }
  }
  return null
}

/**
 * 删除Cookie
 * @param {string} name - Cookie名称
 */
export function deleteCookie(name) {
  const secureFlag = isSecureContext() ? ';Secure' : ''
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;SameSite=Strict${secureFlag}`
}

/**
 * 清除所有认证相关的Cookie
 */
export function clearAuthCookies() {
  deleteCookie('token')
  deleteCookie('refreshToken')
}
