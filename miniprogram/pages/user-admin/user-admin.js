// pages/user-admin/user-admin.js
// 用户管理：仅超级管理员可见可操作。后端全部路由用 roleMiddleware('super_admin') 守门，
// 本页仅做前端显隐 + 纵深防御（超级管理员账号的写操作后端会拒绝，UI 直接隐藏）。
const api = require('../../utils/api.js');
const { guard, isSuperAdmin } = require('../../utils/auth.js');
const { roleLabel, roleClass } = require('../../utils/user.js');
const { formatTime } = require('../../utils/format.js');

// 角色下拉：仅管理员 / 访客。超级管理员故意不出现在下拉里，
// 避免在前端误造出第二个超级管理员（如需可通过其他途径，属高风险操作）。
const ROLE_OPTIONS = [
  { label: '管理员', value: 'admin' },
  { label: '访客', value: 'viewer' },
];

Page({
  data: {
    canManage: false,
    users: [],
    total: 0,
    page: 1,
    pageSize: 20,
    finished: false,
    loading: true,
    refreshing: false, // 局部刷新（输入/筛选时），不卸载搜索框
    error: '',

    // 筛选
    keyword: '',

    // 当前登录用户（用于 self 保护）
    myId: null,

    // 新增 / 编辑 共用弹层
    showSheet: false,
    mode: 'add',          // 'add' | 'edit'
    editId: null,
    isSelf: false,        // 编辑的是否为当前登录用户（影响角色可编辑性）
    sheetTitle: '新增用户',
    submitting: false,
    form: {
      username: '',
      password: '',
      realName: '',
      email: '',
      roleIndex: 1,       // 默认 访客
    },
    focusedField: '',
    roleLabels: ROLE_OPTIONS.map((o) => o.label),
  },

  onLoad() {
    // 纵深防御：非超级管理员直接回首页（页可经 URL 直达）
    if (!guard()) return;
    if (!isSuperAdmin()) {
      wx.reLaunch({ url: '/pages/home/home' });
      return;
    }
    this.setData({ canManage: true });
    this.loadMe();
  },

  async loadMe() {
    try {
      const me = await api.getMe();
      this.setData({ myId: me.id, myRole: me.role });
    } catch (e) {
      // 缺少 myId 时 self 保护失效，但后端会兜底拦截自操作
    }
    this.reload(true);
  },

  onShow() {
    if (!guard()) return;
    // 首次进入由 onLoad 触发；返回本页则原地刷新，保留搜索框
    if (this.data.users.length === 0) return;
    this.reload(false);
  },

  // 重置并加载第一页
  // showOverlay=true：清空列表 + 全屏"加载中"（首屏/下拉刷新）
  // showOverlay=false：保留现有列表，仅顶部细条提示刷新（输入/筛选，避免卸载搜索框导致键盘收起）
  reload(showOverlay = false) {
    const patch = { page: 1, finished: false, total: 0, error: '' };
    if (showOverlay) {
      patch.users = [];
      patch.loading = true;
      patch.refreshing = false;
    } else {
      patch.loading = false;
      patch.refreshing = true;
    }
    this.setData(patch);
    return this.loadUsers();
  },

  async loadUsers() {
    if (this.data.finished && this.data.users.length) return;
    try {
      const params = { page: this.data.page, pageSize: this.data.pageSize };
      if (this.data.keyword) params.keyword = this.data.keyword;

      const res = await api.listUsers(params);
      const items = (res && res.items) || [];
      const list = items.map((u) => this.decorate(u));

      const users = this.data.page === 1 ? list : this.data.users.concat(list);
      const loaded = users.length;
      const total = (res && res.total) || 0;

      this.setData({
        users,
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

  // 把后端用户对象映射成视图友好结构，并按当前登录用户计算操作权限
  decorate(u) {
    const myId = this.data.myId;
    const isSuper = u.role === 'super_admin';
    const isSelf = u.id === myId;
    return {
      id: u.id,
      username: u.username,
      realName: u.realName || '',
      email: u.email || '—',
      role: u.role,
      roleLabel: roleLabel(u.role),
      roleClass: roleClass(u.role),
      isActive: u.isActive,
      lastLoginText: u.lastLoginAt ? formatTime(u.lastLoginAt) : '从未登录',
      // 权限：超级管理员账号受后端保护（除自己外不可改）；自己不可禁用/重置/删除
      canEdit: !isSuper || isSelf,
      canStatus: !isSuper && !isSelf,
      canDelete: !isSuper && !isSelf,
      canReset: !isSuper && !isSelf,
    };
  },

  onReachBottom() {
    if (!this.data.finished && !this.data.loading && !this.data.refreshing) {
      this.setData({ page: this.data.page + 1 });
      this.loadUsers();
    }
  },

  async onPullDownRefresh() {
    await this.reload(true);
    wx.stopPullDownRefresh();
  },

  // 关键词搜索（300ms 防抖）
  onKeywordInput(e) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    clearTimeout(this._t);
    this._t = setTimeout(() => this.reload(), 300);
  },

  clearFilters() {
    this.setData({ keyword: '' });
    this.reload();
  },

  // ===== 新增 / 编辑 弹层 =====
  openAdd() {
    this.setData({
      showSheet: true,
      mode: 'add',
      editId: null,
      isSelf: false,
      sheetTitle: '新增用户',
      submitting: false,
      form: {
        username: '',
        password: '',
        realName: '',
        email: '',
        roleIndex: 1, // 默认 访客
      },
      focusedField: '',
    });
  },

  // 编辑：用卡片已携带的字段回填表单
  openEdit(e) {
    const id = e.currentTarget.dataset.id;
    const u = this.data.users.find((x) => x.id === id);
    if (!u) return;
    const isSelf = id === this.data.myId;
    const roleIndex = ROLE_OPTIONS.findIndex((o) => o.value === u.role);
    this.setData({
      showSheet: true,
      mode: 'edit',
      editId: id,
      isSelf,
      sheetTitle: '编辑用户',
      submitting: false,
      form: {
        username: u.username,
        password: '',
        realName: u.realName || '',
        email: u.email && u.email !== '—' ? u.email : '',
        roleIndex: roleIndex < 0 ? 0 : roleIndex,
      },
      focusedField: '',
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

  onRolePick(e) {
    this.setData({ 'form.roleIndex': Number(e.detail.value) });
  },

  async submit() {
    const f = this.data.form;
    const isSelf = this.data.isSelf;
    const payload = {};

    if (this.data.mode === 'add') {
      const username = (f.username || '').trim();
      const password = (f.password || '').trim();
      if (!username) {
        wx.showToast({ title: '请输入用户名', icon: 'none' });
        return;
      }
      if (!password) {
        wx.showToast({ title: '请输入初始密码', icon: 'none' });
        return;
      }
      payload.username = username;
      payload.password = password;
      if (f.realName && f.realName.trim()) payload.realName = f.realName.trim();
      if (f.email && f.email.trim()) payload.email = f.email.trim();
      payload.role = ROLE_OPTIONS[f.roleIndex] ? ROLE_OPTIONS[f.roleIndex].value : 'viewer';

      this.setData({ submitting: true });
      try {
        await api.createUser(payload);
        this.setData({ showSheet: false });
        wx.showToast({ title: '添加成功', icon: 'success' });
        this.reload();
      } catch (e) {
        wx.showToast({ title: (e && e.message) || '添加失败', icon: 'none' });
      } finally {
        this.setData({ submitting: false });
      }
    } else {
      // 编辑：realName / email 始终提交（已预填）；role 仅非自己时提交
      payload.realName = (f.realName || '').trim();
      payload.email = (f.email || '').trim();
      if (!isSelf && ROLE_OPTIONS[f.roleIndex]) {
        payload.role = ROLE_OPTIONS[f.roleIndex].value;
      }
      if (Object.keys(payload).length === 0) {
        wx.showToast({ title: '没有可保存的修改', icon: 'none' });
        return;
      }

      this.setData({ submitting: true });
      try {
        await api.updateUser(this.data.editId, payload);
        this.setData({ showSheet: false });
        wx.showToast({ title: '保存成功', icon: 'success' });
        this.reload();
      } catch (e) {
        wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' });
      } finally {
        this.setData({ submitting: false });
      }
    }
  },

  // 启用 / 禁用
  toggleStatus(e) {
    const id = e.currentTarget.dataset.id;
    const u = this.data.users.find((x) => x.id === id);
    if (!u) return;
    const next = !u.isActive;
    wx.showModal({
      title: next ? '启用账号' : '禁用账号',
      content: `确定要${next ? '启用' : '禁用'}用户「${u.username}」吗？`,
      confirmColor: '#1C82F5',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.updateUserStatus(id, next);
          wx.showToast({ title: next ? '已启用' : '已禁用', icon: 'success' });
          this.reload();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
        }
      },
    });
  },

  // 重置密码（弹窗输入新密码）
  resetPassword(e) {
    const id = e.currentTarget.dataset.id;
    const u = this.data.users.find((x) => x.id === id);
    wx.showModal({
      title: '重置密码',
      editable: true,
      placeholderText: '请输入新密码',
      content: u
        ? `为「${u.username}」设置新密码：重置后该用户其他设备将被强制下线，下次登录须修改密码。`
        : '设置新密码',
      confirmColor: '#1C82F5',
      success: async (res) => {
        if (!res.confirm) return;
        const pw = (res.content || '').trim();
        if (!pw) {
          wx.showToast({ title: '请输入新密码', icon: 'none' });
          return;
        }
        try {
          await api.resetUserPassword(id, pw);
          wx.showToast({ title: '已重置密码', icon: 'success' });
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '重置失败', icon: 'none' });
        }
      },
    });
  },

  // 删除
  deleteUser(e) {
    const id = e.currentTarget.dataset.id;
    const u = this.data.users.find((x) => x.id === id);
    wx.showModal({
      title: '删除用户',
      content: `确定要删除用户「${u ? u.username : ''}」吗？此操作不可恢复。`,
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteUser(id);
          wx.showToast({ title: '已删除', icon: 'success' });
          this.reload();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' });
        }
      },
    });
  },
});
