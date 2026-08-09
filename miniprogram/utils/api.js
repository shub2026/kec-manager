// utils/api.js
// 业务接口封装：所有需要 semester 的接口自动注入「当前学期」，
// 学期值优先取 app.globalData.currentSemester，缺失时回退拉取 /api/settings。
const { request } = require('./request.js');

function getAppSemester() {
  const app = getApp();
  return (app && app.globalData && app.globalData.currentSemester) || '';
}

async function ensureSemester() {
  let sem = getAppSemester();
  if (sem) return sem;
  try {
    const data = await request({ url: '/api/settings' });
    sem =
      (data && data.currentSemester && data.currentSemester.value) ||
      (data && data.current_semester && data.current_semester.value) ||
      '';
    if (sem) {
      const app = getApp();
      if (app) app.globalData.currentSemester = sem;
      wx.setStorageSync('currentSemester', sem);
    }
  } catch (e) {
    sem = '';
  }
  return sem;
}

const api = {
  getSettings: () => request({ url: '/api/settings' }),
  getMe: () => request({ url: '/api/auth/me' }),

  // 首页概览（指标条）
  async getStats() {
    const semester = await ensureSemester();
    return request({ url: '/api/dashboard/stats', data: { semester } });
  },

  // 首页洞察（完成度 / 异常 / 分布）
  async getInsights() {
    const semester = await ensureSemester();
    return request({ url: '/api/dashboard/insights', data: { semester } });
  },

  // 开课查询（分页 + 年级筛选）
  async getSemesterClasses(params = {}) {
    const semester = await ensureSemester();
    const data = { semester, page: params.page || 1, pageSize: params.pageSize || 20 };
    if (params.grade) data.grade = params.grade;
    return request({ url: '/api/query/semester', data });
  },

  // 教材使用情况（按教材查开课班级）
  async getTextbookUsage(id) {
    const semester = await ensureSemester();
    return request({ url: `/api/query/textbook/${id}`, data: { semester } });
  },

  // 教材列表（搜索 + 分页）
  listTextbooks(params = {}) {
    const data = { page: params.page || 1, pageSize: params.pageSize || 20 };
    if (params.title) data.title = params.title;
    return request({ url: '/api/textbooks', data });
  },

  // 教师名册（分页 + 姓名模糊 / 人员类别筛选）
  // 注意：按项目约定发 camelCase 参数（name / personnelType），
  // 后端 convertRequestNaming 中间件会自动转成 snake（personnel_type）。
  listTeachers(params = {}) {
    const data = { page: params.page || 1, pageSize: params.pageSize || 20 };
    if (params.name) data.name = params.name;
    if (params.personnelType) data.personnelType = params.personnelType;
    return request({ url: '/api/teachers', data });
  },

  // 新增教师（仅管理员），POST /api/teachers。
  // CSRF 双提交由 request.js 统一处理（自动带 X-CSRF-Token 头 + cookie）。
  createTeacher(payload) {
    return request({ url: '/api/teachers', method: 'POST', data: payload });
  },

  // 更新教师（仅管理员），PUT /api/teachers/:id。
  // 后端 updateTeacher 白名单：name/gender/birth_date/personnel_type/
  // qualification_type/default_weekly_hours/affiliated_college_id/status。
  updateTeacher(id, payload) {
    return request({ url: `/api/teachers/${id}`, method: 'PUT', data: payload });
  },

  // 学院列表（所有登录用户可查），用于新增教师时选择归属学院
  getColleges() {
    return request({ url: '/api/colleges' });
  },

  // 课程（学科）列表（所有登录用户可查），用于新增/编辑教师时选择可教授课程
  getCourses() {
    return request({ url: '/api/courses' });
  },

  // 课时统计（按教师汇总周课时）
  async getStatistics() {
    const semester = await ensureSemester();
    return request({ url: '/api/teaching-arrange/statistics', data: { semester } });
  },
};

module.exports = api;
