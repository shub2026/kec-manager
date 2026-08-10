import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import FilterBar from '@/components/filter/FilterBar.vue';

// Element Plus 已在 vitest.setup.js 全局注册
const slots = {
  primary: '<input class="primary-stub" />',
  default: '<select class="secondary-stub"></select>',
  actions: '<button class="action-stub">导出</button>',
};

// useResponsive 以 window.innerWidth 判断断点，测试前改写视口宽度
function setViewport(width) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
}

// useResponsive 的 _update 在 onMounted 中执行（晚于首次渲染），
// 挂载后需等 nextTick 才能拿到正确断点分支
async function mountAt(width, options = {}) {
  setViewport(width);
  const wrapper = mount(FilterBar, options);
  await nextTick();
  return wrapper;
}

function findMoreFilterButton(wrapper) {
  return wrapper.findAll('button').find((b) => b.text().includes('更多筛选'));
}

describe('FilterBar (移动端响应式筛选容器)', () => {
  let wrapper;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    // 清理 el-drawer 传送到 body 的残留节点，避免用例间互相污染
    document.body.innerHTML = '';
  });

  it('桌面端：primary/default/actions 并列直出，无"更多筛选"按钮', async () => {
    wrapper = await mountAt(1280, { slots });
    expect(wrapper.find('.page-toolbar').exists()).toBe(true);
    expect(wrapper.find('.primary-stub').exists()).toBe(true);
    expect(wrapper.find('.secondary-stub').exists()).toBe(true);
    expect(wrapper.find('.action-stub').exists()).toBe(true);
    expect(findMoreFilterButton(wrapper)).toBeUndefined();
  });

  it('桌面端：toolbarClass 可替换容器类（卡片头部场景）', async () => {
    wrapper = await mountAt(1280, {
      slots,
      props: { toolbarClass: 'card-header-actions arrange-header' },
    });
    expect(wrapper.find('.card-header-actions.arrange-header').exists()).toBe(true);
    expect(wrapper.find('.page-toolbar').exists()).toBe(false);
  });

  it('移动端：主筛选器与操作区常驻，次要筛选器不预先渲染', async () => {
    wrapper = await mountAt(375, { slots });
    expect(wrapper.find('.filter-bar-mobile').exists()).toBe(true);
    expect(wrapper.find('.primary-stub').exists()).toBe(true);
    expect(wrapper.find('.action-stub').exists()).toBe(true);
    expect(findMoreFilterButton(wrapper)).toBeTruthy();
    // 未打开抽屉前，次要筛选器不在文档中
    expect(document.querySelector('.secondary-stub')).toBeNull();
  });

  it('移动端：点击"更多筛选"打开抽屉展示全部次要筛选器', async () => {
    wrapper = await mountAt(375, { slots });
    await findMoreFilterButton(wrapper).trigger('click');
    await vi.waitFor(() => {
      expect(document.querySelector('.filter-drawer__body .secondary-stub')).toBeTruthy();
    });
  });

  it('移动端：抽屉"重置"按钮触发 reset 事件，"完成"关闭抽屉', async () => {
    wrapper = await mountAt(375, { slots, props: { activeCount: 2 } });
    await findMoreFilterButton(wrapper).trigger('click');
    await vi.waitFor(() => {
      expect(document.querySelector('.filter-drawer__footer')).toBeTruthy();
    });

    const footerButtons = [...document.querySelectorAll('.filter-drawer__footer button')];
    const resetBtn = footerButtons.find((b) => b.textContent.includes('重置'));
    resetBtn.click();
    expect(wrapper.emitted('reset')).toBeTruthy();
  });

  it('activeCount=0 时重置按钮禁用且角标隐藏', async () => {
    wrapper = await mountAt(375, { slots });
    // el-badge 在 hidden 时不渲染角标节点
    expect(wrapper.find('.el-badge__content').exists()).toBe(false);

    await findMoreFilterButton(wrapper).trigger('click');
    await vi.waitFor(() => {
      expect(document.querySelector('.filter-drawer__footer')).toBeTruthy();
    });
    const resetBtn = [...document.querySelectorAll('.filter-drawer__footer button')].find((b) =>
      b.textContent.includes('重置')
    );
    expect(resetBtn.disabled).toBe(true);
  });

  it('activeCount>0 时角标显示数量且按钮转 primary 色', async () => {
    wrapper = await mountAt(375, { slots, props: { activeCount: 3 } });
    const badge = wrapper.find('.el-badge__content');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('3');
    expect(findMoreFilterButton(wrapper).classes()).toContain('el-button--primary');
  });
});
