import request from '../utils/request';

export const getTextbooks = () => request.get('/textbooks');
export const createTextbook = (data) => request.post('/textbooks', data);
export const updateTextbook = (id, data) => request.put(`/textbooks/${id}`, data);
export const deleteTextbook = (id) => request.delete(`/textbooks/${id}`);
export const toggleTextbookStatus = (id) => request.post(`/textbooks/${id}/toggle-status`);
