import request from '../utils/request';

/**
 * 获取文档列表
 * @param {Object} [params]
 * @param {number} [params.page]
 * @param {number} [params.pageSize]
 * @param {string} [params.keyword] - 文件名模糊搜索
 * @param {string} [params.fileType] - 类型分组：word | excel | pdf | image
 */
export const getDocuments = (params) => request.get('/documents', { params });

/**
 * 下载文档（blob 响应，由调用方触发浏览器保存）
 * @param {number} id
 */
export const downloadDocument = (id) =>
  request.get(`/documents/${id}/download`, { responseType: 'blob' });

/**
 * 重命名文档（仅显示名）
 * @param {number} id
 * @param {{ originalName: string }} data
 */
export const renameDocument = (id, data) => request.patch(`/documents/${id}`, data);

/**
 * 删除文档
 * @param {number} id
 */
export const deleteDocument = (id) => request.delete(`/documents/${id}`);
