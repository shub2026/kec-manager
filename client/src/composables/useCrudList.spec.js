import { describe, it, expect, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { useCrudList } from '@/composables/useCrudList';

// useCrudList 内部调用 onMounted，需在组件实例内执行以正确触发生命周期
function makeWrapper(api) {
  return mount(
    defineComponent({
      setup() {
        const c = useCrudList(api);
        return { c };
      },
      render: () => h('div'),
    })
  );
}

describe('useCrudList error state (P0)', () => {
  function mockApi(overrides = {}) {
    return {
      list: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      ...overrides,
    };
  }

  it('load 成功时清空 error 并写入列表数据', async () => {
    const api = mockApi({ list: vi.fn().mockResolvedValue({ data: [{ id: 1, name: 'a' }] }) });
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;

    c.error.value = '旧错误';
    await c.load();

    expect(c.error.value).toBeNull();
    expect(c.list.value).toEqual([{ id: 1, name: 'a' }]);
    expect(c.loading.value).toBe(false);
  });

  it('load 失败且有响应消息时写入该消息', async () => {
    const err = Object.assign(new Error('boom'), {
      response: { data: { message: '服务端错误：权限不足' } },
    });
    const api = mockApi({ list: vi.fn().mockRejectedValue(err) });
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;

    await c.load();

    expect(c.error.value).toBe('服务端错误：权限不足');
    expect(c.list.value).toEqual([]);
  });

  it('load 失败且无响应消息时回退默认文案', async () => {
    const api = mockApi({ list: vi.fn().mockRejectedValue(new Error('network down')) });
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;

    await c.load();

    expect(c.error.value).toContain('数据加载失败');
  });

  it('再次 load 成功会清除之前的错误状态', async () => {
    // 队列顺序需计入 onMounted 的隐式 load()：
    //   [0] mount 触发 -> 成功(空列表)
    //   [1] 显式 load #1 -> 失败，写入错误 'X'
    //   [2] 显式 load #2 -> 成功，清除错误并写入数据
    const api = mockApi({
      list: vi
        .fn()
        .mockResolvedValueOnce({ data: [] })
        .mockRejectedValueOnce(
          Object.assign(new Error('e'), { response: { data: { message: 'X' } } })
        )
        .mockResolvedValueOnce({ data: [{ id: 2 }] }),
    });
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;

    await c.load();
    expect(c.error.value).toBe('X');

    await c.load();
    expect(c.error.value).toBeNull();
    expect(c.list.value).toEqual([{ id: 2 }]);
  });
});
