// pages/profile/profile.js
// 我的：用户信息 + 当前学期 + 退出登录。
const api = require('../../utils/api.js');
const { guard, logout, isAdmin, isSuperAdmin } = require('../../utils/auth.js');
const { roleLabel } = require('../../utils/user.js');
const { formatTime } = require('../../utils/format.js');

const APP_VERSION = '1.0.0';

// 根据当前运行环境自动识别版本前缀：develop=开发版 / trial=体验版 / release=正式版
function getEnvLabel() {
  try {
    const env = wx.getAccountInfoSync().miniProgram.envVersion;
    return { develop: '开发版', trial: '体验版', release: '正式版' }[env] || '体验版';
  } catch (e) {
    return '体验版';
  }
}

Page({
  data: {
    me: null,
    semester: '',
    appEnv: getEnvLabel(),
    appVersion: APP_VERSION,
    loading: true,
    refreshing: false,
    error: '',
  },

  onShow() {
    if (!guard()) return;
    // 已加载过则不再重复拉取（与其他页一致），避免每次切 tab 闪空 + 重复请求
    if (!this.data.me) this.loadMe();
  },

  async loadMe(isRefresh = false) {
    // 首屏全屏 loading；下拉刷新保留已有内容，仅用轻量提示，避免闪空
    this.setData(isRefresh ? { refreshing: true, error: '' } : { loading: true, error: '' });
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
        canManage: isAdmin(),
        canUserManage: isSuperAdmin(),
        loading: false,
        refreshing: false,
      });
    } catch (e) {
      if (isRefresh) {
        this.setData({ refreshing: false });
        wx.showToast({ title: (e && e.message) || '刷新失败', icon: 'none' });
      } else {
        this.setData({ error: (e && e.message) || '加载失败', loading: false });
      }
    }
  },

  goTeacherAdmin() {
    wx.navigateTo({ url: '/pages/teacher-admin/teacher-admin' });
  },

  goUserAdmin() {
    wx.navigateTo({ url: '/pages/user-admin/user-admin' });
  },

  copyDesktopUrl() {
    wx.setClipboardData({
      data: 'https://kec.sntip.cn',
      success: () => wx.showToast({ title: '地址已复制', icon: 'none' }),
    });
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
    this.loadMe(true).then(() => wx.stopPullDownRefresh());
  },
});
