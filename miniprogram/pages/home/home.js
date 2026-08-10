const api = require('../../utils/api.js');
const { guard } = require('../../utils/auth.js');

Page({
  data: {
    stats: null,
    insights: null,
    semester: '',
    loading: true,
    refreshing: false,
    error: '',
  },

  onShow() {
    if (!guard()) return;
    if (!this.data.stats) this.load();
  },

  async load(isRefresh = false) {
    // 首屏全屏 loading；下拉刷新保留已有内容，仅用轻量提示，避免内容闪空
    this.setData(isRefresh ? { refreshing: true, error: '' } : { loading: true, error: '' });
    try {
      const [stats, insightsRaw] = await Promise.all([api.getStats(), api.getInsights()]);

      // —— 学院课时分布：按最大课时归一化宽度（复用 web 端 HoursChart 口径）——
      const dist = (insightsRaw.distribution || []).slice();
      const maxH = dist.reduce((m, d) => Math.max(m, d.hours), 0) || 1;
      dist.forEach((d) => {
        d._pct = Math.round((d.hours / maxH) * 100);
      });

      // —— 排课进度：复用 web 端 CourseProgressChart 口径（完成度 + 已排/剩余课时）——
      const c = insightsRaw.completion || { rate: 0, assignedCourses: 0, totalCourses: 0 };
      const totalWeekly = stats.totalWeeklyHours || 0;
      const assignedWeekly = stats.assignedWeeklyHours != null ? stats.assignedWeeklyHours : 0;
      const progress = {
        rate: c.rate,
        assigned: c.assignedCourses,
        total: c.totalCourses,
        remaining: Math.max(0, c.totalCourses - c.assignedCourses),
        assignedHours: Math.round(assignedWeekly * 10) / 10,
        remainingHours: Math.round(Math.max(0, totalWeekly - assignedWeekly) * 10) / 10,
        complete: c.totalCourses > 0 && c.assignedCourses >= c.totalCourses,
      };

      // —— 异常提醒：复用 web 端 AlertCard 口径（每项最多 3 条 + 溢出提示）——
      const rawAlerts = insightsRaw.alerts || { unassignedCourses: [], overloadedTeachers: [] };
      const unassigned = rawAlerts.unassignedCourses || [];
      const overloaded = rawAlerts.overloadedTeachers || [];
      const alerts = {
        unassigned: unassigned.slice(0, 3),
        overloaded: overloaded.slice(0, 3),
        unassignedMore: Math.max(0, unassigned.length - 3),
        overloadedMore: Math.max(0, overloaded.length - 3),
        hasAlert: unassigned.length > 0 || overloaded.length > 0,
      };

      // —— 课时概览：复用 web 端 CourseStatsCard 口径（按 totalHours 降序取前 8）——
      const courseStatsRaw = insightsRaw.courseStats || [];
      const coursePalette = ['#1C82F5', '#4BA3F5', '#7BC0F7', '#A9D8FA', '#5B8DEF'];
      const courseStatsMax = courseStatsRaw.reduce((m, x) => Math.max(m, x.totalHours || 0), 0) || 1;
      const courseStats = [...courseStatsRaw]
        .sort((a, b) => (b.totalHours || 0) - (a.totalHours || 0))
        .slice(0, 8)
        .map((x, i) => ({
          id: x.id,
          name: x.name,
          totalHours: Math.round((x.totalHours || 0) * 10) / 10,
          classCount: x.classCount || 0,
          teacherCount: x.teacherCount || 0,
          _pct: Math.max(4, Math.round(((x.totalHours || 0) / courseStatsMax) * 100)),
          _color: coursePalette[i % coursePalette.length],
        }));
      const courseStatsTotal = Math.round(courseStatsRaw.reduce((s, x) => s + (x.totalHours || 0), 0) * 10) / 10;

      const insights = {
        progress,
        alerts,
        distribution: dist,
        courseStats,
        courseStatsTotal,
        courseStatsCount: courseStatsRaw.length,
      };

      const app = getApp();
      this.setData({
        stats,
        insights,
        semester: (app && app.globalData.currentSemester) || '',
        loading: false,
        refreshing: false,
      });
    } catch (e) {
      if (isRefresh) {
        this.setData({ refreshing: false });
        wx.showToast({ title: (e && e.message) || '刷新失败', icon: 'none' });
      } else {
        this.setData({ error: (e && e.message) || '加载失败', loading: false });
      }
    }
  },

  goStatistics() {
    wx.navigateTo({ url: '/pages/hours-statistics/hours-statistics' });
  },
  goTextbook() {
    wx.switchTab({ url: '/pages/textbook/textbook' });
  },
  goTeacher() {
    wx.switchTab({ url: '/pages/teacher-hours/teacher-hours' });
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },
});
