import axios from 'axios';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { getCookie } from './cookies';

const request = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
  },
  // CSRF配置（如果后端支持）
  withCredentials: true,
});

// 请求拦截器 - 自动携带Token和CSRF Token
request.interceptors.request.use(
  (config) => {
    const authStore = useAuthStore();
    if (authStore.token) {
      config.headers.Authorization = `Bearer ${authStore.token}`;
    }
    // 从Cookie读取CSRF Token（如果存在）
    const csrfToken = getCookie('XSRF-TOKEN');
    if (csrfToken && ['post', 'put', 'patch', 'delete'].includes(config.method?.toLowerCase())) {
      config.headers['X-CSRF-Token'] = csrfToken;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器 - 处理Token刷新和错误
// 审计修复：统一为 auth.js 的 _refreshPromise 单点控制，
// request.js 不再维护独立的 isRefreshing + failedQueue 机制，
// 所有并发 401 请求共享同一个 authStore.refreshAccessToken() Promise
let _sharedRefreshPromise = null;

request.interceptors.response.use(
  (response) => {
    const res = response.data;
    if (res.success !== undefined && !res.success) {
      if (!response.config?.silentError) {
        ElMessage({
          message: res.message || '请求失败',
          type: 'error',
          duration: 5000,
          showClose: true,
        });
      }
      return Promise.reject(new Error(res.message));
    }
    return res;
  },
  async (error) => {
    const originalRequest = error.config;
    const authStore = useAuthStore();

    // 处理401未授权
    if (error.response?.status === 401 && !originalRequest._retry) {
      // 对认证相关接口本身不触发刷新，防止死循环
      // 这些接口返回401是正常业务逻辑（token过期/凭证错误）
      const skipRefreshEndpoints = ['/auth/refresh', '/auth/login', '/auth/logout'];
      const isAuthEndpoint = skipRefreshEndpoints.some((ep) => originalRequest.url?.includes(ep));
      if (isAuthEndpoint) {
        return Promise.reject(error);
      }

      // 标记请求已重试，防止无限循环
      originalRequest._retry = true;

      // 审计修复：共享同一个 refresh Promise，所有并发 401 等待同一次刷新
      if (!_sharedRefreshPromise) {
        _sharedRefreshPromise = (async () => {
          try {
            const refreshed = await authStore.refreshAccessToken();
            if (refreshed) {
              return authStore.token;
            }
            throw new Error('登录已过期，请重新登录');
          } finally {
            _sharedRefreshPromise = null;
          }
        })();
      }

      try {
        const newToken = await _sharedRefreshPromise;
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return request(originalRequest);
      } catch (refreshError) {
        ElMessage.error('登录已过期，请重新登录');
        authStore.logout().catch(() => {});
        return Promise.reject(refreshError);
      }
    }

    // 处理403权限不足
    if (error.response?.status === 403) {
      // SEC-H2: 强制改密期间静默处理，Layout.vue 的 ChangePasswordDialog 已覆盖 UX
      const resCode = error.response.data?.code;
      if (resCode === 'MUST_CHANGE_PASSWORD') {
        return Promise.reject(error);
      }
      ElMessage({
        message: '权限不足，无法执行此操作',
        type: 'error',
        duration: 5000,
        showClose: true,
      });
      return Promise.reject(error);
    }

    // 处理其他错误
    const silentError = error.config?.silentError;
    if (error.response) {
      const status = error.response.status;
      const msgMap = {
        400: '请求参数错误',
        404: '请求资源不存在',
        500: '服务器内部错误',
        502: '网关错误',
        503: '服务不可用',
      };
      // FR3修复：blob 响应的 data 是 Blob 对象而非 JSON，需先尝试读取文本提取后端错误消息
      let rawMsg = error.response.data?.message;
      if (!rawMsg && error.response.data instanceof Blob) {
        try {
          const text = await error.response.data.text();
          rawMsg = JSON.parse(text)?.message;
        } catch (_) {
          /* 非 JSON blob，忽略 */
        }
      }
      const msg = typeof rawMsg === 'string' ? rawMsg : msgMap[status] || `请求失败 (${status})`;
      if (!silentError) {
        ElMessage({ message: msg, type: 'error', duration: 5000, showClose: true });
      }
    } else if (error.code === 'ECONNABORTED') {
      if (!error.config?.silentError) ElMessage.error('请求超时，请稍后重试');
    } else if (!error.response) {
      if (!error.config?.silentError) ElMessage.error('网络连接失败，请检查网络');
    } else {
      if (!error.config?.silentError) ElMessage.error(error.message || '网络错误');
    }
    // 安全网：silentError 模式下生产不弹窗（调用方自行处理），但开发环境记录日志便于排查
    if (silentError && import.meta.env.DEV) {
      console.error(
        '[silent error] 拦截器已抑制弹窗，错误由调用方处理:',
        error?.response?.data?.message || error.message
      );
    }
    return Promise.reject(error);
  }
);

export default request;

/**
 * 构造认证请求头（与请求拦截器逻辑保持一致），供非 axios 调用（如 SSE 的 fetch）复用，
 * 避免认证头构造逻辑在多处漂移。
 * @returns {{ Authorization?: string, 'X-CSRF-Token'?: string }}
 */
export function buildAuthHeaders() {
  const authStore = useAuthStore();
  const headers = {};
  if (authStore.token) {
    headers.Authorization = `Bearer ${authStore.token}`;
  }
  const csrfToken = getCookie('XSRF-TOKEN');
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  return headers;
}
