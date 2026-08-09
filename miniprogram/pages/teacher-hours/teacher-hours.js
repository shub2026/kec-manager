// pages/teacher-hours/teacher-hours.js
// 教师课时：按教师汇总周课时，点击展开课程与班级明细。调用 api.getStatistics。
// 后端已对「合班」做去重（合班=1 个逻辑教学班，课时仅计 1 次），口径与 Web 端一致。
const api = require('../../utils/api.js');
const { guard } = require('../../utils/auth.js');

Page({
  data: {
    teachers: [],
    semester: '',
    loading: true,
    error: '',
    expandedId: null,
  },

  onShow() {
    if (!guard()) return;
    if (!this.data.teachers.length) this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const raw = await api.getStatistics();

      const teachers = (raw.teachers || []).map((t) => {
        const collegeNames = (t.collegeList || []).map((c) => c.name).join('、') || '—';
        const levelNames = (t.trainingLevelList || []).map((l) => l.name).join('、') || '—';
        return {
          teacherId: t.teacherId,
          teacherName: t.teacherName,
          personnelType: t.personnelType || '',
          affiliatedCollege: (t.affiliatedCollege && t.affiliatedCollege.name) || '—',
          collegeNames,
          levelNames,
          totalWeeklyHours: t.totalWeeklyHours,
          totalClassCount: t.totalClassCount,
          textbookCount: t.textbookCount,
          details: (t.details || []).map((d) => ({
            courseName: (d.course && d.course.name) || '—',
            weeklyHours: d.weeklyHours,
            classes: (d.classes || []).map((c) => ({
              className: c.className,
              isCombined: c.isCombined,
              collegeName: c.collegeName || '—',
              trainingLevelName: c.trainingLevelName || '—',
              weeklyHours: c.weeklyHours,
              isAuto: c.isAuto,
              textbookName: c.textbookName || '无',
            })),
          })),
        };
      });

      const app = getApp();
      this.setData({
        teachers,
        semester: (app && app.globalData.currentSemester) || '',
        loading: false,
      });
    } catch (e) {
      this.setData({ error: (e && e.message) || '加载失败', loading: false });
    }
  },

  toggle(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? null : id });
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },
});
