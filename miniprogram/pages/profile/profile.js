// pages/profile/profile.js
// 我的：用户信息 + 当前学期 + 退出登录。
const api = require('../../utils/api.js');
const { guard, logout } = require('../../utils/auth.js');
const { roleLabel } = require('../../utils/user.js');
const { formatTime } = require('../../utils/format.js');

const APP_VERSION = '1.0.2';

Page({
  data: {
    me: null,
    semester: '',
    appVersion: APP_VERSION,
    loading: true,
    error: '',
  },

  onShow() {
    if (!guard()) return;
    this.loadMe();
  },

  async loadMe() {
    this.setData({ loading: true, error: '' });
    try {
      const me = await api.getMe();
      const app = getApp();
      this.setData({
        me: {
          username: me.username,
          realName: me.realName || me.username,
          avatar: (me.realName || me.username || '?').charAt(0).toUpperCase(),
          role: roleLabel(me.role),
          email: me.email || '—',
          lastLoginAt: formatTime(me.lastLoginAt),
        },
        semester: (app && app.globalData.currentSemester) || '',
        loading: false,
      });
    } catch (e) {
      this.setData({ error: (e && e.message) || '加载失败', loading: false });
    }
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      confirmColor: '#1C82F5',
      success: (res) => {
        if (res.confirm) logout();
      },
    });
  },

  onPullDownRefresh() {
    this.loadMe().then(() => wx.stopPullDownRefresh());
  },
});
