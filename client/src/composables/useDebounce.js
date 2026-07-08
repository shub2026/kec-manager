import { ref, watch, onUnmounted } from 'vue';

/**
 * 创建一个防抖 ref
 * @param {any} initialValue 初始值
 * @param {number} delay 防抖延迟（毫秒）
 * @returns {{ value: any }} 防抖后的 ref
 */
export function useDebouncedRef(initialValue, delay = 200) {
  const debounced = ref(initialValue);
  let timer = null;
  const source = ref(initialValue);
  watch(source, (val) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      debounced.value = val;
    }, delay);
  });

  // 组件卸载时自动清理定时器，防止内存泄漏
  onUnmounted(() => {
    if (timer) clearTimeout(timer);
  });

  // 返回一个可写 ref，写入防抖到 debounced
  return {
    get value() {
      return debounced.value;
    },
    set value(v) {
      source.value = v;
    },
  };
}

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
