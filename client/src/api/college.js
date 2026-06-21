import request from '../utils/request';

export const getColleges = () => request.get('/colleges');
export const getCollegeLevelMapping = () => request.get('/colleges/level-mapping');
export const createCollege = (data) => request.post('/colleges', data);
export const updateCollege = (id, data) => request.put(`/colleges/${id}`, data);
export const deleteCollege = (id) => request.delete(`/colleges/${id}`);
