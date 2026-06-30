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
 * 清空审计日志
 * @param {import('./types').ResetInput} data
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const resetAuditLogs = (data) => request.post('/settings/reset/audit-logs', data);

/** @param {import('./types').ResetInput} [data] @returns {Promise<import('./types').ApiResponse<void>>} */
export const resetTeachers = (data) => request.post('/settings/reset/teachers', data);

/** @param {import('./types').ResetInput} [data] @returns {Promise<import('./types').ApiResponse<void>>} */
export const resetTeaching = (data) => request.post('/settings/reset/teaching', data);

/** @param {import('./types').ResetInput} [data] @returns {Promise<import('./types').ApiResponse<void>>} */
export const resetClassStudents = (data) => request.post('/settings/reset/class-students', data);

/** @param {import('./types').ResetInput} [data] @returns {Promise<import('./types').ApiResponse<void>>} */
export const resetMajors = (data) => request.post('/settings/reset/majors', data);

/** @param {import('./types').ResetInput} [data] @returns {Promise<import('./types').ApiResponse<void>>} */
export const resetColleges = (data) => request.post('/settings/reset/colleges', data);

/** @param {import('./types').ResetInput} [data] @returns {Promise<import('./types').ApiResponse<void>>} */
export const resetLevels = (data) => request.post('/settings/reset/levels', data);

/** @param {import('./types').ResetInput} [data] @returns {Promise<import('./types').ApiResponse<void>>} */
export const resetCourses = (data) => request.post('/settings/reset/courses', data);

/** @param {import('./types').ResetInput} [data] @returns {Promise<import('./types').ApiResponse<void>>} */
export const resetTextbooks = (data) => request.post('/settings/reset/textbooks', data);

/** @param {import('./types').ResetInput} [data] @returns {Promise<import('./types').ApiResponse<void>>} */
export const resetClasses = (data) => request.post('/settings/reset/classes', data);

/** @param {import('./types').ResetInput} [data] @returns {Promise<import('./types').ApiResponse<void>>} */
export const resetPlans = (data) => request.post('/settings/reset/plans', data);

/** @param {import('./types').ResetInput} [data] @returns {Promise<import('./types').ApiResponse<void>>} */
export const resetSettings = (data) => request.post('/settings/reset/settings', data);
