/**
 * SwapTeachersDialog 交换教师班级弹窗测试
 *
 * 覆盖：
 * - open() 打开弹窗并重置选择
 * - 按班级数据聚合双方安排预览（班级数/课时/锁定班数）
 * - 确认按钮禁用逻辑（未选齐/两人相同）与 confirm 事件载荷
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import SwapTeachersDialog from '@/views/teaching/components/SwapTeachersDialog.vue';

const TEACHERS = [
  { id: 1, name: '张老师' },
  { id: 2, name: '李老师' },
  { id: 3, name: '王老师' },
];

// 张老师 2 班（含 1 锁定），李老师 1 班
const CLASSES = [
  { classId: 11, className: '一班', weeklyHours: 4, assignment: { teacherId: 1, isLocked: true } },
  { classId: 12, className: '二班', weeklyHours: 4, assignment: { teacherId: 1, isLocked: false } },
  { classId: 13, className: '三班', weeklyHours: 2, assignment: { teacherId: 2, isLocked: false } },
  { classId: 14, className: '四班', weeklyHours: 2, assignment: null },
];

const STUBS = {
  ElDialog: {
    props: ['modelValue'],
    template: '<div v-if="modelValue" class="stub-dialog"><slot /><slot name="footer" /></div>',
  },
  ElAlert: true,
  ElForm: { template: '<div><slot /></div>' },
  ElFormItem: { template: '<div><slot /></div>' },
  ElSelect: {
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue'],
    template:
      '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value ? Number($event.target.value) : null)"><slot /></select>',
  },
  ElOption: {
    props: ['label', 'value', 'disabled'],
    template: '<option :value="value" :disabled="disabled">{{ label }}</option>',
  },
  ElButton: {
    props: ['disabled', 'loading'],
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
};

function mountDialog(props = {}) {
  return mount(SwapTeachersDialog, {
    props: { teacherList: TEACHERS, classList: CLASSES, loading: false, ...props },
    global: { stubs: STUBS },
  });
}

// 选择第 selectIndex 个下拉（0=教师A，1=教师B）的指定教师
async function selectTeacher(wrapper, selectIndex, teacherId) {
  const selects = wrapper.findAll('select');
  await selects[selectIndex].setValue(String(teacherId));
}

describe('SwapTeachersDialog', () => {
  it('open() 打开弹窗，选择教师后聚合展示班级数/课时/锁定班数', async () => {
    const wrapper = mountDialog();
    expect(wrapper.find('.stub-dialog').exists()).toBe(false);

    wrapper.vm.open();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.stub-dialog').exists()).toBe(true);

    await selectTeacher(wrapper, 0, 1);
    await selectTeacher(wrapper, 1, 2);

    const text = wrapper.find('.swap-preview').text();
    expect(text).toContain('张老师');
    expect(text).toContain('已安排 2 班 / 8 课时');
    expect(text).toContain('其中 1 班已锁定');
    expect(text).toContain('李老师');
    expect(text).toContain('已安排 1 班 / 2 课时');
  });

  it('未选齐或选择相同教师时确认按钮禁用，选齐后点击 emit confirm', async () => {
    const wrapper = mountDialog();
    wrapper.vm.open();
    await wrapper.vm.$nextTick();

    const confirmBtn = () => wrapper.findAll('button').find((b) => b.text().includes('确认交换'));

    // 初始禁用
    expect(confirmBtn().attributes('disabled')).toBeDefined();

    // 只选一方仍禁用
    await selectTeacher(wrapper, 0, 1);
    expect(confirmBtn().attributes('disabled')).toBeDefined();

    // 选齐两位不同教师后可点击，载荷为双方 id
    await selectTeacher(wrapper, 1, 2);
    expect(confirmBtn().attributes('disabled')).toBeUndefined();
    await confirmBtn().trigger('click');

    expect(wrapper.emitted('confirm')).toHaveLength(1);
    expect(wrapper.emitted('confirm')[0][0]).toEqual({ teacherIdA: 1, teacherIdB: 2 });
  });

  it('已被对方选中的教师在己方下拉中禁用，防止选择相同教师', async () => {
    const wrapper = mountDialog();
    wrapper.vm.open();
    await wrapper.vm.$nextTick();

    await selectTeacher(wrapper, 1, 3);
    // 教师A 下拉中 id=3 的选项应被禁用
    const options = wrapper.findAll('select')[0].findAll('option');
    const disabledOption = options.find((o) => o.text() === '王老师');
    expect(disabledOption.attributes('disabled')).toBeDefined();
  });
});
