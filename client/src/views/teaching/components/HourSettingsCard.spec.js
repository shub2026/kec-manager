import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { Setting, Download, ArrowDown, Check } from '@element-plus/icons-vue';
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
        components: { Setting, Download, ArrowDown, Check },
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
