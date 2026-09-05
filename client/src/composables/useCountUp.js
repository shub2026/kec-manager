import { ref, watch, onUnmounted } from 'vue';

/**
 * 数字从 0 跳动到目标值的动画效果
 * @param {import('vue').Ref<number>} targetRef - 目标数值 ref
 * @param {Object} options - 配置项
 * @param {number} options.duration - 动画时长（ms），默认 800
 * @param {string} options.easing - 缓动函数名，默认 'easeOutCubic'
 * @param {number} options.delay - 首次触发延迟（ms），默认 0；用于多数字瀑布式入场
 * @returns {{ displayValue: import('vue').Ref<number> }}
 */
export function useCountUp(targetRef, options = {}) {
  const { duration = 800, easing = 'easeOutCubic', delay = 0 } = options;
  const displayValue = ref(0);
  let rafId = null;
  let timeoutId = null;
  let startTime = null;
  let fromValue = 0;

  // 系统开启"减弱动态效果"时跳过动画，直接落到目标值（a11y 降级）
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const easingFns = {
    easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
    easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    linear: (t) => t,
  };

  function animate(timestamp) {
    if (!startTime) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easedProgress = easingFns[easing](progress);

    displayValue.value = Math.round(fromValue + (targetRef.value - fromValue) * easedProgress);

    if (progress < 1) {
      rafId = requestAnimationFrame(animate);
    }
  }

  function start() {
    cancel();
    fromValue = 0;
    startTime = null;
    displayValue.value = 0;
    if (targetRef.value === 0) return;
    if (prefersReducedMotion) {
      displayValue.value = targetRef.value;
      return;
    }
    if (delay > 0) {
      timeoutId = setTimeout(() => {
        rafId = requestAnimationFrame(animate);
      }, delay);
    } else {
      rafId = requestAnimationFrame(animate);
    }
  }

  function cancel() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // 监听目标值变化，当从 0 → 非0 时启动动画
  watch(
    targetRef,
    (newVal, oldVal) => {
      if (newVal !== oldVal && oldVal === 0) {
        start();
      } else if (newVal !== oldVal) {
        // 值更新时直接跳变（不做二次动画）
        displayValue.value = newVal;
      }
    },
    { immediate: true }
  );

  onUnmounted(cancel);

  return { displayValue };
}
