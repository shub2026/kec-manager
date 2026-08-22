import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import AlertCard from '@/components/AlertCard.vue';

// 组件已在 vitest.setup.js 中全局注册 Element Plus；router-link 需按用例注入路由（同 TeacherLoadCard 先例）
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'Home', component: { template: '<div />' } },
      { path: '/teaching/arrange', name: 'Arrange', component: { template: '<div />' } },
      { path: '/teaching/teachers', name: 'Teachers', component: { template: '<div />' } },
    ],
  });
}

const baseData = {
  unassignedCourses: [{ id: 1, name: '大学数学' }],
  unassignedClasses: {
    count: 437,
    courses: [
      { id: 11, name: '语文', missing: 141, total: 161 },
      { id: 12, name: '英语', missing: 38, total: 55 },
    ],
  },
  overloadedTeachers: [{ id: 31, name: '高菊', hours: 18, limit: 16 }],
};

function mountCard(options = {}) {
  return mount(AlertCard, {
    props: { data: baseData },
    global: { plugins: [makeRouter()] },
    ...options,
  });
}

describe('AlertCard (首页待办提醒卡)', () => {
  it('无待办时展示绿色空态文案', () => {
    const wrapper = mountCard({
      props: {
        data: {
          unassignedCourses: [],
          overloadedTeachers: [],
          unassignedClasses: { count: 0, courses: [] },
        },
      },
    });
    expect(wrapper.text()).toContain('暂无待办，一切正常');
    expect(wrapper.find('.alert-group').exists()).toBe(false);
  });

  it('明细 ≤4 条时直接展示，无展开按钮', () => {
    const wrapper = mountCard();
    const titles = wrapper.findAll('.alert-group-title');
    expect(titles).toHaveLength(3);
    expect(wrapper.text()).toContain('1 门课程未排课');
    expect(wrapper.text()).toContain('437 个班级未安排');
    expect(wrapper.text()).toContain('1 位教师课时超限');
    // 明细项直接可见（均 ≤4 条）
    expect(wrapper.text()).toContain('大学数学');
    expect(wrapper.text()).toContain('语文');
    expect(wrapper.text()).toContain('英语');
    expect(wrapper.text()).toContain('高菊');
    // 无展开按钮
    expect(wrapper.find('.alert-toggle').exists()).toBe(false);
  });

  it('明细 ＞4 条时显示前 4 条和展开按钮，点击后显示剩余项并可收起', async () => {
    const courses = Array.from({ length: 6 }, (_, i) => ({
      id: i,
      name: `课程${i}`,
      missing: 10 - i,
      total: 20,
    }));
    const wrapper = mountCard({
      props: {
        data: {
          unassignedCourses: [],
          overloadedTeachers: [],
          unassignedClasses: { count: 100, courses },
        },
      },
    });
    // 前 4 条直接展示
    expect(wrapper.text()).toContain('课程0');
    expect(wrapper.text()).toContain('课程3');
    // 第 5、6 条不可见
    expect(wrapper.text()).not.toContain('课程4');
    expect(wrapper.text()).not.toContain('课程5');
    // 展开按钮显示并携带正确文案
    const toggle = wrapper.find('.alert-toggle');
    expect(toggle.exists()).toBe(true);
    expect(toggle.text()).toBe('展开 2 条更多');
    // 点击展开后显示全部
    await toggle.trigger('click');
    expect(wrapper.text()).toContain('课程4');
    expect(wrapper.text()).toContain('课程5');
    expect(toggle.text()).toBe('收起');
    // 再次点击收拢
    await toggle.trigger('click');
    expect(wrapper.text()).not.toContain('课程4');
    expect(toggle.text()).toBe('展开 2 条更多');
  });

  it('头部角标展示待办总数', () => {
    const wrapper = mountCard();
    // 1 + 437 + 1 = 439
    expect(wrapper.find('.el-tag').text()).toBe('439');
  });
});
