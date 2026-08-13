// pages/plan-query/plan-query.js
// 培养方案查询：列表（状态色条区分）+ 筛选 + 点击展开课程卡片流（移动端纵向布局）。
// 全部数据来自现有 GET 接口，纯前端封装，不改后端。
const api = require('../../utils/api.js');
const { guard } = require('../../utils/auth.js');

const STATUS_LABEL = { draft: '草稿', active: '启用', archived: '归档' };
const STATUS_PICKER = ['全部状态', '草稿', '启用', '归档'];
const STATUS_VALUE = ['', 'draft', 'active', 'archived'];

Page({
  data: {
    loading: true,
    error: '',
    keyword: '',
    collegeFilter: '',
    statusFilter: '',
    collegeLabel: '全部学院',
    statusLabel: '全部状态',
    collegeIndex: 0,
    statusIndex: 0,
    collegePickerRange: ['全部学院'],
    statusPickerRange: STATUS_PICKER,
    statusLabelMap: STATUS_LABEL,
    allPlans: [],
    list: [],
    expandedId: null,
    detailLoadingId: null,
    detailError: '',
    // 展开方案详情数据：{ groups, groupTotals, totalAllHours, courseCount, maxSemester }
    detail: null,
  },

  onShow() {
    if (!guard()) return;
    if (!this.data.allPlans.length) this.reload();
  },

  async reload() {
    this.setData({ loading: true, error: '' });
    try {
      const plans = await api.getPlans();
      const raw = Array.isArray(plans) ? plans : [];

      // 从已加载方案派生「学院」筛选选项
      const collegeMap = {};
      raw.forEach((p) => {
        if (p.collegeId && p.colleges && p.colleges.name && !collegeMap[p.collegeId]) {
          collegeMap[p.collegeId] = p.colleges.name;
        }
      });
      const colleges = Object.keys(collegeMap).map((id) => ({ id: Number(id), name: collegeMap[id] }));
      const collegePickerRange = ['全部学院'].concat(colleges.map((c) => c.name));

      this.setData({ allPlans: raw, colleges, collegePickerRange, loading: false });
      this.applyFilter();
    } catch (e) {
      this.setData({ error: (e && e.message) || '加载失败', loading: false });
    }
  },

  applyFilter() {
    const { allPlans, keyword, collegeFilter, statusFilter } = this.data;
    const kw = (keyword || '').trim().toLowerCase();
    const list = allPlans.filter((p) => {
      if (collegeFilter && p.collegeId !== Number(collegeFilter)) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (kw) {
        const hay = `${p.name || ''} ${p.version || ''}`.toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });
    this.setData({ list });
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
    this.applyFilter();
  },
  onSearch() {
    this.applyFilter();
  },
  onClearKeyword() {
    this.setData({ keyword: '' });
    this.applyFilter();
  },

  onCollegeChange(e) {
    const idx = Number(e.detail.value);
    const collegeFilter = idx === 0 ? '' : String(this.data.colleges[idx - 1].id);
    const collegeLabel = idx === 0 ? '全部学院' : this.data.colleges[idx - 1].name;
    this.setData({ collegeIndex: idx, collegeFilter, collegeLabel });
    this.applyFilter();
  },

  onStatusChange(e) {
    const idx = Number(e.detail.value);
    const statusFilter = STATUS_VALUE[idx];
    const statusLabel = STATUS_PICKER[idx];
    this.setData({ statusIndex: idx, statusFilter, statusLabel });
    this.applyFilter();
  },

  resetFilter() {
    this.setData({
      keyword: '', collegeFilter: '', statusFilter: '',
      collegeLabel: '全部学院', statusLabel: '全部状态',
      collegeIndex: 0, statusIndex: 0,
    });
    this.applyFilter();
  },

  // 展开 / 收起方案；展开时懒加载课程数据并构建纵向课程卡片流
  async toggle(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.expandedId === id) {
      this.setData({ expandedId: null, detail: null });
      return;
    }
    this.setData({ expandedId: id, detailLoadingId: id, detailError: '', detail: null });
    try {
      const [courses] = await Promise.all([api.getPlanCourses(id)]);
      if (this.data.expandedId !== id) return;

      const rawCourses = Array.isArray(courses) ? courses : [];
      const detail = this._buildDetail(rawCourses);

      this.setData({ detail, detailLoadingId: null });
    } catch (err) {
      if (this.data.expandedId === id) {
        this.setData({ detailError: (err && err.message) || '明细加载失败', detailLoadingId: null });
      }
    }
  },

  // 构建纵向课程卡片流：按公共课/专业课分组，每门课含各学期明细（周课时/周数/教材）
  _buildDetail(rawCourses) {
    const groups = [
      { type: 'public', label: '公共课', courses: [] },
      { type: 'professional', label: '专业课', courses: [] },
    ];

    let maxSemester = 0;
    rawCourses.forEach((c) => {
      const type = (c.courses && c.courses.type) || 'public';
      const semList = c.planCourseSemesters || [];
      const semesterMap = new Map();
      semList.forEach((s) => { semesterMap.set(s.semester, s); });

      // 逐个学期构建明细（周课时、周数、教材、本学期总课时）
      const semesterItems = [];
      for (let s = c.startSemester; s <= c.endSemester; s++) {
        const sem = semesterMap.get(s);
        const weeklyHours = sem ? (sem.weeklyHours || 0) : (c.weeklyHours || 0);
        const weeks = sem ? (sem.weeksCount || 18) : 18;
        const textbooks = (sem && sem.planTextbooks ? sem.planTextbooks : []).map((t) => ({
          title: (t.textbooks && t.textbooks.title) || '',
          isRequired: t.isRequired !== false,
          isActive: (t.textbooks && t.textbooks.isActive) !== false,
        }));
        semesterItems.push({
          semester: s,
          weeklyHours,
          weeks,
          hours: Math.round(weeklyHours * weeks),
          textbooks,
        });
        if (s > maxSemester) maxSemester = s;
      }

      const totalHours = semesterItems.reduce((sum, it) => sum + it.hours, 0);

      const course = {
        id: c.id,
        name: (c.courses && c.courses.name) || '',
        type,
        isActive: c.isActive !== false,
        totalHours: Math.round(totalHours),
        semesterItems,
      };

      const g = type === 'professional' ? groups[1] : groups[0];
      g.courses.push(course);
    });

    // 分组总课时
    const groupTotals = groups.map((g) =>
      g.courses.reduce((s, c) => s + (c.totalHours || 0), 0)
    );

    const totalAllHours = groupTotals.reduce((s, v) => s + v, 0);
    const courseCount = groups.reduce((s, g) => s + g.courses.length, 0);

    return { groups, groupTotals, totalAllHours, courseCount, maxSemester };
  },

  // 周课时热力色 class（0=灰 / 1~2=浅蓝 / 3~4=中蓝 / ≥5=深蓝）
  _heatClass(hours) {
    if (!hours) return 'zero';
    if (hours <= 2) return 'low';
    if (hours <= 4) return 'mid';
    return 'high';
  },

  noop() {},

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh());
  },
});
