import { PrismaClient } from '@prisma/client';
import { log } from '../utils/logger.js'; // L1修复：使用winston logger

const isDevelopment = process.env.NODE_ENV !== 'production';

// SQLite 过渡优化：启用 WAL 模式 + busy_timeout，缓解文件级锁的并发写入瓶颈
// 切换 MySQL 后此配置无副作用（MySQL 不识别 PRAGMA，会被忽略）
async function applySqlitePragmas(client) {
  try {
    // SQLite PRAGMA 均返回值（旧设置），统一用 $queryRawUnsafe
    await client.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await client.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
    await client.$queryRawUnsafe('PRAGMA synchronous = NORMAL');
  } catch {
    // 非 SQLite 数据源会忽略 PRAGMA，无需处理
  }
}

// 测试环境下显式指定数据源，确保使用测试数据库
const prismaOptions = {
  log: isDevelopment
    ? [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ]
    : [{ emit: 'event', level: 'error' }],
};

if (process.env.NODE_ENV === 'test' && process.env.DATABASE_URL) {
  prismaOptions.datasources = {
    db: { url: process.env.DATABASE_URL },
  };
}

export const prisma = new PrismaClient(prismaOptions);

// C-1 修复：导出 applySqlitePragmas，供 server.js 在 listen 前显式 await
export { applySqlitePragmas };

// 非 server.js 入口（如测试、脚本）仍保留 fire-and-forget 调用
// server.js 入口通过 await applySqlitePragmas() 确保 PRAGMA 先于 listen 生效
if (process.env.NODE_ENV !== 'production') {
  applySqlitePragmas(prisma).catch((e) => {
    log.warn('SQLite PRAGMA 应用失败（切换 MySQL 后可忽略）', { error: e.message });
  });
}

// 开发环境下监听错误和警告事件
if (isDevelopment) {
  prisma.$on('error', (e) => {
    log.error('[Prisma Error]', { message: e.message });
  });

  prisma.$on('warn', (e) => {
    log.warn('[Prisma Warning]', { message: e.message });
  });
}
