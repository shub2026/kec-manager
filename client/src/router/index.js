import { createRouter, createWebHistory } from 'vue-router';
import NProgress from 'nprogress';
import 'nprogress/nprogress.css';
import Layout from '../components/Layout.vue';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';

NProgress.configure({ showSpinner: false, trickleSpeed: 200 });

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { title: '登录', requiresAuth: false },
  },
  {
    path: '/',
    component: Layout,
    redirect: '/dashboard',
    meta: { requiresAuth: true },
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('../views/Dashboard.vue'),
        meta: { title: '首页' },
      },
      {
        path: 'majors',
        name: 'Majors',
        component: () => import('../views/major/MajorList.vue'),
        meta: { title: '专业管理', requiresAdmin: true },
      },
      {
        path: 'colleges',
        name: 'Colleges',
        component: () => import('../views/college/CollegeList.vue'),
        meta: { title: '学院管理', requiresAdmin: true },
      },
      {
        path: 'training-levels',
        name: 'TrainingLevels',
        component: () => import('../views/trainingLevel/TrainingLevelList.vue'),
        meta: { title: '培养层次', requiresAdmin: true },
      },
      {
        path: 'courses',
        name: 'Courses',
        component: () => import('../views/course/CourseList.vue'),
        meta: { title: '课程管理', requiresAdmin: true },
      },
      {
        path: 'textbooks',
        name: 'Textbooks',
        component: () => import('../views/textbook/TextbookList.vue'),
        meta: { title: '教材管理', requiresAdmin: true },
      },
      {
        path: 'classes',
        name: 'Classes',
        component: () => import('../views/class/ClassList.vue'),
        meta: { title: '班级管理', requiresAdmin: true },
      },
      {
        path: 'plans',
        name: 'Plans',
        component: () => import('../views/plan/PlanList.vue'),
        meta: { title: '培养方案', requiresAdmin: true },
      },
      {
        path: 'plans/:id',
        name: 'PlanDetail',
        component: () => import('../views/plan/PlanDetail.vue'),
        meta: { title: '方案明细', requiresAdmin: true },
      },
      // 教学安排模块
      {
        path: 'teaching/teachers',
        name: 'Teachers',
        component: () => import('../views/teaching/TeacherList.vue'),
        meta: { title: '教师信息', requiresAdmin: true },
      },
      {
        path: 'teaching/arrange',
        name: 'TeachingArrange',
        component: () => import('../views/teaching/TeachingArrange.vue'),
        meta: { title: '教学安排', requiresAdmin: true },
      },
      {
        path: 'teaching/statistics',
        name: 'TeachingStatistics',
        component: () => import('../views/teaching/TeachingStatistics.vue'),
        meta: { title: '课时统计', requiresAdmin: true },
      },
      {
        path: 'query/plan',
        name: 'PlanQuery',
        component: () => import('../views/query/PlanQuery.vue'),
        meta: { title: '方案查询' },
      },
      {
        path: 'query/semester',
        name: 'SemesterQuery',
        component: () => import('../views/query/UnifiedSemesterQuery.vue'),
        meta: { title: '开课查询' },
      },
      { path: 'query/historical-semester', redirect: '/query/semester' },
      {
        path: 'query/textbook',
        name: 'TextbookQuery',
        component: () => import('../views/query/UnifiedTextbookQuery.vue'),
        meta: { title: '教材查询' },
      },
      { path: 'query/historical-textbook', redirect: '/query/textbook' },
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('../views/settings/SystemSettings.vue'),
        meta: { title: '系统设置', requiresSuperAdmin: true },
      },
      {
        path: 'audit-logs',
        name: 'AuditLogs',
        component: () => import('../views/system/AuditLog.vue'),
        meta: { title: '操作日志', requiresSuperAdmin: true },
      },
      {
        path: 'users',
        name: 'Users',
        component: () => import('../views/system/UserManagement.vue'),
        meta: { title: '用户管理', requiresAdmin: true },
      },
    ],
  },
  // 404 路由 - 必须放在最后
  {
    path: '/:pathMatch(.*)*',
    component: () => import('@/views/NotFound.vue'),
    meta: { title: '页面不存在', requiresAuth: false },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;
    return { top: 0 };
  },
});

// 全局前置守卫（包 try-catch 防止守卫异常导致白屏）
router.beforeEach(async (to, from, next) => {
  NProgress.start();
  try {
    const authStore = useAuthStore();

    // 设置页面标题
    document.title = to.meta.title ? `${to.meta.title} · KEC课程管理平台` : 'KEC课程管理平台';

    // 如果访问登录页且已登录，跳转到首页
    if (to.path === '/login') {
      if (authStore.isLoggedIn) {
        next('/');
      } else {
        next();
      }
      return;
    }

    // 检查是否需要认证
    if (to.meta.requiresAuth !== false) {
      // 未登录，跳转到登录页
      // isLoggedIn 检查 token；userInfo 兜底：
      // initAuth 可能通过后端 HttpOnly cookie 恢复了用户信息但 JS token 不可读
      if (!authStore.isLoggedIn && !authStore.userInfo) {
        next({
          path: '/login',
          query: { redirect: to.fullPath },
        });
        return;
      }

      // S-01 修复：refreshToken 已完全由 HttpOnly Cookie 管理，不再存储于 JS 内存
      // 当 access token 过期或为空时，尝试通过 HttpOnly Cookie 刷新
      // P1-2 修复：token 过期时始终尝试刷新，不再受 userInfo 缓存状态影响
      // 原先条件 `&& !authStore.userInfo` 导致 F5 后 userInfo 已缓存时跳过刷新，
      // 后续请求携带过期 token 必然 401
      if (!authStore.token || authStore.isTokenExpired(authStore.token)) {
        if (localStorage.getItem('loggedIn') === 'true') {
          // 浏览器会自动携带 HttpOnly refreshToken Cookie，尝试刷新
          const refreshed = await authStore.refreshAccessToken();
          if (!refreshed) {
            next({
              path: '/login',
              query: { redirect: to.fullPath },
            });
            return;
          }
        } else {
          next({
            path: '/login',
            query: { redirect: to.fullPath },
          });
          return;
        }
      }

      // 确保用户信息已加载
      if (!authStore.userInfo) {
        // 并行加载用户信息 + 系统设置，减少首屏串行等待
        const settingsStore = useSettingsStore();
        await Promise.all([authStore.fetchUserInfo(), settingsStore.load()]);
      }

      // 再次检查用户信息是否加载成功
      if (!authStore.userInfo) {
        next({
          path: '/login',
          query: { redirect: to.fullPath },
        });
        return;
      }

      // 检查是否需要超级管理员权限
      if (to.meta.requiresSuperAdmin && authStore.userInfo.role !== 'super_admin') {
        sessionStorage.setItem('permissionWarning', '此功能仅限超级管理员访问');
        next('/dashboard');
        return;
      }

      // 检查是否需要管理员权限（admin或super_admin）
      // 使用 userInfo.role 直接判断，避免计算属性的时序问题
      const userRole = authStore.userInfo.role;
      const hasAdminRole = userRole === 'admin' || userRole === 'super_admin';

      if (to.meta.requiresAdmin && !hasAdminRole) {
        sessionStorage.setItem('permissionWarning', '您没有权限访问此页面');
        next('/dashboard');
        return;
      }
    }

    next();
  } catch (err) {
    // 守卫异常时安全降级，跳登录页避免白屏
    if (import.meta.env.DEV) {
      console.error('[Router Guard Error]', err);
    }
    NProgress.done();
    next('/login');
  }
});

router.afterEach(() => {
  NProgress.done();
});

export default router;
