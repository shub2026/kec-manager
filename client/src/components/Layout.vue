<template>
  <el-container class="layout-container">
    <el-aside :width="isCollapse ? '64px' : '220px'" class="layout-aside">
      <div class="layout-logo">
        <img src="/icons.svg" alt="Logo" class="logo-icon" />
        <span v-if="!isCollapse" class="logo-text">KEC课程管理平台</span>
        <el-icon
          class="collapse-btn"
          role="button"
          tabindex="0"
          :aria-label="isCollapse ? '展开菜单' : '折叠菜单'"
          @click="toggleSidebar"
          @keyup.enter="toggleSidebar"
        >
          <Fold v-if="!isCollapse" />
          <Expand v-else />
        </el-icon>
      </div>
      <el-menu
        :default-active="activeMenu"
        :collapse="isCollapse"
        :background-color="sidebarBg"
        :text-color="sidebarText"
        :active-text-color="sidebarActive"
        router
      >
        <!-- 首页概览（所有用户可见） -->
        <el-menu-item index="/dashboard">
          <el-icon><HomeFilled /></el-icon>
          <template #title>首页概览</template>
        </el-menu-item>

        <!-- 管理员菜单 -->
        <template v-if="authStore.isAdmin">
          <el-sub-menu index="basic">
            <template #title>
              <el-icon><Grid /></el-icon>
              <span>基础数据</span>
            </template>
            <el-menu-item index="/training-levels">培养层次</el-menu-item>
            <el-menu-item index="/majors">专业管理</el-menu-item>
            <el-menu-item index="/colleges">学院管理</el-menu-item>
            <el-menu-item index="/courses">课程管理</el-menu-item>
            <el-menu-item index="/textbooks">教材管理</el-menu-item>
            <el-menu-item index="/classes">班级管理</el-menu-item>
          </el-sub-menu>
          <el-menu-item index="/plans">
            <el-icon><Document /></el-icon>
            <template #title>培养方案</template>
          </el-menu-item>

          <!-- 教学安排模块 -->
          <el-sub-menu index="teaching">
            <template #title>
              <el-icon><Calendar /></el-icon>
              <span>教学安排</span>
            </template>
            <el-menu-item index="/teaching/teachers">教师信息</el-menu-item>
            <el-menu-item index="/teaching/arrange">教学安排</el-menu-item>
            <el-menu-item index="/teaching/statistics">课时统计</el-menu-item>
          </el-sub-menu>

          <!-- 系统管理菜单（超级管理员专属） -->
          <template v-if="authStore.userInfo?.role === 'super_admin'">
            <el-sub-menu index="system">
              <template #title>
                <el-icon><Tools /></el-icon>
                <span>系统管理</span>
              </template>
              <el-menu-item index="/settings">
                <el-icon><Setting /></el-icon>
                <template #title>系统设置</template>
              </el-menu-item>
              <el-menu-item index="/users">
                <el-icon><UserFilled /></el-icon>
                <template #title>用户管理</template>
              </el-menu-item>
              <el-menu-item index="/audit-logs">
                <el-icon><DocumentChecked /></el-icon>
                <template #title>操作日志</template>
              </el-menu-item>
            </el-sub-menu>
          </template>
        </template>

        <!-- 查询报表（所有用户可见） -->
        <el-sub-menu index="query">
          <template #title>
            <el-icon><DataAnalysis /></el-icon>
            <span>查询报表</span>
          </template>
          <el-menu-item index="/query/plan">方案查询</el-menu-item>
          <el-menu-item index="/query/semester">开课查询</el-menu-item>
          <el-menu-item index="/query/textbook">教材查询</el-menu-item>
        </el-sub-menu>
      </el-menu>
      <!-- 侧边栏底部：学期标签 + 用户信息 -->
      <div class="sidebar-footer">
        <div v-if="semesterLabel && !isCollapse" class="sidebar-semester">
          <el-tag size="small" type="info" effect="plain">{{ semesterLabel }}</el-tag>
        </div>
        <el-dropdown
          trigger="click"
          aria-haspopup="true"
          @command="handleCommand"
          :teleported="true"
        >
          <div class="sidebar-user" :class="{ 'is-collapse': isCollapse }" aria-label="用户菜单">
            <span class="user-avatar">{{ avatarChar }}</span>
            <div v-if="!isCollapse" class="user-meta">
              <span class="user-name">{{ authStore.realName || authStore.username }}</span>
              <span class="user-role">{{ authStore.isAdmin ? '管理员' : '访客' }}</span>
            </div>
          </div>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="password">
                <el-icon><Lock /></el-icon>修改密码
              </el-dropdown-item>
              <el-dropdown-item command="logout" divided>
                <el-icon><SwitchButton /></el-icon>退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-aside>
    <el-main class="layout-main">
      <router-view v-slot="{ Component }">
        <transition name="fade-slide" mode="out-in">
          <keep-alive :include="cachedViews">
            <component :is="Component" :key="$route.path" />
          </keep-alive>
        </transition>
      </router-view>
    </el-main>
  </el-container>

  <!-- 修改密码对话框 -->
  <ChangePasswordDialog
    v-model="passwordDialogVisible"
    :forced="authStore.mustChangePassword"
    @success="handlePasswordChangeSuccess"
  />

  <!-- 退出登录确认弹窗 -->
  <el-dialog
    v-model="logoutDialogVisible"
    title="退出登录"
    width="min(400px, 90vw)"
    top="30vh"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div class="logout-body">
      <p class="logout-title">
        <el-icon class="logout-icon"><SwitchButton /></el-icon>
        当前用户：<strong>{{ authStore.realName || authStore.username }}</strong>
      </p>
      <p class="logout-hint">退出后需重新登录才能使用系统功能。</p>
    </div>
    <template #footer>
      <el-button @click="logoutDialogVisible = false">取消</el-button>
      <el-button type="warning" @click="confirmLogout">确认退出</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSettingsStore } from '../stores/settings';
import { useAuthStore } from '../stores/auth';
import { ElMessage } from 'element-plus';
const ChangePasswordDialog = defineAsyncComponent(() => import('./ChangePasswordDialog.vue'));

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();
const authStore = useAuthStore();
const userCollapsed = ref(false); // 用户手动折叠标记
const windowNarrow = ref(false); // 窗口窄屏标记

// 侧边栏配色绑定（el-menu 属性不支持 CSS 变量，通过 JS 读取令牌）
const sidebarBg =
  getComputedStyle(document.documentElement).getPropertyValue('--sidebar-bg').trim() || '#1E293B';
const sidebarText =
  getComputedStyle(document.documentElement).getPropertyValue('--sidebar-text').trim() || '#94A3B8';
const sidebarActive =
  getComputedStyle(document.documentElement).getPropertyValue('--sidebar-active').trim() ||
  '#FFFFFF';

// keep-alive 缓存的列表页组件名（需与各列表组件 defineOptions({ name }) 一致）
const cachedViews = [
  'ClassList',
  'TextbookList',
  'TeacherList',
  'PlanList',
  'CourseList',
  'MajorList',
  'CollegeList',
  'TrainingLevelList',
];

// 侧边栏折叠状态 = 窗口窄屏 || 用户手动折叠
const isCollapse = computed(() => windowNarrow.value || userCollapsed.value);

function toggleSidebar() {
  userCollapsed.value = !userCollapsed.value;
}

// 响应式侧边栏：窄屏自动折叠（用 rAF 节流避免 resize 高频触发）
const SIDEBAR_BREAKPOINT = 1024;
let resizeRaf = null;
function handleResize() {
  if (resizeRaf) window.cancelAnimationFrame(resizeRaf);
  resizeRaf = window.requestAnimationFrame(() => {
    windowNarrow.value = window.innerWidth < SIDEBAR_BREAKPOINT;
  });
}

// 修改密码相关
const passwordDialogVisible = ref(false);
const logoutDialogVisible = ref(false);

const activeMenu = computed(() => route.path);
const semesterLabel = computed(() => settingsStore.semesterLabel);
const avatarChar = computed(() => {
  const name = authStore.realName || authStore.username || '';
  return name.charAt(0).toUpperCase();
});

onMounted(async () => {
  await settingsStore.load();
  handleResize(); // 初始化侧边栏状态
  window.addEventListener('resize', handleResize);

  // 检查是否有权限警告
  const warning = sessionStorage.getItem('permissionWarning');
  if (warning) {
    ElMessage.warning(warning);
    sessionStorage.removeItem('permissionWarning');
  }

  // 首次登录强制修改密码
  if (authStore.mustChangePassword) {
    passwordDialogVisible.value = true;
  }
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
});

function handleCommand(command) {
  if (command === 'password') {
    passwordDialogVisible.value = true;
  } else if (command === 'logout') {
    logoutDialogVisible.value = true;
  }
}

async function confirmLogout() {
  logoutDialogVisible.value = false;
  await authStore.logout();
  ElMessage.success('已退出登录');
}

function handlePasswordChangeSuccess() {
  // 密码修改成功后的处理（已在子组件中处理登出）
}
</script>

<style scoped>
.layout-container {
  height: 100vh;
  overflow: hidden;
  display: flex;
}

.layout-aside {
  transition: width 0.3s ease;
  overflow: hidden;
  flex-shrink: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.layout-logo {
  height: 60px;
  min-height: 60px;
  width: 100%;
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 10px;
  color: var(--bg-card);
  font-size: 15px;
  font-weight: bold;
  border-bottom: 1px solid var(--sidebar-border);
  flex-shrink: 0;
  background: transparent;
  z-index: 10;
}

.logo-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.logo-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}

.collapse-btn {
  flex-shrink: 0;
  font-size: 18px;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.collapse-btn:hover {
  opacity: 1;
}
.layout-aside :deep(.el-menu) {
  width: 100%;
  border-right: none;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 自定义滚动条样式 - 只应用于菜单 */
.layout-aside :deep(.el-menu)::-webkit-scrollbar {
  width: 6px;
}

.layout-aside :deep(.el-menu)::-webkit-scrollbar-track {
  background: var(--sidebar-bg-deep);
}

.layout-aside :deep(.el-menu)::-webkit-scrollbar-thumb {
  background: var(--sidebar-scrollbar);
  border-radius: 3px;
}

.layout-aside :deep(.el-menu)::-webkit-scrollbar-thumb:hover {
  background: var(--sidebar-scrollbar-hover);
}

/* 侧边栏渐变背景 */
.layout-aside {
  background: linear-gradient(180deg, var(--sidebar-bg) 0%, var(--sidebar-bg-deep) 100%);
  box-shadow: var(--shadow-sm);
}

/* 活跃菜单项左侧色条指示器 */
.layout-aside :deep(.el-menu-item.is-active::before) {
  content: '';
  position: absolute;
  left: 0;
  top: var(--space-2);
  bottom: var(--space-2);
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--brand-primary);
  transition: height var(--dur-fast) var(--ease-out);
}

/* 活跃菜单项添加微弱背景 */
.layout-aside :deep(.el-menu-item.is-active) {
  background: rgba(255, 255, 255, 0.06) !important;
}

/* 侧边栏底部 */
.sidebar-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--sidebar-border);
  padding: 10px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar-footer :deep(.el-dropdown) {
  width: 100%;
  display: block;
}

.sidebar-semester {
  display: flex;
  justify-content: center;
  padding: 0 12px;
}

.sidebar-semester :deep(.el-tag) {
  font-size: 12px;
  color: var(--sidebar-text);
  border-color: var(--sidebar-border);
  background: rgba(255, 255, 255, 0.06);
}

.sidebar-user {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 8px 12px;
  width: 100%;
  transition: background var(--dur-fast) var(--ease-out);
}

.sidebar-user:hover {
  background: rgba(255, 255, 255, 0.08);
}

.sidebar-user.is-collapse {
  justify-content: center;
  padding: 8px 0;
}

.user-avatar {
  width: 34px;
  height: 34px;
  border-radius: 4px;
  background: var(--brand-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}

.user-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.user-meta .user-name {
  font-size: 13px;
  color: #e2e8f0;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-meta .user-role {
  font-size: 11px;
  color: var(--sidebar-text);
  line-height: 1.2;
}

/* 确保菜单项占满宽度 */
.layout-aside :deep(.el-menu-item),
.layout-aside :deep(.el-sub-menu__title) {
  width: 100%;
}

/* 折叠时隐藏文字，只显示图标 */
.layout-aside :deep(.el-menu--collapse) .el-menu-item span,
.layout-aside :deep(.el-menu--collapse) .el-sub-menu__title span {
  display: none;
}

.layout-aside :deep(.el-menu--collapse) .el-menu-item .el-sub-menu__icon-arrow,
.layout-aside :deep(.el-menu--collapse) .el-sub-menu__title .el-sub-menu__icon-arrow {
  display: none;
}

.layout-main {
  background: var(--bg-page);
  padding: var(--space-5) var(--space-6);
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  min-height: 0;
}

@media (max-width: 768px) {
  .layout-main {
    padding: var(--space-3) var(--space-3);
  }
}

/* 页面切换 fade-slide 过渡动画 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

.logout-body {
  padding: 4px 0;
}
.logout-title {
  font-size: 14px;
  color: var(--text-primary);
  margin: 0 0 var(--space-2) 0;
}
.logout-icon {
  vertical-align: middle;
  color: var(--brand-warning);
  margin-right: 6px;
}
.logout-hint {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}
</style>
