import request from '../utils/request';
import './types';

/**
 * 导出课时统计
 * @param {import('./types').ExportStatisticsParams} params
 * @returns {Promise<Blob>}
 */
export const exportStatistics = (params) =>
  request.get('/export/statistics', { params, responseType: 'blob' });

/**
 * 导出教学安排
 * @param {import('./types').TeachingArrangeParams} params
 * @returns {Promise<Blob>}
 */
export const exportTeachingArrange = (params) =>
  request.get('/export/teaching-arrange', { params, responseType: 'blob' });

/**
 * 导出学期综合查询数据
 * @param {import('./types').ExportSemesterInput} data
 * @returns {Promise<Blob>}
 */
export const exportSemester = (params) =>
  request.post('/export/semester', params, { responseType: 'blob' });

/**
 * 导出教材使用详情
 * @param {number} id - 教材 ID
 * @param {import('./types').TextbookQueryParams} [params]
 * @returns {Promise<Blob>}
 */
export const exportTextbook = (id, params) =>
  request.get(`/export/textbook/${id}`, { params, responseType: 'blob' });
