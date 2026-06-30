import request from '../utils/request';
import './types';

/**
 * 获取课程列表
 * @param {import('./types').CourseListParams} [params]
 * @returns {Promise<import('./types').ApiResponse<import('./types').Course[]>>}
 */
export const getCourses = (params) => request.get('/courses', { params });

/**
 * 创建课程
 * @param {import('./types').CourseInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').Course>>}
 */
export const createCourse = (data) => request.post('/courses', data);

/**
 * 更新课程
 * @param {number} id
 * @param {import('./types').CourseInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').Course>>}
 */
export const updateCourse = (id, data) => request.put(`/courses/${id}`, data);

/**
 * 删除课程（已关联方案/教师/教学安排时会被拒绝）
 * @param {number} id
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const deleteCourse = (id) => request.delete(`/courses/${id}`);
