const { login } = require('../../utils/auth.js');

Page({
  data: {
    username: '',
    password: '',
    loading: false,
    error: '',
    showPassword: false,
  },

  onLoad() {
    const app = getApp();
    if (app && app.globalData.token) {
      wx.reLaunch({ url: '/pages/home/home' });
    }
  },

  onUsername(e) {
    this.setData({ username: e.detail.value });
  },

  onPassword(e) {
    this.setData({ password: e.detail.value });
  },

  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword });
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
