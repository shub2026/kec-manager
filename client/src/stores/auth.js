import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import router from '@/router';
import { deleteCookie, clearAuthCookies } from '@/utils/cookies';
import { clearAllCache } from '@/utils/cache';

// 延迟导入 api/auth，避免与 request.js → stores/auth.js → api/auth.js → request.js 形成循环依赖
let _authApi = null;
async function getAuthApi() {
  if (!_authApi) {
    _authApi = await import('@/api/auth');
  }
  return _authApi;
}

export const useAuthStore = defineStore('auth', () => {
  // H-3: Token 由后端 HttpOnly Cookie 管理，前端不再存储 Token 副本
  // 内存变量仅用于 isTokenExpired 等客户端逻辑判断，实际认证依赖浏览器自动携带 HttpOnly Cookie
  const token = ref('');
  const refreshToken = ref('');

  function isTokenExpired(tokenStr) {
    if (!tokenStr) return true;
    try {
      const payload = JSON.parse(atob(tokenStr.split('.')[1]));
      return payload.exp * 1000 < Date.now();
    } catch {
      return true;
    }
  }

  // 添加 try-catch 防止 localStorage 被篡改导致应用崩溃
  let parsedUserInfo = null;
  try {
    const userInfoStr = localStorage.getItem('userInfo');
    parsedUserInfo = userInfoStr ? JSON.parse(userInfoStr) : null;
  } catch (error) {
    // 生产环境不输出详细错误信息
    if (import.meta.env.DEV) {
      console.warn('Failed to parse userInfo:', error.message);
    }
    // 清除损坏的数据
    localStorage.removeItem('userInfo');
  }
  const userInfo = ref(parsedUserInfo);

  // isLoggedIn 仅检查 token 是否存在（不依赖时间，避免 computed 缓存导致状态过时）
  // 实际的过期判断由 router guard 和 request interceptor 通过 isTokenExpired() 处理
  const isLoggedIn = computed(() => {
    return !!(token.value || refreshToken.value);
  });
  const isAdmin = computed(() => ['admin', 'super_admin'].includes(userInfo.value?.role));
  const isSuperAdmin = computed(() => userInfo.value?.role === 'super_admin');
  const isViewer = computed(() => userInfo.value?.role === 'viewer');
  const mustChangePassword = computed(() => userInfo.value?.mustChangePassword === true);
  const username = computed(() => userInfo.value?.username || '');
  const realName = computed(() => userInfo.value?.realName || '');

  async function login(username, password) {
    try {
      const { login: apiLogin, fetchCsrfToken } = await getAuthApi();
      // 先获取 CSRF Token（设置 XSRF-TOKEN cookie），再发起登录请求
      await fetchCsrfToken();
      const response = await apiLogin({
        username,
        password,
      });

      const { user, token: newToken, refreshToken: newRefreshToken } = response.data;

      token.value = newToken;
      refreshToken.value = newRefreshToken;
      userInfo.value = user;

      // H-3: Token 由后端 HttpOnly Cookie 管理，前端不再通过 JS Cookie 存储 Token
      // userInfo仍然存储在localStorage（非敏感数据）
      localStorage.setItem('userInfo', JSON.stringify(user));
      // 登录标志：F5刷新时若JS cookie不可读（HttpOnly同名冲突），initAuth可据此回退到后端cookie认证
      localStorage.setItem('loggedIn', 'true');

      router.push('/');

      return { success: true, message: '登录成功' };
    } catch (error) {
      let message = '登录失败';
      if (error.response) {
        const status = error.response.status;
        if (status === 401 || status === 403) {
          message = '账号或密码错误，请检查重新输入';
        } else if (status >= 500) {
          message = '服务器异常，请稍后重试';
        } else if (error.response.data?.message) {
          message = error.response.data.message;
        }
      } else if (error.code === 'ECONNABORTED' || !error.response) {
        message = '网络连接失败，请检查网络后重试';
      }
      return {
        success: false,
        message,
      };
    }
  }

  async function logout() {
    try {
      if (token.value) {
        const { logout: apiLogout } = await getAuthApi();
        await apiLogout();
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('登出请求失败:', error.message);
      }
    } finally {
      clearAuth();
      router.push('/login');
    }
  }

  // 并发守卫：路由守卫与请求拦截器可能同时触发 token 刷新，复用同一个 Promise 避免并发刷新
  let _refreshPromise = null;

  async function refreshAccessToken() {
    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = (async () => {
      try {
        const { refreshAccessToken: apiRefresh } = await getAuthApi();
        const response = await apiRefresh({
          refreshToken: refreshToken.value,
        });

        const { token: newToken, refreshToken: newRefreshToken } = response.data;

        token.value = newToken;
        // H-3: 不再调用 setCookie，Token 由后端 HttpOnly Cookie 管理

        // 若后端返回了新的 refreshToken，同步更新，避免长期登录后 refreshToken 过期失效
        if (newRefreshToken) {
          refreshToken.value = newRefreshToken;
          // H-3: 不再调用 setCookie，Token 由后端 HttpOnly Cookie 管理
        }

        return true;
      } catch (error) {
        clearAuth();
        return false;
      } finally {
        _refreshPromise = null;
      }
    })();

    return _refreshPromise;
  }

  async function fetchUserInfo(retryCount = 0) {
    try {
      const { fetchUserInfo: apiFetchUserInfo } = await getAuthApi();
      const response = await apiFetchUserInfo();
      userInfo.value = response.data;

      localStorage.setItem('userInfo', JSON.stringify(response.data));
      return true;
    } catch (error) {
      // 防止无限递归，最多重试1次
      if (retryCount >= 1) {
        clearAuth();
        router.push('/login');
        return false;
      }

      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return fetchUserInfo(retryCount + 1);
      }
      return false;
    }
  }

  async function changePassword(oldPassword, newPassword) {
    try {
      const { changePassword: apiChangePassword } = await getAuthApi();
      await apiChangePassword({
        oldPassword,
        newPassword,
      });
      return { success: true, message: '密码修改成功' };
    } catch (error) {
      return {
        success: false,
        message: error.message || '密码修改失败',
      };
    }
  }

  function clearAuth() {
    token.value = '';
    refreshToken.value = '';
    userInfo.value = null;

    // 清除Cookie
    clearAuthCookies();
    // 清除旧版cookie名（修复前遗留的HttpOnly cookie由后端logout清除，此处清理JS可写的同名残留）
    deleteCookie('token');
    deleteCookie('refreshToken');
    // 清除localStorage中的用户信息和登录标志
    localStorage.removeItem('userInfo');
    localStorage.removeItem('loggedIn');
    // 清除API响应缓存，防止公共机器上残留前一位用户的查询数据
    clearAllCache();
  }

  async function initAuth() {
    try {
      if (token.value && !isTokenExpired(token.value)) {
        await fetchUserInfo();
      } else if (refreshToken.value && !isTokenExpired(refreshToken.value)) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          await fetchUserInfo();
        }
      } else if (localStorage.getItem('loggedIn') === 'true') {
        // JS cookie 可能因后端 HttpOnly 同名 cookie 冲突而不可读，
        // 但浏览器发送请求时会自动携带后端设置的 HttpOnly cookie，
        // 尝试通过后端认证接口恢复会话
        if (import.meta.env.DEV) {
          console.info('[Auth] JS cookie不可读，尝试通过后端HttpOnly cookie恢复认证');
        }
        try {
          const ok = await fetchUserInfo();
          if (!ok) {
            // fetchUserInfo 内部已尝试 refreshAccessToken，仍然失败
            clearAuth();
          }
        } catch {
          clearAuth();
        }
      } else if (token.value || refreshToken.value) {
        clearAuth();
      }
    } catch (error) {
      // 安全兜底：认证初始化异常时清除所有状态，确保应用能正常挂载
      clearAuth();
      if (import.meta.env.DEV) {
        console.warn('[Auth] 初始化失败，已清除认证状态:', error.message);
      }
    }
  }

  return {
    token,
    refreshToken,
    userInfo,
    isLoggedIn,
    isAdmin,
    isSuperAdmin,
    isViewer,
    mustChangePassword,
    username,
    realName,
    isTokenExpired,
    login,
    logout,
    refreshAccessToken,
    fetchUserInfo,
    changePassword,
    clearAuth,
    initAuth,
  };
});
