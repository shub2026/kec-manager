import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// 避免引入真实路由（会连带加载全部视图组件）
vi.mock('@/router', () => ({
  default: { push: vi.fn() },
}));

// auth store 通过动态 import 加载 api/auth，vi.mock 同样可拦截
const mockApi = {
  login: vi.fn(),
  logout: vi.fn(),
  refreshAccessToken: vi.fn(),
  fetchUserInfo: vi.fn(),
  changePassword: vi.fn(),
  fetchCsrfToken: vi.fn().mockResolvedValue({}),
};
vi.mock('@/api/auth', () => mockApi);

import router from '@/router';
import { useAuthStore } from '@/stores/auth';

/** 构造带指定 exp 的伪 JWT（仅 payload 部分有效） */
function fakeJwt(expSeconds) {
  const payload = btoa(JSON.stringify({ exp: expSeconds }));
  return `header.${payload}.sig`;
}

describe('auth store', () => {
  let store;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setActivePinia(createPinia());
    store = useAuthStore();
  });

  describe('isTokenExpired', () => {
    it('空 token 视为过期', () => {
      expect(store.isTokenExpired('')).toBe(true);
      expect(store.isTokenExpired(null)).toBe(true);
    });

    it('无法解析的 token 视为过期', () => {
      expect(store.isTokenExpired('not-a-jwt')).toBe(true);
    });

    it('exp 在未来时未过期', () => {
      expect(store.isTokenExpired(fakeJwt(Math.floor(Date.now() / 1000) + 3600))).toBe(false);
    });

    it('exp 在过去时已过期', () => {
      expect(store.isTokenExpired(fakeJwt(Math.floor(Date.now() / 1000) - 10))).toBe(true);
    });
  });

  describe('login', () => {
    it('登录成功时写入 token/userInfo 并持久化到 localStorage', async () => {
      const user = { username: 'alice', role: 'admin', realName: '爱丽丝' };
      mockApi.login.mockResolvedValue({ data: { user, token: 'tk-1' } });

      const result = await store.login('alice', 'pw');

      expect(result.success).toBe(true);
      expect(mockApi.fetchCsrfToken).toHaveBeenCalled();
      expect(store.token).toBe('tk-1');
      expect(store.userInfo).toEqual(user);
      expect(JSON.parse(localStorage.getItem('userInfo'))).toEqual(user);
      expect(localStorage.getItem('loggedIn')).toBe('true');
    });

    it('401/403 提示账号或密码错误', async () => {
      mockApi.login.mockRejectedValue({ response: { status: 401 } });
      const result = await store.login('alice', 'wrong');
      expect(result.success).toBe(false);
      expect(result.message).toContain('账号或密码错误');
    });

    it('5xx 提示服务器异常', async () => {
      mockApi.login.mockRejectedValue({ response: { status: 500 } });
      const result = await store.login('a', 'b');
      expect(result.message).toContain('服务器异常');
    });

    it('后端返回具体消息时透传', async () => {
      mockApi.login.mockRejectedValue({
        response: { status: 423, data: { message: '账号已锁定' } },
      });
      const result = await store.login('a', 'b');
      expect(result.message).toBe('账号已锁定');
    });

    it('网络错误提示检查网络', async () => {
      mockApi.login.mockRejectedValue({ code: 'ECONNABORTED' });
      const result = await store.login('a', 'b');
      expect(result.message).toContain('网络连接失败');
    });
  });

  describe('logout', () => {
    it('有 token 时调用登出接口，随后清理状态并跳转登录页', async () => {
      store.token = 'tk';
      store.userInfo = { username: 'a' };
      localStorage.setItem('loggedIn', 'true');
      mockApi.logout.mockResolvedValue({});

      await store.logout();

      expect(mockApi.logout).toHaveBeenCalledTimes(1);
      expect(store.token).toBe('');
      expect(store.userInfo).toBeNull();
      expect(localStorage.getItem('loggedIn')).toBeNull();
      expect(router.push).toHaveBeenCalledWith('/login');
    });

    it('登出接口失败时仍然清理本地状态', async () => {
      store.token = 'tk';
      mockApi.logout.mockRejectedValue(new Error('network'));

      await store.logout();

      expect(store.token).toBe('');
      expect(router.push).toHaveBeenCalledWith('/login');
    });
  });

  describe('refreshAccessToken', () => {
    it('刷新成功时更新 token 并返回 true', async () => {
      mockApi.refreshAccessToken.mockResolvedValue({ data: { token: 'new-tk' } });

      const ok = await store.refreshAccessToken();

      expect(ok).toBe(true);
      expect(store.token).toBe('new-tk');
    });

    it('刷新失败时清理认证状态并返回 false', async () => {
      store.token = 'old';
      mockApi.refreshAccessToken.mockRejectedValue(new Error('expired'));

      const ok = await store.refreshAccessToken();

      expect(ok).toBe(false);
      expect(store.token).toBe('');
    });

    it('并发刷新复用同一个 Promise，仅请求一次', async () => {
      let resolveApi;
      mockApi.refreshAccessToken.mockReturnValue(
        new Promise((resolve) => {
          resolveApi = resolve;
        })
      );

      const p1 = store.refreshAccessToken();
      const p2 = store.refreshAccessToken();
      resolveApi({ data: { token: 'tk' } });

      expect(await Promise.all([p1, p2])).toEqual([true, true]);
      expect(mockApi.refreshAccessToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('changePassword', () => {
    it('修改成功返回成功消息', async () => {
      mockApi.changePassword.mockResolvedValue({});
      const result = await store.changePassword('old', 'new');
      expect(result).toEqual({ success: true, message: '密码修改成功' });
    });

    it('后端校验 details 逐条拼接为消息', async () => {
      mockApi.changePassword.mockRejectedValue({
        response: {
          data: { data: { details: [{ message: '长度不足' }, { message: '缺少大写字母' }] } },
        },
      });
      const result = await store.changePassword('old', 'new');
      expect(result.success).toBe(false);
      expect(result.message).toBe('长度不足；缺少大写字母');
    });

    it('无 details 时回退后端 message', async () => {
      mockApi.changePassword.mockRejectedValue({
        response: { data: { message: '旧密码错误' } },
      });
      const result = await store.changePassword('old', 'new');
      expect(result.message).toBe('旧密码错误');
    });
  });

  describe('角色 computed', () => {
    it('admin/super_admin 均视为管理员', () => {
      store.userInfo = { role: 'admin' };
      expect(store.isAdmin).toBe(true);
      expect(store.isSuperAdmin).toBe(false);

      store.userInfo = { role: 'super_admin' };
      expect(store.isAdmin).toBe(true);
      expect(store.isSuperAdmin).toBe(true);
    });

    it('viewer 与强制改密标志', () => {
      store.userInfo = { role: 'viewer', mustChangePassword: true };
      expect(store.isViewer).toBe(true);
      expect(store.isAdmin).toBe(false);
      expect(store.mustChangePassword).toBe(true);
    });

    it('username/realName 缺省为空字符串', () => {
      store.userInfo = null;
      expect(store.username).toBe('');
      expect(store.realName).toBe('');
    });

    it('isLoggedIn 仅取决于 token 是否存在', () => {
      expect(store.isLoggedIn).toBe(false);
      store.token = 'tk';
      expect(store.isLoggedIn).toBe(true);
    });
  });
});
