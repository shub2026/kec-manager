import { defineStore } from 'pinia';
import { ref } from 'vue';
import request from '../utils/request';

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref({});
  const semesterLabel = ref('');

  // 防重复请求：pending Promise 复用 + 5 分钟缓存有效期
  let _pendingPromise = null;
  let _lastLoadTime = 0;
  const CACHE_TTL = 5 * 60 * 1000;

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

  function _parseSemesterLabel(cs) {
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
  }

  /**
   * 加载系统设置（带防重复请求 + 5 分钟缓存）
   * @param {boolean} force - 强制跳过缓存
   */
  async function load(force = false) {
    // 缓存有效期内且非强制刷新，直接返回
    if (!force && _lastLoadTime > 0 && Date.now() - _lastLoadTime < CACHE_TTL) {
      return;
    }
    // 已有进行中的请求，复用 pending Promise
    if (_pendingPromise) {
      return _pendingPromise;
    }

    _pendingPromise = request
      .get('/settings')
      .then((res) => {
        settings.value = res.data || {};
        _lastLoadTime = Date.now();
        _parseSemesterLabel(settings.value.currentSemester);
      })
      .catch((e) => {
        if (import.meta.env.DEV) console.error('加载系统设置失败:', e);
      })
      .finally(() => {
        _pendingPromise = null;
      });

    return _pendingPromise;
  }

  /** 获取当前学期值（如 "2025-2026-2"），未加载时返回空字符串 */
  function currentSemesterValue() {
    return settings.value?.currentSemester?.value || '';
  }

  async function save(data) {
    await request.put('/settings', data);
    await load(true);
  }

  return { settings, semesterLabel, load, save, currentSemesterValue };
});
