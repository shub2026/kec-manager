// pages/textbook-detail/textbook-detail.js
// 教材详情：教材信息 + 使用该教材的班级列表（展开看课程 / 是否必修 / 是否连排）。
const api = require('../../utils/api.js');
const { guard } = require('../../utils/auth.js');

Page({
  data: {
    id: '',
    textbook: null,
    classes: [],
    totalClasses: 0,
    totalStudents: 0,
    semester: '',
    loading: true,
    error: '',
    expandedId: null,
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    if (!guard()) return;
    if (!this.data.textbook) this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const raw = await api.getTextbookUsage(this.data.id);

      const classes = (raw.classes || []).map((c, i) => ({
        key: i,
        classId: c.classId,
        className: c.className,
        collegeName: c.collegeName || '—',
        majorName: c.majorName || '—',
        trainingLevelName: c.trainingLevelName || '—',
        studentCount: c.student_count || c.studentCount || 0,
        grade: c.grade || '—',
        courseName: c.courseName || '—',
        isRequired: c.is_required,
        isConsecutive: c.is_consecutive,
      }));

      const app = getApp();
      this.setData({
        textbook: raw.textbook || null,
        classes,
        totalClasses: raw.totalClasses || 0,
        totalStudents: raw.totalStudents || 0,
        semester: (app && app.globalData.currentSemester) || '',
        loading: false,
      });
    } catch (e) {
      this.setData({ error: (e && e.message) || '加载失败', loading: false });
    }
  },

  toggle(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ expandedId: this.data.expandedId === key ? null : key });
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },
});
