import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { Setting, Download, ArrowDown, ArrowUp, Check } from '@element-plus/icons-vue';
import HourSettingsCard from './HourSettingsCard.vue';

// 屏蔽课时设置接口，避免测试触发真实请求
vi.mock('@/api/teachingArrange', () => ({
  getHourSettings: vi.fn().mockResolvedValue({ data: null }),
  saveHourSettings: vi.fn().mockResolvedValue({}),
}));

// 组件已在 vitest.setup.js 中全局注册 Element Plus
describe('HourSettingsCard（导出Excel下拉按钮）', () => {
  let wrapper;

  function mountCard(props = {}) {
    // attachTo 使 el-dropdown 的菜单（teleport 到 body）可被查询
    wrapper = mount(HourSettingsCard, {
      props: {
        currentSemesterLabel: '2026-2027-1',
        allCourses: [
          { id: 1, name: '数学', code: 'A00012' },
          { id: 2, name: '英语', code: 'A00013' },
        ],
        selectedCourseId: null,
        ...props,
      },
      attachTo: document.body,
      global: {
        // 图标在应用入口全局注册，测试中需手动补齐
        components: { Setting, Download, ArrowDown, ArrowUp, Check },
      },
    });
    return wrapper;
  }

  function findMenuItems() {
    return Array.from(document.body.querySelectorAll('.el-dropdown-menu__item'));
  }

  afterEach(() => {
    wrapper?.unmount();
    document.body.replaceChildren();
  });

  it('头部渲染"导出Excel"下拉按钮', () => {
    mountCard();
    const btn = wrapper.findAll('button').find((b) => b.text().includes('导出Excel'));
    expect(btn).toBeTruthy();
  });

  it('下拉项为"导出当前科目"与"导出全部科目"', () => {
    mountCard();
    const labels = findMenuItems().map((el) => el.textContent.trim());
    expect(labels).toEqual(['导出当前科目', '导出全部科目']);
  });

  it('未选课程时"导出当前科目"置灰，"导出全部科目"可用', () => {
    mountCard({ selectedCourseId: null });
    const [current, all] = findMenuItems();
    expect(current.classList.contains('is-disabled')).toBe(true);
    expect(all.classList.contains('is-disabled')).toBe(false);
  });

  it('选中课程后"导出当前科目"不再置灰', () => {
    mountCard({ selectedCourseId: 1 });
    const [current] = findMenuItems();
    expect(current.classList.contains('is-disabled')).toBe(false);
  });

  it('下拉 command=current 时透传 export 事件', () => {
    mountCard({ selectedCourseId: 1 });
    wrapper.findComponent({ name: 'ElDropdown' }).vm.$emit('command', 'current');
    expect(wrapper.emitted('export')).toEqual([['current']]);
  });

  it('下拉 command=all 时透传 export 事件', () => {
    mountCard();
    wrapper.findComponent({ name: 'ElDropdown' }).vm.$emit('command', 'all');
    expect(wrapper.emitted('export')).toEqual([['all']]);
  });

  it('exporting=true 时按钮进入 loading 态', () => {
    mountCard({ exporting: true });
    const btn = wrapper.findAll('button').find((b) => b.text().includes('导出Excel'));
    expect(btn.classes()).toContain('is-loading');
  });
});

describe('HourSettingsCard（移动端课时要求折叠）', () => {
  let wrapper;
  const originalMatchMedia = window.matchMedia;

  function mockMatchMedia(matches) {
    window.matchMedia = vi.fn().mockReturnValue({
      matches,
      media: '',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  }

  function mountCard(props = {}) {
    wrapper = mount(HourSettingsCard, {
      props: {
        currentSemesterLabel: '2026-2027-1',
        allCourses: [{ id: 1, name: '数学', code: 'A00012' }],
        selectedCourseId: 1,
        ...props,
      },
      global: {
        components: { Setting, Download, ArrowDown, ArrowUp, Check },
      },
    });
    return wrapper;
  }

  function findToggle() {
    return wrapper.find('.hour-toggle');
  }

  afterEach(() => {
    wrapper?.unmount();
    window.matchMedia = originalMatchMedia;
  });

  it('桌面端默认展开，点击折叠头可收起/展开表单', async () => {
    mockMatchMedia(false);
    mountCard();
    expect(wrapper.find('.hour-settings-body').isVisible()).toBe(true);
    expect(wrapper.find('.hour-summary').exists()).toBe(false);

    await findToggle().trigger('click');
    expect(wrapper.find('.hour-settings-body').isVisible()).toBe(false);
    expect(wrapper.find('.hour-summary').exists()).toBe(true);

    await findToggle().trigger('click');
    // jsdom 的 getComputedStyle 存在缓存缺陷：内联 display:none 清除后计算样式不刷新，
    // 故改断言内联样式已移除 + aria-expanded 状态（真实浏览器中 v-show 会恢复显示）
    expect(wrapper.find('.hour-settings-body').attributes('style') || '').not.toContain(
      'display: none'
    );
    expect(findToggle().attributes('aria-expanded')).toBe('true');
  });

  it('移动端（matchMedia 命中）默认收起并展示配置摘要', () => {
    mockMatchMedia(true);
    mountCard();
    expect(wrapper.find('.hour-settings-body').isVisible()).toBe(false);
    // 摘要展示默认课时配置：专职 16/20
    expect(wrapper.find('.hour-summary').text()).toContain('专职 16/20');
  });

  it('未选课程时不渲染折叠头', () => {
    mockMatchMedia(true);
    mountCard({ selectedCourseId: null });
    expect(wrapper.find('.hour-toggle').exists()).toBe(false);
  });
});
