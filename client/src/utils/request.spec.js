/**
 * utils/request.js 单元测试
 *
 * 通过自定义 axios adapter 驱动真实拦截器链路，覆盖：
 * - 请求拦截器：Token 注入、CSRF Token 仅变异方法注入
 * - 响应拦截器成功路径：解包 response.data、success=false 业务失败弹窗/静默
 * - 401：共享刷新（并发只刷一次）、刷新失败登出、认证端点不触发刷新、重试后仍 401 不再刷新
 * - 403：强制改密静默、CSRF 失效自愈重试一次、普通 403 权限提示
 * - 其他错误：状态码文案映射、后端自定义消息、Blob 错误体提取、超时、断网、silentError 抑制弹窗
 * - buildAuthHeaders：与请求拦截器同口径的头部构造
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError } from 'axios';
import request, { buildAuthHeaders } from './request';

// ── mock 依赖（hoisted 保证 vi.mock 工厂可用）──
const mocks = vi.hoisted(() => ({
  authStore: {
    token: 'test-token',
    refreshAccessToken: vi.fn(),
    logout: vi.fn(),
  },
  cookieValue: null,
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => mocks.authStore,
}));

vi.mock('./cookies', () => ({
  getCookie: (name) => (name === 'XSRF-TOKEN' ? mocks.cookieValue : null),
}));

const mockElMessage = vi.hoisted(() => {
  const fn = vi.fn();
  fn.error = vi.fn();
  fn.success = vi.fn();
  fn.warning = vi.fn();
  fn.info = vi.fn();
  return fn;
});

vi.mock('element-plus', () => ({
  ElMessage: mockElMessage,
}));

// ── 工具：构造 adapter 成功/失败结果 ──
function okResponse(config, data = { success: true }, status = 200) {
  return { data, status, statusText: 'OK', headers: {}, config };
}

function httpError(config, status, data = {}) {
  return new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_RESPONSE,
    config,
    null,
    { data, status, statusText: '', headers: {}, config }
  );
}

describe('request 请求拦截器', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStore.token = 'test-token';
    mocks.authStore.refreshAccessToken = vi.fn().mockResolvedValue(true);
    mocks.authStore.logout = vi.fn().mockResolvedValue(undefined);
    mocks.cookieValue = null;
  });

  it('存在 token 时注入 Authorization 头', async () => {
    let captured;
    request.defaults.adapter = (config) => {
      captured = config;
      return Promise.resolve(okResponse(config));
    };
    await request.get('/classes');
    expect(captured.headers.Authorization).toBe('Bearer test-token');
  });

  it('无 token 时不注入 Authorization 头', async () => {
    mocks.authStore.token = null;
    let captured;
    request.defaults.adapter = (config) => {
      captured = config;
      return Promise.resolve(okResponse(config));
    };
    await request.get('/classes');
    expect(captured.headers.Authorization).toBeUndefined();
  });

  it.each(['post', 'put', 'patch', 'delete'])('%s 请求注入 CSRF 头', async (method) => {
    mocks.cookieValue = 'csrf-abc';
    let captured;
    request.defaults.adapter = (config) => {
      captured = config;
      return Promise.resolve(okResponse(config));
    };
    await request[method]('/data', {});
    expect(captured.headers['X-CSRF-Token']).toBe('csrf-abc');
  });

  it('GET 请求不注入 CSRF 头', async () => {
    mocks.cookieValue = 'csrf-abc';
    let captured;
    request.defaults.adapter = (config) => {
      captured = config;
      return Promise.resolve(okResponse(config));
    };
    await request.get('/data');
    expect(captured.headers['X-CSRF-Token']).toBeUndefined();
  });
});

describe('request 成功响应处理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStore.token = 'test-token';
  });

  it('解包 response.data 返回业务载荷', async () => {
    request.defaults.adapter = (config) =>
      Promise.resolve(okResponse(config, { success: true, data: { id: 1 } }));
    const res = await request.get('/classes');
    expect(res).toEqual({ success: true, data: { id: 1 } });
  });

  it('success=false 时弹窗并 reject 业务消息', async () => {
    request.defaults.adapter = (config) =>
      Promise.resolve(okResponse(config, { success: false, message: '班级名称已存在' }));
    await expect(request.post('/classes', {})).rejects.toThrow('班级名称已存在');
    expect(mockElMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: '班级名称已存在', type: 'error' })
    );
  });

  it('success=false + silentError 时不弹窗仍 reject', async () => {
    request.defaults.adapter = (config) =>
      Promise.resolve(okResponse(config, { success: false, message: '静默失败' }));
    await expect(request.get('/probe', { silentError: true })).rejects.toThrow('静默失败');
    expect(mockElMessage).not.toHaveBeenCalled();
  });

  it('响应无 success 字段（如文件流）时直接透传', async () => {
    request.defaults.adapter = (config) => Promise.resolve(okResponse(config, 'binary-content'));
    const res = await request.get('/export');
    expect(res).toBe('binary-content');
  });
});

describe('request 401 处理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStore.token = 'old-token';
    mocks.authStore.logout = vi.fn().mockResolvedValue(undefined);
  });

  it('401 后刷新成功：用新 token 重试并返回结果', async () => {
    mocks.authStore.refreshAccessToken = vi.fn(async () => {
      mocks.authStore.token = 'new-token';
      return true;
    });
    const attempts = new Map();
    request.defaults.adapter = (config) => {
      const n = (attempts.get(config.url) || 0) + 1;
      attempts.set(config.url, n);
      if (n === 1) return Promise.reject(httpError(config, 401, {}));
      return Promise.resolve(okResponse(config, { success: true, data: 'ok' }));
    };

    const res = await request.get('/classes');
    expect(res).toEqual({ success: true, data: 'ok' });
    expect(mocks.authStore.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(attempts.get('/classes')).toBe(2);
  });

  it('并发 401 共享同一次刷新，且重试均携带新 token', async () => {
    mocks.authStore.refreshAccessToken = vi.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            mocks.authStore.token = 'new-token';
            resolve(true);
          }, 10);
        })
    );
    const attempts = new Map();
    const secondAttemptHeaders = new Map();
    request.defaults.adapter = (config) => {
      const n = (attempts.get(config.url) || 0) + 1;
      attempts.set(config.url, n);
      if (n === 1) return Promise.reject(httpError(config, 401, {}));
      secondAttemptHeaders.set(config.url, config.headers.Authorization);
      return Promise.resolve(okResponse(config, { success: true }));
    };

    const [r1, r2] = await Promise.all([request.get('/a'), request.get('/b')]);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(mocks.authStore.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(secondAttemptHeaders.get('/a')).toBe('Bearer new-token');
    expect(secondAttemptHeaders.get('/b')).toBe('Bearer new-token');
  });

  it('刷新失败：提示过期并登出', async () => {
    mocks.authStore.refreshAccessToken = vi.fn().mockResolvedValue(false);
    request.defaults.adapter = (config) => Promise.reject(httpError(config, 401, {}));

    await expect(request.get('/classes')).rejects.toThrow('登录已过期，请重新登录');
    expect(mockElMessage.error).toHaveBeenCalledWith('登录已过期，请重新登录');
    expect(mocks.authStore.logout).toHaveBeenCalled();
  });

  it.each(['/auth/login', '/auth/refresh', '/auth/logout'])(
    '认证端点 %s 的 401 不触发刷新',
    async (url) => {
      mocks.authStore.refreshAccessToken = vi.fn();
      request.defaults.adapter = (config) => Promise.reject(httpError(config, 401, {}));
      await expect(request.post(url, {})).rejects.toBeTruthy();
      expect(mocks.authStore.refreshAccessToken).not.toHaveBeenCalled();
    }
  );

  it('重试后仍 401：不再二次刷新，走通用错误提示', async () => {
    mocks.authStore.refreshAccessToken = vi.fn(async () => {
      mocks.authStore.token = 'new-token';
      return true;
    });
    request.defaults.adapter = (config) => Promise.reject(httpError(config, 401, {}));

    await expect(request.get('/classes')).rejects.toBeTruthy();
    expect(mocks.authStore.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(mockElMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: '请求失败 (401)' })
    );
  });
});

describe('request 403 处理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStore.token = 'test-token';
  });

  it('强制改密 403 静默拒绝不弹窗', async () => {
    request.defaults.adapter = (config) =>
      Promise.reject(httpError(config, 403, { code: 'MUST_CHANGE_PASSWORD' }));
    await expect(request.get('/classes')).rejects.toBeTruthy();
    expect(mockElMessage).not.toHaveBeenCalled();
    expect(mockElMessage.error).not.toHaveBeenCalled();
  });

  it('CSRF 失效：重新获取 csrf-token 后重试一次成功', async () => {
    const attempts = new Map();
    let csrfFetches = 0;
    request.defaults.adapter = (config) => {
      if (config.url === '/auth/csrf-token') {
        csrfFetches += 1;
        return Promise.resolve(okResponse(config, { success: true }));
      }
      const n = (attempts.get(config.url) || 0) + 1;
      attempts.set(config.url, n);
      if (n === 1) {
        return Promise.reject(httpError(config, 403, { message: 'CSRF token 无效，请刷新页面' }));
      }
      return Promise.resolve(okResponse(config, { success: true, data: 'saved' }));
    };

    const res = await request.post('/save', {});
    expect(res).toEqual({ success: true, data: 'saved' });
    expect(csrfFetches).toBe(1);
    expect(attempts.get('/save')).toBe(2);
  });

  it('CSRF 重试后仍 403：只重试一次并提示后端 CSRF 消息', async () => {
    let csrfFetches = 0;
    let saveAttempts = 0;
    request.defaults.adapter = (config) => {
      if (config.url === '/auth/csrf-token') {
        csrfFetches += 1;
        return Promise.resolve(okResponse(config, { success: true }));
      }
      saveAttempts += 1;
      return Promise.reject(httpError(config, 403, { message: 'CSRF token 无效，请刷新页面' }));
    };

    await expect(request.post('/save', {})).rejects.toBeTruthy();
    expect(saveAttempts).toBe(2);
    expect(csrfFetches).toBe(1);
    expect(mockElMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'CSRF token 无效，请刷新页面' })
    );
  });

  it('普通 403 提示权限不足', async () => {
    request.defaults.adapter = (config) =>
      Promise.reject(httpError(config, 403, { message: '无权访问' }));
    await expect(request.get('/admin')).rejects.toBeTruthy();
    expect(mockElMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: '权限不足，无法执行此操作' })
    );
  });
});

describe('request 其他错误处理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStore.token = 'test-token';
  });

  it('404 使用状态码文案映射', async () => {
    request.defaults.adapter = (config) => Promise.reject(httpError(config, 404, {}));
    await expect(request.get('/missing')).rejects.toBeTruthy();
    expect(mockElMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: '请求资源不存在' })
    );
  });

  it('后端自定义错误消息优先于状态码映射', async () => {
    request.defaults.adapter = (config) =>
      Promise.reject(httpError(config, 500, { message: '数据库连接失败' }));
    await expect(request.get('/classes')).rejects.toBeTruthy();
    expect(mockElMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: '数据库连接失败' })
    );
  });

  it('Blob 错误体：提取其中 JSON 消息', async () => {
    const blob = new Blob([JSON.stringify({ message: '导出失败：班级数为空' })], {
      type: 'application/json',
    });
    // jsdom 的 Blob 可能未实现 text()，兜底补齐
    if (typeof blob.text !== 'function') {
      blob.text = async () => JSON.stringify({ message: '导出失败：班级数为空' });
    }
    request.defaults.adapter = (config) => Promise.reject(httpError(config, 400, blob));
    await expect(request.get('/export')).rejects.toBeTruthy();
    expect(mockElMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: '导出失败：班级数为空' })
    );
  });

  it('silentError 抑制弹窗（开发环境仅记录日志）', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    request.defaults.adapter = (config) =>
      Promise.reject(httpError(config, 400, { message: '参数错误' }));
    await expect(request.get('/x', { silentError: true })).rejects.toBeTruthy();
    expect(mockElMessage).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('超时提示请求超时', async () => {
    request.defaults.adapter = (config) =>
      Promise.reject(
        new AxiosError('timeout of 30000ms exceeded', AxiosError.ECONNABORTED, config)
      );
    await expect(request.get('/slow')).rejects.toBeTruthy();
    expect(mockElMessage.error).toHaveBeenCalledWith('请求超时，请稍后重试');
  });

  it('无响应的网络错误提示检查网络', async () => {
    request.defaults.adapter = (config) =>
      Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config));
    await expect(request.get('/offline')).rejects.toBeTruthy();
    expect(mockElMessage.error).toHaveBeenCalledWith('网络连接失败，请检查网络');
  });
});

describe('buildAuthHeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('同时有 token 与 CSRF cookie 时返回两个头', () => {
    mocks.authStore.token = 'h-token';
    mocks.cookieValue = 'csrf-h';
    expect(buildAuthHeaders()).toEqual({
      Authorization: 'Bearer h-token',
      'X-CSRF-Token': 'csrf-h',
    });
  });

  it('无 token 无 cookie 时返回空对象', () => {
    mocks.authStore.token = null;
    mocks.cookieValue = null;
    expect(buildAuthHeaders()).toEqual({});
  });
});
