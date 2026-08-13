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
      // 展开状态下沉到 card：点击只更新本卡片，其余卡片不参与 setData diff
      expanded: false,
      detail: null,
      detailLoading: false,
      detailError: '',
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

  // 点选课程卡片：展开 / 收起，手风琴式：展开当前卡片自动收起其他已展开卡片。
  // 仅通过路径更新涉及的卡片（当前 + 其余展开卡片），未展开卡片零参与 setData diff。
  async toggle(e) {
    const id = e.currentTarget.dataset.id;
    const groups = this.data.groups;
    let gi = -1;
    let ci = -1;
    for (let i = 0; i < groups.length; i++) {
      const idx = groups[i].cards.findIndex((c) => c.courseId === id);
      if (idx >= 0) {
        gi = i;
        ci = idx;
        break;
      }
    }
    if (gi < 0) return;
    const card = groups[gi].cards[ci];

    const patch = {};
    if (card.expanded) {
      // 收起当前
      patch[`groups[${gi}].cards[${ci}].expanded`] = false;
      patch[`groups[${gi}].cards[${ci}].detail`] = null;
      patch[`groups[${gi}].cards[${ci}].detailError`] = '';
      this.setData(patch);
      return;
    }

    // 手风琴：关闭其他所有已展开卡片
    for (let i = 0; i < groups.length; i++) {
      const cards = groups[i].cards;
      for (let j = 0; j < cards.length; j++) {
        if ((i !== gi || j !== ci) && cards[j].expanded) {
          patch[`groups[${i}].cards[${j}].expanded`] = false;
          patch[`groups[${i}].cards[${j}].detail`] = null;
          patch[`groups[${i}].cards[${j}].detailError`] = '';
        }
      }
    }
    // 展开当前
    patch[`groups[${gi}].cards[${ci}].expanded`] = true;
    patch[`groups[${gi}].cards[${ci}].detailLoading`] = true;
    patch[`groups[${gi}].cards[${ci}].detail`] = null;
    patch[`groups[${gi}].cards[${ci}].detailError`] = '';
    this.setData(patch);

    try {
      const resp = await api.getCourseArrangeDetail(id);
      // 收起竞态检查：以本卡片当前 expanded 为准
      if (
        !this.data.groups[gi] ||
        !this.data.groups[gi].cards[ci] ||
        !this.data.groups[gi].cards[ci].expanded
      ) {
        return;
      }
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
      this.setData({
        [`groups[${gi}].cards[${ci}].detail`]: { classes, summary: resp.summary },
        [`groups[${gi}].cards[${ci}].detailLoading`]: false,
      });
    } catch (err) {
      if (
        this.data.groups[gi] &&
        this.data.groups[gi].cards[ci] &&
        this.data.groups[gi].cards[ci].expanded
      ) {
        this.setData({
          [`groups[${gi}].cards[${ci}].detailError`]: (err && err.message) || '明细加载失败',
          [`groups[${gi}].cards[${ci}].detailLoading`]: false,
        });
      }
    }
  },

  onPullDownRefresh() {
    this.reload(true).then(() => wx.stopPullDownRefresh());
  },
});
