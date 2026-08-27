<template>
  <el-container class="layout-container">
    <!-- 窄屏顶部栏：汉堡按钮 + Logo + 用户头像 -->
    <header v-if="isMobile" class="mobile-header">
      <button class="mobile-menu-btn" aria-label="打开菜单" @click="drawerVisible = true">
        <el-icon :size="22"><Expand /></el-icon>
      </button>
      <div class="mobile-brand">
        <img src="/icons.svg" alt="" class="logo-icon" />
        <span class="mobile-title">KEC课程管理平台</span>
      </div>
      <el-dropdown trigger="click" :teleported="true" @command="handleCommand">
        <button type="button" class="mobile-avatar" aria-label="用户菜单">
          <el-icon :size="18"><UserFilled /></el-icon>
        </button>
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
    </header>

    <!-- 桌面侧边栏：固定 + 折叠模式 -->
    <el-aside v-if="!isMobile" :width="isCollapse ? '64px' : '220px'" class="layout-aside">
      <div class="layout-logo" :class="{ 'is-collapsed': isCollapse }">
        <img src="/icons.svg" alt="" class="logo-icon" />
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
        unique-opened
        router
      >
        <SideMenuContent />
      </el-menu>
      <div class="sidebar-footer">
        <div v-if="semesterLabel && !isCollapse" class="sidebar-semester">
          <el-tag size="small" type="info" effect="plain" disable-transitions>{{
            semesterLabel
          }}</el-tag>
        </div>
        <el-dropdown
          trigger="click"
          aria-haspopup="true"
          :teleported="true"
          @command="handleCommand"
        >
          <div class="sidebar-user" :class="{ 'is-collapse': isCollapse }" aria-label="用户菜单">
            <span class="user-avatar">
              <el-icon :size="18"><UserFilled /></el-icon>
            </span>
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

    <!-- 窄屏抽屉式侧边栏：滑出 + 遮罩 -->
    <el-drawer
      v-model="drawerVisible"
      direction="ltr"
      :size="260"
      :with-header="false"
      modal-class="mobile-drawer"
    >
      <div class="drawer-aside">
        <div class="layout-logo">
          <img src="/icons.svg" alt="" class="logo-icon" />
          <span class="logo-text">KEC课程管理平台</span>
          <el-icon
            class="collapse-btn"
            role="button"
            tabindex="0"
            aria-label="关闭菜单"
            @click="drawerVisible = false"
            @keyup.enter="drawerVisible = false"
          >
            <Fold />
          </el-icon>
        </div>
        <el-menu
          :default-active="activeMenu"
          :background-color="sidebarBg"
          :text-color="sidebarText"
          :active-text-color="sidebarActive"
          unique-opened
          router
          @select="drawerVisible = false"
        >
          <SideMenuContent />
        </el-menu>
        <div class="sidebar-footer">
          <div v-if="semesterLabel" class="sidebar-semester">
            <el-tag size="small" type="info" effect="plain" disable-transitions>{{
              semesterLabel
            }}</el-tag>
          </div>
          <div class="sidebar-user">
            <span class="user-avatar">
              <el-icon :size="18"><UserFilled /></el-icon>
            </span>
            <div class="user-meta">
              <span class="user-name">{{ authStore.realName || authStore.username }}</span>
              <span class="user-role">{{ authStore.isAdmin ? '管理员' : '访客' }}</span>
            </div>
          </div>
        </div>
      </div>
    </el-drawer>

    <el-main class="layout-main" :class="{ 'has-mobile-header': isMobile }">
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
    width="var(--dialog-width)"
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
      <el-button type="primary" @click="confirmLogout">确认退出</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted, defineAsyncComponent } from 'vue';
import { useRoute } from 'vue-router';
import { useSettingsStore } from '../stores/settings';
import { useAuthStore } from '../stores/auth';
import { useResponsive } from '../composables/useResponsive';
import { ElMessage } from 'element-plus';
import SideMenuContent from './SideMenuContent.vue';
const ChangePasswordDialog = defineAsyncComponent(() => import('./ChangePasswordDialog.vue'));

const route = useRoute();
const settingsStore = useSettingsStore();
const authStore = useAuthStore();
const userCollapsed = ref(false); // 用户手动折叠标记（仅桌面）

// 响应式：使用统一的 useResponsive，断点体系单一真相源
const { isMobile } = useResponsive();

// 窄屏抽屉式侧边栏
const drawerVisible = ref(false);

// 侧边栏配色绑定（el-menu 属性不支持 CSS 变量，通过 JS 读取令牌）
// 改为 computed：主题变更时可重新读取，避免模块初始化时一次性读取的陈旧值
function _readVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
const sidebarBg = computed(() => _readVar('--sidebar-bg'));
const sidebarText = computed(() => _readVar('--sidebar-text'));
const sidebarActive = computed(() => _readVar('--sidebar-active'));

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

// 桌面侧边栏折叠状态 = 用户手动折叠（窄屏走抽屉，不再用折叠态）
const isCollapse = computed(() => userCollapsed.value);

function toggleSidebar() {
  userCollapsed.value = !userCollapsed.value;
}

// 修改密码相关
const passwordDialogVisible = ref(false);
const logoutDialogVisible = ref(false);

const activeMenu = computed(() => route.path);
const semesterLabel = computed(() => settingsStore.semesterLabel);

onMounted(async () => {
  await settingsStore.load();

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
  height: 100dvh;
  overflow: hidden;
  display: flex;
}

/* ==================== 窄屏顶部栏 ==================== */
.mobile-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--mobile-header-height);
  z-index: var(--z-fixed-header);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-light);
  box-shadow: var(--shadow-xs);
}

.mobile-menu-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-regular);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.mobile-menu-btn:hover {
  background: var(--bg-subtle);
  color: var(--brand-primary);
}

.mobile-brand {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mobile-title {
  font-size: var(--font-size-subtitle);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mobile-avatar {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: var(--radius-sm);
  padding: 0;
  /* 玻璃灰中性风的浅色顶栏对应版：白底上玻璃白会消失，改中性浅灰底+细描边(镜像桌面端结构)，深灰图标对比度≈7.9:1 */
  background: var(--bg-subtle);
  box-shadow: inset 0 0 0 1px var(--border-light);
  color: var(--text-regular);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: var(--fw-semibold);
  flex-shrink: 0;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.mobile-avatar:hover {
  background: var(--brand-primary-soft);
  color: var(--brand-primary);
}

.mobile-avatar:active {
  background: var(--bg-subtle);
}

.mobile-avatar:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}

/* ==================== 桌面侧边栏 ==================== */
.layout-aside {
  transition: width 0.3s ease;
  overflow: hidden;
  flex-shrink: 0;
  height: 100vh;
  height: 100dvh;
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
  color: var(--text-primary);
  font-size: var(--font-size-subtitle);
  font-weight: var(--fw-bold);
  border-bottom: 1px solid var(--sidebar-border);
  flex-shrink: 0;
  background: transparent;
  z-index: var(--z-toolbar);
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

/* 折叠/展开按钮:24×24 触达区 + hover 浅蓝底,替代纯图标低可发现性 */
.collapse-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  font-size: 16px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--sidebar-text);
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.collapse-btn:hover {
  background: var(--sidebar-active-bg);
  color: var(--sidebar-active);
}

/* 折叠态 logo 区竖排:64px 宽扣除 padding 仅剩 40px,容不下"图标+按钮"横排(60px),改为上下排布 */
.layout-logo.is-collapsed {
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 0 8px;
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
  border-radius: var(--radius-sm);
}

.layout-aside :deep(.el-menu)::-webkit-scrollbar-thumb:hover {
  background: var(--sidebar-scrollbar-hover);
}

/* 侧边栏浅色背景 + 右侧细分隔线（quiet chrome：与内容区同源中性色） */
.layout-aside {
  background: var(--sidebar-bg);
  border-right: 1px solid var(--sidebar-border);
  box-shadow: var(--shadow-xs);
}

/* 菜单项 hover 中性浅灰（低噪音），激活项除外保持浅蓝 */
.layout-aside :deep(.el-menu-item:not(.is-active):hover),
.layout-aside :deep(.el-sub-menu__title:hover) {
  background: var(--bg-subtle);
}

/* 活跃菜单项左侧色条指示器 */
.layout-aside :deep(.el-menu-item.is-active::before) {
  content: '';
  position: absolute;
  left: 0;
  top: var(--space-2);
  bottom: var(--space-2);
  width: 3px;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--brand-primary);
  transition: height var(--dur-fast) var(--ease-out);
}

/* 活跃菜单项：满宽浅蓝底 + 品牌蓝字加粗（Ant Design Pro light 经典选中态） */
.layout-aside :deep(.el-menu-item.is-active) {
  background: var(--sidebar-active-bg);
  font-weight: var(--fw-semibold);
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
  font-size: var(--font-size-caption);
  color: var(--sidebar-text);
  border-color: var(--sidebar-border);
  background: var(--bg-subtle);
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
  background: var(--bg-subtle);
}

.sidebar-user.is-collapse {
  justify-content: center;
  padding: 8px 0;
}

.user-avatar {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  /* 浅色侧边栏版：白底+细描边（与移动端顶栏头像镜像），深灰图标对比度≈7.9:1 */
  background: var(--bg-card);
  box-shadow: inset 0 0 0 1px var(--border-light);
  color: var(--text-regular);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: var(--fw-semibold);
  flex-shrink: 0;
}

.user-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.user-meta .user-name {
  font-size: var(--font-size-body-sm);
  color: var(--sidebar-text-strong);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-meta .user-role {
  font-size: var(--font-size-micro);
  color: var(--sidebar-text);
  line-height: 1.2;
}

/* 菜单项:占满宽度 + 40px 紧凑行高(EP 默认 56px 在浅色侧边栏中偏空旷,对齐 shadcn/Ant Design 主流行高) */
.layout-aside :deep(.el-menu-item),
.layout-aside :deep(.el-sub-menu__title) {
  width: 100%;
  height: 40px;
  line-height: 40px;
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

/* 窄屏：为固定顶部栏留出空间 */
.layout-main.has-mobile-header {
  padding-top: calc(var(--mobile-header-height) + var(--space-3));
}

@media (max-width: 768px) {
  .layout-main {
    padding: calc(var(--mobile-header-height) + var(--space-3)) var(--space-3) var(--space-3);
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
  font-size: var(--font-size-body);
  color: var(--text-primary);
  margin: 0 0 var(--space-2) 0;
}
.logout-icon {
  vertical-align: middle;
  color: var(--brand-warning);
  margin-right: 6px;
}
.logout-hint {
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
  margin: 0;
}
</style>

<style>
/* ==================== 窄屏抽屉全局样式（非 scoped，因 drawer 渲染到 body） ==================== */
.mobile-drawer .el-drawer__body {
  padding: 0;
}

.drawer-aside {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--sidebar-bg);
}

.drawer-aside .layout-logo {
  color: var(--text-primary);
}

.drawer-aside .el-menu {
  flex: 1;
  border-right: none;
  overflow-y: auto;
  overflow-x: hidden;
  background: transparent;
}

/* 抽屉版菜单项与桌面侧边栏同 40px 行高(抽屉渲染在 body 下,需在非 scoped 块声明) */
.drawer-aside .el-menu-item,
.drawer-aside .el-sub-menu__title {
  height: 40px;
  line-height: 40px;
}

.drawer-aside .el-menu::-webkit-scrollbar {
  width: 6px;
}

.drawer-aside .el-menu::-webkit-scrollbar-thumb {
  background: var(--sidebar-scrollbar);
  border-radius: var(--radius-sm);
}

.drawer-aside .el-menu-item.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: var(--space-2);
  bottom: var(--space-2);
  width: 3px;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--brand-primary);
}

.drawer-aside .el-menu-item:not(.is-active):hover,
.drawer-aside .el-sub-menu__title:hover {
  background: var(--bg-subtle);
}

.drawer-aside .el-menu-item.is-active {
  background: var(--sidebar-active-bg);
  font-weight: var(--fw-semibold);
}

.drawer-aside .sidebar-user {
  cursor: default;
}

.drawer-aside .sidebar-user:hover {
  background: transparent;
}

/* 折叠态弹出子菜单(popper 渲染在 body 下):与侧边栏 40px 行高及选中/hover 态视觉一致 */
.el-menu--popup .el-menu-item {
  height: 40px;
  line-height: 40px;
}

.el-menu--popup .el-menu-item:not(.is-active):hover {
  background: var(--bg-subtle);
}

.el-menu--popup .el-menu-item.is-active {
  background: var(--sidebar-active-bg);
  font-weight: var(--fw-semibold);
}
</style>
