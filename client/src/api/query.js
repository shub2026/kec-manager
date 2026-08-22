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

/**
 * 课程查询：按课程聚合各培养方案采用情况
 * @param {Object} [params] - 筛选参数
 * @param {string} [params.courseName] - 课程名称模糊匹配
 * @param {string} [params.courseType] - 科目类型（public | professional）
 * @param {number} [params.collegeId] - 学院 ID（方案维度）
 * @param {number} [params.majorId] - 专业 ID（方案维度）
 * @param {number} [params.trainingLevelId] - 培养层次 ID（方案维度）
 * @param {string} [params.planStatus] - 方案状态（draft | active | archived）
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const getCourseQuery = (params = {}) => request.get('/query/course', { params });
