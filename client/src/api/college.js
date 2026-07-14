import request from '../utils/request';
import './types';

/**
 * 获取学院列表
 * @returns {Promise<import('./types').ApiResponse<import('./types').College[]>>}
 */
export const getColleges = () => request.get('/colleges');

/**
 * 获取学院-培养层次映射
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const getCollegeLevelMapping = () => request.get('/colleges/level-mapping');

/**
 * 创建学院
 * @param {import('./types').CollegeInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').College>>}
 */
export const createCollege = (data) => request.post('/colleges', data);

/**
 * 更新学院
 * @param {number} id
 * @param {import('./types').CollegeInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').College>>}
 */
export const updateCollege = (id, data) => request.put(`/colleges/${id}`, data);

/**
 * 删除学院（已关联班级/方案时会被拒绝）
 * @param {number} id
 * @param {{ silent?: boolean }} [options] - silent=true 时抑制拦截器的错误弹窗
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const deleteCollege = (id, { silent } = {}) =>
  request.delete(`/colleges/${id}`, { silentError: silent });
