const { login } = require('../../utils/auth.js');
const api = require('../../utils/api.js');

Page({
  data: {
    username: '',
    password: '',
    loading: false,
    error: '',
    showPassword: false,
    pwdFocus: false,
    // 注册开放开关：默认关闭，设置加载失败时保持隐藏（与后端 fail-close 一致）
    registerEnabled: false,
  },

  onLoad() {
    const app = getApp();
    if (app && app.globalData.token) {
      wx.reLaunch({ url: '/pages/home/home' });
    }
    this.loadRegisterFlag();
  },

  async loadRegisterFlag() {
    try {
      const data = await api.getSettings();
      const item = (data && (data.registerEnabled || data.register_enabled)) || null;
      this.setData({ registerEnabled: !!item && item.value === 'true' });
    } catch {
      this.setData({ registerEnabled: false });
    }
  },

  onUsername(e) {
    this.setData({ username: e.detail.value });
  },

  onPassword(e) {
    this.setData({ password: e.detail.value });
  },

  // 用户名回车 → 聚焦密码框（键盘串联，减少手动点按）
  onUsernameConfirm() {
    this.setData({ pwdFocus: true });
  },

  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  onGoRegister() {
    wx.navigateTo({ url: '/pages/register/register' });
  },

  async onSubmit() {
    const { username, password } = this.data;
    if (!username || !password) {
      this.setData({ error: '请输入用户名和密码' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      await login(username, password);
      wx.showToast({ title: '登录成功', icon: 'success' });
      const app = getApp();
      if (app && app.bootstrapSemester) await app.bootstrapSemester();
      wx.reLaunch({ url: '/pages/home/home' });
    } catch (e) {
      this.setData({ error: (e && e.message) || '登录失败，请重试' });
    } finally {
      this.setData({ loading: false });
    }
  },
});
