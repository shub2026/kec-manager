const api = require('../../utils/api.js');
const { guard } = require('../../utils/auth.js');

Page({
  data: {
    stats: null,
    insights: null,
    semester: '',
    loading: true,
    error: '',
  },

  onShow() {
    if (!guard()) return;
    if (!this.data.stats) this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const [stats, insightsRaw] = await Promise.all([api.getStats(), api.getInsights()]);

      // 分布条按最大课时归一化宽度
      const dist = (insightsRaw.distribution || []).slice();
      const maxH = dist.reduce((m, d) => Math.max(m, d.hours), 0) || 1;
      dist.forEach((d) => {
        d._pct = Math.round((d.hours / maxH) * 100);
      });

      const insights = {
        completion: insightsRaw.completion || { rate: 0, assignedCourses: 0, totalCourses: 0 },
        alerts: insightsRaw.alerts || { unassignedCourses: [], overloadedTeachers: [] },
        distribution: dist,
      };

      const app = getApp();
      this.setData({
        stats,
        insights,
        semester: (app && app.globalData.currentSemester) || '',
        loading: false,
      });
    } catch (e) {
      this.setData({ error: (e && e.message) || '加载失败', loading: false });
    }
  },

  goStatistics() {
    wx.navigateTo({ url: '/pages/hours-statistics/hours-statistics' });
  },
  goSemester() {
    wx.switchTab({ url: '/pages/semester/semester' });
  },
  goTextbook() {
    wx.switchTab({ url: '/pages/textbook/textbook' });
  },
  goTeacher() {
    wx.switchTab({ url: '/pages/teacher-hours/teacher-hours' });
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },
});
