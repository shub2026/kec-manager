// utils/api.js
// 业务接口封装：所有需要 semester 的接口自动注入「当前学期」，
// 学期值优先取 app.globalData.currentSemester，缺失时回退拉取 /api/settings。
const { request } = require('./request.js');

function getAppSemester() {
  const app = getApp();
  return (app && app.globalData && app.globalData.currentSemester) || '';
}

// 学期拉取单例：并发调用时复用同一 Promise，避免重复请求
let _semesterPromise = null;

async function ensureSemester() {
  let sem = getAppSemester();
  if (sem) return sem;
  if (_semesterPromise) return _semesterPromise;
  _semesterPromise = (async () => {
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
      return sem;
    } catch (e) {
      return '';
    } finally {
      _semesterPromise = null;
    }
  })();
  return _semesterPromise;
}

const api = {
  getSettings: () => request({ url: '/api/settings' }),
  getMe: () => request({ url: '/api/auth/me' }),

  // 访客自助注册（创建待激活账号，需管理员激活后登录）
  register(payload) {
    return request({ url: '/api/auth/register', method: 'POST', data: payload });
  },

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
  // remark/default_weekly_hours/affiliated_college_id/status。
  updateTeacher(id, payload) {
    return request({ url: `/api/teachers/${id}`, method: 'PUT', data: payload });
  },

  // 删除教师（仅管理员），DELETE /api/teachers/:id。
  // 后端 teacher.routes.js 已挂载该路由（roleMiddleware admin/super_admin）。
  deleteTeacher(id) {
    return request({ url: `/api/teachers/${id}`, method: 'DELETE' });
  },

  // 学院列表（所有登录用户可查），用于新增教师时选择归属学院
  getColleges() {
    return request({ url: '/api/colleges' });
  },

  // 课程（学科）列表（所有登录用户可查），用于新增/编辑教师时选择可教授课程
  getCourses() {
    return request({ url: '/api/courses' });
  },

  // ===== 培养方案查询（所有登录用户可读，无需改后端） =====
  // 方案列表 GET /api/plans；支持 college_id 过滤（其余筛选前端做）。
  // 注意：后端经 convertResponseNaming 把 snake_case 转 camelCase，
  // 前端拿到 majorId/collegeId/trainingLevelId/courseCount/classCount/applyFromYear 等。
  getPlans(params = {}) {
    const data = {};
    if (params.collegeId) data.college_id = params.collegeId;
    return request({ url: '/api/plans', data });
  },

  // 方案课程明细（含学期与教材）：GET /api/plans/:id/courses
  getPlanCourses(id) {
    return request({ url: `/api/plans/${id}/courses` });
  },

  // 方案学期周数概览：GET /api/plans/:id/semesters
  getPlanSemesters(id) {
    return request({ url: `/api/plans/${id}/semesters` });
  },

  // 课时统计（按教师汇总周课时）
  async getStatistics() {
    const semester = await ensureSemester();
    return request({ url: '/api/teaching-arrange/statistics', data: { semester } });
  },

  // 教学安排 - 课程排课概览（对标 web 端 CourseOverviewGrid 的数据源，只读）
  async getCourseOverview() {
    const semester = await ensureSemester();
    return request({ url: '/api/teaching-arrange/course-overview', data: { semester } });
  },

  // 教学安排 - 单课程逐班安排明细（卡片展开用，只读）
  async getCourseArrangeDetail(courseId) {
    const semester = await ensureSemester();
    return request({ url: '/api/teaching-arrange/classes', data: { courseId, semester } });
  },

  // 课程查询（对标 WEB 端 CourseQuery 页）：按课程聚合各培养方案采用情况
  // GET /api/query/course，筛选参数透传；后端 convertRequestNaming 会自动把
  // camelCase 查询参数转成 snake_case（courseName→course_name 等）。
  async getCourseQuery(params = {}) {
    const data = {};
    if (params.courseName) data.courseName = params.courseName;
    if (params.courseType) data.courseType = params.courseType;
    if (params.collegeId) data.collegeId = params.collegeId;
    if (params.majorId) data.majorId = params.majorId;
    if (params.trainingLevelId) data.trainingLevelId = params.trainingLevelId;
    if (params.planStatus) data.planStatus = params.planStatus;
    return request({ url: '/api/query/course', data });
  },

  // ===== 用户管理（仅超级管理员，后端 roleMiddleware('super_admin') 守门） =====
  // 列表：分页 + keyword 模糊（用户名 / 姓名 / 联系电话）。
  // 按项目约定发 camelCase 参数（pageSize / keyword），后端中间件会自动转 snake。
  listUsers(params = {}) {
    const data = { page: params.page || 1, pageSize: params.pageSize || 20 };
    if (params.keyword) data.keyword = params.keyword;
    return request({ url: '/api/users', data });
  },

  // 创建用户：username / password 必填，realName / phone / role 选填。
  // CSRF 双提交由 request.js 统一处理（自动带 X-CSRF-Token 头 + cookie）。
  // 后端 convertRequestNaming 会把 realName → real_name。
  createUser(payload) {
    return request({ url: '/api/users', method: 'POST', data: payload });
  },

  // 更新用户（仅 super_admin）：realName / phone / role。
  updateUser(id, payload) {
    return request({ url: `/api/users/${id}`, method: 'PUT', data: payload });
  },

  // 启用 / 禁用账号。isActive 经中间件转 is_active。
  updateUserStatus(id, isActive) {
    return request({ url: `/api/users/${id}/status`, method: 'PUT', data: { isActive } });
  },

  // 重置密码（管理员操作，无需原密码）。newPassword 经中间件转 new_password。
  resetUserPassword(id, newPassword) {
    return request({ url: `/api/users/${id}/password`, method: 'PUT', data: { newPassword } });
  },

  // 删除用户。DELETE 请求层已支持（走 CSRF 双提交分支）。
  deleteUser(id) {
    return request({ url: `/api/users/${id}`, method: 'DELETE' });
  },
};

module.exports = api;
