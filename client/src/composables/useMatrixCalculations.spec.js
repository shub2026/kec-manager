/**
 * useMatrixCalculations.spec.js 单元测试
 *
 * 重点覆盖：
 * - groups 映射字段透传：isActive（停用开关/灰底行依赖，缺字段视为启用）
 * - 公共课/专业课分组与排序
 * - totalHours 预计算与小计/总计
 */
import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useMatrixCalculations } from './useMatrixCalculations';

/** 构造一条原始课程记录（模拟 GET /plans/:id/courses 经命名转换后的字段） */
function makeCourse(overrides = {}) {
  return {
    id: 1,
    courses: { name: '语文', code: 'YW', type: 'public' },
    startSemester: 1,
    endSemester: 2,
    weeklyHours: 4,
    weeksPerSemester: 18,
    planCourseSemesters: [
      { semester: 1, weeklyHours: 4, weeksCount: 18 },
      { semester: 2, weeklyHours: 4, weeksCount: 18 },
    ],
    sortOrder: 1,
    ...overrides,
  };
}

describe('useMatrixCalculations', () => {
  describe('isActive 透传（停用/启用视觉依赖）', () => {
    it('is_active=false 应映射为 isActive=false（开关显示"禁"、行灰底）', () => {
      const rawCourses = ref([makeCourse({ isActive: false })]);
      const { groups } = useMatrixCalculations(rawCourses);
      expect(groups.value[0].courses[0].isActive).toBe(false);
    });

    it('is_active=true 应映射为 isActive=true', () => {
      const rawCourses = ref([makeCourse({ isActive: true })]);
      const { groups } = useMatrixCalculations(rawCourses);
      expect(groups.value[0].courses[0].isActive).toBe(true);
    });

    it('旧数据缺字段应视为启用（isActive=true）', () => {
      const rawCourses = ref([makeCourse()]);
      const { groups } = useMatrixCalculations(rawCourses);
      expect(groups.value[0].courses[0].isActive).toBe(true);
    });
  });

  describe('分组与排序', () => {
    it('按课程类型分为公共课/专业课两组', () => {
      const rawCourses = ref([
        makeCourse({ id: 1, sortOrder: 1 }),
        makeCourse({
          id: 2,
          sortOrder: 1,
          courses: { name: '解剖', code: 'JP', type: 'professional' },
        }),
      ]);
      const { groups } = useMatrixCalculations(rawCourses);
      expect(groups.value).toHaveLength(2);
      expect(groups.value[0].courses.map((c) => c.id)).toEqual([1]);
      expect(groups.value[1].courses.map((c) => c.id)).toEqual([2]);
    });

    it('组内按 sortOrder 升序', () => {
      const rawCourses = ref([
        makeCourse({ id: 2, sortOrder: 2 }),
        makeCourse({ id: 1, sortOrder: 1 }),
      ]);
      const { groups } = useMatrixCalculations(rawCourses);
      expect(groups.value[0].courses.map((c) => c.id)).toEqual([1, 2]);
    });
  });

  describe('课时计算', () => {
    it('totalHours 预计算 = 周课时 × 周数 × 学期数', () => {
      const rawCourses = ref([makeCourse()]); // 4 课时 × 18 周 × 2 学期
      const { groups, totalAllHours } = useMatrixCalculations(rawCourses);
      expect(groups.value[0].courses[0].totalHours).toBe(144);
      expect(totalAllHours.value).toBe(144);
    });

    it('maxSemester 至少为 8，随课程结束学期扩展', () => {
      const rawCourses = ref([makeCourse({ endSemester: 10 })]);
      const { maxSemester } = useMatrixCalculations(rawCourses);
      expect(maxSemester.value).toBe(10);
    });

    it('每学期小计与总计按学期下标聚合', () => {
      const rawCourses = ref([makeCourse()]);
      const { subtotals, grandTotals } = useMatrixCalculations(rawCourses);
      expect(subtotals.value.public[0]).toBe(4);
      expect(subtotals.value.public[1]).toBe(4);
      expect(grandTotals.value[0]).toBe(4);
      expect(grandTotals.value[2]).toBe(0);
    });
  });
});
