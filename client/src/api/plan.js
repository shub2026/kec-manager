import request from '../utils/request';

export const getPlans = () => request.get('/plans');
export const getPlanById = (id) => request.get(`/plans/${id}`);
export const createPlan = (data) => request.post('/plans', data);
export const updatePlan = (id, data) => request.put(`/plans/${id}`, data);
export const deletePlan = (id) => request.delete(`/plans/${id}`);
export const getPlanCourses = (id) => request.get(`/plans/${id}/courses`);
export const addPlanCourse = (id, data) => request.post(`/plans/${id}/courses`, data);
export const updatePlanCourse = (id, data) => request.put(`/plans/courses/${id}`, data);
export const deletePlanCourse = (id) => request.delete(`/plans/courses/${id}`);

// 学期明细
export const createSemester = (planId, courseId, data) =>
  request.post(`/plans/${planId}/courses/${courseId}/semesters`, data);
export const updateSemester = (id, data) => request.put(`/plans/semesters/${id}`, data);
export const getPlanSemesters = (id) => request.get(`/plans/${id}/semesters`);

// 教材关联（关联到学期）
export const setSemesterTextbook = (semesterId, data) =>
  request.post(`/plans/semesters/${semesterId}/textbooks`, data);
export const removeSemesterTextbook = (semesterId) =>
  request.delete(`/plans/semesters/${semesterId}/textbooks`);

// 兼容旧 API
export const addPlanTextbook = (courseId, data) =>
  request.post(`/plans/courses/${courseId}/textbooks`, data);
export const deletePlanTextbook = (id) => request.delete(`/plans/textbooks/${id}`);
