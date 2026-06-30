import request from '../utils/request';
import './types';

/**
 * 获取系统设置
 * @returns {Promise<import('./types').ApiResponse<import('./types').SystemSettings>>}
 */
export const getSettings = () => request.get('/settings');

/**
 * 更新系统设置
 * @param {import('./types').SystemSettingsInput} data
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const updateSettings = (data) => request.put('/settings', data);

/**
 * 系统重置 - 清空所有业务数据（保留用户账号）
 * @param {import('./types').ResetInput} data
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const resetSettings = (data) => request.post('/settings/reset/settings', data);

/**
 * 清空审计日志
 * @param {import('./types').ResetInput} data
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const resetAuditLogs = (data) => request.post('/settings/reset/audit-logs', data);
