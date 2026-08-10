/**
 * ClassList 合班伙伴候选加载回归测试
 *
 * 覆盖修复点：
 * - 候选加载改用全量轻量接口 getClassOptions（不再用分页 getClasses 取前 100 条）
 * - 候选映射为轻量对象（id/name/collegeId/combinationId/matchedPlanId，缺省补 null）
 * - 候选缓存：第二次打开弹窗不再重复请求
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';

// ---- mock API 与依赖模块 ----
vi.mock('@/api/class', () => ({
  getClasses: vi.fn(),
  getClassOptions: vi.fn(),
  createClass: vi.fn(),
  updateClass: vi.fn(),
  deleteClass: vi.fn(),
  batchDeleteClasses: vi.fn(),
  batchUpdateClasses: vi.fn(),
}));
// store 与导出/导入 composable 不在本测试关注范围，直接 mock 隔离
vi.mock('@/stores/classData', () => ({
  useClassDataStore: () => ({
    loadBaseData: vi.fn().mockResolvedValue(undefined),
    ingestRelations: vi.fn(),
  }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    load: vi.fn().mockResolvedValue(undefined),
    currentSemesterValue: () => null,
  }),
}));
// auth store 会引入 @/router → Layout（含 svg 静态资源），测试中无需真实实现
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ role: 'admin', username: 'tester' }),
}));
vi.mock('@/composables/useExport', () => ({
  useExport: () => ({ exportData: vi.fn(), downloadTemplate: vi.fn() }),
}));
vi.mock('@/composables/useImport', () => ({
  showImportResultCard: vi.fn(),
}));

import ClassList from '@/views/class/ClassList.vue';
import { getClasses, getClassOptions } from '@/api/class';

// 子组件 stub —— 避免复杂子组件在 jsdom 中渲染干扰
const STUBS = {
  PageHeader: { template: '<div class="stub-page-header" />' },
  ClassFilterBar: {
    emits: ['add'],
    template:
      '<div class="stub-filter-bar"><button class="stub-add-btn" @click="$emit(\'add\')">新增</button></div>',
  },
  ClassTable: { template: '<div class="stub-table" />' },
  ClassFormDialog: {
    name: 'ClassFormDialog',
    props: ['classes', 'visible', 'form'],
    template: '<div class="stub-form-dialog" />',
  },
  DeleteConfirmDialog: { template: '<div class="stub-delete-dialog" />' },
  BaseConfirmBody: { template: '<div class="stub-confirm-body" />' },
  ListErrorState: { template: '<div class="stub-error" />' },
  // 图标组件在应用中全局注册，测试中用空占位避免解析告警
  Plus: { template: '<i />' },
  Loading: { template: '<i />' },
};

// 候选接口返回：故意让部分条目缺失 combinationId/matchedPlanId，验证映射补 null
const OPTIONS_ITEMS = [
  { id: 1, name: '一班', collegeId: 10, combinationId: 5, matchedPlanId: 20 },
  { id: 2, name: '二班', collegeId: 10 },
  { id: 3, name: '三班', collegeId: 11, combinationId: null, matchedPlanId: null },
];

const flushed = () => new Promise((r) => setTimeout(r, 20));

async function mountList() {
  const wrapper = mount(ClassList, { global: { stubs: STUBS } });
  await flushed();
  await nextTick();
  return wrapper;
}

async function openAddDialog(wrapper) {
  await wrapper.find('.stub-add-btn').trigger('click');
  await flushed();
  await nextTick();
}

describe('ClassList — 合班伙伴候选加载', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClasses.mockResolvedValue({ data: { items: [], total: 0 } });
    getClassOptions.mockResolvedValue({ data: { items: OPTIONS_ITEMS } });
  });

  it('打开新增弹窗后调用 getClassOptions 而非分页 getClasses', async () => {
    const wrapper = await mountList();
    // 挂载时仅列表加载调用过一次 getClasses
    expect(getClasses).toHaveBeenCalledTimes(1);
    expect(getClassOptions).not.toHaveBeenCalled();

    await openAddDialog(wrapper);

    expect(getClassOptions).toHaveBeenCalledTimes(1);
    expect(getClassOptions).toHaveBeenCalledWith();
    // 不再用分页接口拉候选
    expect(getClasses).toHaveBeenCalledTimes(1);
  });

  it('传给 ClassFormDialog 的 classes 为映射后的轻量对象（缺省补 null）', async () => {
    const wrapper = await mountList();
    await openAddDialog(wrapper);

    const dialog = wrapper.findComponent({ name: 'ClassFormDialog' });
    expect(dialog.exists()).toBe(true);
    expect(dialog.props('classes')).toEqual([
      { id: 1, name: '一班', collegeId: 10, combinationId: 5, matchedPlanId: 20 },
      { id: 2, name: '二班', collegeId: 10, combinationId: null, matchedPlanId: null },
      { id: 3, name: '三班', collegeId: 11, combinationId: null, matchedPlanId: null },
    ]);
  });

  it('候选接口异常时 classes 回退为空数组且不影响弹窗打开', async () => {
    getClassOptions.mockRejectedValueOnce(new Error('网络错误'));
    const wrapper = await mountList();
    await openAddDialog(wrapper);

    const dialog = wrapper.findComponent({ name: 'ClassFormDialog' });
    expect(dialog.props('classes')).toEqual([]);
  });

  it('第二次打开弹窗命中缓存，getClassOptions 不再被调用', async () => {
    const wrapper = await mountList();

    await openAddDialog(wrapper);
    expect(getClassOptions).toHaveBeenCalledTimes(1);

    await openAddDialog(wrapper);
    expect(getClassOptions).toHaveBeenCalledTimes(1);

    // 缓存数据仍保留
    const dialog = wrapper.findComponent({ name: 'ClassFormDialog' });
    expect(dialog.props('classes')).toHaveLength(OPTIONS_ITEMS.length);
  });
});
