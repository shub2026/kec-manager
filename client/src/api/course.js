import request from '../utils/request';

export const getCourses = (params) => request.get('/courses', { params });
export const createCourse = (data) => request.post('/courses', data);
export const updateCourse = (id, data) => request.put(`/courses/${id}`, data);
export const deleteCourse = (id) => request.delete(`/courses/${id}`);
