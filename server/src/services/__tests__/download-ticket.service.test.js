/**
 * download-ticket.service 单元测试
 *
 * 覆盖：
 * - issueDownloadTicket: 票据格式与绑定信息
 * - consumeDownloadTicket: 一次性消费、过期/非法票据
 * - peekDownloadTicket: 查询不消费、过期清理
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn() },
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { issueDownloadTicket, consumeDownloadTicket, peekDownloadTicket } =
  await import('../download-ticket.service.js');

describe('download-ticket.service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('issueDownloadTicket', () => {
    it('签发 48 位 hex 票据（24 字节随机数）', () => {
      const ticket = issueDownloadTicket(1, 'admin', 'alice');
      expect(ticket).toMatch(/^[0-9a-f]{48}$/);
    });

    it('每次签发的票据互不相同', () => {
      const t1 = issueDownloadTicket(1, 'admin', 'alice');
      const t2 = issueDownloadTicket(1, 'admin', 'alice');
      expect(t1).not.toBe(t2);
    });
  });

  describe('consumeDownloadTicket', () => {
    it('有效票据返回绑定的用户信息', () => {
      const ticket = issueDownloadTicket(42, 'viewer', 'bob');
      expect(consumeDownloadTicket(ticket)).toEqual({
        userId: 42,
        role: 'viewer',
        username: 'bob',
      });
    });

    it('票据为一次性，二次消费返回 null', () => {
      const ticket = issueDownloadTicket(1, 'admin', 'alice');
      consumeDownloadTicket(ticket);
      expect(consumeDownloadTicket(ticket)).toBeNull();
    });

    it('超过 30s TTL 的票据消费返回 null', () => {
      const ticket = issueDownloadTicket(1, 'admin', 'alice');
      vi.advanceTimersByTime(30 * 1000 + 1);
      expect(consumeDownloadTicket(ticket)).toBeNull();
    });

    it('非法入参返回 null', () => {
      expect(consumeDownloadTicket(null)).toBeNull();
      expect(consumeDownloadTicket(undefined)).toBeNull();
      expect(consumeDownloadTicket(123)).toBeNull();
      expect(consumeDownloadTicket('nonexistent-ticket')).toBeNull();
    });
  });

  describe('peekDownloadTicket', () => {
    it('查询不消费票据，随后仍可正常消费', () => {
      const ticket = issueDownloadTicket(7, 'admin', 'carol');

      expect(peekDownloadTicket(ticket)).toEqual({
        userId: 7,
        role: 'admin',
        username: 'carol',
      });
      expect(consumeDownloadTicket(ticket)).not.toBeNull();
    });

    it('过期票据 peek 返回 null 并顺带清理', () => {
      const ticket = issueDownloadTicket(1, 'admin', 'alice');
      vi.advanceTimersByTime(30 * 1000 + 1);

      expect(peekDownloadTicket(ticket)).toBeNull();
      // 已被清理，重复 peek 也为 null
      expect(peekDownloadTicket(ticket)).toBeNull();
    });

    it('非法入参返回 null', () => {
      expect(peekDownloadTicket(null)).toBeNull();
      expect(peekDownloadTicket('unknown')).toBeNull();
    });
  });
});
