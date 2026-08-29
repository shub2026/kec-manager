/**
 * useCountUp 数字跳动动画 composable 单元测试
 *
 * 覆盖：
 * - 目标值 0 → 非0 触发动画，动画结束精确到达目标值
 * - 非0 → 非0 更新直接跳变（不做二次动画）
 * - 初始目标为 0 时保持 0
 * - prefers-reduced-motion 降级直接落目标值
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick, defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { useCountUp } from './useCountUp';

/** 在组件实例内调用（依赖 watch/onUnmounted 生命周期） */
function runInComponent(targetRef, options) {
  let result;
  mount(
    defineComponent({
      setup() {
        result = useCountUp(targetRef, options);
        return () => h('div');
      },
    }),
    { global: { plugins: [] } }
  );
  return result;
}

describe('useCountUp', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始目标为 0 时显示值保持 0', () => {
    const target = ref(0);
    const { displayValue } = runInComponent(target);
    expect(displayValue.value).toBe(0);
  });

  it('0 → 非0 触发动画，结束后精确到达目标值', async () => {
    const target = ref(0);
    const { displayValue } = runInComponent(target, { duration: 300 });

    target.value = 120;
    await nextTick();

    // 动画进行中：值已开始增长
    vi.advanceTimersByTime(100);
    expect(displayValue.value).toBeGreaterThan(0);
    expect(displayValue.value).toBeLessThan(120);

    // 动画结束：精确到达目标
    vi.advanceTimersByTime(400);
    expect(displayValue.value).toBe(120);
  });

  it('非0 → 非0 变化直接跳变，不做二次动画', async () => {
    const target = ref(0);
    const { displayValue } = runInComponent(target, { duration: 300 });

    target.value = 100;
    await nextTick();
    vi.advanceTimersByTime(400); // 第一次动画完成
    expect(displayValue.value).toBe(100);

    target.value = 250;
    await nextTick(); // watch 同步跳变
    expect(displayValue.value).toBe(250);
  });

  it('prefers-reduced-motion 时跳过动画直接落目标值', async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true }));

    try {
      const target = ref(0);
      const { displayValue } = runInComponent(target, { duration: 800 });

      target.value = 99;
      await nextTick();
      // 无需推进动画帧，直接到位
      expect(displayValue.value).toBe(99);
    } finally {
      window.matchMedia = original;
    }
  });

  it('支持不同缓动函数（linear）', async () => {
    const target = ref(0);
    const { displayValue } = runInComponent(target, { duration: 100, easing: 'linear' });

    target.value = 100;
    await nextTick();
    vi.advanceTimersByTime(200);

    expect(displayValue.value).toBe(100);
  });
});
