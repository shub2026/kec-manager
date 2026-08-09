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
    courseCount: t.assignmentCount || 0,
    courseList: courses.slice(0, 3),
    courseListMore: courses.length > 3 ? `+${courses.length - 3}` : '',
    status: t.status, // active / disabled
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
    error: '',

    // 筛选
    searchName: '',
    filterPersonnel: '',
    filterPersonnelLabel: '',
    personnelOptions: PERSONNEL_OPTIONS.map((o) => o.label),

    // 新增弹层
    showAdd: false,
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
    genderOptions: GENDER_OPTIONS.map((o) => o.label),
    personnelLabels: PERSONNEL_OPTIONS.map((o) => o.label),
    statusLabels: STATUS_OPTIONS.map((o) => o.label),
    colleges: [],          // 原始对象数组 {id, name}
    collegeNames: [],      // picker 展示用
    collegeLoaded: false,
  },

  onLoad() {
    // 纵深防御：非管理员直接回首页（页可经 URL 直达）
    if (!guard()) return;
    this.setData({ canManage: isAdmin() });
    if (!isAdmin()) {
      wx.reLaunch({ url: '/pages/home/home' });
      return;
    }
    // 拉取学院列表（新增教师时选归属学院）
    this.loadColleges();
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

  onShow() {
    if (guard()) this.reload();
  },

  // 重置并加载第一页
  reload() {
    this.setData({ page: 1, finished: false, teachers: [], total: 0, loading: true, error: '' });
    this.loadTeachers();
  },

  async loadTeachers() {
    if (this.data.finished && this.data.teachers.length) return;
    try {
      const params = { page: this.data.page, pageSize: this.data.pageSize };
      if (this.data.searchName) params.name = this.data.searchName;
      if (this.data.filterPersonnel) params.personnel_type = this.data.filterPersonnel;

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
        finished: loaded >= total,
      });
    } catch (e) {
      this.setData({ error: (e && e.message) || '加载失败', loading: false });
    }
  },

  onReachBottom() {
    if (!this.data.finished && !this.data.loading) {
      this.setData({ page: this.data.page + 1 });
      this.loadTeachers();
    }
  },

  onPullDownRefresh() {
    this.reload();
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

  // ===== 新增教师弹层 =====
  openAdd() {
    this.setData({
      showAdd: true,
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
    });
  },

  closeAdd() {
    if (this.data.submitting) return;
    this.setData({ showAdd: false });
  },

  // 弹层内部点按：阻止冒泡到 mask 关闭
  noop() {},

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
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

  async submitAdd() {
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
    if (f.weeklyHours !== '') {
      const n = Number(f.weeklyHours);
      if (Number.isNaN(n) || n < 0 || n > 40) {
        wx.showToast({ title: '自定义课时需在 0-40 之间', icon: 'none' });
        return;
      }
      payload.default_weekly_hours = n;
    }

    this.setData({ submitting: true });
    try {
      await api.createTeacher(payload);
      this.setData({ showAdd: false });
      wx.showToast({ title: '添加成功', icon: 'success' });
      this.reload();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '添加失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
