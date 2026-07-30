import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// settings store 通过动态 import 加载 api/settings
const mockApi = {
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
};
vi.mock('@/api/settings', () => mockApi);

// 降级重试分支会动态引入 auth store，打桩避免拉起真实路由依赖
const mockRefresh = vi.fn().mockResolvedValue(false);
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ refreshAccessToken: mockRefresh }),
}));

import { useSettingsStore } from '@/stores/settings';

function settingsPayload(semesterValue) {
  return { data: { currentSemester: { value: semesterValue } } };
}

describe('settings store', () => {
  let store;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setActivePinia(createPinia());
    store = useSettingsStore();
  });

  describe('load 与学期标签解析', () => {
    it('第 1 学期解析为起始年秋季', async () => {
      mockApi.getSettings.mockResolvedValue(settingsPayload('2025-2026-1'));
      await store.load();
      expect(store.semesterLabel).toBe('2025年秋季(第1学期)');
    });

    it('第 2 学期解析为结束年春季', async () => {
      mockApi.getSettings.mockResolvedValue(settingsPayload('2025-2026-2'));
      await store.load();
      expect(store.semesterLabel).toBe('2026年春季(第2学期)');
    });

    it('非法学期格式不更新标签', async () => {
      mockApi.getSettings.mockResolvedValue(settingsPayload('2025-2027-1'));
      await store.load();
      expect(store.semesterLabel).toBe('');
    });

    it('响应缺少 data 时 settings 回退为空对象', async () => {
      mockApi.getSettings.mockResolvedValue({});
      await store.load();
      expect(store.settings).toEqual({});
    });
  });

  describe('缓存与防重复请求', () => {
    it('缓存有效期内二次 load 不重复请求', async () => {
      mockApi.getSettings.mockResolvedValue(settingsPayload('2025-2026-1'));
      await store.load();
      await store.load();
      expect(mockApi.getSettings).toHaveBeenCalledTimes(1);
    });

    it('force=true 跳过缓存重新请求', async () => {
      mockApi.getSettings.mockResolvedValue(settingsPayload('2025-2026-1'));
      await store.load();
      await store.load(true);
      expect(mockApi.getSettings).toHaveBeenCalledTimes(2);
    });

    it('并发 load 复用同一个 pending Promise', async () => {
      let resolveApi;
      mockApi.getSettings.mockReturnValue(
        new Promise((resolve) => {
          resolveApi = resolve;
        })
      );

      const p1 = store.load();
      const p2 = store.load();
      resolveApi(settingsPayload('2025-2026-2'));
      await Promise.all([p1, p2]);

      expect(mockApi.getSettings).toHaveBeenCalledTimes(1);
      expect(store.semesterLabel).toBe('2026年春季(第2学期)');
    });

    it('接口失败不抛出（错误被吞没，控制台记录）', async () => {
      mockApi.getSettings.mockRejectedValue(new Error('boom'));
      await expect(store.load()).resolves.toBeUndefined();
    });
  });

  describe('降级恢复', () => {
    it('已登录但返回匿名裁剪结果时尝试刷新令牌后重试', async () => {
      localStorage.setItem('loggedIn', 'true');
      mockRefresh.mockResolvedValueOnce(true);
      mockApi.getSettings
        .mockResolvedValueOnce({ data: {} }) // 首次：降级结果（无 currentSemester）
        .mockResolvedValueOnce(settingsPayload('2025-2026-2'));

      await store.load();

      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockApi.getSettings).toHaveBeenCalledTimes(2);
      expect(store.semesterLabel).toBe('2026年春季(第2学期)');
    });

    it('刷新失败仍降级时不写缓存，下次 load 重新请求', async () => {
      localStorage.setItem('loggedIn', 'true');
      mockRefresh.mockResolvedValue(false);
      mockApi.getSettings.mockResolvedValue({ data: {} });

      await store.load();
      await store.load();

      // 降级未写缓存时间，二次 load 重新发起请求
      expect(mockApi.getSettings).toHaveBeenCalledTimes(2);
    });
  });

  describe('currentSemesterValue / save', () => {
    it('未加载时返回空字符串', () => {
      expect(store.currentSemesterValue()).toBe('');
    });

    it('加载后返回当前学期值', async () => {
      mockApi.getSettings.mockResolvedValue(settingsPayload('2025-2026-2'));
      await store.load();
      expect(store.currentSemesterValue()).toBe('2025-2026-2');
    });

    it('save 调用更新接口、写跨标签页标记并强制重载', async () => {
      mockApi.updateSettings.mockResolvedValue({});
      mockApi.getSettings.mockResolvedValue(settingsPayload('2026-2027-1'));

      await store.save({ some: 'data' });

      expect(mockApi.updateSettings).toHaveBeenCalledWith({ some: 'data' });
      expect(localStorage.getItem('settingsUpdatedAt')).toBeTruthy();
      expect(store.semesterLabel).toBe('2026年秋季(第1学期)');
    });
  });
});
