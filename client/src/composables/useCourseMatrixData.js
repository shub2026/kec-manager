import { ref, computed, onMounted, watch } from 'vue';
import { useMatrixCalculations } from './useMatrixCalculations';
import { getPlanCourses, getPlanSemesters } from '../api/plan';

/**
 * 课程矩阵数据加载 composable
 * 负责：数据获取、状态管理、生命周期、矩阵计算
 *
 * @param {import('vue').Ref<number> | () => number} planId - 培养方案ID（响应式）
 */
export function useCourseMatrixData(planId) {
  // ==================== 状态 ====================
  const loading = ref(false);
  const rawCourses = ref([]);
  const semesterWeeks = ref([]);
  const globalWeeks = ref(18);

  // ==================== 计算属性 ====================

  /** 最大学期数（至少8） */
  const maxSemester = computed(() => {
    if (!rawCourses.value.length) return 8;
    const max = Math.max(...rawCourses.value.map((c) => c.endSemester), 0);
    return Math.max(max, 8);
  });

  // ==================== 矩阵计算（委托给共享 composable） ====================
  const { groups, isInRange, getHours, calcTotalHours, calcGroupTotal } = useMatrixCalculations(
    rawCourses,
    semesterWeeks
  );

  /** 所有课程总课时合计 */
  const totalAllHours = computed(() => {
    return groups.value.reduce((sum, g) => sum + calcGroupTotal(g), 0);
  });

  // ==================== 数据加载 ====================

  /** 构建学期周数数组（统一值） */
  function buildSemesterWeeks(planSemesters, courses) {
    let defaultWeeks = 18;
    if (courses.length > 0 && courses[0].weeksPerSemester) {
      defaultWeeks = courses[0].weeksPerSemester;
    }
    if (planSemesters.length > 0) {
      defaultWeeks = planSemesters[0].weeksCount || defaultWeeks;
    }
    globalWeeks.value = defaultWeeks;
    return Array(maxSemester.value).fill(defaultWeeks);
  }

  /** 加载培养方案的课程和学期数据 */
  async function loadData() {
    const pid = typeof planId === 'function' ? planId() : planId.value;
    if (!pid) return;

    loading.value = true;
    try {
      const [coursesRes, semestersRes] = await Promise.all([
        getPlanCourses(pid),
        getPlanSemesters(pid),
      ]);
      rawCourses.value = coursesRes.data || [];
      semesterWeeks.value = buildSemesterWeeks(semestersRes.data || [], rawCourses.value);
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('CourseMatrix load error:', e);
      }
    } finally {
      loading.value = false;
    }
  }

  // ==================== 生命周期 ====================
  onMounted(loadData);

  // planId 变化时重新加载
  if (typeof planId === 'function') {
    watch(planId, loadData);
  } else {
    watch(() => planId.value, loadData);
  }

  return {
    // 状态
    loading,
    rawCourses,
    semesterWeeks,
    globalWeeks,
    // 计算
    maxSemester,
    groups,
    totalAllHours,
    // 计算辅助函数
    isInRange,
    getHours,
    calcTotalHours,
    calcGroupTotal,
    // 方法
    loadData,
  };
}
