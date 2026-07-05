<template>
  <el-container class="layout-container">
    <el-aside :width="isCollapse ? '64px' : '220px'" class="layout-aside">
      <div class="layout-logo">
        <img src="/icons.svg" alt="Logo" class="logo-icon" />
        <span v-if="!isCollapse">KEC课程管理平台</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        :collapse="isCollapse"
        :background-color="sidebarBg"
        :text-color="sidebarText"
        :active-text-color="sidebarActive"
        router
      >
        <!-- 管理员菜单 -->
        <template v-if="authStore.isAdmin">
          <el-menu-item index="/dashboard">
            <el-icon><HomeFilled /></el-icon>
            <template #title>首页概览</template>
          </el-menu-item>
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

          <!-- 系统管理菜单（所有管理员可见） -->
          <el-sub-menu index="system">
            <template #title>
              <el-icon><Tools /></el-icon>
              <span>系统管理</span>
            </template>
            <!-- 超级管理员专属 -->
            <template v-if="authStore.userInfo?.role === 'super_admin'">
              <el-menu-item index="/settings">
                <el-icon><Setting /></el-icon>
                <template #title>系统设置</template>
              </el-menu-item>
            </template>
            <!-- admin和super_admin都可以访问 -->
            <el-menu-item index="/users">
              <el-icon><UserFilled /></el-icon>
              <template #title>用户管理</template>
            </el-menu-item>
            <!-- 超级管理员专属 -->
            <template v-if="authStore.userInfo?.role === 'super_admin'">
              <el-menu-item index="/audit-logs">
                <el-icon><DocumentChecked /></el-icon>
                <template #title>操作日志</template>
              </el-menu-item>
            </template>
          </el-sub-menu>
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
    </el-aside>
    <el-container>
      <el-header class="layout-header">
        <div class="layout-header-left">
          <el-icon
            class="collapse-icon"
            role="button"
            tabindex="0"
            :aria-label="isCollapse ? '展开菜单' : '折叠菜单'"
            @click="toggleSidebar"
            @keyup.enter="toggleSidebar"
          >
            <Fold v-if="!isCollapse" />
            <Expand v-else />
          </el-icon>
          <span class="header-title">{{ currentTitle }}</span>
        </div>
        <div class="layout-header-right">
          <el-tag v-if="semesterLabel" size="small" type="info">{{ semesterLabel }}</el-tag>
          <el-dropdown aria-haspopup="true" @command="handleCommand">
            <span class="user-info" aria-label="用户菜单">
              <el-icon><User /></el-icon>
              <span class="user-name">{{ authStore.realName || authStore.username }}</span>
              <el-tag size="small" :type="authStore.isAdmin ? 'success' : 'info'">
                {{ authStore.isAdmin ? '管理员' : '访客' }}
              </el-tag>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="layout-main">
        <router-view v-slot="{ Component }">
          <transition name="fade-slide" mode="out-in">
            <keep-alive :include="cachedViews">
              <component :is="Component" :key="$route.fullPath" />
            </keep-alive>
          </transition>
        </router-view>
      </el-main>
      <el-footer class="layout-footer" height="32px">
        <span>KEC课程管理平台 v{{ version }}</span>
      </el-footer>
    </el-container>
  </el-container>

  <!-- 修改密码对话框 -->
  <ChangePasswordDialog v-model="passwordDialogVisible" :forced="authStore.mustChangePassword" @success="handlePasswordChangeSuccess" />

  <!-- 退出登录确认弹窗 -->
  <el-dialog
    v-model="logoutDialogVisible"
    title="退出登录"
    width="min(400px, 90vw)"
    top="30vh"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div style="padding: 4px 0">
      <p style="font-size: 14px; color: var(--text-primary); margin: 0 0 8px">
        <el-icon style="vertical-align: middle; color: var(--brand-warning); margin-right: 6px"
          ><SwitchButton
        /></el-icon>
        当前用户：<strong>{{ authStore.realName || authStore.username }}</strong>
      </p>
      <p style="font-size: 13px; color: var(--text-secondary); margin: 0">
        退出后需重新登录才能使用系统功能。
      </p>
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
const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

// 侧边栏配色绑定（el-menu 属性不支持 CSS 变量，通过 JS 读取令牌）
const sidebarBg =
  getComputedStyle(document.documentElement).getPropertyValue('--sidebar-bg').trim() || '#304156';
const sidebarText =
  getComputedStyle(document.documentElement).getPropertyValue('--sidebar-text').trim() || '#bfcbd9';
const sidebarActive =
  getComputedStyle(document.documentElement).getPropertyValue('--sidebar-active').trim() ||
  '#409eff';

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
const currentTitle = computed(() => route.meta?.title || '首页');
const semesterLabel = computed(() => settingsStore.semesterLabel);

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
  background: var(--sidebar-bg);
  overflow: hidden;
  flex-shrink: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.06);
}

.layout-logo {
  height: 60px;
  min-height: 60px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #fff;
  font-size: 16px;
  font-weight: bold;
  border-bottom: 1px solid var(--sidebar-border);
  flex-shrink: 0;
  overflow: hidden;
  background: var(--sidebar-bg);
  z-index: 10;
}

/* 菜单容器可滚动 */
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

.logo-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
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

.layout-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-light);
  background: var(--bg-card);
  flex-shrink: 0;
  height: 60px;
}

.layout-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.layout-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.collapse-icon {
  cursor: pointer;
  font-size: 20px;
}

/* 用户菜单触发器:图标 / 用户名 / 角色标签 同行垂直居中 */
.user-info {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  outline: none;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease-out);
}

.user-info:hover {
  background: var(--bg-subtle);
}

.user-info:focus-visible {
  background: var(--brand-primary-soft);
}

.user-name {
  font-size: 14px;
  color: var(--text-regular);
  line-height: 1;
}

.header-title {
  font-size: 16px;
  font-weight: 500;
}

.layout-main {
  background: var(--bg-page);
  padding: var(--space-5) var(--space-6);
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  min-height: 0;
}

.layout-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 12px;
  background: var(--bg-card);
  border-top: 1px solid var(--border-light);
  flex-shrink: 0;
}

/* 窄屏头部紧凑排列 */
@media (max-width: 768px) {
  .layout-header {
    height: 50px;
    padding: 0 12px;
  }

  .layout-header-left {
    gap: 10px;
  }

  .header-title {
    font-size: 14px;
  }

  .layout-header-right {
    gap: 8px;
  }

  .layout-main {
    padding: 12px 12px;
  }
}
</style>
