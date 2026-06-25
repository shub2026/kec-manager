import { computed } from 'vue';
import request from '../utils/request';

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

  /** 根据当前日期计算当前学期值（本地回退） */
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

  /** 从后端系统设置获取当前学期，失败时回退到本地日期计算 */
  async function fetchCurrentSemester() {
    try {
      const res = await request.get('/settings');
      const cs = res.data?.currentSemester;
      if (cs?.value && typeof cs.value === 'string' && /^\d{4}-\d{4}-[12]$/.test(cs.value)) {
        return cs.value;
      }
    } catch (e) {
      if (import.meta.env.DEV) console.warn('获取系统学期失败，使用本地计算:', e);
    }
    return getCurrentSemester();
  }

  return { availableSemesters, getCurrentSemester, fetchCurrentSemester };
}
