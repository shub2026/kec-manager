const api = require('../../utils/api.js');
const { guard } = require('../../utils/auth.js');

Page({
  data: {
    list: [],
    semester: '',
    page: 1,
    pageSize: 20,
    total: 0,
    grade: '',
    grades: [],
    loading: false,      // 首屏/下拉刷新的全屏 loading
    refreshing: false,   // 搜索/筛选时局部刷新，不卸载搜索框
    loadingMore: false,
    finished: false,
    error: '',
    expandedId: null,
  },

  onShow() {
    if (!guard()) return;
    if (!this.data.list.length) {
      this.reload({ showOverlay: true });
    }
  },

  // 切走 tab 时重置筛选，下次进入显示全量数据
  onHide() {
    this.setData({ grade: '', list: [], finished: false });
  },

  reload({ showOverlay = false } = {}) {
    this.setData({ page: 1, finished: false, error: '' });
    if (showOverlay) {
      // 首屏/下拉刷新：清空列表 + 全屏遮罩
      this.setData({ loading: true, list: [], total: 0 });
    } else {
      // 搜索/筛选：保留旧列表，仅顶部细条提示，避免结果区瞬时空白闪烁
      this.setData({ refreshing: true });
    }
    return this.fetch(true);
  },

  async fetch(reset) {
    if (this.data.loadingMore) return;
    if (!reset && (this.data.loading || this.data.refreshing)) return;
    if (!reset && this.data.finished) return;
    // 仅在「加载更多」时置 loadingMore；首屏/刷新由 loading/refreshing 表征，避免与下方守卫冲突
    this.setData({ loadingMore: !reset });
    try {
      const resp = await api.getSemesterClasses({
        page: this.data.page,
        pageSize: this.data.pageSize,
        grade: this.data.grade,
      });

      const classes = (resp.data || []).map((c) => ({
        classId: c.classId,
        className: c.className,
        collegeName: c.collegeName,
        majorName: c.majorName,
        grade: c.grade,
        studentCount: c.studentCount,
        planName: c.planName,
        courseCount: (c.courses || []).length,
        courses: (c.courses || []).map((co) => ({
          courseName: co.courseName,
          courseType: co.courseType,
          weeklyHours: co.weeklyHours,
          textbooks: (co.textbooks || []).map((t) => t.title).join('、') || '无',
        })),
      }));

      const merged = reset ? classes : this.data.list.concat(classes);
      const app = getApp();
      this.setData({
        list: merged,
        total: resp.total,
        semester: (app && app.globalData.currentSemester) || '',
        grades: resp.grades || [],
        // 优先以 total 判定到底；后端未返回 total 时，以「本页返回数 < pageSize」兜底
        finished:
          (typeof resp.total === 'number' && merged.length >= resp.total) ||
          classes.length < this.data.pageSize,
        loading: false,
        refreshing: false,
        loadingMore: false,
      });
    } catch (e) {
      this.setData({
        error: (e && e.message) || '加载失败',
        loading: false,
        refreshing: false,
        loadingMore: false,
      });
    }
  },

  onReachBottom() {
    if (this.data.finished || this.data.loading || this.data.refreshing || this.data.loadingMore) return;
    this.setData({ page: this.data.page + 1 });
    this.fetch(false);
  },

  onPullDownRefresh() {
    this.reload({ showOverlay: true }).then(() => wx.stopPullDownRefresh());
  },

  // ===== 年级筛选 =====
  onGradeChange(e) {
    const idx = e.detail.value;
    const grade = this.data.grades[idx];
    this.setData({ grade });
    this.reload({ showOverlay: false });
  },

  clearFilters() {
    this.setData({ grade: '' });
    this.reload({ showOverlay: false });
  },

  toggle(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? null : id });
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/home' });
  },
});
