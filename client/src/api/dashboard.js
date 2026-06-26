import request from '../utils/request';

/**
 * 获取首页数据概览统计（基于当前学期）
 * @param {string} semester - 学期字符串，如 '2025-2026-2'
 * @returns {Promise} 统计数据
 */
export function getDashboardStats(semester) {
  return request.get('/dashboard/stats', { params: { semester } });
}
