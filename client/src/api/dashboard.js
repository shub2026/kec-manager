import request from '../utils/request';
import './types';

/**
 * 获取首页数据概览统计（基于当前学期）
 * @param {string} semester - 学期字符串，如 '2025-2026-2'
 * @returns {Promise<import('./types').ApiResponse<import('./types').DashboardStats>>}
 */
export function getDashboardStats(semester) {
  return request.get('/dashboard/stats', { params: { semester } });
}

/**
 * 获取首页洞察数据：排课完成度 + 异常提醒 + 课时分布
 * @param {string} semester
 * @returns {Promise<import('./types').ApiResponse>}
 */
export function getDashboardInsights(semester) {
  return request.get('/dashboard/insights', { params: { semester } });
}
