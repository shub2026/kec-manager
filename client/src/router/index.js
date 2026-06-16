import { createRouter, createWebHistory } from 'vue-router'
import Layout from '../components/Layout.vue'
import { useAuthStore } from '../stores/auth'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { title: '登录', requiresAuth: false }
  },
  {
    path: '/',
    component: Layout,
    redirect: (to) => {
      // 使用Pinia store而不是全局变量
      const authStore = useAuthStore()
      if (authStore.userInfo?.role === 'viewer') {
        return '/query/semester'
      }
      return '/dashboard'
    },
    meta: { requiresAuth: true },
    children: [
      { path: 'dashboard', name: 'Dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '首页', requiresAdmin: true } },
      { path: 'majors', name: 'Majors', component: () => import('../views/major/MajorList.vue'), meta: { title: '专业管理', requiresAdmin: true } },
      { path: 'colleges', name: 'Colleges', component: () => import('../views/college/CollegeList.vue'), meta: { title: '学院管理', requiresAdmin: true } },
      { path: 'training-levels', name: 'TrainingLevels', component: () => import('../views/trainingLevel/TrainingLevelList.vue'), meta: { title: '培养层次', requiresAdmin: true } },
      { path: 'courses', name: 'Courses', component: () => import('../views/course/CourseList.vue'), meta: { title: '课程管理', requiresAdmin: true } },
      { path: 'textbooks', name: 'Textbooks', component: () => import('../views/textbook/TextbookList.vue'), meta: { title: '教材管理', requiresAdmin: true } },
      { path: 'classes', name: 'Classes', component: () => import('../views/class/ClassList.vue'), meta: { title: '班级管理', requiresAdmin: true } },
      { path: 'plans', name: 'Plans', component: () => import('../views/plan/PlanList.vue'), meta: { title: '培养方案', requiresAdmin: true } },
      { path: 'plans/:id', name: 'PlanDetail', component: () => import('../views/plan/PlanDetail.vue'), meta: { title: '方案明细', requiresAdmin: true } },
      { path: 'query/plan', name: 'PlanQuery', component: () => import('../views/query/PlanQuery.vue'), meta: { title: '培养方案查询' } },
      { path: 'query/semester', name: 'SemesterQuery', component: () => import('../views/query/UnifiedSemesterQuery.vue'), meta: { title: '开课查询' } },
      { path: 'query/historical-semester', redirect: '/query/semester' },
      { path: 'query/textbook', name: 'TextbookQuery', component: () => import('../views/query/UnifiedTextbookQuery.vue'), meta: { title: '教材使用查询' } },
      { path: 'query/historical-textbook', redirect: '/query/textbook' },
      { path: 'settings', name: 'Settings', component: () => import('../views/settings/SystemSettings.vue'), meta: { title: '系统设置', requiresSuperAdmin: true } },
      { path: 'audit-logs', name: 'AuditLogs', component: () => import('../views/system/AuditLog.vue'), meta: { title: '操作日志', requiresSuperAdmin: true } },
      { path: 'users', name: 'Users', component: () => import('../views/system/UserManagement.vue'), meta: { title: '用户管理', requiresAdmin: true } },
    ],
  },
  // 404 路由 - 必须放在最后
  {
    path: '/:pathMatch(.*)*',
    component: () => import('@/views/NotFound.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 全局前置守卫
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()

  // 设置页面标题
  document.title = to.meta.title ? `${to.meta.title} - KEC课程管理平台` : 'KEC课程管理平台'

  // 如果访问登录页且已登录，跳转到首页
  if (to.path === '/login') {
    if (authStore.isLoggedIn) {
      next('/')
    } else {
      next()
    }
    return
  }

  // 检查是否需要认证
  if (to.meta.requiresAuth !== false) {
    // 未登录，跳转到登录页
    if (!authStore.isLoggedIn) {
      next({
        path: '/login',
        query: { redirect: to.fullPath }
      })
      return
    }

    // 确保用户信息已加载
    if (!authStore.userInfo) {
      await authStore.fetchUserInfo()
    }

    // 再次检查用户信息是否加载成功
    if (!authStore.userInfo) {
      next({
        path: '/login',
        query: { redirect: to.fullPath }
      })
      return
    }

    // 检查是否需要超级管理员权限
    if (to.meta.requiresSuperAdmin && authStore.userInfo.role !== 'super_admin') {
      sessionStorage.setItem('permissionWarning', '此功能仅限超级管理员访问')
      next('/query/semester')
      return
    }

    // 检查是否需要管理员权限（admin或super_admin）
    // 使用userInfo.role直接判断，避免计算属性的时序问题
    const userRole = authStore.userInfo.role
    const hasAdminRole = userRole === 'admin' || userRole === 'super_admin'
    
    if (to.meta.requiresAdmin && !hasAdminRole) {
      sessionStorage.setItem('permissionWarning', '您没有权限访问此页面')
      next('/query/semester')
      return
    }
  }

  next()
})

export default router
