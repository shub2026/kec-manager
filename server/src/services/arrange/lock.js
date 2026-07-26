import { prisma } from '../../lib/prisma.js';
import logger from '../../utils/logger.js';
import { randomUUID } from 'crypto';

// B-01 修复：基于数据库的排课并发锁，支持多进程/多实例部署
// 使用 arrange_locks 表替代进程内 Set，确保跨进程互斥
// F9 修复：增加 owner 标识，防止过期锁被其他实例误释放

const LOCK_TIMEOUT_MS = 5000; // 获取锁超时时间

// F9：进程内记录每个 lockKey 的持有者标识，releaseLock 时带 owner 条件删除
const lockOwners = new Map();

/**
 * 尝试获取数据库锁
 * @param {string} lockKey - 锁标识（如 "course:semester" 或 "batch:semester"）
 * @param {number} timeoutMs - 超时毫秒数
 * @returns {Promise<boolean>} 是否获取成功
 */
export async function acquireLock(lockKey, timeoutMs = LOCK_TIMEOUT_MS) {
  const startTime = Date.now();
  const owner = randomUUID();
  while (Date.now() - startTime < timeoutMs) {
    try {
      // 使用 INSERT OR IGNORE 实现原子性获取
      // SQLite 的写入串行化保证了原子性
      // F9 修复：写入 owner 标识，releaseLock 时带 owner 条件删除
      const result = await prisma.$executeRaw`
        INSERT OR IGNORE INTO arrange_locks (lock_key, owner, created_at, expires_at)
        VALUES (${lockKey}, ${owner}, datetime('now'), datetime('now', '+10 minutes'))
      `;
      if (result > 0) {
        lockOwners.set(lockKey, owner);
        return true;
      }

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
 * F9 修复：带 owner 条件删除，防止误释放其他实例持有的锁。
 * 场景：实例 A 排课超时 → 锁过期 → 实例 B 清理过期锁并取得新锁 →
 *       实例 A finally 中的 releaseLock 不再误删实例 B 的锁。
 * @param {string} lockKey
 */
export async function releaseLock(lockKey) {
  try {
    const owner = lockOwners.get(lockKey);
    if (owner) {
      await prisma.$executeRaw`
        DELETE FROM arrange_locks WHERE lock_key = ${lockKey} AND owner = ${owner}
      `;
      lockOwners.delete(lockKey);
    } else {
      // F9 修复：无 owner 记录时（如进程重启后内存丢失），仅清理 owner 为空的遗留锁，
      // 绝不删除其他实例持有的带 owner 锁，避免 F9 描述的"误删他人锁"问题。
      await prisma.$executeRaw`DELETE FROM arrange_locks WHERE lock_key = ${lockKey} AND (owner IS NULL OR owner = '')`;
    }
  } catch (e) {
    logger.warn(`[Lock] releaseLock error for ${lockKey}: ${e.message}`);
  }
}
