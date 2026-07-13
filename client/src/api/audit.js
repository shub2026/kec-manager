import request from '../utils/request';
import './types';

/**
 * 查询操作日志
 * @param {import('./types').AuditLogParams} [params]
 * @returns {Promise<import('./types').ApiResponse<import('./types').AuditLogResponse>>}
 */
export const getAuditLogs = (params) => request.get('/audit/logs', { params });
