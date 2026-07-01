import { ref, onMounted, onUnmounted } from 'vue';

/**
 * 响应式断点检测（共享实例，避免多组件重复监听 resize）
 *
 * 断点约定（与 global.css 一致）：
 * - isMobile: < 768px（手机）
 * - isTablet: 768 ~ 991px（平板）
 * - isDesktop: >= 992px（桌面）
 *
 * @returns {{ isMobile: Ref<boolean>, isTablet: Ref<boolean>, isDesktop: Ref<boolean> }}
 */
const isMobile = ref(false);
const isTablet = ref(false);
const isDesktop = ref(true);

let _listenerCount = 0;
function _update() {
  const w = window.innerWidth;
  isMobile.value = w < 768;
  isTablet.value = w >= 768 && w < 992;
  isDesktop.value = w >= 992;
}

export function useResponsive() {
  onMounted(() => {
    if (_listenerCount === 0) {
      _update();
      window.addEventListener('resize', _update);
    }
    _listenerCount += 1;
  });

  onUnmounted(() => {
    _listenerCount -= 1;
    if (_listenerCount === 0) {
      window.removeEventListener('resize', _update);
    }
  });

  return { isMobile, isTablet, isDesktop };
}
