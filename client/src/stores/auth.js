import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import router from '@/router';
import { setCookie, getCookie, deleteCookie, clearAuthCookies } from '@/utils/cookies';
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
  const token = ref(getCookie('token') || '');
  const refreshToken = ref(getCookie('refreshToken') || '');

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
  const username = computed(() => userInfo.value?.username || '');
  const realName = computed(() => userInfo.value?.realName || '');

  async function login(username, password) {
    try {
      const { login: apiLogin } = await getAuthApi();
      const response = await apiLogin({
        username,
        password,
      });

      const { user, token: newToken, refreshToken: newRefreshToken } = response.data;

      token.value = newToken;
      refreshToken.value = newRefreshToken;
      userInfo.value = user;

      // Cookie过期时间与JWT有效期保持一致
      setCookie('token', newToken, 7); // Access Token Cookie保留7天，JWT过期由isTokenExpired检测
      setCookie('refreshToken', newRefreshToken, 7); // Refresh Token 7天，与JWT有效期一致
      // userInfo仍然存储在localStorage（非敏感数据）
      localStorage.setItem('userInfo', JSON.stringify(user));

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
          refresh_token: refreshToken.value,
        });

        const { token: newToken, refreshToken: newRefreshToken } = response.data;

        token.value = newToken;
        setCookie('token', newToken, 7);

        // 若后端返回了新的 refreshToken，同步更新，避免长期登录后 refreshToken 过期失效
        if (newRefreshToken) {
          refreshToken.value = newRefreshToken;
          setCookie('refreshToken', newRefreshToken, 7);
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
    // 清除localStorage中的用户信息
    localStorage.removeItem('userInfo');
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
