import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import TeacherLoadCard from '@/components/TeacherLoadCard.vue';

// 组件已在 vitest.setup.js 中全局注册 Element Plus；router-link 需按用例注入路由（同 CourseProgressChart 先例）
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'Home', component: { template: '<div />' } },
      { path: '/teaching/teachers', name: 'Teachers', component: { template: '<div />' } },
      {
        path: '/teaching/statistics',
        name: 'TeachingStatistics',
        component: { template: '<div />' },
      },
    ],
  });
}

function mountCard(options = {}) {
  return mount(TeacherLoadCard, {
    props: { data: baseData },
    global: { plugins: [makeRouter()] },
    ...options,
  });
}

const baseData = {
  totalTeachers: 76,
  assignedTeachers: 2,
  avgHours: 5,
  top: [
    { id: 1, name: '王五', hours: 6 },
    { id: 2, name: '赵六', hours: 4 },
  ],
  byPersonnelType: { full_time: 1, external: 1 },
};

describe('TeacherLoadCard (首页教师课时卡片)', () => {
  it('无排课教师时展示空态文案', () => {
    const wrapper = mountCard({ props: { data: { ...baseData, assignedTeachers: 0 } } });
    expect(wrapper.text()).toContain('暂无排课教师');
  });

  it('渲染标题与环图下方指标（参与排课教师 / 人均周课时）', () => {
    const wrapper = mountCard();
    expect(wrapper.text()).toContain('教师情况');
    expect(wrapper.text()).toContain('参与排课教师');
    expect(wrapper.text()).toContain('76 在职');
    expect(wrapper.text()).toContain('人均周课时');
    expect(wrapper.find('.load-metrics').text()).toContain('5');
  });

  it('底部指标块整体可点击：教师指标跳转教师信息页、课时指标跳转课时统计页', () => {
    const links = mountCard().findAll('.load-metrics a.metric-link');
    expect(links).toHaveLength(2);
    expect(links[0].attributes('href')).toBe('/teaching/teachers');
    expect(links[0].text()).toContain('参与排课教师');
    expect(links[1].attributes('href')).toBe('/teaching/statistics');
    expect(links[1].text()).toContain('人均周课时');
  });

  it('环状图图例按中文标签展示人数与占比，中心展示总人数', () => {
    const wrapper = mountCard();
    // full_time 1 + external 1 → 各占 50%
    const items = wrapper.findAll('.legend-item');
    expect(items[0].find('.legend-label').text()).toBe('专职');
    expect(items[0].find('.legend-value').text()).toBe('1 人');
    expect(items[0].find('.legend-percent').text()).toBe('50%');
    expect(items[1].find('.legend-label').text()).toBe('外聘');
    expect(items[1].find('.legend-value').text()).toBe('1 人');
    expect(items[1].find('.legend-percent').text()).toBe('50%');
    expect(wrapper.find('.donut-total').text()).toBe('2');
    // 环状背景为 conic-gradient 分段渐变
    expect(wrapper.find('.donut').attributes('style')).toContain('conic-gradient');
  });

  it('驼峰键归一化：fullTime/partTime 也展示中文标签', () => {
    const wrapper = mountCard({
      props: {
        data: { ...baseData, byPersonnelType: { fullTime: 49, partTime: 14 } },
      },
    });
    const items = wrapper.findAll('.legend-item');
    expect(items[0].find('.legend-label').text()).toBe('专职');
    expect(items[0].find('.legend-value').text()).toBe('49 人');
    expect(items[0].find('.legend-percent').text()).toBe('78%');
    expect(items[1].find('.legend-label').text()).toBe('兼职');
    expect(items[1].find('.legend-value').text()).toBe('14 人');
    expect(items[1].find('.legend-percent').text()).toBe('22%');
    expect(wrapper.text()).not.toContain('fullTime');
  });

  it('人员类别固定顺序：专职 → 兼职 → 外聘（不随接口键序变化）', () => {
    const wrapper = mountCard({
      props: {
        data: {
          ...baseData,
          byPersonnelType: { external: 3, full_time: 49, part_time: 14 },
        },
      },
    });
    const items = wrapper.findAll('.legend-item').map((t) => t.text());
    expect(items[0]).toContain('专职');
    expect(items[1]).toContain('兼职');
    expect(items[2]).toContain('外聘');
  });
});
