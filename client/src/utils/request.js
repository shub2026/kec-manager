import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'
import { useAuthStore } from '@/stores/auth'

const request = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json; charset=utf-8'
  },
  // CSRF配置（如果后端支持）
  withCredentials: true
})

// 请求拦截器 - 自动携带Token和CSRF Token
request.interceptors.request.use(
  config => {
    const authStore = useAuthStore()
    if (authStore.token) {
      config.headers.Authorization = `Bearer ${authStore.token}`
    }
    // 从Cookie读取CSRF Token（如果存在）
    const csrfToken = getCookie('XSRF-TOKEN')
    if (csrfToken && ['post', 'put', 'delete'].includes(config.method?.toLowerCase())) {
      config.headers['X-CSRF-Token'] = csrfToken
    }
    return config
  },
  error => {
    return Promise.reject(error)
  }
)

// 响应拦截器 - 处理Token刷新和错误
let isRefreshing = false
let failedQueue = []

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token)
    }
  })
  failedQueue = []
}

// 添加辅助函数获取Cookie
function getCookie(name) {
  const nameEQ = name + '='
  const ca = document.cookie.split(';')
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i]
    while (c.charAt(0) === ' ') c = c.substring(1, c.length)
    if (c.indexOf(nameEQ) === 0) {
      return decodeURIComponent(c.substring(nameEQ.length, c.length))
    }
  }
  return null
}

request.interceptors.response.use(
  response => {
    const res = response.data
    if (res.success !== undefined && !res.success) {
      ElMessage.error(res.message || '请求失败')
      return Promise.reject(new Error(res.message))
    }
    return res
  },
  async error => {
    const originalRequest = error.config
    const authStore = useAuthStore()

    // 处理401未授权
    if (error.response?.status === 401 && !originalRequest._retry) {
      // 标记请求已重试，防止无限循环
      originalRequest._retry = true
      
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        })
          .then(token => {
            originalRequest.headers.Authorization = `Bearer ${token}`
            return request(originalRequest)
          })
          .catch(err => Promise.reject(err))
      }

      isRefreshing = true

      try {
        const refreshed = await authStore.refreshAccessToken()
        isRefreshing = false

        if (refreshed) {
          processQueue(null, authStore.token)
          originalRequest.headers.Authorization = `Bearer ${authStore.token}`
          return request(originalRequest)
        } else {
          processQueue(error, null)
          ElMessage.error('登录已过期，请重新登录')
          await authStore.logout()
          return Promise.reject(error)
        }
      } catch (refreshError) {
        isRefreshing = false
        processQueue(refreshError, null)
        ElMessage.error('登录已过期，请重新登录')
        await authStore.logout()
        return Promise.reject(refreshError)
      }
    }

    // 处理403权限不足
    if (error.response?.status === 403) {
      ElMessage.error('权限不足，无法执行此操作')
      return Promise.reject(error)
    }

    // 处理其他错误
    if (error.response) {
      const status = error.response.status
      const msgMap = {
        400: '请求参数错误',
        404: '请求资源不存在',
        500: '服务器内部错误',
        502: '网关错误',
        503: '服务不可用',
      }
      const msg = error.response.data?.message || msgMap[status] || `请求失败 (${status})`
      ElMessage.error(msg)
    } else if (error.code === 'ECONNABORTED') {
      ElMessage.error('请求超时，请稍后重试')
    } else if (!error.response) {
      ElMessage.error('网络连接失败，请检查网络')
    } else {
      ElMessage.error(error.message || '网络错误')
    }
    return Promise.reject(error)
  }
)

export default request
