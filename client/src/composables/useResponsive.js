import { ref, onMounted, onUnmounted } from 'vue';

/**
 * 响应式断点检测（共享实例，避免多组件重复监听 resize）
 *
 * 断点约定（与 global.css 五档体系一致，单一真相源）：
 * - xs  : < 480px（手机竖屏）
 * - sm  : 480 ~ 767px（手机横屏 / 小平板）
 * - md  : 768 ~ 991px（平板）
 * - lg  : 992 ~ 1199px（小桌面）
 * - xl  : 1200 ~ 1439px（桌面）
 * - xxl : >= 1440px（大桌面）
 *
 * 语义别名（向后兼容既有调用）：
 * - isMobile  : < 768px（含 xs + sm）
 * - isTablet  : 768 ~ 991px（md）
 * - isDesktop : >= 992px（lg + xl + xxl）
 *
 * @returns {{ isMobile: Ref<boolean>, isTablet: Ref<boolean>, isDesktop: Ref<boolean> }}
 */
const isMobile = ref(false);
const isTablet = ref(false);
const isDesktop = ref(true);

// 断点常量（与 global.css @media 阈值一一对应，作为项目统一真相源）
export const BREAKPOINTS = Object.freeze({
  XS: 480,
  SM: 768,
  MD: 992,
  LG: 1200,
  XL: 1440,
  // 侧边栏折叠阈值（与 Layout 抽屉/折叠切换一致）
  SIDEBAR_DESKTOP: 992,
});

let _listenerCount = 0;
function _update() {
  const w = window.innerWidth;
  isMobile.value = w < BREAKPOINTS.SM;
  isTablet.value = w >= BREAKPOINTS.SM && w < BREAKPOINTS.MD;
  isDesktop.value = w >= BREAKPOINTS.MD;
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
