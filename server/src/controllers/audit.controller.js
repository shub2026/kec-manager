import { getAuditLogs } from '../services/audit.service.js';
import { success } from '../utils/response.js';

/**
 * GET /api/audit/logs - 查询操作日志
 */
export async function listAuditLogs(req, res, next) {
  try {
    const { action, module, result, page, pageSize } = req.query;
    const logsData = await getAuditLogs({
      action,
      module,
      result,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
    success(res, logsData);
  } catch (e) {
    next(e);
  }
}
