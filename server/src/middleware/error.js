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

  // Prisma 记录不存在错误
  if (err.code === 'P2025') {
    return res.status(404).json({ success: false, message: '记录不存在' });
  }

  // 自定义应用错误
  if (err instanceof AppError) {
    log.error(`[AppError] ${err.message}`, { statusCode: err.statusCode, code: err.code });
    return res.status(err.statusCode).json({
      success: false,
      message: isProduction ? (err.isOperational ? err.message : getSafeMessage(err)) : err.message,
      code: isProduction ? undefined : err.code,
    });
  }

  // 未知错误
  log.error('[Unhandled Error]', { message: err.message, stack: err.stack });
  const status = err.statusCode || err.status || 500;

  // M1修复：始终返回安全消息，不向客户端泄露堆栈信息
  // 开发调试时通过服务器日志查看错误详情
  res.status(status).json({
    success: false,
    message: isProduction ? getSafeMessage(err) : err.message || '服务器内部错误',
  });
}
