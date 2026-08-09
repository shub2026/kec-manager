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
    loading: false,
    loadingMore: false,
    finished: false,
    error: '',
    expandedId: null,
  },

  onShow() {
    if (!guard()) return;
    if (!this.data.list.length) this.reload();
  },

  async reload() {
    this.setData({ page: 1, list: [], finished: false, error: '' });
    await this.fetch(true);
  },

  async fetch(reset) {
    if (this.data.loading || this.data.loadingMore) return;
    this.setData(reset ? { loading: true } : { loadingMore: true });
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
        studentCount: c.student_count,
        planName: c.planName,
        courseCount: (c.courses || []).length,
        courses: (c.courses || []).map((co) => ({
          courseName: co.courseName,
          courseType: co.courseType,
          weeklyHours: co.weekly_hours,
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
        loadingMore: false,
      });
    } catch (e) {
      this.setData({ error: (e && e.message) || '加载失败', loading: false, loadingMore: false });
    }
  },

  onReachBottom() {
    if (this.data.finished || this.data.loading || this.data.loadingMore) return;
    this.setData({ page: this.data.page + 1 });
    this.fetch(false);
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh());
  },

  onGradeChange(e) {
    const idx = e.detail.value;
    const grade = this.data.grades[idx];
    this.setData({ grade });
    this.reload();
  },

  clearGrade() {
    this.setData({ grade: '' });
    this.reload();
  },

  toggle(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? null : id });
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/home' });
  },
});
