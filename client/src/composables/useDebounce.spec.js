/**
 * useDebounceFn 防抖工具单元测试
 *
 * 覆盖：延迟内多次调用只执行一次（取最后参数）、延迟后可再次触发、cancel 取消待执行调用
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { useDebounceFn } from './useDebounce';

/** 在组件实例内创建（composable 注册了 onUnmounted 清理） */
function createDebounced(fn, delay) {
  let debounced;
  mount(
    defineComponent({
      setup() {
        debounced = useDebounceFn(fn, delay);
        return () => h('div');
      },
    }),
    { global: { plugins: [] } }
  );
  return debounced;
}

describe('useDebounceFn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('延迟内多次调用只执行一次，且使用最后一次参数', () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 100);

    debounced(1);
    debounced(2);
    debounced(3);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('执行完成后再次调用可重新触发', () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 50);

    debounced('a');
    vi.advanceTimersByTime(50);
    debounced('b');
    vi.advanceTimersByTime(50);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 'a');
    expect(fn).toHaveBeenNthCalledWith(2, 'b');
  });

  it('cancel 取消待执行调用', () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 100);

    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(200);

    expect(fn).not.toHaveBeenCalled();
  });

  it('默认延迟 200ms', () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn);

    debounced();
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
