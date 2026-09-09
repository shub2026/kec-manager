const { API_BASE } = require('./config.js');

// 学期缓存有效期：超过该时长后（切前台/进入页面）会重新向服务器拉取，
// 保证 Web 端修改「当前学期」后小程序能及时同步，而非长期命中本地缓存。
const SEMESTER_TTL_MS = 60 * 1000;

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

    // 进入前台时按需刷新学期：Web 端切换学期后，小程序从后台切回即可同步最新值
    wx.onAppShow(() => {
      if (this.globalData.token) this.refreshSemester();
    });
  },

  /**
   * 拉取系统设置，拿到当前学期（用于所有统计类接口必填的 semester 参数）
   * 启动与登录后强制刷新（force），不走节流
   */
  bootstrapSemester() {
    return this.refreshSemester(true);
  },

  /**
   * 刷新当前学期（默认带 60s 节流，force 时强制重新拉取）
   * @param {boolean} force - 是否忽略节流强制请求
   * @returns {Promise<string>} 拉取后的学期值（可能仍为旧值或 ''）
   */
  refreshSemester(force = false) {
    const now = Date.now();
    if (!this.globalData.token) return Promise.resolve(this.globalData.currentSemester);
    // 节流：距上次拉取不足 TTL 且未强制刷新时直接返回内存值，避免高频重复请求
    if (!force && this._semesterFetchedAt && now - this._semesterFetchedAt < SEMESTER_TTL_MS) {
      return Promise.resolve(this.globalData.currentSemester);
    }
    this._semesterFetchedAt = now;
    return new Promise((resolve) => {
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
          resolve(this.globalData.currentSemester);
        },
        fail: () => resolve(this.globalData.currentSemester),
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
