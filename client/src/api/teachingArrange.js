import request from '../utils/request';
import './types';

/**
 * 教学安排 - 班级课程数据
 * @param {import('./types').TeachingArrangeParams} params
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const getCourseClasses = (params) => request.get('/teaching-arrange/classes', { params });

/**
 * 教学安排 - 教师列表
 * @param {import('./types').TeachingArrangeParams} params
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const getCourseTeachers = (params) => request.get('/teaching-arrange/teachers', { params });

/**
 * 手动安排教师
 * @param {import('./types').AssignTeacherInput} data
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const assignTeacher = (data) => request.post('/teaching-arrange/assign', data);

/**
 * 删除教学安排
 * @param {number} id - 教学安排 ID
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const deleteAssignment = (id) => request.delete(`/teaching-arrange/assignments/${id}`);

/**
 * 自动排课（单课程）
 * @param {import('./types').AutoArrangeInput} data
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const runAutoArrange = (data) => request.post('/teaching-arrange/auto-arrange', data);

/**
 * 批量自动排课（所有课程）
 * @param {import('./types').BatchAutoArrangeInput} data
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const runBatchAutoArrange = (data) =>
  request.post('/teaching-arrange/batch-auto-arrange', data);

/**
 * 重置自动安排（清除指定学期的自动安排）
 * @param {Object} data
 * @param {string} data.semester
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const resetAutoAssignments = (data) => request.post('/teaching-arrange/reset', data);

/**
 * 课时统计
 * @param {Object} params
 * @param {string} params.semester
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const getTeachingStatistics = (params) =>
  request.get('/teaching-arrange/statistics', { params });

/**
 * 获取课时要求设置
 * @param {import('./types').HourSettingsQuery} params
 * @returns {Promise<import('./types').ApiResponse<import('./types').HourSettings>>}
 */
export const getHourSettings = (params) =>
  request.get('/teaching-arrange/hour-settings', { params });

/**
 * 保存课时要求设置
 * @param {import('./types').HourSettingsInput} data
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const saveHourSettings = (data) => request.put('/teaching-arrange/hour-settings', data);
