import { AppError } from '../utils/error.js';
import { log } from '../utils/logger.js'; // L1修复：使用winston logger

/**
 * 将 Prisma/数据库错误消息转换为安全的用户友好提示
 */
function getSafeMessage(err) {
  // Prisma 唯一约束冲突
  if (err.code === 'P2002') {
    return '该记录已存在，请修改后重试';
  }
  // Prisma 外键约束失败
  if (err.code === 'P2003') {
    return '关联数据不存在，请检查后重试';
  }
  // Prisma 无效参数
  if (err.code === 'P2009') {
    return '请求参数格式不正确';
  }
  // Prisma 查询结果不存在
  if (err.code === 'P2025') {
    return '记录不存在';
  }
  // JWT 相关错误
  if (err.name === 'TokenExpiredError') {
    return '登录已过期，请重新登录';
  }
  if (err.name === 'JsonWebTokenError') {
    return '无效的认证令牌';
  }
  // 默认安全消息
  return '操作失败，请稍后重试';
}

export function errorHandler(err, req, res, next) {
  const isProduction = process.env.NODE_ENV === 'production';
  // S-06修复：详细信息仅对本地请求开放，不再仅依赖 NODE_ENV
  const isLocalRequest =
    req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
  // 审计修复：仅在显式启用 DEBUG_ERRORS 时暴露内部错误细节
  const showDetails = !isProduction && isLocalRequest && process.env.DEBUG_ERRORS === 'true';

  // Prisma 记录不存在错误
  if (err.code === 'P2025') {
    return res.status(404).json({ success: false, message: '记录不存在' });
  }

  // Prisma 唯一约束冲突 → 409 Conflict
  if (err.code === 'P2002') {
    const target = err.meta?.target?.join(', ') || '';
    log.warn('[P2002 唯一约束冲突]', { target });
    return res.status(409).json({
      success: false,
      message: showDetails ? `唯一约束冲突: ${target}` : '该记录已存在，请修改后重试',
    });
  }

  // 自定义应用错误
  if (err instanceof AppError) {
    log.error(`[AppError] ${err.message}`, { statusCode: err.statusCode, code: err.code });
    return res.status(err.statusCode).json({
      success: false,
      message: showDetails ? err.message : err.isOperational ? err.message : getSafeMessage(err),
      code: showDetails ? err.code : undefined,
    });
  }

  // 未知错误
  log.error('[Unhandled Error]', { message: err.message, stack: err.stack });
  const status = err.statusCode || err.status || 500;

  res.status(status).json({
    success: false,
    message: showDetails ? err.message || '服务器内部错误' : getSafeMessage(err),
  });
}
