import request from '../utils/request';
import './types';

/**
 * 获取专业列表
 * @returns {Promise<import('./types').ApiResponse<import('./types').Major[]>>}
 */
export const getMajors = () => request.get('/majors');

/**
 * 创建专业
 * @param {import('./types').MajorInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').Major>>}
 */
export const createMajor = (data) => request.post('/majors', data);

/**
 * 更新专业
 * @param {number} id
 * @param {import('./types').MajorInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').Major>>}
 */
export const updateMajor = (id, data) => request.put(`/majors/${id}`, data);

/**
 * 删除专业（已关联班级/方案时会被拒绝）
 * @param {number} id
 * @param {{ silent?: boolean }} [options] - silent=true 时抑制拦截器的错误弹窗
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const deleteMajor = (id, { silent } = {}) =>
  request.delete(`/majors/${id}`, { silentError: silent });
