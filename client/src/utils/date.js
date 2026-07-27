/**
 * 日期相关工具函数
 */

/**
 * 格式化出生年月，只显示到月份（"YYYY-MM"）
 * @param {string|null} birthDate - 出生日期字符串
 * @returns {string}
 */
export function formatBirthDate(birthDate) {
  if (!birthDate) return '-';
  // 只显示到月份: "YYYY-MM" 或截取前7位
  const str = String(birthDate);
  if (str.length >= 7) return str.substring(0, 7);
  return str;
}

/**
 * 根据出生年月计算年龄
 * @param {string|null} birthDate - 出生日期字符串（"YYYY-MM" 或 "YYYY-MM-DD"）
 * @returns {number|string} 年龄，无效时返回 '-'
 */
export function calcAge(birthDate) {
  if (!birthDate) return '-';
  const str = String(birthDate);
  // 支持 "YYYY-MM" 或 "YYYY-MM-DD"
  const parts = str.split('-');
  if (parts.length < 2) return '-';
  const birthYear = parseInt(parts[0], 10);
  const birthMonth = parseInt(parts[1], 10) - 1; // 0-indexed
  if (isNaN(birthYear) || isNaN(birthMonth)) return '-';
  const now = new Date();
  let age = now.getFullYear() - birthYear;
  const m = now.getMonth() - birthMonth;
  if (m < 0) age--;
  return age > 0 ? age : '-';
}
