import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ListErrorState from '@/components/ListErrorState.vue';

// 组件已在 vitest.setup.js 中全局注册 Element Plus
describe('ListErrorState (P0 错误状态占位)', () => {
  it('渲染错误描述文案', () => {
    const wrapper = mount(ListErrorState, {
      props: { message: '数据加载失败，请稍后重试' },
    });
    expect(wrapper.text()).toContain('数据加载失败，请稍后重试');
  });

  it('默认文案在缺省时生效', () => {
    const wrapper = mount(ListErrorState);
    expect(wrapper.text()).toContain('数据加载失败');
  });

  it('容器带 role="alert" 以被读屏软件播报', () => {
    const wrapper = mount(ListErrorState, {
      props: { message: 'x' },
    });
    expect(wrapper.get('[role="alert"]').exists()).toBe(true);
  });

  it('点击重试按钮触发 retry 事件', async () => {
    const wrapper = mount(ListErrorState, {
      props: { message: 'x' },
    });
    const btn = wrapper.find('button');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    expect(wrapper.emitted('retry')).toBeTruthy();
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('showRetry=false 时隐藏重试按钮', () => {
    const wrapper = mount(ListErrorState, {
      props: { message: 'x', showRetry: false },
    });
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('loading=true 时重试按钮进入 loading 态', () => {
    const wrapper = mount(ListErrorState, {
      props: { message: 'x', loading: true },
    });
    // el-button 的 loading 会在内部渲染一个 spinner，按钮仍存在但被禁用
    const btn = wrapper.find('button');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes('disabled')).toBeDefined();
  });
});
