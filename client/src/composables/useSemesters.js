import { computed } from 'vue';

export { downloadBlob } from '../utils/download';

/**
 * 学期相关逻辑的共享 composable
 * @param {object} options
 * @param {number} options.rangeBefore - 当前年份往前多少年（默认 3）
 * @param {number} options.rangeAfter - 当前年份往后多少年（默认 3）
 */
export function useSemesters(options = {}) {
  const { rangeBefore = 3, rangeAfter = 3 } = options;

  /** 可选学期列表（前后各 N 年） */
  const availableSemesters = computed(() => {
    const currentYear = new Date().getFullYear();
    const semesters = [];
    for (let y = currentYear - rangeBefore; y <= currentYear + rangeAfter; y++) {
      semesters.push(
        { value: `${y}-${y + 1}-1`, label: `${y}-${y + 1}学年 秋季(第1学期)` },
        { value: `${y}-${y + 1}-2`, label: `${y}-${y + 1}学年 春季(第2学期)` }
      );
    }
    return semesters;
  });

  /** 根据当前日期计算当前学期值 */
  function getCurrentSemester() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (month >= 8) {
      return `${year}-${year + 1}-1`;
    } else {
      return `${year - 1}-${year}-2`;
    }
  }

  return { availableSemesters, getCurrentSemester };
}
