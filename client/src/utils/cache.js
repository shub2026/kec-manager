/**
 * API响应缓存工具
 * 用于减少重复请求，提升性能
 */

const cache = new Map();

/**
 * 从缓存获取数据或执行API调用
 * @param {Function} apiCall - API调用函数
 * @param {string} key - 缓存键
 * @param {number} ttl - 缓存时间（毫秒），默认60秒
 * @returns {Promise<any>} API响应数据
 */
export async function getWithCache(apiCall, key, ttl = 60000) {
  const now = Date.now();
  const cached = cache.get(key);

  // 检查缓存是否有效
  if (cached && (now - cached.timestamp) < ttl) {
    return cached.data;
  }

  // 执行API调用
  const data = await apiCall();
  
  // 更新缓存
  cache.set(key, {
    data,
    timestamp: now
  });

  return data;
}

/**
 * 清除指定缓存
 * @param {string} key - 缓存键
 */
export function clearCache(key) {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

/**
 * 清除所有缓存
 */
export function clearAllCache() {
  cache.clear();
}

/**
 * 获取缓存统计信息
 * @returns {Object} 缓存统计信息
 */
export function getCacheStats() {
  return {
    size: cache.size,
    keys: Array.from(cache.keys())
  };
}

/**
 * 清理过期缓存
 */
export function cleanupExpired(ttl = 60000) {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if ((now - value.timestamp) >= ttl) {
      cache.delete(key);
    }
  }
}

// 定期清理过期缓存（每5分钟）
let cleanupIntervalId = null;

/**
 * 启动缓存清理定时器
 */
export function startCleanupTimer() {
  if (cleanupIntervalId) return; // 防止重复启动
  cleanupIntervalId = setInterval(() => cleanupExpired(), 5 * 60 * 1000);
}

/**
 * 停止缓存清理定时器
 */
export function stopCleanupTimer() {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

// 在浏览器环境中自动启动（仅在模块加载时执行一次）
if (typeof window !== 'undefined') {
  startCleanupTimer();
  
  // 页面卸载时清理（SPA应用中可能不会触发，但保留以防万一）
  window.addEventListener('beforeunload', () => {
    stopCleanupTimer();
  });
}
