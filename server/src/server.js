import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import { prisma } from './lib/prisma.js';
import { log } from './utils/logger.js';

const PORT = process.env.PORT || 3000;

// 全局错误处理：防止未捕获的异常/拒绝导致进程崩溃
process.on('uncaughtException', (err) => {
  log.error('[uncaughtException] 未捕获的异常，进程即将退出', { message: err.message, stack: err.stack });
  // Node.js 官方建议：uncaughtException 后必须退出进程，因为进程状态可能已损坏
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('[unhandledRejection] 未处理的Promise拒绝，进程即将退出', {
    reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : String(reason),
  });
  process.exit(1);
});

const server = app.listen(PORT, () => {
  log.info(`Server running on http://localhost:${PORT}`);
});

// 服务器错误处理（如端口被占用）
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log.error(`端口 ${PORT} 已被占用，请关闭占用进程后重试`);
  } else {
    log.error('服务器错误', { message: err.message });
  }
  process.exit(1);
});

// 防止空闲连接导致内存泄漏
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

async function shutdown(signal) {
  log.info(`收到 ${signal} 信号，正在关闭...`);
  server.close(async () => {
    try {
      await prisma.$disconnect();
    } catch (e) {
      log.error('Prisma断开连接失败', { message: e.message });
    }
    process.exit(0);
  });

  // 10秒超时强制退出
  setTimeout(() => {
    log.error('关闭超时，强制退出');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
