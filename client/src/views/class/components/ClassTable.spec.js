/**
 * ClassTable 合班组号角标渲染测试
 *
 * 覆盖：
 * - 合班班级渲染组号角标（.combined-group-no），同组班级编号一致
 * - 无伙伴的合班班级仍显示组号角标，文案为"合班(无伙伴)"
 * - 非合班班级不渲染角标
 * - combinationNo 缺失（旧数据）时不渲染角标但保留合班标签
 * - 默认「只看在读」过滤下的空态文案与「查看已毕业/离校班级」出口
 */
import { describe, it, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ClassTable from './ClassTable.vue';

function mountTable(classes, extraProps = {}) {
  return mount(ClassTable, {
    props: {
      classes,
      loading: false,
      pagination: { page: 1, pageSize: 20, total: classes.length },
      ...extraProps,
    },
  });
}

describe('ClassTable — 合班组号角标', () => {
  it('合班班级渲染组号角标，同组班级编号一致', async () => {
    const wrapper = mountTable([
      {
        id: 1,
        name: 'A班',
        isCombinedClass: true,
        combinationId: 5,
        combinationNo: 3,
        partnerClassNames: 'B班',
      },
      {
        id: 2,
        name: 'B班',
        isCombinedClass: true,
        combinationId: 5,
        combinationNo: 3,
        partnerClassNames: 'A班',
      },
    ]);
    await flushPromises();

    const badges = wrapper.findAll('.combined-group-no');
    expect(badges.length).toBe(2);
    expect(badges[0].text()).toBe('3');
    expect(badges[1].text()).toBe('3');
  });

  it('无伙伴的合班班级仍显示组号角标，文案标注无伙伴', async () => {
    const wrapper = mountTable([
      {
        id: 1,
        name: 'A班',
        isCombinedClass: true,
        combinationId: 9,
        combinationNo: 7,
        partnerClassNames: '',
      },
    ]);
    await flushPromises();

    const badge = wrapper.find('.combined-group-no');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('7');
    expect(wrapper.find('.combined-tag').text()).toContain('合班(无伙伴)');
  });

  it('非合班班级不渲染合班标签与角标', async () => {
    const wrapper = mountTable([{ id: 1, name: 'A班', isCombinedClass: false }]);
    await flushPromises();

    expect(wrapper.find('.combined-tag').exists()).toBe(false);
    expect(wrapper.find('.combined-group-no').exists()).toBe(false);
  });

  it('combinationNo 缺失时保留合班标签但不渲染角标', async () => {
    const wrapper = mountTable([
      {
        id: 1,
        name: 'A班',
        isCombinedClass: true,
        combinationId: 2,
        combinationNo: null,
        partnerClassNames: 'B班',
      },
    ]);
    await flushPromises();

    expect(wrapper.find('.combined-tag').exists()).toBe(true);
    expect(wrapper.find('.combined-group-no').exists()).toBe(false);
  });
});

describe('ClassTable — 状态过滤下的空态', () => {
  it('只看在读时空态提示并给出查看全部状态入口', async () => {
    const wrapper = mountTable([], { statusFiltered: true });
    await flushPromises();

    expect(wrapper.text()).toContain('暂无在读班级数据');
    const action = wrapper.find('.empty-content .el-button');
    expect(action.exists()).toBe(true);
    expect(action.text()).toContain('查看已毕业/离校班级');

    await action.trigger('click');
    expect(wrapper.emitted('clear-status-filter')).toHaveLength(1);
  });

  it('未过滤状态时保持通用空态文案且不渲染入口', async () => {
    const wrapper = mountTable([]);
    await flushPromises();

    expect(wrapper.text()).toContain('暂无班级数据');
    expect(wrapper.text()).not.toContain('查看已毕业/离校班级');
    expect(wrapper.emitted('clear-status-filter')).toBeUndefined();
  });
});
