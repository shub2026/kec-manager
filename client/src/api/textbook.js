import request from '../utils/request';
import './types';

/**
 * 获取教材列表
 * @returns {Promise<import('./types').ApiResponse<import('./types').Textbook[]>>}
 */
export const getTextbooks = () => request.get('/textbooks');

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
