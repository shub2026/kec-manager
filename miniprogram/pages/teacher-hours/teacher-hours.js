// pages/teacher-hours/teacher-hours.js
// 教师课时：按教师汇总周课时，点击展开课程与班级明细。调用 api.getStatistics。
// 后端已对「合班」做去重（合班=1 个逻辑教学班，课时仅计 1 次），口径与 Web 端一致。
const api = require('../../utils/api.js');
const { guard } = require('../../utils/auth.js');
const { personnelLabel, personnelTagClass } = require('../../utils/personnel.js');

Page({
  data: {
    teachers: [],
    filteredTeachers: [],
    subjectOptions: [],
    filterName: '',
    filterSubject: '',
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
          personnelType: personnelLabel(t.personnelType),
          personnelClass: personnelTagClass(t.personnelType),
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

      // 收集本学期所有任教科目，用于科目筛选下拉
      const subjectSet = new Set();
      for (const t of teachers) {
        for (const d of t.details || []) {
          if (d.courseName) subjectSet.add(d.courseName);
        }
      }
      const subjectOptions = [...subjectSet].sort();

      const app = getApp();
      this.setData(
        {
          teachers,
          subjectOptions,
          semester: (app && app.globalData.currentSemester) || '',
          loading: false,
        },
        () => this.applyFilter()
      );
    } catch (e) {
      this.setData({ error: (e && e.message) || '加载失败', loading: false });
    }
  },

  toggle(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? null : id });
  },

  // 姓名输入防抖 200ms，与 WEB 端一致
  onNameInput(e) {
    this.setData({ filterName: e.detail.value });
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.applyFilter(), 200);
  },

  onSubjectChange(e) {
    const idx = e.detail.value;
    const subject = this.data.subjectOptions[idx] || '';
    this.setData({ filterSubject: subject }, () => this.applyFilter());
  },

  clearFilters() {
    this.setData({ filterName: '', filterSubject: '' }, () => this.applyFilter());
  },

  applyFilter() {
    const { teachers, filterName, filterSubject } = this.data;
    const filtered = teachers.filter((t) => {
      if (filterName && !t.teacherName.includes(filterName)) return false;
      if (filterSubject && !(t.details || []).some((d) => d.courseName === filterSubject)) return false;
      return true;
    });
    this.setData({ filteredTeachers: filtered, expandedId: null });
  },

  // 切走 tab 时重置筛选
  onHide() {
    this.setData({ filterName: '', filterSubject: '' }, () => this.applyFilter());
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },
});
