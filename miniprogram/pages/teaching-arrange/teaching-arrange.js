const api = require('../../utils/api.js');
const { guard } = require('../../utils/auth.js');

// 科目类型元数据：与 WEB 端 CourseQuery 标签语义保持一致（仅 public / professional 两种）
const TYPE_META = {
  public: { label: '公共课', cls: 'blue' },
  professional: { label: '专业课', cls: 'green' },
};

// 方案状态展示：与 WEB 端一致（生效 / 草稿 / 归档）
function statusLabel(status) {
  const map = { active: '生效', draft: '草稿', archived: '归档' };
  return map[status] || status || '—';
}
// 方案状态标签样式类：与 WEB 端 el-tag type 对齐（success/warning/info）
function statusClass(status) {
  const map = { active: 'success', draft: 'warning', archived: 'info' };
  return map[status] || 'info';
}

Page({
  data: {
    // 筛选
    keyword: '',          // 课程名模糊搜索
    courseType: '',       // 科目类型筛选（''=全部）
    typeIndex: 0,         // 当前科目类型筛选项索引
    typeLabel: '全部',    // 当前科目类型筛选显示文案
    typeOptions: [
      { value: '', label: '全部' },
      { value: 'public', label: '公共课' },
      { value: 'professional', label: '专业课' },
    ],
    // 数据
    courses: [],          // 课程聚合列表
    totalCourses: 0,
    totalPlans: 0,
    expandedId: null,     // 当前展开的课程 id（手风琴）
    // 状态
    loading: true,
    refreshing: false,
    error: '',
  },

  onShow() {
    if (!guard()) return;
    if (!this.data.courses.length) this.reload();
  },

  // 课程名输入即搜：200ms 防抖（与 WEB 端同款交互）
  onKeywordInput(e) {
    const value = e.detail.value;
    this.setData({ keyword: value });
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.reload();
    }, 200);
  },

  onTypeChange(e) {
    const idx = Number(e.detail.value);
    const opt = this.data.typeOptions[idx];
    this.setData({ courseType: opt.value, typeIndex: idx, typeLabel: opt.label });
    this.reload();
  },

  resetFilters() {
    this.setData({ keyword: '', courseType: '', typeIndex: 0, typeLabel: '全部' });
    this.reload();
  },

  reload() {
    this.setData({ loading: true, error: '', courses: [], expandedId: null });
    return this.fetch();
  },

  async fetch() {
    const { keyword, courseType } = this.data;
    this.setData({ refreshing: true });
    try {
      const params = {};
      if (keyword.trim()) params.courseName = keyword.trim();
      if (courseType) params.courseType = courseType;
      const resp = await api.getCourseQuery(params);
      const courses = (resp.courses || []).map((c) => {
        const meta = TYPE_META[c.course.type] || { label: c.course.type || '其他', cls: 'gray' };
        return {
          id: c.course.id,
          name: c.course.name,
          code: c.course.code || '',
          type: c.course.type,
          typeLabel: meta.label,
          typeClass: meta.cls,
          planCount: c.planCount || 0,
          activePlanCount: c.activePlanCount || 0,
          totalHours: c.totalHours || 0,
          // 展开状态下沉到课程：点击只更新本卡片
          plans: (c.plans || []).map((p) => ({
            planId: p.planId,
            planName: p.planName,
            version: p.version || '',
            planStatus: p.planStatus,
            statusLabel: statusLabel(p.planStatus),
            statusClass: statusClass(p.planStatus),
            isActive: p.isActive,
            majorName: p.majorName || '—',
            collegeName: p.collegeName || '—',
            trainingLevelName: p.trainingLevelName || '—',
            startSemester: p.startSemester,
            endSemester: p.endSemester,
            semesters: (p.semesters || []).map((s) => ({
              semester: s.semester,
              weeklyHours: s.weeklyHours,
              weeksCount: s.weeksCount,
              hours: s.hours,
              textbooks: (s.textbooks || [])
                .filter((t) => t.isActive)
                .map((t) => t.title)
                .join('、') || '',
            })),
            totalHours: p.totalHours,
          })),
          expanded: false,
        };
      });
      this.setData({
        courses,
        totalCourses: resp.totalCourses || 0,
        totalPlans: resp.totalPlans || 0,
        loading: false,
        refreshing: false,
      });
    } catch (e) {
      this.setData({
        error: (e && e.message) || '课程查询失败',
        loading: false,
        refreshing: false,
      });
    }
  },

  // 点选课程卡片：展开 / 收起，手风琴式（展开当前自动收起其他）
  toggle(e) {
    const id = e.currentTarget.dataset.id;
    const courses = this.data.courses;
    const idx = courses.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const patch = {};
    const willExpand = !courses[idx].expanded;
    // 收起其他已展开
    courses.forEach((c, i) => {
      if (i !== idx && c.expanded) patch[`courses[${i}].expanded`] = false;
    });
    patch[`courses[${idx}].expanded`] = willExpand;
    this.setData(patch);
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh());
  },
});
