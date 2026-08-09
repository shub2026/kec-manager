// pages/teacher-admin/teacher-admin.js
// 教师管理：查询教师档案（所有登录用户）+ 新增教师（仅管理员）。
// 权限守门人在后端 roleMiddleware('admin','super_admin')，本页仅做前端显隐 + 纵深防御。
const api = require('../../utils/api.js');
const { guard, isAdmin } = require('../../utils/auth.js');
const { personnelLabel, personnelTagClass } = require('../../utils/personnel.js');

const PERSONNEL_OPTIONS = [
  { label: '专职', value: 'full_time' },
  { label: '兼职', value: 'part_time' },
  { label: '外聘', value: 'external' },
];
const GENDER_OPTIONS = [
  { label: '男', value: 'male' },
  { label: '女', value: 'female' },
];
const STATUS_OPTIONS = [
  { label: '启用', value: 'active' },
  { label: '禁用', value: 'disabled' },
];

// 把后端教师对象映射成视图友好结构
// 注意：后端 convertResponseNaming 已把响应转为 camelCase，这里直接用驼峰字段
function genderLabel(g) {
  return g === 'male' ? '男' : g === 'female' ? '女' : '—';
}

function normalize(t) {
  const courses = t.courseList || [];
  return {
    id: t.id,
    name: t.name,
    gender: genderLabel(t.gender),
    birthDate: t.birthDate || '—',
    personnelType: personnelLabel(t.personnelType),
    personnelClass: personnelTagClass(t.personnelType),
    college: (t.affiliatedCollege && t.affiliatedCollege.name) || '未归属学院',
    qualification: t.qualificationType || '—',
    defaultWeeklyHours: t.defaultWeeklyHours != null ? t.defaultWeeklyHours : '—',
    courseList: courses.slice(0, 3),
    courseListMore: courses.length > 3 ? `+${courses.length - 3}` : '',
    status: t.status, // active / disabled
    // 编辑时回填表单所需的原始字段（camelCase，与响应一致）
    editSrc: {
      id: t.id,
      name: t.name,
      gender: t.gender,
      personnelType: t.personnelType,
      status: t.status,
      birthDate: t.birthDate || '',
      qualificationType: t.qualificationType || '',
      defaultWeeklyHours: t.defaultWeeklyHours != null ? String(t.defaultWeeklyHours) : '',
      affiliatedCollegeId: t.affiliatedCollegeId || null,
      courseIds: (t.courseList || []).map((c) => c.id),
    },
  };
}

Page({
  data: {
    canManage: false,
    teachers: [],
    total: 0,
    page: 1,
    pageSize: 30,
    finished: false,
    loading: true,
    refreshing: false, // 局部刷新（筛选/输入时），不卸载搜索框
    error: '',

    // 筛选
    searchName: '',
    filterPersonnel: '',
    filterPersonnelLabel: '',
    personnelOptions: PERSONNEL_OPTIONS.map((o) => o.label),

    // 新增 / 编辑 共用弹层
    showSheet: false,
    mode: 'add',          // 'add' | 'edit'
    editId: null,
    sheetTitle: '新增教师',
    submitting: false,
    form: {
      name: '',
      genderIndex: -1,
      personnelIndex: -1,
      collegeIndex: -1,
      statusIndex: 0, // 默认启用
      birthDate: '',
      qualification: '',
      weeklyHours: '',
    },
    focusedField: '', // 当前聚焦的表单字段（高亮边框用）
    genderOptions: GENDER_OPTIONS.map((o) => o.label),
    personnelLabels: PERSONNEL_OPTIONS.map((o) => o.label),
    statusLabels: STATUS_OPTIONS.map((o) => o.label),
    colleges: [],          // 原始对象数组 {id, name}
    collegeNames: [],      // picker 展示用
    collegeLoaded: false,

    // 学科（课程）多选
    courseOptions: [],     // { id, name, selected }
    courseLoaded: false,
  },

  onLoad() {
    // 纵深防御：非管理员直接回首页（页可经 URL 直达）
    if (!guard()) return;
    this.setData({ canManage: isAdmin() });
    if (!isAdmin()) {
      wx.reLaunch({ url: '/pages/home/home' });
      return;
    }
    // 拉取学院、学科列表（新增/编辑教师时使用）
    this.loadColleges();
    this.loadCourses();
  },

  async loadColleges() {
    if (this.data.collegeLoaded) return;
    try {
      const list = await api.getColleges();
      const arr = Array.isArray(list) ? list : [];
      this.setData({
        colleges: arr,
        collegeNames: arr.map((c) => c.name),
        collegeLoaded: true,
      });
    } catch (e) {
      // 学院列表加载失败不阻断新增，仅无法选归属学院
      this.setData({ collegeLoaded: true });
    }
  },

  async loadCourses() {
    if (this.data.courseLoaded) return;
    try {
      const list = await api.getCourses();
      const arr = Array.isArray(list) ? list : [];
      this.setData({
        courseOptions: arr.map((c) => ({ id: c.id, name: c.name, selected: false })),
        courseLoaded: true,
      });
    } catch (e) {
      // 学科列表加载失败不阻断新增，仅无法选学科
      this.setData({ courseLoaded: true });
    }
  },

  onShow() {
    if (!guard()) return;
    // 首次进入（列表为空）用全屏遮罩；返回本页则原地刷新，保留搜索框
    if (this.data.teachers.length === 0) this.reload(true);
    else this.reload(false);
  },

  // 重置并加载第一页
  // showOverlay=true：清空列表 + 全屏"加载中"（首屏/下拉刷新）
  // showOverlay=false：保留现有列表，仅顶部细条提示刷新（输入/筛选，避免卸载搜索框导致键盘收起）
  reload(showOverlay = false) {
    const patch = { page: 1, finished: false, total: 0, error: '' };
    if (showOverlay) {
      patch.teachers = [];
      patch.loading = true;
      patch.refreshing = false;
    } else {
      patch.loading = false;
      patch.refreshing = true;
    }
    this.setData(patch);
    this.loadTeachers();
  },

  async loadTeachers() {
    if (this.data.finished && this.data.teachers.length) return;
    try {
      const params = { page: this.data.page, pageSize: this.data.pageSize };
      if (this.data.searchName) params.name = this.data.searchName;
      if (this.data.filterPersonnel) params.personnelType = this.data.filterPersonnel;

      const res = await api.listTeachers(params);
      const items = (res && res.items) || [];
      const list = items.map(normalize);

      const teachers = this.data.page === 1 ? list : this.data.teachers.concat(list);
      const loaded = teachers.length;
      const total = (res && res.total) || 0;

      this.setData({
        teachers,
        total,
        loading: false,
        refreshing: false,
        finished: loaded >= total,
      });
    } catch (e) {
      this.setData({
        error: (e && e.message) || '加载失败',
        loading: false,
        refreshing: false,
      });
    }
  },

  onReachBottom() {
    if (!this.data.finished && !this.data.loading && !this.data.refreshing) {
      this.setData({ page: this.data.page + 1 });
      this.loadTeachers();
    }
  },

  onPullDownRefresh() {
    this.reload(true);
    wx.stopPullDownRefresh();
  },

  // 姓名搜索（300ms 防抖）
  onNameInput(e) {
    const searchName = e.detail.value;
    this.setData({ searchName });
    clearTimeout(this._t);
    this._t = setTimeout(() => this.reload(), 300);
  },

  onPersonnelChange(e) {
    const idx = Number(e.detail.value);
    this.setData({
      filterPersonnel: PERSONNEL_OPTIONS[idx].value,
      filterPersonnelLabel: PERSONNEL_OPTIONS[idx].label,
    });
    this.reload();
  },

  clearFilters() {
    this.setData({ searchName: '', filterPersonnel: '', filterPersonnelLabel: '' });
    this.reload();
  },

  // ===== 新增 / 编辑 弹层 =====
  openAdd() {
    this.setData({
      showSheet: true,
      mode: 'add',
      editId: null,
      sheetTitle: '新增教师',
      submitting: false,
      form: {
        name: '',
        genderIndex: -1,
        personnelIndex: -1,
        collegeIndex: -1,
        statusIndex: 0,
        birthDate: '',
        qualification: '',
        weeklyHours: '',
      },
      focusedField: '',
      courseOptions: this.data.courseOptions.map((c) => ({ ...c, selected: false })),
    });
  },

  // 编辑：用卡片已携带的原始字段回填表单
  openEdit(e) {
    const id = e.currentTarget.dataset.id;
    const t = this.data.teachers.find((x) => x.id === id);
    if (!t || !t.editSrc) return;
    const s = t.editSrc;
    const genderIndex = s.gender ? GENDER_OPTIONS.findIndex((o) => o.value === s.gender) : -1;
    const personnelIndex = s.personnelType
      ? PERSONNEL_OPTIONS.findIndex((o) => o.value === s.personnelType)
      : -1;
    const statusIndex =
      s.status === 'disabled'
        ? STATUS_OPTIONS.findIndex((o) => o.value === 'disabled')
        : STATUS_OPTIONS.findIndex((o) => o.value === 'active');
    const collegeIndex =
      s.affiliatedCollegeId != null
        ? this.data.colleges.findIndex((c) => c.id === s.affiliatedCollegeId)
        : -1;
    const selectedIds = new Set(s.courseIds || []);
    const courseOptions = this.data.courseOptions.map((c) => ({
      ...c,
      selected: selectedIds.has(c.id),
    }));

    this.setData({
      showSheet: true,
      mode: 'edit',
      editId: id,
      sheetTitle: '编辑教师',
      submitting: false,
      form: {
        name: s.name || '',
        genderIndex,
        personnelIndex,
        collegeIndex,
        statusIndex: statusIndex < 0 ? 0 : statusIndex,
        birthDate: s.birthDate || '',
        qualification: s.qualificationType || '',
        weeklyHours: s.defaultWeeklyHours || '',
      },
      focusedField: '',
      courseOptions,
    });
  },

  closeSheet() {
    if (this.data.submitting) return;
    this.setData({ showSheet: false });
  },

  // 弹层内部点按：阻止冒泡到 mask 关闭
  noop() {},

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  onFormFocus(e) {
    this.setData({ focusedField: e.currentTarget.dataset.field });
  },

  onFormBlur(e) {
    if (this.data.focusedField === e.currentTarget.dataset.field) {
      this.setData({ focusedField: '' });
    }
  },

  onGenderPick(e) {
    this.setData({ 'form.genderIndex': Number(e.detail.value) });
  },

  onPersonnelPick(e) {
    this.setData({ 'form.personnelIndex': Number(e.detail.value) });
  },

  onCollegePick(e) {
    this.setData({ 'form.collegeIndex': Number(e.detail.value) });
  },

  onStatusPick(e) {
    this.setData({ 'form.statusIndex': Number(e.detail.value) });
  },

  toggleCourse(e) {
    const id = Number(e.currentTarget.dataset.id);
    const courseOptions = this.data.courseOptions.map((c) =>
      c.id === id ? { ...c, selected: !c.selected } : c
    );
    this.setData({ courseOptions });
  },

  async submit() {
    const f = this.data.form;
    if (!f.name || !f.name.trim()) {
      wx.showToast({ title: '请填写教师姓名', icon: 'none' });
      return;
    }
    const payload = { name: f.name.trim() };
    if (f.genderIndex >= 0) payload.gender = GENDER_OPTIONS[f.genderIndex].value;
    if (f.personnelIndex >= 0) payload.personnel_type = PERSONNEL_OPTIONS[f.personnelIndex].value;
    if (f.collegeIndex >= 0 && this.data.colleges[f.collegeIndex]) {
      payload.affiliated_college_id = this.data.colleges[f.collegeIndex].id;
    }
    payload.status = STATUS_OPTIONS[f.statusIndex].value;
    if (f.birthDate && f.birthDate.trim()) payload.birth_date = f.birthDate.trim();
    if (f.qualification && f.qualification.trim()) payload.qualification_type = f.qualification.trim();

    // 学科（课程）多选
    const courseIds = this.data.courseOptions.filter((c) => c.selected).map((c) => c.id);
    if (courseIds.length) payload.courseIds = courseIds;

    // 自定义课时：空串视作清空（null），否则校验 0-40
    if (f.weeklyHours !== '') {
      const n = Number(f.weeklyHours);
      if (Number.isNaN(n) || n < 0 || n > 40) {
        wx.showToast({ title: '自定义课时需在 0-40 之间', icon: 'none' });
        return;
      }
      payload.default_weekly_hours = n;
    } else {
      payload.default_weekly_hours = null;
    }

    this.setData({ submitting: true });
    try {
      if (this.data.mode === 'edit') {
        await api.updateTeacher(this.data.editId, payload);
      } else {
        await api.createTeacher(payload);
      }
      this.setData({ showSheet: false });
      wx.showToast({
        title: this.data.mode === 'edit' ? '保存成功' : '添加成功',
        icon: 'success',
      });
      this.reload();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
