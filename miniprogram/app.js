const { API_BASE } = require('./config.js');

App({
  globalData: {
    apiBase: API_BASE,
    token: '',
    role: '',
    currentSemester: '',
  },

  onLaunch() {
    this.globalData.apiBase = API_BASE;
    this.globalData.token = wx.getStorageSync('token') || '';
    this.globalData.role = wx.getStorageSync('role') || '';
    this.globalData.currentSemester = wx.getStorageSync('currentSemester') || '';
    if (this.globalData.token) this.bootstrapSemester();
  },

  // 拉取系统设置，拿到当前学期（用于所有统计类接口必填的 semester 参数）
  bootstrapSemester() {
    return new Promise((resolve) => {
      if (!this.globalData.token) return resolve();
      wx.request({
        url: this.globalData.apiBase + '/api/settings',
        method: 'GET',
        enableCookie: true,
        header: { Authorization: 'Bearer ' + this.globalData.token },
        success: (res) => {
          if (res.statusCode === 200 && res.data) {
            const sem =
              (res.data.currentSemester && res.data.currentSemester.value) ||
              (res.data.current_semester && res.data.current_semester.value) ||
              '';
            if (sem) {
              this.globalData.currentSemester = sem;
              wx.setStorageSync('currentSemester', sem);
            }
          }
          resolve();
        },
        fail: () => resolve(),
      });
    });
  },

  // 简单的登录守卫：未登录则跳转到登录页
  ensureAuth() {
    if (!this.globalData.token) {
      wx.reLaunch({ url: '/pages/login/login' });
      return false;
    }
    return true;
  },
});
