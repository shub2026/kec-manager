/**
 * TeacherSelectDialog 选择任课教师弹窗测试
 *
 * 覆盖：
 * - 教材筛选：按教师已用教材（assignedTextbooks）过滤列表
 * - 清除教材筛选后恢复全量
 * - 重新 open() 时重置教材筛选状态
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import TeacherSelectDialog from '@/views/teaching/components/TeacherSelectDialog.vue';

const TEACHERS = [
  {
    id: 1,
    name: '张老师',
    personnelType: 'full_time',
    totalWeeklyHours: 8,
    totalClassCount: 2,
    assignedTextbooks: [
      { id: 11, title: '高等数学' },
      { id: 12, title: '线性代数' },
    ],
    courseList: [],
    collegeList: [],
    trainingLevelList: [],
  },
  {
    id: 2,
    name: '李老师',
    personnelType: 'part_time',
    totalWeeklyHours: 4,
    totalClassCount: 1,
    assignedTextbooks: [{ id: 12, title: '线性代数' }],
    courseList: [],
    collegeList: [],
    trainingLevelList: [],
  },
  {
    id: 3,
    name: '王老师',
    personnelType: 'external',
    totalWeeklyHours: 0,
    totalClassCount: 0,
    assignedTextbooks: [],
    courseList: [],
    collegeList: [],
    trainingLevelList: [],
  },
];

const STUBS = {
  ElDialog: {
    props: ['modelValue'],
    template: '<div v-if="modelValue" class="stub-dialog"><slot /><slot name="footer" /></div>',
  },
  ElInput: { props: ['modelValue', 'size'], template: '<input :value="modelValue" />' },
  ElSelect: {
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue'],
    template:
      '<select :value="modelValue" @change="$emit(\'update:modelValue\', parseValue($event.target.value))"><slot /></select>',
    methods: {
      // 教材 value 为数字 id，人员类别为字符串枚举：数字串还原为 Number，其余原样透传
      parseValue(raw) {
        if (raw === '') return '';
        const num = Number(raw);
        return Number.isNaN(num) ? raw : num;
      },
    },
  },
  ElOption: {
    props: ['label', 'value'],
    template: '<option :value="value">{{ label }}</option>',
  },
  ElTable: true,
  ElTableColumn: true,
  ElTag: true,
  ElTooltip: true,
  ElIcon: true,
  ElPagination: true,
  ElButton: true,
};

function mountDialog(props = {}) {
  return mount(TeacherSelectDialog, {
    props: { teacherList: TEACHERS, hourSettings: {}, ...props },
    global: { stubs: STUBS },
  });
}

// 打开弹窗（open 需传入班级行，仅用于填充 currentClass）
function openDialog(wrapper) {
  wrapper.vm.open({ classId: 1, weeklyHours: 2 });
}

// 筛选栏下拉顺序：第 1 个为人员类别，第 2 个为教材
async function setTextbookFilter(wrapper, value) {
  const selects = wrapper.findAll('select');
  await selects[1].setValue(String(value ?? ''));
}

describe('TeacherSelectDialog 教材筛选', () => {
  it('选择教材后仅保留已用该教材的教师', async () => {
    const wrapper = mountDialog();
    openDialog(wrapper);
    await wrapper.vm.$nextTick();

    // 初始全量
    expect(wrapper.find('.filter-count').text()).toContain('共 3 位教师');

    await setTextbookFilter(wrapper, 11);
    expect(wrapper.find('.filter-count').text()).toContain('共 1 位教师');

    await setTextbookFilter(wrapper, 12);
    expect(wrapper.find('.filter-count').text()).toContain('共 2 位教师');
  });

  it('清除教材筛选后恢复全量', async () => {
    const wrapper = mountDialog();
    openDialog(wrapper);
    await wrapper.vm.$nextTick();

    await setTextbookFilter(wrapper, 11);
    expect(wrapper.find('.filter-count').text()).toContain('共 1 位教师');

    await setTextbookFilter(wrapper, '');
    expect(wrapper.find('.filter-count').text()).toContain('共 3 位教师');
  });

  it('重新打开弹窗时重置教材筛选', async () => {
    const wrapper = mountDialog();
    openDialog(wrapper);
    await wrapper.vm.$nextTick();

    await setTextbookFilter(wrapper, 11);
    expect(wrapper.find('.filter-count').text()).toContain('共 1 位教师');

    openDialog(wrapper);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.filter-count').text()).toContain('共 3 位教师');
  });
});
