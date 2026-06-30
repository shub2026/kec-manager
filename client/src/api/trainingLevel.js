import request from '../utils/request';
import './types';

/**
 * 获取培养层次列表
 * @returns {Promise<import('./types').ApiResponse<import('./types').TrainingLevel[]>>}
 */
export const getTrainingLevels = () => request.get('/training-levels');

/**
 * 创建培养层次
 * @param {import('./types').TrainingLevelInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').TrainingLevel>>}
 */
export const createTrainingLevel = (data) => request.post('/training-levels', data);

/**
 * 更新培养层次
 * @param {number} id
 * @param {import('./types').TrainingLevelInput} data
 * @returns {Promise<import('./types').ApiResponse<import('./types').TrainingLevel>>}
 */
export const updateTrainingLevel = (id, data) => request.put(`/training-levels/${id}`, data);

/**
 * 删除培养层次（已关联班级/方案/教师时会被拒绝）
 * @param {number} id
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const deleteTrainingLevel = (id) => request.delete(`/training-levels/${id}`);
