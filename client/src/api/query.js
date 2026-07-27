import request from '../utils/request';
import './types';

/**
 * 学期综合查询
 * @param {import('./types').SemesterQueryParams} params
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const getSemesterQuery = (params) => request.get('/query/semester', { params });

/**
 * 教材详情查询（含学期使用情况）
 * @param {number} id - 教材 ID
 * @param {import('./types').TextbookQueryParams} [params]
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const getTextbookQuery = (id, params = {}) =>
  request.get(`/query/textbook/${id}`, { params });
