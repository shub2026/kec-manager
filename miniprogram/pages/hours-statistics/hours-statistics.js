// pages/hours-statistics/hours-statistics.js
// 教师情况（用户明确新增页）：整体汇总 + 各科分布。
// 数据源与「教师课时」同为 api.getStatistics，合班已在后端去重。
const api = require('../../utils/api.js');
const { guard } = require('../../utils/auth.js');

Page({
  data: {
    summary: null,
    teacherLoadCard: null,
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
      // 并行请求：getStatistics（整体汇总/各科分布主体）+ getInsights（顶部环形图示 teacherLoad）
      // 任一失败另一仍可展示（降级处理）
      const [statsResult, insightsResult] = await Promise.allSettled([
        api.getStatistics(),
        api.getInsights(),
      ]);
      const raw = statsResult.status === 'fulfilled' ? statsResult.value : null;
      const insightsRaw = insightsResult.status === 'fulfilled' ? insightsResult.value : null;
      if (!raw) {
        this.setData({
          error: (statsResult.reason && statsResult.reason.message) || '加载失败',
          loading: false,
        });
        return;
      }

      // 整体汇总仅 3 个真实字段（totalTeachers/totalWeeklyHours/totalClasses），
      // 派生「人均周课时」作为第 4 个指标，避免与「任课教师」重复。
      const s = raw.summary || {};
      const avgWeeklyHours =
        s.totalTeachers ? (s.totalWeeklyHours / s.totalTeachers).toFixed(1) : '0';

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

      // 顶部环形图示（与首页教师情况卡片同款，数据源 insights.teacherLoad）
      const rawTeacherLoad =
        (insightsRaw && insightsRaw.teacherLoad) ||
        { totalTeachers: 0, assignedTeachers: 0, avgHours: 0, byPersonnelType: {} };
      const PERSONNEL_ORDER = ['fullTime', 'partTime', 'external'];
      const PERSONNEL_LABEL = { fullTime: '专职', partTime: '兼职', external: '外聘', unknown: '未分类' };
      const PERSONNEL_COLOR = {
        fullTime: '#10b981',  // 专职 翡翠绿（WEB --brand-success）
        partTime: '#ff6b1a',  // 兼职 活力橙（WEB --brand-warning）
        external: '#64748b',  // 外聘 中性灰（WEB --el-color-info）
        unknown: '#c0c4cc',   // 未分类（WEB fallback）
      };
      const bt = rawTeacherLoad.byPersonnelType || {};
      const tlEntries = Object.keys(bt)
        .map((k) => ({ type: k, count: bt[k] }))
        .sort((a, b) => {
          const ia = PERSONNEL_ORDER.indexOf(a.type);
          const ib = PERSONNEL_ORDER.indexOf(b.type);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
      const tlTotal = tlEntries.reduce((sum, e) => sum + e.count, 0);
      let acc = 0;
      const stops = tlEntries.map((e) => {
        const pct = tlTotal > 0 ? (e.count / tlTotal) * 100 : 0;
        const from = acc;
        acc += pct;
        const color = PERSONNEL_COLOR[e.type] || '#CBD5E1';
        return `${color} ${from.toFixed(2)}% ${acc.toFixed(2)}%`;
      });
      const teacherLoadCard = {
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

      const app = getApp();
      this.setData({
        summary: Object.assign({}, s, { avgWeeklyHours }),
        teacherLoadCard,
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
