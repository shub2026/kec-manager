/**
 * 字符串相关工具函数
 */

/**
 * 按字符数截断文本（正确处理中文与代理对字符）
 * 超出 maxChars 时截断并追加省略号，未超出时原样返回
 * @param {string|null|undefined} text - 原始文本
 * @param {number} maxChars - 最大保留字符数
 * @returns {string} 截断后的文本，空输入返回 ''
 */
export function truncateText(text, maxChars) {
  if (!text) return '';
  const str = String(text);
  const chars = Array.from(str);
  if (chars.length <= maxChars) return str;
  return chars.slice(0, maxChars).join('') + '…';
}
