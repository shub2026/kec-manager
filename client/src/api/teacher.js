import request from '../utils/request';
import './types';

/**
 * 获取教师列表
 * @param {Object} [params] - 查询参数
 * @param {number} [params.page] - 页码
 * @param {number} [params.page_size] - 每页数量
 * @returns {Promise<import('./types').ApiResponse<{ items: import('./types').Teacher[], total: number }>>}
 */
export const getTeachers = (params) => request.get('/teachers', { params });

/**
 * 创建教师
 * @param {import('./types').TeacherInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').Teacher>>}
 */
export const createTeacher = (data) => request.post('/teachers', data);

/**
 * 更新教师
 * @param {number} id
 * @param {import('./types').TeacherInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').Teacher>>}
 */
export const updateTeacher = (id, data) => request.put(`/teachers/${id}`, data);

/**
 * 删除教师
 * @param {number} id
 * @param {{ silent?: boolean }} [options] - silent=true 时抑制拦截器的错误弹窗
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const deleteTeacher = (id, { silent } = {}) =>
  request.delete(`/teachers/${id}`, { silentError: silent });

/**
 * 批量更新教师默认课时
 * @param {Object} data
 * @param {number[]} data.teacherIds
 * @param {number} data.defaultWeeklyHours
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const batchUpdateDefaultHours = (data) => request.put('/teachers/batch/default-hours', data);

/**
 * 切换教师状态
 * @param {number} id
 * @param {string} status - 'active' | 'disabled'
 * @returns {Promise<import('./types').ApiResponse<import('./types').Teacher>>}
 */
export const toggleTeacherStatus = (id, status) =>
  request.patch(`/teachers/${id}/status`, { status });
