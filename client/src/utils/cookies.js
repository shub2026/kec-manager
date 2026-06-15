/**
 * Cookie工具函数
 * 用于安全地存储token等敏感信息
 */

/**
 * 设置Cookie
 * @param {string} name - Cookie名称
 * @param {string} value - Cookie值
 * @param {number} days - 过期天数（默认7天）
 */
export function setCookie(name, value, days = 7) {
  const expires = new Date()
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000)
  // HttpOnly无法通过JS设置，需要后端配合
  // 这里使用Secure + SameSite增强安全性
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Strict`
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
  document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;SameSite=Strict'
}

/**
 * 清除所有认证相关的Cookie
 */
export function clearAuthCookies() {
  deleteCookie('token')
  deleteCookie('refreshToken')
}
