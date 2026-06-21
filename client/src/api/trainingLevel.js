import request from '../utils/request';

export const getTrainingLevels = () => request.get('/training-levels');
export const createTrainingLevel = (data) => request.post('/training-levels', data);
export const updateTrainingLevel = (id, data) => request.put(`/training-levels/${id}`, data);
export const deleteTrainingLevel = (id) => request.delete(`/training-levels/${id}`);
