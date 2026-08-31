import request from '../utils/request';
import './types';

/**
 * 获取 CSRF Token（设置 XSRF-TOKEN cookie）
 * @returns {Promise<import('./types').ApiResponse<{csrfToken: string}>>}
 */
export const fetchCsrfToken = () => request.get('/auth/csrf-token');

/**
 * 用户登录
 * @param {Object} data
 * @param {string} data.username
 * @param {string} data.password
 * @returns {Promise<import('./types').ApiResponse<import('./types').LoginResult>>}
 */
export const login = (data) => request.post('/auth/login', data);

/**
 * 访客自助注册（创建待激活账号，需管理员激活后登录）
 * @param {Object} data
 * @param {string} data.username
 * @param {string} data.password
 * @param {string} [data.realName]
 * @param {string} [data.phone]
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const register = (data) => request.post('/auth/register', data, { silentError: true });

/**
 * 退出登录
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const logout = () => request.post('/auth/logout');

/**
 * 刷新访问令牌
 * @param {import('./types').RefreshTokenInput} data
 * @returns {Promise<import('./types').ApiResponse<{token: string, refreshToken: string}>>}
 */
export const refreshAccessToken = (data) => request.post('/auth/refresh', data);

/**
 * 获取当前用户信息
 * @returns {Promise<import('./types').ApiResponse<import('./types').User>>}
 */
export const fetchUserInfo = () => request.get('/auth/me');

/**
 * 修改密码
 * @param {import('./types').ChangePasswordInput} data
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const changePassword = (data) => request.put('/auth/password', data);
