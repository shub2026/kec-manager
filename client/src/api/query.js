import request from '../utils/request';

export const getSemesterQuery = (params) => request.get('/query/semester', { params });
export const getTextbookQuery = (id, params = {}) =>
  request.get(`/query/textbook/${id}`, { params });
export const getTextbooksOverview = (params = {}) => request.get('/query/textbooks', { params });
