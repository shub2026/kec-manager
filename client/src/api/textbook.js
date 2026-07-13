import request from '../utils/request';
import './types';

/**
 * 获取教材列表（服务端分页 + 筛选 + 排序）
 * @param {Object} [params] - 查询参数
 * @param {number} [params.page] - 页码
 * @param {number} [params.page_size] - 每页数量
 * @param {string} [params.title] - 书名模糊匹配
 * @param {string} [params.category] - 类别精确匹配（技工/非技工）
 * @param {string} [params.publisher] - 出版社精确匹配
 * @returns {Promise<import('./types').ApiResponse<{ items: import('./types').Textbook[], total: number, publishers: string[] }>>}
 */
export const getTextbooks = (params) => request.get('/textbooks', { params });

/**
 * 创建教材
 * @param {import('./types').TextbookInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').Textbook>>}
 */
export const createTextbook = (data) => request.post('/textbooks', data);

/**
 * 更新教材
 * @param {number} id
 * @param {import('./types').TextbookInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').Textbook>>}
 */
export const updateTextbook = (id, data) => request.put(`/textbooks/${id}`, data);

/**
 * 删除教材
 * @param {number} id
 * @param {import('./types').DeleteOptions} [options]
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const deleteTextbook = (id, { silent } = {}) =>
  request.delete(`/textbooks/${id}`, { silentError: silent });

/**
 * 切换教材启用/停用状态
 * @param {number} id
 * @returns {Promise<import('./types').ApiResponse<import('./types').Textbook>>}
 */
export const toggleTextbookStatus = (id) => request.post(`/textbooks/${id}/toggle-status`);

/**
 * 批量更新教材
 * @param {number[]} ids - 要更新的教材 ID 列表
 * @param {object} updates - 要更新的字段（snake_case）
 * @returns {Promise<import('./types').ApiResponse<{total: number, succeeded: Array, failed: Array}>>}
 */
export const batchUpdateTextbooks = (ids, updates) =>
  request.post('/textbooks/batch-update', { ids, updates });

/**
 * 批量删除教材
 * @param {number[]} ids - 要删除的教材 ID 列表
 * @returns {Promise<import('./types').ApiResponse<{total: number, succeeded: Array, failed: Array, skippedIds: number[], deletedCount: number}>>}
 */
export const batchDeleteTextbooks = (ids) => request.post('/textbooks/batch-delete', { ids });
