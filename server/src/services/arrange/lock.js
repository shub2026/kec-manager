import { prisma } from '../../lib/prisma.js';
import logger from '../../utils/logger.js';

// B-01 修复：基于数据库的排课并发锁，支持多进程/多实例部署
// 使用 arrange_locks 表替代进程内 Set，确保跨进程互斥

const LOCK_TIMEOUT_MS = 5000; // 获取锁超时时间

/**
 * 尝试获取数据库锁
 * @param {string} lockKey - 锁标识（如 "course:semester" 或 "batch:semester"）
 * @param {number} timeoutMs - 超时毫秒数
 * @returns {Promise<boolean>} 是否获取成功
 */
export async function acquireLock(lockKey, timeoutMs = LOCK_TIMEOUT_MS) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      // 使用 INSERT OR IGNORE 实现原子性获取
      // SQLite 的写入串行化保证了原子性
      const result = await prisma.$executeRaw`
        INSERT OR IGNORE INTO arrange_locks (lock_key, created_at, expires_at)
        VALUES (${lockKey}, datetime('now'), datetime('now', '+10 minutes'))
      `;
      if (result > 0) return true;

      // 检查是否有过期锁可以清理
      const cleaned = await prisma.$executeRaw`
        DELETE FROM arrange_locks
        WHERE lock_key = ${lockKey} AND expires_at < datetime('now')
      `;
      if (cleaned > 0) continue; // 清理了过期锁，重试

      // 等待后重试
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (e) {
      logger.warn(`[Lock] acquireLock error for ${lockKey}: ${e.message}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  return false;
}

/**
 * 释放数据库锁
 * @param {string} lockKey
 */
export async function releaseLock(lockKey) {
  try {
    await prisma.$executeRaw`DELETE FROM arrange_locks WHERE lock_key = ${lockKey}`;
  } catch (e) {
    logger.warn(`[Lock] releaseLock error for ${lockKey}: ${e.message}`);
  }
}
