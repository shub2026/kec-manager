/**
 * 下载 Blob 文件为 Excel
 * @param {Blob|ArrayBuffer} response - 响应数据
 * @param {string} filename - 文件名
 */
export function downloadBlob(response, filename) {
  const blob = new Blob([response], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
