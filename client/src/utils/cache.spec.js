import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getWithCache,
  clearCache,
  clearAllCache,
  getCacheStats,
  cleanupExpired,
  startCleanupTimer,
  stopCleanupTimer,
} from '@/utils/cache';

describe('cache 工具', () => {
  beforeEach(() => {
    clearAllCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearAllCache();
  });

  describe('getWithCache', () => {
    it('首次调用执行 API 并写入缓存', async () => {
      const apiCall = vi.fn().mockResolvedValue({ list: [1, 2] });
      const data = await getWithCache(apiCall, 'k1');

      expect(data).toEqual({ list: [1, 2] });
      expect(apiCall).toHaveBeenCalledTimes(1);
      expect(getCacheStats().keys).toContain('k1');
    });

    it('TTL 内命中缓存不重复请求', async () => {
      const apiCall = vi.fn().mockResolvedValue('v1');
      await getWithCache(apiCall, 'k1');
      const second = await getWithCache(apiCall, 'k1');

      expect(second).toBe('v1');
      expect(apiCall).toHaveBeenCalledTimes(1);
    });

    it('超过 TTL 后重新请求', async () => {
      const apiCall = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
      await getWithCache(apiCall, 'k1', 1000);

      vi.advanceTimersByTime(1001);
      const second = await getWithCache(apiCall, 'k1', 1000);

      expect(second).toBe('v2');
      expect(apiCall).toHaveBeenCalledTimes(2);
    });

    it('达到容量上限时淘汰时间戳最旧的一条（LRU）', async () => {
      // 依次写入 50 条（上限），时间戳递增保证 k0 最旧
      for (let i = 0; i < 50; i++) {
        vi.advanceTimersByTime(1);
        await getWithCache(() => Promise.resolve(i), `k${i}`, 10 * 60 * 1000);
      }
      expect(getCacheStats().size).toBe(50);

      vi.advanceTimersByTime(1);
      await getWithCache(() => Promise.resolve('new'), 'k-new', 10 * 60 * 1000);

      const { size, keys } = getCacheStats();
      expect(size).toBe(50);
      expect(keys).not.toContain('k0');
      expect(keys).toContain('k-new');
    });
  });

  describe('clearCache / clearAllCache', () => {
    it('clearCache 指定键仅删除该键', async () => {
      await getWithCache(() => Promise.resolve(1), 'a');
      await getWithCache(() => Promise.resolve(2), 'b');

      clearCache('a');

      expect(getCacheStats().keys).toEqual(['b']);
    });

    it('clearCache 不传键时清空全部', async () => {
      await getWithCache(() => Promise.resolve(1), 'a');
      clearCache();
      expect(getCacheStats().size).toBe(0);
    });
  });

  describe('cleanupExpired', () => {
    it('仅清理超过 TTL 的条目', async () => {
      await getWithCache(() => Promise.resolve(1), 'old');
      vi.advanceTimersByTime(30000);
      await getWithCache(() => Promise.resolve(2), 'fresh');

      vi.advanceTimersByTime(30001); // old 已过 60s，fresh 未过
      cleanupExpired(60000);

      expect(getCacheStats().keys).toEqual(['fresh']);
    });
  });

  describe('cleanup 定时器', () => {
    it('定时器每 5 分钟触发过期清理，stop 后不再触发', async () => {
      stopCleanupTimer(); // 清除模块加载时自动启动的定时器
      await getWithCache(() => Promise.resolve(1), 'k1');

      startCleanupTimer();
      startCleanupTimer(); // 重复启动应被忽略

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(getCacheStats().size).toBe(0);

      stopCleanupTimer();
      await getWithCache(() => Promise.resolve(2), 'k2');
      vi.advanceTimersByTime(10 * 60 * 1000);
      // 已停止清理，条目虽过期但仍在缓存中
      expect(getCacheStats().keys).toContain('k2');
    });
  });
});
