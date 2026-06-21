import request from '../utils/request';

export const getClasses = (params) => request.get('/classes', { params });
export const getClassStats = () => request.get('/classes/stats');
export const createClass = (data) => request.post('/classes', data);
export const updateClass = (id, data) => request.put(`/classes/${id}`, data);
export const deleteClass = (id) => request.delete(`/classes/${id}`);
