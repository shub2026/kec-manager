/**
 * CourseOverviewGrid 课程安排概览卡片网格测试
 *
 * 覆盖：
 * - 卡片数量与关键字段渲染（名称/类型标签/已安排进度/统计指标）
 * - 点击卡片与键盘 Enter 触发 select-course
 * - 进度百分比计算（含 totalClasses 为 0 的兜底）
 * - loading/error/empty 三态
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { ElProgress } from 'element-plus';
import CourseOverviewGrid from '@/views/teaching/components/CourseOverviewGrid.vue';

const STUBS = {
  ListErrorState: {
    props: ['message'],
    emits: ['retry'],
    template: '<div class="stub-error" @click="$emit(\'retry\')">{{ message }}</div>',
  },
  EmptyState: { template: '<div class="stub-empty" />' },
};

const COURSES = [
  {
    courseId: 1,
    courseName: '语文',
    courseType: 'public',
    teacherCount: 28,
    totalClasses: 181,
    assignedCount: 119,
    lockedCount: 0,
    totalCourseHours: 558,
    assignedHours: 392,
    remainingHours: 166,
  },
  {
    courseId: 2,
    courseName: '数学',
    courseType: 'professional',
    teacherCount: 5,
    totalClasses: 20,
    assignedCount: 20,
    lockedCount: 3,
    totalCourseHours: 80,
    assignedHours: 80,
    remainingHours: 0,
  },
];

function mountGrid(props = {}) {
  return mount(CourseOverviewGrid, {
    props: { courses: COURSES, loading: false, error: null, ...props },
    global: { stubs: STUBS },
  });
}

describe('CourseOverviewGrid', () => {
  it('按课程渲染卡片并展示关键字段', () => {
    const wrapper = mountGrid();
    const cards = wrapper.findAll('.overview-card');
    expect(cards).toHaveLength(2);

    expect(cards[0].text()).toContain('语文');
    expect(cards[0].text()).toContain('公共课');
    expect(cards[0].text()).toContain('已安排 119/181 个班级');
    expect(cards[0].text()).toContain('28'); // 教师数
    expect(cards[0].text()).toContain('558'); // 总课时
    expect(cards[0].text()).toContain('166'); // 剩余课时

    // 全部安排完成的卡片显示成功角标
    expect(cards[1].text()).toContain('全部安排完成');
  });

  it('进度百分比计算正确，totalClasses 为 0 时兜底为 0', () => {
    const wrapper = mountGrid({
      courses: [
        { ...COURSES[0], assignedCount: 3, totalClasses: 4 },
        { ...COURSES[1], assignedCount: 0, totalClasses: 0 },
      ],
    });
    const bars = wrapper.findAllComponents(ElProgress);
    expect(bars[0].props('percentage')).toBe(75);
    expect(bars[1].props('percentage')).toBe(0);
  });

  it('点击卡片触发 select-course 并携带 courseId', async () => {
    const wrapper = mountGrid();
    await wrapper.findAll('.overview-card')[0].trigger('click');
    expect(wrapper.emitted('select-course')).toEqual([[1]]);
  });

  it('键盘 Enter 触发 select-course', async () => {
    const wrapper = mountGrid();
    await wrapper.findAll('.overview-card')[1].trigger('keydown.enter');
    expect(wrapper.emitted('select-course')).toEqual([[2]]);
  });

  it('error 状态显示错误占位并透传 retry', async () => {
    const wrapper = mountGrid({ courses: [], error: '加载课程概览失败，请稍后重试' });
    expect(wrapper.find('.stub-error').exists()).toBe(true);
    expect(wrapper.find('.overview-grid').exists()).toBe(false);
    await wrapper.find('.stub-error').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('空数据显示 EmptyState 占位', () => {
    const wrapper = mountGrid({ courses: [] });
    expect(wrapper.find('.stub-empty').exists()).toBe(true);
    expect(wrapper.find('.overview-grid').exists()).toBe(false);
  });

  it('loading 状态不渲染卡片网格数据', () => {
    const wrapper = mountGrid({ courses: [], loading: true });
    expect(wrapper.find('.overview-card').exists()).toBe(false);
    expect(wrapper.find('.stub-empty').exists()).toBe(false);
  });
});
