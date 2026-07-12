import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import logger from '../utils/logger.js';

/**
 * 记录操作日志
 * @param {Object} params - 日志参数
 * @param {string} params.action - 操作类型：import, export, create, update, delete
 * @param {string} params.module - 模块名称：class, course, textbook, major, college, trainingPlan, system
 * @param {number} [params.userId] - 操作人ID
 * @param {string} [params.ip] - IP地址
 * @param {Object|string} [params.details] - 操作详情（对象或JSON字符串）
 * @param {string} params.result - 结果：success, failed
 * @param {string} [params.message] - 消息
 */
export async function createAuditLog({ action, module, userId, ip, details, result, message }) {
  try {
    // details 序列化并限制最大长度，防止审计表膨胀
    let detailsStr = details;
    if (typeof details === 'object' && details !== null) {
      detailsStr = JSON.stringify(details);
    }
    if (typeof detailsStr === 'string' && detailsStr.length > 2000) {
      detailsStr = detailsStr.slice(0, 1997) + '...';
    }

    await prisma.audit_logs.create({
      data: {
        action,
        module,
        operator_id: userId || null,
        ip: ip || null,
        details: detailsStr,
        result,
        message: message || null,
      },
    });
  } catch (error) {
    // 安全修复：使用winston记录审计失败，便于生产环境追踪
    logger.error('创建审计日志失败:', {
      error: error.message,
      action,
      module,
      userId,
      result,
    });
    // 审计修复：DB写入失败时降级写入文件日志，确保审计记录不丢失
    try {
      const data = { action, module, userId, ip, details, result, message, timestamp: new Date().toISOString() };
      const logDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, `audit-fallback-${new Date().toISOString().split('T')[0]}.jsonl`);
      fs.appendFileSync(logFile, JSON.stringify(data) + '\n', 'utf-8');
    } catch (fileErr) {
      logger.error('审计日志文件降级写入也失败', { error: fileErr.message });
    }
    // 注意：不抛出错误以避免中断主业务流程
    // 但生产环境应监控此错误日志并告警
  }
}

/**
 * 查询操作日志
 * @param {Object} params - 查询参数
 * @param {string} [params.action] - 操作类型筛选
 * @param {string} [params.module] - 模块筛选
 * @param {string} [params.result] - 结果筛选
 * @param {number} [params.page] - 页码
 * @param {number} [params.pageSize] - 每页数量
 */
export async function getAuditLogs({ action, module, result, page = 1, pageSize = 20 }) {
  const where = {};
  if (action) where.action = action;
  if (module) where.module = module;
  if (result) where.result = result;

  const skip = (page - 1) * pageSize;
  const take = Math.min(Math.max(Number(pageSize) || 20, 1), 100); // M4 修复：防御性上限保护

  const [logs, total] = await Promise.all([
    prisma.audit_logs.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take,
    }),
    prisma.audit_logs.count({ where }),
  ]);

  // 保持数据库原始字段名（下划线命名），由中间件自动转换为驼峰命名
  const formattedLogs = logs.map((log) => ({
    id: log.id,
    action: log.action,
    module: log.module,
    operator_id: log.operator_id,
    ip: log.ip,
    details: log.details,
    result: log.result,
    message: log.message,
    created_at: log.created_at,
  }));

  return { logs: formattedLogs, total, page, pageSize };
}
