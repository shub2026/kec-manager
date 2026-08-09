// utils/format.js
// 通用格式化函数，与 WEB 端口径保持一致

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function formatTime(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

module.exports = { formatTime };
