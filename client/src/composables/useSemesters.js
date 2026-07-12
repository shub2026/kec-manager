import { computed } from 'vue';
import { useSettingsStore } from '../stores/settings';

export { downloadBlob } from '../utils/download';

/**
 * 审计修复：严格的学期校验，与后端 parseSemester 验证逻辑一致
 * 格式 YYYY-YYYY-N，且 end === start+1，start 在 2000-2099 范围内
 */
function isValidSemester(value) {
  const match = value.match(/^(\d{4})-(\d{4})-([12])$/);
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return end === start + 1 && start >= 2000 && start <= 2099;
}

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

  /** 根据当前日期计算当前学期值（本地回退）
   * @param {number} [semesterStartMonth=8] - 学期边界月份（秋季学期起始月），默认 8（八月）
   */
  function getCurrentSemester(semesterStartMonth = 8) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (month >= semesterStartMonth) {
      return `${year}-${year + 1}-1`;
    } else {
      return `${year - 1}-${year}-2`;
    }
  }

  /** 从后端系统设置获取当前学期，失败时回退到本地日期计算 */
  async function fetchCurrentSemester() {
    let semesterStartMonth = 8;
    try {
      const store = useSettingsStore();
      await store.load();
      const value = store.currentSemesterValue();
      // B-04: 读取可配置的学期边界月份（FR3修复：键名已改为 camelCase，与响应中间件转换后一致）
      const monthSetting = store.settings?.semesterStartMonth?.value;
      if (monthSetting) {
        const parsed = Number(monthSetting);
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 12) {
          semesterStartMonth = parsed;
        }
      }
      if (value && isValidSemester(value)) {
        return value;
      }
    } catch (e) {
      if (import.meta.env.DEV) console.warn('获取系统学期失败，使用本地计算:', e);
    }
    return getCurrentSemester(semesterStartMonth);
  }

  return { availableSemesters, getCurrentSemester, fetchCurrentSemester };
}
