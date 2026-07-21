import request from '../utils/request';
import './types';

/**
 * 获取用户列表
 * @param {Object} [params]
 * @param {number} [params.page]
 * @param {number} [params.pageSize]
 * @returns {Promise<import('./types').ApiResponse<import('./types').User[]>>}
 */
export const getUsers = (params) => request.get('/users', { params });

/**
 * 创建用户
 * @param {import('./types').UserInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').User>>}
 */
export const createUser = (data) => request.post('/users', data);

/**
 * 更新用户（不能修改 username）
 * @param {number} id
 * @param {import('./types').UserInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').User>>}
 */
export const updateUser = (id, data) => request.put(`/users/${id}`, data);

/**
 * 删除用户
 * @param {number} id
 * @param {{ silent?: boolean }} [options] - silent=true 时抑制拦截器的错误弹窗
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const deleteUser = (id, { silent } = {}) =>
  request.delete(`/users/${id}`, { silentError: silent });

/**
 * 切换用户激活/禁用状态
 * @param {number} id
 * @param {import('./types').ToggleUserStatusInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').User>>}
 */
export const toggleUserStatus = (id, data) => request.put(`/users/${id}/status`, data);

/**
 * 重置用户密码（管理员操作，重置后用户下次登录须修改密码）
 * @param {number} id
 * @param {{ newPassword: string }} data
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const resetUserPassword = (id, data) => request.put(`/users/${id}/password`, data);
