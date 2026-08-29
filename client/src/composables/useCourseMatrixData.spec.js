/**
 * useCourseMatrixData 课程矩阵数据加载 composable 单元测试
 *
 * 覆盖：
 * - loadData：并行拉取课程与学期配置、状态归位、缺 planId 不请求、失败兜底
 * - buildSemesterWeeks 周数优先级：学期配置 > 课程默认 > 18
 * - planId 变化触发重载
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, h, ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

vi.mock('../api/plan', () => ({
  getPlanCourses: vi.fn(),
  getPlanSemesters: vi.fn(),
}));

import { useCourseMatrixData } from './useCourseMatrixData';
import { getPlanCourses, getPlanSemesters } from '../api/plan';

const COURSE = {
  id: 1,
  courses: { type: 'public', name: '语文', code: 'YW' },
  startSemester: 1,
  endSemester: 2,
  weeklyHours: 4,
  weeksPerSemester: 16,
  planCourseSemesters: [],
  sortOrder: 0,
  isActive: true,
};

function makeWrapper(planId) {
  return mount(
    defineComponent({
      setup() {
        const m = useCourseMatrixData(planId);
        return { m };
      },
      render: () => h('div'),
    }),
    { global: { plugins: [] } }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getPlanCourses.mockResolvedValue({ data: [] });
  getPlanSemesters.mockResolvedValue({ data: [] });
});

describe('loadData', () => {
  it('挂载时并行拉取课程与学期配置并填充状态', async () => {
    getPlanCourses.mockResolvedValue({ data: [COURSE] });
    getPlanSemesters.mockResolvedValue({ data: [] });
    const wrapper = makeWrapper(ref(7));
    const { m } = wrapper.vm;
    await nextTick();
    await m.loadData();

    expect(getPlanCourses).toHaveBeenCalledWith(7);
    expect(getPlanSemesters).toHaveBeenCalledWith(7);
    expect(m.rawCourses.value).toHaveLength(1);
    expect(m.loading.value).toBe(false);
    // maxSemester 至少 8 → 周数数组长度 8，默认取课程的 weeksPerSemester
    expect(m.semesterWeeks.value).toHaveLength(8);
    expect(m.globalWeeks.value).toBe(16);
  });

  it('planId 为空时不发起请求', async () => {
    const wrapper = makeWrapper(ref(null));
    const { m } = wrapper.vm;
    await m.loadData();

    expect(getPlanCourses).not.toHaveBeenCalled();
    expect(getPlanSemesters).not.toHaveBeenCalled();
  });

  it('支持函数式 planId', async () => {
    const wrapper = makeWrapper(() => 3);
    const { m } = wrapper.vm;
    await m.loadData();

    expect(getPlanCourses).toHaveBeenCalledWith(3);
  });

  it('接口失败时不抛出，状态归位且列表保持为空', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getPlanCourses.mockRejectedValue(new Error('down'));
    const wrapper = makeWrapper(ref(1));
    const { m } = wrapper.vm;

    await m.loadData();

    expect(m.loading.value).toBe(false);
    expect(m.rawCourses.value).toEqual([]);
    consoleSpy.mockRestore();
  });
});

describe('buildSemesterWeeks 周数优先级', () => {
  it('学期配置 weeksCount 优先', async () => {
    getPlanCourses.mockResolvedValue({ data: [COURSE] }); // weeksPerSemester=16
    getPlanSemesters.mockResolvedValue({ data: [{ semester: 1, weeksCount: 20 }] });
    const wrapper = makeWrapper(ref(1));
    const { m } = wrapper.vm;
    await m.loadData();

    expect(m.globalWeeks.value).toBe(20);
    expect(m.semesterWeeks.value.every((w) => w === 20)).toBe(true);
  });

  it('无学期配置时用课程 weeksPerSemester', async () => {
    getPlanCourses.mockResolvedValue({ data: [COURSE] });
    getPlanSemesters.mockResolvedValue({ data: [] });
    const wrapper = makeWrapper(ref(1));
    const { m } = wrapper.vm;
    await m.loadData();

    expect(m.globalWeeks.value).toBe(16);
  });

  it('两者皆无时回退 18', async () => {
    getPlanCourses.mockResolvedValue({ data: [{ ...COURSE, weeksPerSemester: null }] });
    getPlanSemesters.mockResolvedValue({ data: [{ semester: 1, weeksCount: null }] });
    const wrapper = makeWrapper(ref(1));
    const { m } = wrapper.vm;
    await m.loadData();

    expect(m.globalWeeks.value).toBe(18);
  });
});

describe('planId 变化重载', () => {
  it('ref planId 变化后重新拉取', async () => {
    const planId = ref(1);
    const wrapper = makeWrapper(planId);
    const { m } = wrapper.vm;
    await nextTick(); // 挂载自动加载完成
    await m.loadData(); // 显式加载
    expect(getPlanCourses).toHaveBeenCalledTimes(2);
    expect(getPlanCourses).toHaveBeenLastCalledWith(1);

    planId.value = 2;
    await nextTick(); // watch 触发重载，请求在回调内同步发起

    expect(getPlanCourses).toHaveBeenLastCalledWith(2);
  });
});
