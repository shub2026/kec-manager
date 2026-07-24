import crypto from 'crypto';
import { log } from '../utils/logger.js';

/**
 * SEC-M2 修复：一次性下载票据服务
 *
 * 替代原先将 JWT 直接放入 URL 查询参数（download_token）的做法，
 * 避免 JWT 泄露到 Nginx access log、浏览器历史、Referer 头。
 *
 * 设计：
 * - 票据为 24 字节随机 hex（192 bit 熵），非 JWT，无业务信息
 * - 存储在内存 Map（生产可用 Redis 替换），30s 过期，单次使用
 * - 消费后立即删除，即便泄露也只能用一次
 * - 票据与 userId/role 绑定，鉴权时校验
 *
 * 注意：当前为单实例内存方案；多实例部署需替换为 Redis 实现。
 */

const TICKET_TTL_MS = 30 * 1000; // 30 秒
const MAX_TICKETS = 10000; // 容量保护

const tickets = new Map(); // ticket -> { userId, role, username, expireAt }

// 定时清理过期票据（每分钟一次）
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of tickets) {
    if (value.expireAt <= now) {
      tickets.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    log.debug(`清理过期下载票据 ${cleaned} 条`);
  }
}, 60 * 1000).unref();

/**
 * 签发一次性下载票据
 * @param {number} userId
 * @param {string} role
 * @param {string} username
 * @returns {string} 票据字符串
 */
export function issueDownloadTicket(userId, role, username) {
  // 容量保护：超过上限时先清理过期项
  if (tickets.size > MAX_TICKETS) {
    const now = Date.now();
    for (const [key, value] of tickets) {
      if (value.expireAt <= now) tickets.delete(key);
    }
  }

  const ticket = crypto.randomBytes(24).toString('hex');
  tickets.set(ticket, {
    userId,
    role,
    username,
    expireAt: Date.now() + TICKET_TTL_MS,
  });
  return ticket;
}

/**
 * 消费下载票据（一次性，消费后立即删除）
 * @param {string} ticket
 * @returns {{userId:number, role:string, username:string} | null}
 */
export function consumeDownloadTicket(ticket) {
  if (!ticket || typeof ticket !== 'string') return null;
  const entry = tickets.get(ticket);
  if (!entry) return null;

  // 立即删除，确保一次性
  tickets.delete(ticket);

  // 校验是否过期
  if (entry.expireAt <= Date.now()) {
    return null;
  }

  return {
    userId: entry.userId,
    role: entry.role,
    username: entry.username,
  };
}

/**
 * 查询票据（不消费，用于检查是否存在）
 */
export function peekDownloadTicket(ticket) {
  if (!ticket || typeof ticket !== 'string') return null;
  const entry = tickets.get(ticket);
  if (!entry) return null;
  if (entry.expireAt <= Date.now()) {
    tickets.delete(ticket);
    return null;
  }
  return {
    userId: entry.userId,
    role: entry.role,
    username: entry.username,
  };
}
