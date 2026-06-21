import request from '../utils/request';

export const getMajors = () => request.get('/majors');
export const createMajor = (data) => request.post('/majors', data);
export const updateMajor = (id, data) => request.put(`/majors/${id}`, data);
export const deleteMajor = (id) => request.delete(`/majors/${id}`);
