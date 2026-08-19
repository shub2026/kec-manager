// pages/hours-statistics/hours-statistics.js
// 课时统计（用户明确新增页）：整体汇总 + 教师构成。
// 数据源与「教师课时」同为 api.getStatistics，合班已在后端去重。
const api = require('../../utils/api.js');
const { guard } = require('../../utils/auth.js');

Page({
  data: {
    summary: null,
    teacherTypeStat: { fullTime: 0, partTime: 0, external: 0, unknown: 0 },
    subjectTeacherStat: [],
    semester: '',
    loading: true,
    error: '',
  },

  onShow() {
    if (!guard()) return;
    if (!this.data.summary) this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const raw = await api.getStatistics();

      // 整体汇总仅 3 个真实字段（totalTeachers/totalWeeklyHours/totalClasses），
      // 派生「人均周课时」作为第 4 个指标，避免与「任课教师」重复。
      const s = raw.summary || {};
      const avgWeeklyHours =
        s.totalTeachers ? (s.totalWeeklyHours / s.totalTeachers).toFixed(1) : '0';

      // 教师类型构成：按 personnelType 聚合专职/兼职/外聘（数据来自后端 getStatistics 已返回的 teachers）
      const typeCount = { full_time: 0, part_time: 0, external: 0 };
      let unknownType = 0;
      (raw.teachers || []).forEach((t) => {
        const k = t.personnelType;
        if (k === 'full_time' || k === 'part_time' || k === 'external') typeCount[k] += 1;
        else unknownType += 1;
      });
      const teacherTypeStat = {
        fullTime: typeCount.full_time,
        partTime: typeCount.part_time,
        external: typeCount.external,
        unknown: unknownType,
      };

      // 各科教师构成：按任教课程名（语文/数学/...）分组，聚合专/兼/外数量 + 占比。
      // 一个教师可能任教多门课，先按课程名去重，每门课各计 1 次（跨科教师会同时出现在多科）；
      // courseList 为空则归「未分配课程」。
      const subjectMap = new Map();
      (raw.teachers || []).forEach((t) => {
        const type =
          t.personnelType === 'full_time' ? 'fullTime'
          : t.personnelType === 'part_time' ? 'partTime'
          : t.personnelType === 'external' ? 'external'
          : 'unknown';
        const names = [...new Set((t.courseList || []).map((c) => c.name).filter(Boolean))];
        if (!names.length) names.push('未分配课程');
        names.forEach((cn) => {
          if (!subjectMap.has(cn)) {
            subjectMap.set(cn, { name: cn, fullTime: 0, partTime: 0, external: 0, unknown: 0 });
          }
          subjectMap.get(cn)[type] += 1;
        });
      });
      const subjectTeacherStat = [...subjectMap.values()]
        .map((c) => {
          const total = c.fullTime + c.partTime + c.external + c.unknown;
          return Object.assign({}, c, {
            total,
            fullPct: total ? Math.round((c.fullTime / total) * 100) : 0,
            partPct: total ? Math.round((c.partTime / total) * 100) : 0,
            extPct: total ? Math.round((c.external / total) * 100) : 0,
            unkPct: total ? Math.round((c.unknown / total) * 100) : 0,
          });
        })
        .sort((a, b) => b.total - a.total);

      const app = getApp();
      this.setData({
        summary: Object.assign({}, s, { avgWeeklyHours }),
        teacherTypeStat,
        subjectTeacherStat,
        semester: (app && app.globalData.currentSemester) || '',
        loading: false,
      });
    } catch (e) {
      this.setData({ error: (e && e.message) || '加载失败', loading: false });
    }
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },
});
