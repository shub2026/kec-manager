// utils/auth.js
// 登录 / 登出封装。登录成功后务必缓存「响应体里的 csrfToken」，
// 否则后续 POST 头/ cookie 不一致会触发 403。
const { request, setToken, setRefresh, setCsrf, clearSession } = require('./request.js');

async function login(username, password) {
  const data = await request({
    url: '/api/auth/login',
    method: 'POST',
    data: { username, password },
  });

  if (data && data.token) setToken(data.token);
  if (data && data.refreshToken) setRefresh(data.refreshToken);
  // 关键：用登录响应里轮换后的 csrfToken 覆盖缓存，保证后续 POST 双提交一致
  if (data && data.csrfToken) setCsrf(data.csrfToken);

  const app = getApp();
  if (app) app.globalData.token = (data && data.token) || '';

  // 存角色：登录响应 user 已带回 role，写入 globalData + storage，供前端权限门控使用
  const role = (data && data.user && data.user.role) || '';
  if (role) {
    if (app) app.globalData.role = role;
    wx.setStorageSync('role', role);
  }

  return data && data.user ? data.user : { username };
}

// 当前用户是否为管理员（admin / super_admin）。
// 角色来源：globalData.role 优先，fallback 到 storage，保证刷新后不丢。
function isAdmin() {
  const app = getApp();
  const role =
    (app && app.globalData && app.globalData.role) ||
    wx.getStorageSync('role') ||
    '';
  return role === 'admin' || role === 'super_admin';
}

function logout() {
  clearSession();
  const app = getApp();
  if (app) app.globalData.token = '';
  wx.reLaunch({ url: '/pages/login/login' });
}

// 登录守卫：未登录跳登录页，返回 false
function guard() {
  const app = getApp();
  if (!app || !app.globalData.token) {
    wx.reLaunch({ url: '/pages/login/login' });
    return false;
  }
  return true;
}

module.exports = { login, logout, guard, isAdmin };
