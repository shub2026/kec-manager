const api = require('../../utils/api.js');
const { guard } = require('../../utils/auth.js');

// 课程类型元数据：与 web 端 CourseOverviewGrid 标签语义保持一致
const TYPE_META = {
  public: { label: '公共课', cls: 'blue' },
  professional: { label: '专业课', cls: 'green' },
  elective: { label: '选修课', cls: 'gray' },
};
// 分组展示顺序
const GROUP_ORDER = ['public', 'professional', 'elective'];

function buildGroups(overview) {
  const byType = {};
  for (const c of overview) {
    const type = c.courseType || 'other';
    if (!byType[type]) byType[type] = [];
    const meta = TYPE_META[type] || { label: c.courseType || '其他', cls: 'gray' };
    const total = c.totalClasses || 0;
    const assigned = c.assignedCount || 0;
    byType[type].push({
      ...c,
      typeLabel: meta.label,
      typeClass: meta.cls,
      percent: total ? Math.round((assigned / total) * 100) : 0,
      status: assigned >= total && total > 0 ? 'done' : assigned === 0 ? 'waiting' : 'partial',
      overHours: (c.remainingHours || 0) < 0,
    });
  }
  // 已知三类按 GROUP_ORDER 排前，未知类型追加其后
  const order = GROUP_ORDER.filter((t) => byType[t]);
  Object.keys(byType).forEach((t) => {
    if (!GROUP_ORDER.includes(t)) order.push(t);
  });
  return order.map((type) => ({
    type,
    label: (TYPE_META[type] || { label: type }).label,
    cards: byType[type],
  }));
}

Page({
  data: {
    groups: [],
    summary: null,
    loading: true,
    refreshing: false,
    error: '',
    semester: '',
    expandedId: null,
    currentDetail: null,
    detailLoadingId: null,
    detailError: '',
  },

  onShow() {
    if (!guard()) return;
    if (!this.data.groups.length) this.reload();
  },

  async reload(isRefresh = false) {
    this.setData(isRefresh ? { refreshing: true, error: '', detailError: '' } : { loading: true, error: '', detailError: '' });
    try {
      const overview = await api.getCourseOverview();
      const list = Array.isArray(overview) ? overview : [];
      const totalClasses = list.reduce((s, c) => s + (c.totalClasses || 0), 0);
      const assignedCount = list.reduce((s, c) => s + (c.assignedCount || 0), 0);
      const summary = {
        courses: list.length,
        totalClasses,
        assignedCount,
        rate: totalClasses ? Math.round((assignedCount / totalClasses) * 100) : 0,
      };
      const app = getApp();
      this.setData({
        groups: buildGroups(list),
        summary,
        semester: (app && app.globalData.currentSemester) || '',
        loading: false,
        refreshing: false,
        expandedId: null,
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

  // 点选课程卡片：展开 / 收起；展开时懒加载该课程逐班安排明细（同时仅展开一个）
  async toggle(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.expandedId === id) {
      this.setData({ expandedId: null, currentDetail: null });
      return;
    }
    this.setData({ expandedId: id, detailLoadingId: id, detailError: '', currentDetail: null });
    try {
      const resp = await api.getCourseArrangeDetail(id);
      // 仅当仍展开同一课程时回填，避免快速切换导致的竞态覆盖
      if (this.data.expandedId !== id) return;
      const classes = (resp.classes || []).map((cls) => ({
        classId: cls.classId,
        className: cls.className,
        isCombined: cls.isCombinedClass,
        assignment: cls.assignment
          ? {
              teacherName: cls.assignment.teacherName,
              isLocked: cls.assignment.isLocked,
              isAuto: cls.assignment.isAuto,
            }
          : null,
        weeklyHours: cls.weeklyHours,
      }));
      this.setData({ currentDetail: { classes, summary: resp.summary }, detailLoadingId: null });
    } catch (err) {
      if (this.data.expandedId === id) {
        this.setData({ detailError: (err && err.message) || '明细加载失败', detailLoadingId: null });
      }
    }
  },

  onPullDownRefresh() {
    this.reload(true).then(() => wx.stopPullDownRefresh());
  },
});
