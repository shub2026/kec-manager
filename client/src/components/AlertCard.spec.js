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
  underGuaranteedTeachers: [
    { id: 21, name: '陈萍', hours: 0, limit: 8 },
    { id: 22, name: '肖安琪', hours: 0, limit: 8 },
  ],
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
          underGuaranteedTeachers: [],
        },
      },
    });
    expect(wrapper.text()).toContain('暂无待办，一切正常');
    expect(wrapper.find('.alert-group').exists()).toBe(false);
  });

  it('默认全部收拢：只渲染分组标题，不渲染任何明细项', () => {
    const wrapper = mountCard();
    const titles = wrapper.findAll('.alert-group-title');
    expect(titles).toHaveLength(4);
    expect(wrapper.text()).toContain('1 门课程未排课');
    expect(wrapper.text()).toContain('437 个班级未安排');
    expect(wrapper.text()).toContain('2 位教师保障课时未达标');
    expect(wrapper.text()).toContain('1 位教师课时超限');
    expect(wrapper.find('.alert-item').exists()).toBe(false);
    titles.forEach((t) => expect(t.attributes('aria-expanded')).toBe('false'));
  });

  it('点击分组标题展开该组明细，明细项携带跳转链接；再次点击收拢', async () => {
    const wrapper = mountCard();
    const titles = wrapper.findAll('.alert-group-title');
    // 展开“未安排班级”分组
    await titles[1].trigger('click');
    expect(titles[1].attributes('aria-expanded')).toBe('true');
    const links = wrapper.findAll('.alert-item-link');
    expect(links).toHaveLength(2);
    expect(links[0].attributes('href')).toBe('/teaching/arrange');
    expect(wrapper.text()).toContain('语文');
    expect(wrapper.text()).toContain('还差 141/161 班');
    // 其他分组保持收拢
    expect(wrapper.text()).not.toContain('陈萍');
    // 再次点击收拢
    await titles[1].trigger('click');
    expect(titles[1].attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('.alert-item').exists()).toBe(false);
  });

  it('保障课时未达标分组展开后明细展示课时进度并跳转教师页', async () => {
    const wrapper = mountCard();
    await wrapper.findAll('.alert-group-title')[2].trigger('click');
    const links = wrapper.findAll('.alert-item-link');
    expect(links).toHaveLength(2);
    expect(links[0].attributes('href')).toBe('/teaching/teachers');
    expect(wrapper.text()).toContain('0/8 课时');
  });

  it('头部角标展示待办总数', () => {
    const wrapper = mountCard();
    // 1 + 437 + 2 + 1 = 441
    expect(wrapper.find('.el-tag').text()).toBe('441');
  });
});
