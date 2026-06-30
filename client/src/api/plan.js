import request from '../utils/request';
import './types';

/**
 * 获取培养方案列表
 * @param {import('./types').PlanListParams} [params]
 * @returns {Promise<import('./types').ApiResponse<import('./types').Plan[]>>}
 */
export const getPlans = (params) => request.get('/plans', { params });

/**
 * 获取单个培养方案（含课程列表）
 * @param {number} id
 * @returns {Promise<import('./types').ApiResponse<import('./types').Plan>>}
 */
export const getPlanById = (id) => request.get(`/plans/${id}`);

/**
 * 创建培养方案
 * @param {import('./types').PlanInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').Plan>>}
 */
export const createPlan = (data) => request.post('/plans', data);

/**
 * 更新培养方案
 * @param {number} id
 * @param {import('./types').PlanInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').Plan>>}
 */
export const updatePlan = (id, data) => request.put(`/plans/${id}`, data);

/**
 * 删除培养方案（会解除关联班级，不拒绝）
 * @param {number} id
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const deletePlan = (id) => request.delete(`/plans/${id}`);

/**
 * 获取方案下的课程列表
 * @param {number} id - 方案 ID
 * @returns {Promise<import('./types').ApiResponse<import('./types').PlanCourse[]>>}
 */
export const getPlanCourses = (id) => request.get(`/plans/${id}/courses`);

/**
 * 添加课程到方案
 * @param {number} id - 方案 ID
 * @param {import('./types').PlanCourseInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').PlanCourse>>}
 */
export const addPlanCourse = (id, data) => request.post(`/plans/${id}/courses`, data);

/**
 * 更新方案课程
 * @param {number} id - 方案课程 ID
 * @param {Partial<import('./types').PlanCourseInput>} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').PlanCourse>>}
 */
export const updatePlanCourse = (id, data) => request.put(`/plans/courses/${id}`, data);

/**
 * 更新方案课程排序
 * @param {number} id - 方案课程 ID
 * @param {number} sortOrder
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const updatePlanCourseSortOrder = (id, sortOrder) =>
  request.patch(`/plans/courses/${id}/sort-order`, { sortOrder });

/**
 * 删除方案课程
 * @param {number} id - 方案课程 ID
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const deletePlanCourse = (id) => request.delete(`/plans/courses/${id}`);

// 学期明细

/**
 * 创建学期明细
 * @param {number} planId
 * @param {number} courseId
 * @param {import('./types').PlanSemesterInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').PlanSemester>>}
 */
export const createSemester = (planId, courseId, data) =>
  request.post(`/plans/${planId}/courses/${courseId}/semesters`, data);

/**
 * 更新学期明细
 * @param {number} id - 学期明细 ID
 * @param {Partial<import('./types').PlanSemesterInput>} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').PlanSemester>>}
 */
export const updateSemester = (id, data) => request.put(`/plans/semesters/${id}`, data);

/**
 * 获取方案的所有学期明细
 * @param {number} id - 方案 ID
 * @returns {Promise<import('./types').ApiResponse<import('./types').PlanSemester[]>>}
 */
export const getPlanSemesters = (id) => request.get(`/plans/${id}/semesters`);

// 教材关联（关联到学期）

/**
 * 设置学期教材关联
 * @param {number} semesterId
 * @param {import('./types').SetSemesterTextbookInput} data
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const setSemesterTextbook = (semesterId, data) =>
  request.post(`/plans/semesters/${semesterId}/textbooks`, data);

/**
 * 移除学期教材关联
 * @param {number} semesterId
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const removeSemesterTextbook = (semesterId) =>
  request.delete(`/plans/semesters/${semesterId}/textbooks`);

// 兼容旧 API

/**
 * @deprecated 使用 setSemesterTextbook 代替
 */
export const addPlanTextbook = (courseId, data) =>
  request.post(`/plans/courses/${courseId}/textbooks`, data);

/**
 * @deprecated 使用 removeSemesterTextbook 代替
 */
export const deletePlanTextbook = (id) => request.delete(`/plans/textbooks/${id}`);
