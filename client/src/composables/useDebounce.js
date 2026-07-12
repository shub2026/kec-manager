import { onUnmounted } from 'vue';

/**
 * 创建防抖函数
 * @param {Function} fn 要防抖的函数
 * @param {number} delay 延迟毫秒
 * @returns {Function} 防抖后的函数（带 .cancel 方法，组件卸载时自动清理）
 */
export function useDebounceFn(fn, delay = 200) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
  };

  // 组件卸载时自动清理定时器
  onUnmounted(() => {
    if (timer) clearTimeout(timer);
  });

  return debounced;
}
