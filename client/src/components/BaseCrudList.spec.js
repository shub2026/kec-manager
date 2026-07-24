/**
 * 基础数据列表页共性测试：TrainingLevelList / CollegeList / MajorList
 *
 * 覆盖修复点：
 * - TDZ 错误：useCrudList() 必须在 filteredList computed 之前调用，
 *   否则 setup 中 `list` 变量在声明前被访问导致 ReferenceError
 * - load 解构：模板 @retry="load" 依赖 composable 返回的 load 函数
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';

// ---- mock API 模块 ----
vi.mock('@/api/trainingLevel', () => ({
  getTrainingLevels: vi.fn(),
  createTrainingLevel: vi.fn(),
  updateTrainingLevel: vi.fn(),
  deleteTrainingLevel: vi.fn(),
}));
vi.mock('@/api/college', () => ({
  getColleges: vi.fn(),
  createCollege: vi.fn(),
  updateCollege: vi.fn(),
  deleteCollege: vi.fn(),
}));
vi.mock('@/api/major', () => ({
  getMajors: vi.fn(),
  createMajor: vi.fn(),
  updateMajor: vi.fn(),
  deleteMajor: vi.fn(),
}));

import TrainingLevelList from '@/views/trainingLevel/TrainingLevelList.vue';
import CollegeList from '@/views/college/CollegeList.vue';
import MajorList from '@/views/major/MajorList.vue';
import { getTrainingLevels } from '@/api/trainingLevel';
import { getColleges } from '@/api/college';
import { getMajors } from '@/api/major';

// 子组件 stub —— 避免 Element Plus 复杂组件在 jsdom 中渲染干扰
const STUBS = {
  PageHeader: { template: '<div class="stub-page-header" />' },
  EmptyState: { template: '<div class="stub-empty" />' },
  DeleteConfirmDialog: { template: '<div class="stub-delete-dialog" />' },
  ListErrorState: {
    props: ['message'],
    emits: ['retry'],
    template:
      '<div class="stub-error">{{ message }}<button @click="$emit(\'retry\')">重试</button></div>',
  },
};

const CONFIGS = [
  { name: 'TrainingLevelList', component: TrainingLevelList, listApi: getTrainingLevels },
  { name: 'CollegeList', component: CollegeList, listApi: getColleges },
  { name: 'MajorList', component: MajorList, listApi: getMajors },
];

const SAMPLE_DATA = [
  { id: 1, name: '高职', code: 'GZ', description: '高等职业教育', classCount: 5 },
  { id: 2, name: '中职', code: 'ZZ', description: '中等职业教育', classCount: 3 },
  { id: 3, name: '技工', code: 'JG', description: '技工学校', classCount: 0 },
];

const onMountedFlushed = () => new Promise((r) => setTimeout(r, 50));

CONFIGS.forEach(({ name, component, listApi }) => {
  describe(`${name} — TDZ 修复与列表交互`, () => {
    beforeEach(() => {
      vi.clearAllMocks();
      listApi.mockResolvedValue({ data: [...SAMPLE_DATA] });
    });

    // ── 挂载 ──────────────────────────────
    it('组件挂载不抛 TDZ ReferenceError', () => {
      // 修复前此处在 setup 中触发 "Cannot access 'list' before initialization"
      expect(() => mount(component, { global: { stubs: STUBS } })).not.toThrow();
    });

    it('挂载后正常渲染表格行', async () => {
      const wrapper = mount(component, { global: { stubs: STUBS } });
      await onMountedFlushed();
      await nextTick();

      expect(wrapper.findComponent({ name: 'ElTable' }).exists()).toBe(true);
      expect(wrapper.findAll('tbody tr').length).toBeGreaterThanOrEqual(SAMPLE_DATA.length);
    });

    // ── 搜索过滤 ──────────────────────────
    it('按名称搜索过滤列表', async () => {
      const wrapper = mount(component, { global: { stubs: STUBS } });
      await onMountedFlushed();

      const input = wrapper.findComponent({ name: 'ElInput' });
      await input.setValue('高职');
      await nextTick();

      expect(wrapper.findAll('tbody tr').length).toBe(1);
    });

    it('按编码搜索过滤列表', async () => {
      const wrapper = mount(component, { global: { stubs: STUBS } });
      await onMountedFlushed();

      const input = wrapper.findComponent({ name: 'ElInput' });
      await input.setValue('JG');
      await nextTick();

      expect(wrapper.findAll('tbody tr').length).toBe(1);
    });

    it('搜索无匹配时显示空状态', async () => {
      const wrapper = mount(component, { global: { stubs: STUBS } });
      await onMountedFlushed();

      const input = wrapper.findComponent({ name: 'ElInput' });
      await input.setValue('不存在的关键词');
      await nextTick();

      expect(wrapper.findAll('tbody tr').length).toBe(0);
    });

    it('清空搜索后恢复全部数据', async () => {
      const wrapper = mount(component, { global: { stubs: STUBS } });
      await onMountedFlushed();

      const input = wrapper.findComponent({ name: 'ElInput' });
      await input.setValue('高职');
      await nextTick();
      expect(wrapper.findAll('tbody tr').length).toBe(1);

      await input.setValue('');
      await nextTick();
      expect(wrapper.findAll('tbody tr').length).toBe(SAMPLE_DATA.length);
    });

    // ── 错误状态 ──────────────────────────
    it('加载失败时显示 ListErrorState 而非空状态', async () => {
      listApi.mockRejectedValueOnce(
        Object.assign(new Error('boom'), {
          response: { data: { message: '服务器内部错误' } },
        })
      );
      const wrapper = mount(component, { global: { stubs: STUBS } });
      await onMountedFlushed();
      await nextTick();

      expect(wrapper.find('.stub-error').exists()).toBe(true);
      expect(wrapper.find('.stub-error').text()).toContain('服务器内部错误');
      expect(wrapper.findComponent({ name: 'ElTable' }).exists()).toBe(false);
    });

    it('点击重试按钮重新加载数据', async () => {
      listApi.mockRejectedValueOnce(new Error('网络错误'));
      const wrapper = mount(component, { global: { stubs: STUBS } });
      await onMountedFlushed();
      await nextTick();

      expect(wrapper.find('.stub-error').exists()).toBe(true);

      // 第二次调用返回成功
      listApi.mockResolvedValueOnce({ data: [...SAMPLE_DATA] });
      await wrapper.find('.stub-error button').trigger('click');
      await onMountedFlushed();
      await nextTick();

      expect(wrapper.find('.stub-error').exists()).toBe(false);
      expect(wrapper.findComponent({ name: 'ElTable' }).exists()).toBe(true);
    });

    // ── 空数据 ────────────────────────────
    it('空数据时不显示 ListErrorState', async () => {
      listApi.mockResolvedValueOnce({ data: [] });
      const wrapper = mount(component, { global: { stubs: STUBS } });
      await onMountedFlushed();
      await nextTick();

      expect(wrapper.find('.stub-error').exists()).toBe(false);
      expect(wrapper.findComponent({ name: 'ElTable' }).exists()).toBe(true);
    });
  });
});
