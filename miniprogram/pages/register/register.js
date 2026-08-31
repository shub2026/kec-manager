// pages/register/register.js
// 访客自助注册：创建待激活账号（role=viewer, is_active=false），
// 须由超级管理员在用户管理中激活后方可登录。
const api = require('../../utils/api.js');

// 与后端 validateRegister 保持一致：至少两种字符类型
function hasEnoughCharTypes(value) {
  let types = 0;
  if (/[a-z]/.test(value)) types++;
  if (/[A-Z]/.test(value)) types++;
  if (/\d/.test(value)) types++;
  if (/[^a-zA-Z\d]/.test(value)) types++;
  return types >= 2;
}

Page({
  data: {
    username: '',
    realName: '',
    phone: '',
    password: '',
    confirmPassword: '',
    showPassword: false,
    loading: false,
    error: '',
  },

  onField(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  async onSubmit() {
    const { username, realName, phone, password, confirmPassword } = this.data;

    const name = (username || '').trim();
    if (!name) {
      this.setData({ error: '请输入用户名' });
      return;
    }
    if (name.length > 50) {
      this.setData({ error: '用户名不超过50个字符' });
      return;
    }
    if (!password) {
      this.setData({ error: '请设置密码' });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      this.setData({ error: '密码长度须在8-128位之间' });
      return;
    }
    if (!hasEnoughCharTypes(password)) {
      this.setData({ error: '密码须至少包含两种字符类型（小写字母、大写字母、数字、特殊字符）' });
      return;
    }
    if (password !== confirmPassword) {
      this.setData({ error: '两次输入的密码不一致' });
      return;
    }
    const tel = (phone || '').trim();
    if (tel && !/^1[3-9]\d{9}$/.test(tel)) {
      this.setData({ error: '联系电话须为11位大陆手机号' });
      return;
    }

    this.setData({ loading: true, error: '' });
    try {
      const payload = { username: name, password };
      if ((realName || '').trim()) payload.realName = realName.trim();
      if (tel) payload.phone = tel;
      await api.register(payload);
      wx.showToast({ title: '注册成功，请联系管理员激活账号', icon: 'none', duration: 2500 });
      setTimeout(() => wx.navigateBack(), 2500);
    } catch (e) {
      this.setData({ error: (e && e.message) || '注册失败，请重试' });
    } finally {
      this.setData({ loading: false });
    }
  },
});
