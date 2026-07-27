/**
 * API响应缓存工具
 * 用于减少重复请求，提升性能
 */

const MAX_CACHE_SIZE = 50; // 最大缓存条目，防止内存无限增长
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
  if (cached && now - cached.timestamp < ttl) {
    return cached.data;
  }

  // 执行API调用
  const data = await apiCall();

  // 达到上限时淘汰时间戳最旧的一条（按 timestamp 真正的 LRU）
  if (cache.size >= MAX_CACHE_SIZE) {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [k, v] of cache.entries()) {
      if (v.timestamp < oldestTime) {
        oldestTime = v.timestamp;
        oldestKey = k;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }

  // 更新缓存
  cache.set(key, {
    data,
    timestamp: now,
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
    keys: Array.from(cache.keys()),
  };
}

/**
 * 清理过期缓存
 */
export function cleanupExpired(ttl = 60000) {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp >= ttl) {
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

  // 页面卸载时清理定时器。优先使用 pagehide（覆盖 bfcache 场景，比 beforeunload 更可靠），
  // beforeunload 作为兜底（部分旧浏览器）。两者都监听以最大化兼容性。
  const _onHide = () => stopCleanupTimer();
  window.addEventListener('pagehide', _onHide);
  window.addEventListener('beforeunload', _onHide);
}
