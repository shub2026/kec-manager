// pages/hours-statistics/hours-statistics.js
// 课时统计（用户明确新增页）：整体汇总 + 学院课时分布 + 课时 Top 教师。
// 数据源与「教师课时」同为 api.getStatistics，合班已在后端去重。
const api = require('../../utils/api.js');
const { guard } = require('../../utils/auth.js');

Page({
  data: {
    summary: null,
    collegeDist: [],
    topTeachers: [],
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

      // 学院课时分布：按教师「所属学院」归集周课时（避免多学院授课重复计数）
      const byCollege = new Map();
      (raw.teachers || []).forEach((t) => {
        const name = (t.affiliatedCollege && t.affiliatedCollege.name) || '未分配';
        byCollege.set(name, (byCollege.get(name) || 0) + (t.totalWeeklyHours || 0));
      });
      const dist = [...byCollege.entries()]
        .map(([name, hours]) => ({ name, hours }))
        .sort((a, b) => b.hours - a.hours);
      const maxH = dist.reduce((m, d) => Math.max(m, d.hours), 0) || 1;
      dist.forEach((d) => {
        d._pct = Math.round((d.hours / maxH) * 100);
      });

      const top = (raw.teachers || [])
        .slice(0, 5)
        .map((t) => ({
          teacherName: t.teacherName,
          affiliatedCollege: (t.affiliatedCollege && t.affiliatedCollege.name) || '—',
          totalWeeklyHours: t.totalWeeklyHours,
          totalClassCount: t.totalClassCount,
        }));

      // 整体汇总仅 3 个真实字段（totalTeachers/totalWeeklyHours/totalClasses），
      // 派生「人均周课时」作为第 4 个指标，避免与「任课教师」重复。
      const s = raw.summary || {};
      const avgWeeklyHours =
        s.totalTeachers ? (s.totalWeeklyHours / s.totalTeachers).toFixed(1) : '0';

      const app = getApp();
      this.setData({
        summary: Object.assign({}, s, { avgWeeklyHours }),
        collegeDist: dist,
        topTeachers: top,
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
