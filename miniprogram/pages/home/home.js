const api = require('../../utils/api.js');
const { guard, isAdmin } = require('../../utils/auth.js');

Page({
  data: {
    stats: null,
    insights: null,
    semester: '',
    orgName: '',
    loading: true,
    refreshing: false,
    error: '',
    isAdmin: false,
  },

  onShow() {
    if (!guard()) return;
    this.setData({ isAdmin: isAdmin() });
    this.loadOrgName();
    if (!this.data.stats) this.load();
  },

  // 副标题调用 WEB 端系统标识（organizationName 设置，默认「欢迎回来」）
  async loadOrgName() {
    try {
      const settings = await api.getSettings();
      const org = settings?.organizationName?.value || '欢迎回来';
      this.setData({ orgName: org });
    } catch (e) {
      // 失败保持默认「欢迎回来」
    }
  },

  async load(isRefresh = false) {
    this.setData(isRefresh ? { refreshing: true, error: '' } : { loading: true, error: '' });
    try {
      // 并行请求 stats 和 insights，任一失败时另一个仍可展示（降级处理）
      const [statsResult, insightsResult] = await Promise.allSettled([api.getStats(), api.getInsights()]);
      
      const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
      const insightsRaw = insightsResult.status === 'fulfilled' ? insightsResult.value : null;

      // 两个接口都失败时提示错误
      if (!stats && !insightsRaw) {
        const errorMsg = statsResult.status === 'rejected' 
          ? statsResult.reason?.message || '加载失败'
          : insightsResult.status === 'rejected'
          ? insightsResult.reason?.message || '加载失败'
          : '加载失败';
        if (isRefresh) {
          this.setData({ refreshing: false });
          wx.showToast({ title: errorMsg, icon: 'none' });
        } else {
          this.setData({ error: errorMsg, loading: false });
        }
        return;
      }

      // 学院课时分布
      const dist = insightsRaw ? (insightsRaw.distribution || []).slice() : [];
      const maxH = dist.reduce((m, d) => Math.max(m, d.hours), 0) || 1;
      dist.forEach((d) => {
        d._pct = Math.round((d.hours / maxH) * 100);
      });

      // 排课进度（rate 为后端课时口径：已排课时 ÷ 总课时）
      const c = insightsRaw?.completion || { rate: 0, assignedCourses: 0, totalCourses: 0 };
      const totalWeekly = c.totalHours ?? stats?.totalWeeklyHours ?? 0;
      const assignedWeekly = c.assignedHours ?? stats?.assignedWeeklyHours ?? 0;
      const progress = {
        rate: c.rate,
        assigned: c.assignedCourses,
        total: c.totalCourses,
        remaining: Math.max(0, c.totalCourses - c.assignedCourses),
        assignedHours: Math.round(assignedWeekly * 10) / 10,
        remainingHours: Math.round(Math.max(0, totalWeekly - assignedWeekly) * 10) / 10,
        complete: (c.rate || 0) >= 100,
      };

      // 教师情况（对照 web 端 TeacherLoadCard，环形图示）
      // 数据源：insights.teacherLoad.byPersonnelType（专职/兼职/外聘计数）+ 在岗/参与排课/人均周课时
      const rawTeacherLoad = insightsRaw?.teacherLoad || {
        totalTeachers: 0,
        assignedTeachers: 0,
        avgHours: 0,
        byPersonnelType: {},
      };
      const PERSONNEL_ORDER = ['fullTime', 'partTime', 'external'];
      const PERSONNEL_LABEL = { fullTime: '专职', partTime: '兼职', external: '外聘', unknown: '未分类' };
      // 教师构成：暖橘 + 湖绿 + 雾蓝灰，与品牌冷蓝 #1C82F5 形成冷暖对比，整体克制不抢眼
      const PERSONNEL_COLOR = {
        fullTime: '#10b981',  // 专职 翡翠绿（WEB --brand-success）
        partTime: '#ff6b1a',  // 兼职 活力橙（WEB --brand-warning）
        external: '#64748b',  // 外聘 中性灰（WEB --el-color-info）
        unknown:   '#c0c4cc', // 未分类（WEB fallback）
      };
      const bt = rawTeacherLoad.byPersonnelType || {};
      const tlEntries = Object.keys(bt)
        .map((k) => ({ type: k, count: bt[k] }))
        .sort((a, b) => {
          const ia = PERSONNEL_ORDER.indexOf(a.type);
          const ib = PERSONNEL_ORDER.indexOf(b.type);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
      const tlTotal = tlEntries.reduce((s, e) => s + e.count, 0);
      let acc = 0;
      const stops = tlEntries.map((e) => {
        const pct = tlTotal > 0 ? (e.count / tlTotal) * 100 : 0;
        const from = acc;
        acc += pct;
        return `${PERSONNEL_COLOR[e.type] || '#CBD5E1'} ${from.toFixed(2)}% ${acc.toFixed(2)}%`;
      });
      const teacherLoad = {
        hasData: (rawTeacherLoad.assignedTeachers || 0) > 0,
        assignedTeachers: rawTeacherLoad.assignedTeachers || 0,
        totalTeachers: rawTeacherLoad.totalTeachers || 0,
        avgHours: rawTeacherLoad.avgHours || 0,
        total: tlTotal,
        entries: tlEntries.map((e) => ({
          label: PERSONNEL_LABEL[e.type] || e.type,
          count: e.count,
          pct: tlTotal > 0 ? Math.round((e.count / tlTotal) * 100) : 0,
          color: PERSONNEL_COLOR[e.type] || '#CBD5E1',
        })),
        donut: tlTotal > 0 ? `conic-gradient(${stops.join(', ')})` : 'none',
      };

      // 课时概览
      const courseStatsRaw = insightsRaw?.courseStats || [];
      const coursePalette = ['#1c82f5', '#3d95f7', '#79b7fc', '#b5d6fc', '#64748b'];
      const courseStatsMax = courseStatsRaw.reduce((m, x) => Math.max(m, x.totalHours || 0), 0) || 1;
      // 较上学期课时差值文案：增加红 / 减少绿 / 持平与新增灰（上学期无该课程时 delta 为 null）
      const deltaText = (d) =>
        d == null ? '新增' : d > 0 ? `+${d}` : d < 0 ? `${d}` : '持平';
      const deltaClass = (d) => (d > 0 ? 'up' : d < 0 ? 'down' : 'flat');
      const courseStats = [...courseStatsRaw]
        .sort((a, b) => (b.totalHours || 0) - (a.totalHours || 0))
        .slice(0, 8)
        .map((x, i) => ({
          id: x.id,
          name: x.name,
          totalHours: Math.round((x.totalHours || 0) * 10) / 10,
          classCount: x.classCount || 0,
          teacherCount: x.teacherCount || 0,
          prevTotalHours: x.prevTotalHours ?? null,
          delta: x.delta ?? null,
          _deltaText: deltaText(x.delta ?? null),
          _deltaClass: deltaClass(x.delta ?? null),
          _pct: Math.max(4, Math.round(((x.totalHours || 0) / courseStatsMax) * 100)),
          _color: coursePalette[i % coursePalette.length],
        }));
      const courseStatsTotal = Math.round(courseStatsRaw.reduce((s, x) => s + (x.totalHours || 0), 0) * 10) / 10;

      const insights = {
        progress,
        teacherLoad,
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
  goCourseQuery() {
    wx.navigateTo({ url: '/pages/semester/semester' });
  },
  goTextbook() {
    wx.navigateTo({ url: '/pages/textbook/textbook' });
  },
  goPlanQuery() {
    wx.navigateTo({ url: '/pages/plan-query/plan-query' });
  },
  goTeacher() {
    wx.switchTab({ url: '/pages/teacher-hours/teacher-hours' });
  },
  goTeacherAdmin() {
    wx.navigateTo({ url: '/pages/teacher-admin/teacher-admin' });
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },
});
