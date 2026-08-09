// utils/request.js
// KEC 小程序统一请求层
//
// 设计要点（与后端 kec-manager 对齐）：
//  1. 响应统一由 success() 包裹为 { success, message, data }，本层拆包后只返回内层 data。
//  2. GET 请求：自动附带 Authorization: Bearer <token>，无需 CSRF。
//  3. POST/PUT/DELETE：后端全局 validateCsrf 要求 CSRF 双提交
//     —— 头 X-CSRF-Token 与 Cookie XSRF-TOKEN 必须一致且 HMAC 有效。
//     token 由 GET /api/auth/csrf-token 服务端签发，wx cookie jar（enableCookie）自动保存/回传 XSRF-TOKEN。
//  4. 登录响应会轮换 XSRF-TOKEN cookie，因此登录成功后必须把「响应体里的 csrfToken」缓存起来，
//     否则后续 POST 头（旧 token）/ cookie（新 token）不一致会 403。
//  5. 401：仅对 GET 静默 refresh 后重试；POST 鉴权端点（登录/刷新）的 401 直接报错给调用方。
//  6. 403（CSRF 失效）：重新拉取 csrf 后重试一次。
const { API_BASE } = require('../config.js');

const TOKEN_KEY = 'token';
const REFRESH_KEY = 'refreshToken';
const CSRF_KEY = 'csrfToken';

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || '';
}
function setToken(t) {
  if (t) wx.setStorageSync(TOKEN_KEY, t);
  else wx.removeStorageSync(TOKEN_KEY);
}
function getRefresh() {
  return wx.getStorageSync(REFRESH_KEY) || '';
}
function setRefresh(r) {
  if (r) wx.setStorageSync(REFRESH_KEY, r);
  else wx.removeStorageSync(REFRESH_KEY);
}
function getCsrf() {
  return wx.getStorageSync(CSRF_KEY) || '';
}
function setCsrf(c) {
  if (c) wx.setStorageSync(CSRF_KEY, c);
  else wx.removeStorageSync(CSRF_KEY);
}

function clearSession() {
  setToken('');
  setRefresh('');
  setCsrf('');
}

let refreshing = null;

function rawRequest(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_BASE + options.url,
      method: options.method || 'GET',
      data: options.data || {},
      header: options.header || {},
      enableCookie: options.enableCookie !== undefined ? options.enableCookie : true,
      success: (res) => resolve(res),
      fail: (err) => reject({ code: -1, message: '网络错误，请检查网络后重试', detail: err }),
    });
  });
}

async function fetchCsrf() {
  const res = await rawRequest({ url: '/api/auth/csrf-token', method: 'GET' });
  const csrf = res.data && res.data.data && res.data.data.csrfToken;
  if (!csrf) throw { code: 'CSRF', message: '无法获取安全令牌' };
  setCsrf(csrf);
  return csrf;
}

async function doRefresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refreshToken = getRefresh();
    if (!refreshToken) {
      clearSession();
      throw { code: 401, message: '会话已过期' };
    }
    const csrf = getCsrf() || (await fetchCsrf());
    const res = await rawRequest({
      url: '/api/auth/refresh',
      method: 'POST',
      data: { refresh_token: refreshToken },
      header: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      enableCookie: true,
    });
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const d = (res.data && res.data.data) || {};
      if (d.token) setToken(d.token);
      if (d.refreshToken) setRefresh(d.refreshToken);
      return true;
    }
    clearSession();
    throw { code: 401, message: '会话已过期，请重新登录' };
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

function normalize(res) {
  const body = res.data || {};
  return typeof body.data !== 'undefined' ? body.data : body;
}

function rejectErr(res) {
  const body = res.data || {};
  return Promise.reject({
    code: res.statusCode,
    message: (body && body.message) || '请求失败',
  });
}

async function request(options) {
  const method = (options.method || 'GET').toUpperCase();
  const header = Object.assign({ 'Content-Type': 'application/json' }, options.header || {});
  const token = getToken();
  if (token) header['Authorization'] = 'Bearer ' + token;

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    let csrf = getCsrf();
    if (!csrf) csrf = await fetchCsrf();
    header['X-CSRF-Token'] = csrf;
  }

  let res = await rawRequest({
    url: options.url,
    method,
    data: options.data || {},
    header,
    enableCookie: true,
  });

  if (res.statusCode >= 200 && res.statusCode < 300) return normalize(res);

  if (res.statusCode === 401) {
    // 仅 GET 触发静默刷新；登录/刷新等鉴权 POST 的 401 视为凭据错误，直接抛给调用方
    if (method === 'GET') {
      try {
        await doRefresh();
      } catch (e) {
        wx.reLaunch({ url: '/pages/login/login' });
        return Promise.reject(e);
      }
      const h2 = Object.assign({ 'Content-Type': 'application/json' }, options.header || {});
      const t = getToken();
      if (t) h2['Authorization'] = 'Bearer ' + t;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) h2['X-CSRF-Token'] = getCsrf();
      res = await rawRequest({ url: options.url, method, data: options.data || {}, header: h2, enableCookie: true });
      if (res.statusCode >= 200 && res.statusCode < 300) return normalize(res);
    }
    return rejectErr(res);
  }

  if (res.statusCode === 403 && !options._csrfRetry) {
    const csrf = await fetchCsrf();
    const h3 = Object.assign({}, header, { 'X-CSRF-Token': csrf });
    const retry = await rawRequest({ url: options.url, method, data: options.data || {}, header: h3, enableCookie: true });
    if (retry.statusCode >= 200 && retry.statusCode < 300) return normalize(retry);
    return rejectErr(retry);
  }

  return rejectErr(res);
}

module.exports = {
  request,
  rawRequest,
  fetchCsrf,
  getToken,
  setToken,
  getRefresh,
  setRefresh,
  getCsrf,
  setCsrf,
  clearSession,
};
