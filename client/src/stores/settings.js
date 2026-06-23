import { defineStore } from 'pinia';
import { ref } from 'vue';
import request from '../utils/request';

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref({});
  const semesterLabel = ref('');

  /**
   * 将学期格式转换为友好显示格式
   * @param {number} startYear - 学年起始年
   * @param {number} endYear - 学年结束年
   * @param {number} semesterIndex - 学期索引(1或2)
   * @returns {string} 格式化后的学期标签，如 "2026年春季(第2学期)"
   */
  function formatSemesterLabel(startYear, endYear, semesterIndex) {
    const season = semesterIndex === 1 ? '秋季' : '春季';
    const displayYear = semesterIndex === 1 ? startYear : endYear;

    return `${displayYear}年${season}(第${semesterIndex}学期)`;
  }

  async function load() {
    try {
      const res = await request.get('/settings');
      settings.value = res.data || {};
      const cs = settings.value.currentSemester;
      // M-14: 防御性正则校验学期格式，异常格式跳过解析避免 NaN 崩溃
      const SEMESTER_RE = /^(\d{4})-(\d{4})-([12])$/;
      if (cs && cs.value && typeof cs.value === 'string') {
        const match = cs.value.match(SEMESTER_RE);
        if (match) {
          const startYear = Number(match[1]);
          const endYear = Number(match[2]);
          const semesterIndex = Number(match[3]);
          if (
            Number.isFinite(startYear) &&
            Number.isFinite(endYear) &&
            (semesterIndex === 1 || semesterIndex === 2)
          ) {
            semesterLabel.value = formatSemesterLabel(startYear, endYear, semesterIndex);
          }
        }
      }
    } catch (e) {
      console.error('加载系统设置失败:', e);
    }
  }

  async function save(data) {
    await request.put('/settings', data);
    await load();
  }

  return { settings, semesterLabel, load, save };
});
