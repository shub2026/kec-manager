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
    const res = await request.get('/settings');
    settings.value = res.data;
    const cs = settings.value.currentSemester;
    if (cs) {
      const parts = cs.value.split('-');
      const startYear = Number(parts[0]);
      const endYear = Number(parts[1]);
      const semesterIndex = Number(parts[2]);
      semesterLabel.value = formatSemesterLabel(startYear, endYear, semesterIndex);
    }
  }

  async function save(data) {
    await request.put('/settings', data);
    await load();
  }

  return { settings, semesterLabel, load, save };
});
