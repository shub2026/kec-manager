/**
 * CompareTeachersDialog 教师任课对比弹窗测试
 *
 * 覆盖：
 * - open() 打开弹窗；选齐两位教师后拉取对比数据并展示双方清单与课时汇总
 * - 锁定班级勾选框禁用；未勾选时确认禁用，勾选后 emit 选中名单
 * - 对比数据加载失败展示错误提示
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { compareTeacherAssignments } from '@/api/teachingArrange';
import CompareTeachersDialog from '@/views/teaching/components/CompareTeachersDialog.vue';

vi.mock('@/api/teachingArrange', () => ({
  compareTeacherAssignments: vi.fn(),
}));

const TEACHERS = [
  { id: 1, name: '张老师' },
  { id: 2, name: '李老师' },
  { id: 3, name: '王老师' },
];

const SCOPE = { courseId: 3, semester: '2026-2027-1' };

// 张老师：3 班（含 1 锁定）/ 12 课时；李老师：1 班 / 4 课时
const COMPARE_DATA = {
  courseId: 3,
  semester: SCOPE.semester,
  teacherA: {
    id: 1,
    name: '张老师',
    personnelType: 'full_time',
    classCount: 3,
    lockedCount: 1,
    totalHours: 12,
    classes: [
      {
        assignmentId: 11,
        classId: 101,
        className: '一班',
        weeklyHours: 4,
        isLocked: true,
        isCombined: false,
        combinationNo: null,
        partnerClassNames: '',
        collegeName: '信息学院',
        majorName: '软件',
        grade: 2,
        textbookTitles: [],
      },
      {
        assignmentId: 12,
        classId: 102,
        className: '二班',
        weeklyHours: 4,
        isLocked: false,
        isCombined: true,
        combinationNo: 1,
        partnerClassNames: '三班',
        collegeName: '信息学院',
        majorName: '软件',
        grade: 2,
        textbookTitles: [],
      },
      {
        assignmentId: 13,
        classId: 103,
        className: '三班',
        weeklyHours: 4,
        isLocked: false,
        isCombined: false,
        combinationNo: null,
        partnerClassNames: '',
        collegeName: '信息学院',
        majorName: '软件',
        grade: 2,
        textbookTitles: [],
      },
    ],
  },
  teacherB: {
    id: 2,
    name: '李老师',
    personnelType: 'part_time',
    classCount: 1,
    lockedCount: 0,
    totalHours: 4,
    classes: [
      {
        assignmentId: 21,
        classId: 201,
        className: '四班',
        weeklyHours: 4,
        isLocked: false,
        isCombined: false,
        combinationNo: null,
        partnerClassNames: '',
        collegeName: '机电学院',
        majorName: '机械',
        grade: 3,
        textbookTitles: [],
      },
    ],
  },
};

const STUBS = {
  ElDialog: {
    props: ['modelValue'],
    template: '<div v-if="modelValue" class="stub-dialog"><slot /><slot name="footer" /></div>',
  },
  ElAlert: {
    props: ['title', 'type'],
    template: '<div class="stub-alert">{{ title }}</div>',
  },
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
  ElCheckboxGroup: {
    props: ['modelValue'],
    template: '<div class="stub-cbg"><slot /></div>',
  },
  ElCheckbox: {
    props: ['value', 'disabled', 'modelValue', 'indeterminate'],
    emits: ['update:modelValue'],
    template:
      '<label class="stub-cb-wrap"><input type="checkbox" class="stub-cb" :data-cid="value" :data-ind="indeterminate ? 1 : 0" :checked="!!modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" /><span><slot /></span></label>',
  },
  ElTag: { template: '<span class="stub-tag"><slot /></span>' },
  ElEmpty: {
    props: ['description'],
    template: '<div class="stub-empty">{{ description }}</div>',
  },
};

function mountDialog(props = {}) {
  return mount(CompareTeachersDialog, {
    props: { teacherList: TEACHERS, loading: false, ...props },
    global: { stubs: STUBS },
  });
}

async function selectTeacher(wrapper, selectIndex, teacherId) {
  const selects = wrapper.findAll('select');
  await selects[selectIndex].setValue(String(teacherId));
}

async function openAndLoad(wrapper) {
  wrapper.vm.open(SCOPE);
  await wrapper.vm.$nextTick();
  await selectTeacher(wrapper, 0, 1);
  await selectTeacher(wrapper, 1, 2);
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  compareTeacherAssignments.mockResolvedValue({ data: COMPARE_DATA });
});

describe('CompareTeachersDialog', () => {
  it('选齐两位教师后拉取对比数据并展示双方清单与课时汇总', async () => {
    const wrapper = mountDialog();
    expect(wrapper.find('.stub-dialog').exists()).toBe(false);

    await openAndLoad(wrapper);

    expect(compareTeacherAssignments).toHaveBeenCalledWith({
      courseId: 3,
      semester: SCOPE.semester,
      teacherIdA: 1,
      teacherIdB: 2,
    });
    const text = wrapper
      .findAll('.compare-col')
      .map((c) => c.text())
      .join(' ');
    expect(text).toContain('教师 A：张老师');
    expect(text).toContain('专职');
    expect(text).toContain('3 班 / 12 课时');
    expect(text).toContain('1 班已锁定');
    expect(text).toContain('教师 B：李老师');
    expect(text).toContain('兼职');
    expect(text).toContain('一班');
    expect(text).toContain('合班 1 组');
    expect(text).toContain('四班');
  });

  it('锁定班级勾选框禁用；勾选后确认按钮可用并 emit 选中名单', async () => {
    const wrapper = mountDialog();
    await openAndLoad(wrapper);

    const confirmBtn = () => wrapper.findAll('button').find((b) => b.text().includes('互换所选'));

    // 锁定班级（101）勾选框禁用，非锁定（102/201）可用
    const lockedCb = wrapper.find('input[data-cid="101"]');
    expect(lockedCb.attributes('disabled')).toBeDefined();
    expect(wrapper.find('input[data-cid="102"]').attributes('disabled')).toBeUndefined();

    // 未勾选时确认禁用
    expect(confirmBtn().attributes('disabled')).toBeDefined();

    // 勾选 A 侧 102 与 B 侧 201 后可确认
    wrapper.vm.selections[0] = [102];
    wrapper.vm.selections[1] = [201];
    await wrapper.vm.$nextTick();
    expect(confirmBtn().attributes('disabled')).toBeUndefined();
    await confirmBtn().trigger('click');

    expect(wrapper.emitted('confirm')).toHaveLength(1);
    expect(wrapper.emitted('confirm')[0][0]).toEqual({
      teacherIdA: 1,
      teacherIdB: 2,
      classIdsA: [102],
      classIdsB: [201],
    });
  });

  it('切换教师时清空已勾选并重新拉取；加载失败展示错误提示', async () => {
    const wrapper = mountDialog();
    await openAndLoad(wrapper);
    wrapper.vm.selections[0] = [102];

    compareTeacherAssignments.mockRejectedValueOnce({
      response: { data: { message: '教师不存在' } },
    });
    // 改选教师 B 触发重新加载
    await selectTeacher(wrapper, 1, 3);
    await flushPromises();

    expect(compareTeacherAssignments).toHaveBeenCalledTimes(2);
    expect(wrapper.vm.selections).toEqual([[], []]);
    expect(wrapper.find('.compare-error').text()).toContain('教师不存在');
  });

  it('全选只勾选未锁定班级；再点清空；部分勾选呈半选态', async () => {
    const wrapper = mountDialog();
    await openAndLoad(wrapper);

    const headerCbs = () => wrapper.findAll('.col-header input.stub-cb');
    expect(headerCbs()).toHaveLength(2);

    // A 侧全选 → 仅未锁定的 102/103（101 锁定排除）
    await headerCbs()[0].setChecked(true);
    expect(wrapper.vm.selections[0]).toEqual([102, 103]);
    expect(headerCbs()[0].attributes('data-ind')).toBe('0');

    // 勾选态再点一次 → 清空
    await headerCbs()[0].setChecked(false);
    expect(wrapper.vm.selections[0]).toEqual([]);

    // 部分勾选 → 半选态
    wrapper.vm.selections[0] = [102];
    await wrapper.vm.$nextTick();
    expect(headerCbs()[0].attributes('data-ind')).toBe('1');
  });
});
