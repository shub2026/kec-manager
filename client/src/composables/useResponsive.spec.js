/**
 * useResponsive 响应式断点 composable 单元测试
 *
 * 覆盖：挂载时按窗口宽度初始化断点、resize 事件更新、共享监听器引用计数
 * 断点口径：isMobile <768、isTablet 768~991、isDesktop >=992
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { useResponsive, BREAKPOINTS } from './useResponsive';

function setWidth(px) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: px });
}

function mountHost() {
  return mount(
    defineComponent({
      setup() {
        return { ...useResponsive() };
      },
      render: () => h('div'),
    }),
    { global: { plugins: [] } }
  );
}

describe('useResponsive', () => {
  let originalWidth;

  beforeEach(() => {
    originalWidth = window.innerWidth;
  });

  afterEach(() => {
    setWidth(originalWidth);
  });

  it('窄屏（<768）判定为移动端', () => {
    setWidth(375);
    const wrapper = mountHost();
    expect(wrapper.vm.isMobile).toBe(true);
    expect(wrapper.vm.isTablet).toBe(false);
    expect(wrapper.vm.isDesktop).toBe(false);
    wrapper.unmount();
  });

  it('平板宽度（768~991）判定为 tablet', () => {
    setWidth(800);
    const wrapper = mountHost();
    expect(wrapper.vm.isMobile).toBe(false);
    expect(wrapper.vm.isTablet).toBe(true);
    expect(wrapper.vm.isDesktop).toBe(false);
    wrapper.unmount();
  });

  it('桌面宽度（>=992）判定为 desktop', () => {
    setWidth(1200);
    const wrapper = mountHost();
    expect(wrapper.vm.isMobile).toBe(false);
    expect(wrapper.vm.isTablet).toBe(false);
    expect(wrapper.vm.isDesktop).toBe(true);
    wrapper.unmount();
  });

  it('resize 事件实时更新断点（共享单例）', () => {
    setWidth(1200);
    const wrapper = mountHost();
    expect(wrapper.vm.isDesktop).toBe(true);

    setWidth(500);
    window.dispatchEvent(new window.Event('resize'));
    expect(wrapper.vm.isMobile).toBe(true);
    expect(wrapper.vm.isDesktop).toBe(false);

    wrapper.unmount();
  });

  it('多实例共享同一状态，全部卸载后监听器移除', () => {
    setWidth(1200);
    const w1 = mountHost();
    const w2 = mountHost();

    setWidth(500);
    window.dispatchEvent(new window.Event('resize'));
    // 共享 ref：两个实例同步更新
    expect(w1.vm.isMobile).toBe(true);
    expect(w2.vm.isMobile).toBe(true);

    w1.unmount(); // 仍有监听
    setWidth(1200);
    window.dispatchEvent(new window.Event('resize'));
    expect(w2.vm.isDesktop).toBe(true);

    w2.unmount(); // 监听移除：事件不再影响状态
    setWidth(375);
    window.dispatchEvent(new window.Event('resize'));
    expect(w2.vm.isDesktop).toBe(true);
  });

  it('BREAKPOINTS 常量与文档口径一致', () => {
    expect(BREAKPOINTS).toEqual({
      XS: 480,
      SM: 768,
      MD: 992,
      LG: 1200,
      XL: 1440,
      SIDEBAR_DESKTOP: 992,
    });
  });
});
