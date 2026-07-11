import request from '../utils/request';
import './types';

/**
 * 获取班级列表
 * @param {import('./types').ClassListParams} [params]
 * @returns {Promise<import('./types').ApiResponse<import('./types').PaginatedResponse<import('./types').Class>>>}
 */
export const getClasses = (params) => request.get('/classes', { params });

/**
 * 获取班级统计
 * @returns {Promise<import('./types').ApiResponse<{totalClasses: number, totalStudents: number}>>}
 */
export const getClassStats = () => request.get('/classes/stats');

/**
 * 创建班级
 * @param {import('./types').ClassInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').Class>>}
 */
export const createClass = (data) => request.post('/classes', data);

/**
 * 更新班级
 * @param {number} id
 * @param {import('./types').ClassInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').Class>>}
 */
export const updateClass = (id, data) => request.put(`/classes/${id}`, data);

/**
 * 删除班级
 * @param {number} id
 * @param {{ silent?: boolean }} [options] - silent=true 时抑制拦截器的错误弹窗（批量删除场景）
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const deleteClass = (id, { silent } = {}) =>
  request.delete(`/classes/${id}`, { silentError: silent });

/**
 * 批量更新班级
 * @param {number[]} ids - 要更新的班级 ID 列表
 * @param {object} updates - 要更新的字段（snake_case）
 * @returns {Promise<import('./types').ApiResponse<{total: number, succeeded: Array, failed: Array}>>}
 */
export const batchUpdateClasses = (ids, updates) =>
  request.post('/classes/batch-update', { ids, updates });

/**
 * 批量删除班级
 * @param {number[]} ids - 要删除的班级 ID 列表
 * @returns {Promise<import('./types').ApiResponse<{total: number, succeeded: Array, failed: Array, deletedCount: number}>>}
 */
export const batchDeleteClasses = (ids) =>
  request.post('/classes/batch-delete', { ids });
