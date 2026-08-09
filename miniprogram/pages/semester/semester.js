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
    searchName: '',
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
    this.setData({ grade: '', searchName: '', list: [], finished: false });
  },

  reload({ showOverlay = false } = {}) {
    this.setData({ page: 1, list: [], finished: false, error: '' });
    if (showOverlay) {
      this.setData({ loading: true });
    } else {
      this.setData({ refreshing: true });
    }
    return this.fetch(true);
  },

  async fetch(reset) {
    if (this.data.loadingMore) return;
    if (!reset && (this.data.loading || this.data.refreshing)) return;
    try {
      const resp = await api.getSemesterClasses({
        page: this.data.page,
        pageSize: this.data.pageSize,
        grade: this.data.grade,
        name: this.data.searchName,
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
        finished: merged.length >= (resp.total || 0),
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
    this.setData({ page: this.data.page + 1, loadingMore: true });
    this.fetch(false);
  },

  onPullDownRefresh() {
    this.reload({ showOverlay: true }).then(() => wx.stopPullDownRefresh());
  },

  // ===== 搜索 =====
  onSearchInput(e) {
    const value = e.detail.value || '';
    this.setData({ searchName: value });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.reload({ showOverlay: false });
    }, 350);
  },

  clearSearch() {
    this.setData({ searchName: '' });
    this.reload({ showOverlay: false });
  },

  // ===== 年级筛选 =====
  onGradeChange(e) {
    const idx = e.detail.value;
    const grade = this.data.grades[idx];
    this.setData({ grade });
    this.reload({ showOverlay: false });
  },

  clearFilters() {
    this.setData({ grade: '', searchName: '' });
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
