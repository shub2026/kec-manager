import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import TeacherLoadCard from '@/components/TeacherLoadCard.vue';

// 组件已在 vitest.setup.js 中全局注册 Element Plus
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
    const wrapper = mount(TeacherLoadCard, {
      props: { data: { ...baseData, assignedTeachers: 0 } },
    });
    expect(wrapper.text()).toContain('暂无排课教师');
  });

  it('渲染标题与指标行（参与教师数 / 在职数 / 人均周课时）', () => {
    const wrapper = mount(TeacherLoadCard, { props: { data: baseData } });
    expect(wrapper.text()).toContain('教师课时');
    expect(wrapper.text()).toContain('参与排课教师');
    expect(wrapper.text()).toContain('2');
    expect(wrapper.text()).toContain('76 在职');
    expect(wrapper.text()).toContain('人均周课时');
    expect(wrapper.text()).toContain('5');
  });

  it('TOP3 条形渲染姓名与课时，最多三行', () => {
    const data = {
      ...baseData,
      assignedTeachers: 4,
      top: [
        { id: 1, name: '甲', hours: 10 },
        { id: 2, name: '乙', hours: 8 },
        { id: 3, name: '丙', hours: 6 },
        { id: 4, name: '丁', hours: 4 },
      ],
    };
    const wrapper = mount(TeacherLoadCard, { props: { data } });
    const rows = wrapper.findAll('.top-row');
    // 后端只返回前 3，但组件侧也防御：超出的不渲染
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(wrapper.text()).toContain('甲');
    expect(wrapper.text()).toContain('10');
  });

  it('人员类别构成按中文标签与人数展示', () => {
    const wrapper = mount(TeacherLoadCard, { props: { data: baseData } });
    expect(wrapper.text()).toContain('专职 1 人');
    expect(wrapper.text()).toContain('外聘 1 人');
  });

  it('驼峰键归一化：fullTime/partTime 也展示中文标签', () => {
    const wrapper = mount(TeacherLoadCard, {
      props: {
        data: { ...baseData, byPersonnelType: { fullTime: 49, partTime: 14 } },
      },
    });
    expect(wrapper.text()).toContain('专职 49 人');
    expect(wrapper.text()).toContain('兼职 14 人');
    expect(wrapper.text()).not.toContain('fullTime');
  });

  it('人员类别固定顺序：专职 → 兼职 → 外聘（不随接口键序变化）', () => {
    const wrapper = mount(TeacherLoadCard, {
      props: {
        data: {
          ...baseData,
          byPersonnelType: { external: 3, full_time: 49, part_time: 14 },
        },
      },
    });
    const tags = wrapper.findAll('.load-personnel .el-tag').map((t) => t.text());
    expect(tags[0]).toContain('专职');
    expect(tags[1]).toContain('兼职');
    expect(tags[2]).toContain('外聘');
  });
});
