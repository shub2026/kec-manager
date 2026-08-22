/**
 * CourseProgressChart 首页排课进度卡片测试
 *
 * 覆盖：
 * - 完成态（rate>=100）渲染绿色完成提示，且不可点击
 * - 未完成态常驻状态条文案（剩余门数口径 / 课时口径边界态）
 * - 管理员未完成时状态条为跳转教学安排页的链接，非管理员仅展示
 * - 无课程数据时的空态
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import CourseProgressChart from '@/components/CourseProgressChart.vue';

// 组件已在 vitest.setup.js 中全局注册 Element Plus；router-link 需按用例注入路由
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'Home', component: { template: '<div />' } },
      { path: '/teaching/arrange', name: 'TeachingArrange', component: { template: '<div />' } },
    ],
  });
}

function mountChart(props = {}) {
  return mount(CourseProgressChart, {
    props: {
      data: { totalCourses: 9, assignedCourses: 4, rate: 17 },
      totalHours: 1404,
      assignedHours: 232,
      ...props,
    },
    global: { plugins: [makeRouter()] },
  });
}

describe('CourseProgressChart (首页排课进度卡片)', () => {
  it('rate>=100 渲染绿色完成提示，且不渲染跳转链接', () => {
    const wrapper = mountChart({
      data: { totalCourses: 9, assignedCourses: 9, rate: 100 },
      assignedHours: 1404,
      isAdmin: true,
    });
    const hint = wrapper.find('.status-hint.is-done');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain('全部课程已排课完成');
    expect(wrapper.find('a.status-hint').exists()).toBe(false);
  });

  it('未完成且剩余门数>0：管理员状态条为跳转教学安排页的链接', () => {
    const wrapper = mountChart({ isAdmin: true });
    const link = wrapper.find('a.status-hint.is-pending');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('/teaching/arrange');
    expect(link.text()).toContain('剩余 5 门课程待排课');
  });

  it('未完成且非管理员：状态条常驻但不可点击', () => {
    const wrapper = mountChart({ isAdmin: false });
    const hint = wrapper.find('.status-hint.is-pending');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain('剩余 5 门课程待排课');
    expect(wrapper.find('a.status-hint').exists()).toBe(false);
  });

  it('边界态：课程均已开排但课时未满时回退为剩余课时文案', () => {
    const wrapper = mountChart({
      data: { totalCourses: 9, assignedCourses: 9, rate: 71 },
      assignedHours: 1000,
      isAdmin: true,
    });
    // remainingHours = 1404 - 1000 = 404
    expect(wrapper.find('.status-hint').text()).toContain('剩余 404 课时待安排');
  });

  it('无课程数据时渲染空态而非状态条', () => {
    const wrapper = mountChart({
      data: { totalCourses: 0, assignedCourses: 0, rate: 0 },
      totalHours: 0,
      assignedHours: 0,
    });
    expect(wrapper.text()).toContain('暂无排课数据');
    expect(wrapper.find('.status-hint').exists()).toBe(false);
  });
});
