import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import { prisma } from './lib/prisma.js';
import { log } from './utils/logger.js';

const PORT = process.env.PORT || 3000;

// 全局错误处理：防止未捕获的异常/拒绝导致进程崩溃
process.on('uncaughtException', (err) => {
  log.error('[uncaughtException] 未捕获的异常，进程即将退出', {
    message: err.message,
    stack: err.stack,
  });
  // Node.js 官方建议：uncaughtException 后必须退出进程，因为进程状态可能已损坏
  process.exit(1);
});

process.on('unhandledRejection', (reason, _promise) => {
  log.error('[unhandledRejection] 未处理的Promise拒绝，进程即将退出', {
    reason:
      reason instanceof Error ? { message: reason.message, stack: reason.stack } : String(reason),
  });
  process.exit(1);
});

// C-1 修复：将启动逻辑封装为 async 函数，确保 SQLite PRAGMA（WAL + busy_timeout）
// 在开始监听端口前完成初始化，避免首批写请求因 PRAGMA 未生效而触发 SQLITE_BUSY
async function start() {
  const { applySqlitePragmas } = await import('./lib/prisma.js');
  await applySqlitePragmas(prisma);

  // L-6 修复：提醒运维人员修改 DEFAULT_SEMESTER 环境变量
  const defaultSemester = process.env.DEFAULT_SEMESTER || '2025-2026-2';
  if (defaultSemester === '2025-2026-2' && process.env.NODE_ENV === 'production') {
    log.warn('[配置提醒] DEFAULT_SEMESTER 仍为默认值 2025-2026-2，请通过环境变量配置实际学期', {
      hint: '在 .env 或 docker-compose.yml 中设置 DEFAULT_SEMESTER=YYYY-YYYY-N',
    });
  }

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

  // 注册关闭信号处理（必须在 server 创建后）
  process.on('SIGINT', () => shutdown('SIGINT', server));
  process.on('SIGTERM', () => shutdown('SIGTERM', server));
}

start().catch((err) => {
  log.error('服务启动失败', { message: err.message, stack: err.stack });
  process.exit(1);
});

async function shutdown(signal, srv) {
  log.info(`收到 ${signal} 信号，正在关闭...`);
  if (srv) {
    srv.close(async () => {
      try {
        await prisma.$disconnect();
      } catch (e) {
        log.error('Prisma断开连接失败', { message: e.message });
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }

  // 10秒超时强制退出
  setTimeout(() => {
    log.error('关闭超时，强制退出');
    process.exit(1);
  }, 10000);
}
