<template>
  <div class="login-page">
    <!-- 左侧装饰（绝对定位，不影响居中布局） -->
    <div class="deco-area" aria-hidden="true">
      <div class="deco-circle deco-c1"></div>
      <div class="deco-circle deco-c2"></div>
      <div class="deco-circle deco-c3"></div>
      <div class="deco-line deco-l1"></div>
      <div class="deco-line deco-l2"></div>
      <div class="deco-dot deco-d1"></div>
      <div class="deco-dot deco-d2"></div>
      <div class="deco-dot deco-d3"></div>
    </div>

    <div class="login-container">
      <!-- 顶部品牌 -->
      <div class="brand">
        <div class="brand-logo">
          <img src="/icons.svg" alt="" />
        </div>
        <div class="brand-info">
          <h1 class="brand-name">KEC 课程管理平台</h1>
          <p class="brand-tagline">课程编排 &middot; 培养方案 &middot; 教材管理</p>
        </div>
      </div>

      <!-- 表单区 -->
      <div class="login-card">
        <div class="card-accent"></div>

        <div class="card-header">
          <h2>{{ organizationName }}</h2>
        </div>

        <el-form
          ref="formRef"
          :model="loginForm"
          :rules="rules"
          class="login-form"
          label-position="top"
          aria-label="用户登录表单"
        >
          <el-form-item label="用户名" prop="username">
            <el-input
              v-model="loginForm.username"
              placeholder="请输入用户名"
              size="large"
              clearable
              :prefix-icon="User"
              @keyup.enter="handleLogin"
            />
          </el-form-item>

          <el-form-item label="密码" prop="password">
            <el-input
              v-model="loginForm.password"
              type="password"
              placeholder="请输入密码"
              size="large"
              show-password
              :prefix-icon="Key"
              @keyup.enter="handleLogin"
            />
          </el-form-item>

          <el-form-item>
            <el-button
              type="primary"
              size="large"
              :loading="loading"
              class="login-btn"
              aria-label="登录"
              @click="handleLogin"
            >
              {{ loading ? '登录中...' : '登 录' }}
            </el-button>
          </el-form-item>
        </el-form>

        <!-- 账号提示（仅开发环境显示，凭据从本地环境变量读取） -->
        <div v-if="showTestAccounts && devAccountHint" class="account-hint">
          <el-collapse>
            <el-collapse-item title="测试账号" name="1">
              <div class="hint-body">
                <div class="hint-row">
                  <span>{{ devAccountHint }}</span>
                </div>
              </div>
            </el-collapse-item>
          </el-collapse>
        </div>
      </div>

      <!-- 底部 -->
      <footer class="page-footer">
        <span>KEC Platform v{{ appVersion }}</span>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';
import { User, Key } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();

const formRef = ref(null);
const loading = ref(false);
const organizationName = ref('欢迎回来');
const showTestAccounts = import.meta.env.DEV;
const devAccountHint = import.meta.env.VITE_DEV_ACCOUNT_HINT || '';
const appVersion = ref(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev');

const loginForm = reactive({
  username: '',
  password: '',
});

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, message: '密码长度至少8位', trigger: 'blur' },
  ],
};

async function handleLogin() {
  if (!formRef.value) return;

  try {
    await formRef.value.validate();
  } catch {
    return;
  }

  loading.value = true;

  try {
    const result = await authStore.login(loginForm.username, loginForm.password);

    if (result.success) {
      ElMessage.success('登录成功');
      // 仅允许站内相对路径跳转，防止开放重定向
      const redirect = route.query.redirect;
      const safeRedirect =
        typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')
          ? redirect
          : '/';
      router.push(safeRedirect);
    } else {
      ElMessage.error(result.message);
    }
  } catch (error) {
    // 兜底：确保登录失败时一定有提示（拦截器对 /auth/login 的 401 不弹窗）
    const msg = error?.response?.data?.message || error?.message || '登录失败，请稍后重试';
    ElMessage.error(msg);
  } finally {
    loading.value = false;
  }
}

async function loadOrganizationName() {
  try {
    await settingsStore.load();
    const orgName = settingsStore.settings.organizationName?.value;
    if (orgName && orgName.trim() !== '') {
      organizationName.value = orgName;
    } else {
      organizationName.value = '欢迎回来';
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('加载系统标识失败:', e);
    }
    organizationName.value = '欢迎回来';
  }
}

onMounted(() => {
  loadOrganizationName();
});
</script>

<style scoped>
/* ================================================================
   登录页 — 居中布局 + 左侧点缀装饰（A 方案）
   表单保持居中，左侧绝对定位几何装饰，不影响布局流
   ================================================================ */
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-page);
  background-image: radial-gradient(
    ellipse 80% 60% at 50% 0%,
    color-mix(in srgb, var(--brand-primary) 6%, transparent) 0%,
    transparent 70%
  );
  padding: 40px 20px;
  overflow: hidden;
  position: relative;
}

.login-page::before,
.login-page::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

.login-page::before {
  width: 480px;
  height: 480px;
  top: -160px;
  left: -100px;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--brand-primary) 4%, transparent) 0%,
    transparent 70%
  );
}

.login-page::after {
  width: 380px;
  height: 380px;
  bottom: -100px;
  right: -60px;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--brand-primary) 3%, transparent) 0%,
    transparent 70%
  );
}

/* ==================== 左侧装饰区（绝对定位，不参与居中） ==================== */
.deco-area {
  position: absolute;
  top: 0;
  left: 0;
  width: 40%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}

.deco-circle {
  position: absolute;
  border-radius: 50%;
}

/* 大圆环：品牌蓝描边 */
.deco-c1 {
  width: 260px;
  height: 260px;
  top: 15%;
  left: 8%;
  border: 2px solid color-mix(in srgb, var(--brand-primary) 10%, transparent);
}

/* 中圆环：偏下偏右 */
.deco-c2 {
  width: 160px;
  height: 160px;
  bottom: 25%;
  left: 18%;
  border: 2px solid color-mix(in srgb, var(--brand-primary) 8%, transparent);
}

/* 填充光斑 */
.deco-c3 {
  width: 200px;
  height: 200px;
  top: 40%;
  left: 5%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--brand-primary) 5%, transparent) 0%,
    transparent 70%
  );
}

/* 装饰线 */
.deco-line {
  position: absolute;
}

.deco-l1 {
  width: 140px;
  height: 2px;
  top: 38%;
  left: 15%;
  background: color-mix(in srgb, var(--brand-primary) 8%, transparent);
  transform: rotate(-20deg);
}

.deco-l2 {
  width: 100px;
  height: 2px;
  bottom: 32%;
  left: 28%;
  background: color-mix(in srgb, var(--brand-mint) 10%, transparent);
  transform: rotate(15deg);
}

/* 装饰点 */
.deco-dot {
  position: absolute;
  border-radius: 50%;
}

.deco-d1 {
  width: 8px;
  height: 8px;
  top: 30%;
  left: 32%;
  background: color-mix(in srgb, var(--brand-primary) 18%, transparent);
}

.deco-d2 {
  width: 6px;
  height: 6px;
  bottom: 38%;
  left: 12%;
  background: color-mix(in srgb, var(--brand-primary) 12%, transparent);
}

.deco-d3 {
  width: 10px;
  height: 10px;
  top: 58%;
  left: 25%;
  background: color-mix(in srgb, var(--brand-mint) 15%, transparent);
}

/* ==================== 居中容器 ==================== */
.login-container {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  z-index: 1;
  animation: login-fade-in 0.5s var(--ease-out) both;
}

@keyframes login-fade-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ==================== 品牌 ==================== */
.brand {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: var(--space-7);
}

.brand-logo {
  flex-shrink: 0;
}

.brand-logo img {
  width: 64px;
  height: 64px;
  filter: drop-shadow(0 4px 12px rgba(0, 171, 107, 0.2));
}

.brand-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.brand-name {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 4px;
  line-height: 1.3;
}

.brand-tagline {
  margin: 0;
  font-size: 15px;
  color: var(--text-secondary);
  letter-spacing: 3px;
}

/* ==================== 卡片 ==================== */
.login-card {
  width: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: 0 36px var(--space-6);
  box-shadow: var(--shadow-md);
  position: relative;
  overflow: hidden;
}

.card-accent {
  height: 3px;
  background: linear-gradient(to right, var(--brand-primary), var(--brand-mint));
  box-shadow: 0 2px 16px var(--brand-primary-shadow), 0 0 24px rgba(28, 130, 245, 0.12);
}

.card-header {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  padding: var(--space-5) 0 20px;
}

.card-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  text-align: center;
}

/* ==================== 表单 ==================== */
.login-form :deep(.el-form-item) {
  margin-bottom: 18px;
}

.login-form :deep(.el-form-item__label) {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-regular);
  padding-bottom: 6px;
}

.login-form :deep(.el-input__wrapper) {
  border-radius: var(--radius-sm);
  box-shadow: 0 0 0 1px var(--border-light) inset;
  padding: var(--space-1) var(--space-3);
  transition: box-shadow var(--dur-base) var(--ease-out);
}

.login-form :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--border-base) inset;
}

.login-form :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 2px var(--brand-primary) inset;
}

.login-form :deep(.el-input__prefix .el-icon) {
  color: var(--text-secondary);
  font-size: 16px;
}

.login-btn {
  width: 100%;
  height: 46px;
  border-radius: var(--radius-sm);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 4px;
  text-indent: 4px;
  margin-top: 6px;
  background: var(--brand-primary);
  border: none;
  box-shadow: var(--shadow-sm);
  transition: all var(--dur-base) var(--ease-out);
}

.login-btn:hover,
.login-btn:focus {
  background: var(--brand-primary-hover);
  box-shadow: var(--shadow-glow);
}

.login-btn:active {
  background: var(--brand-primary-active);
  transform: scale(0.98);
}

/* ==================== 账号提示 ==================== */
.account-hint {
  border-top: 1px solid var(--border-light);
  padding-top: var(--space-3);
}

.account-hint :deep(.el-collapse) {
  border: none;
}

.account-hint :deep(.el-collapse-item__header) {
  font-size: 12px;
  color: var(--text-secondary);
  border: none;
  height: 28px;
  line-height: 28px;
  padding: 0;
}

.account-hint :deep(.el-collapse-item__wrap) {
  border: none;
}

.account-hint :deep(.el-collapse-item__content) {
  padding: 0 0 var(--space-1);
}

.hint-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.hint-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
  color: var(--text-regular);
}

.hint-row code {
  background: var(--bg-subtle);
  padding: 2px var(--space-2);
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-primary);
}

/* ==================== 底部 ==================== */
.page-footer {
  margin-top: var(--space-6);
  text-align: center;
  color: var(--text-placeholder);
  font-size: 12px;
}

/* ==================== 响应式 ==================== */

/* ≤992px：隐藏左侧装饰 */
@media (max-width: 992px) {
  .deco-area {
    display: none;
  }
}

@media (max-width: 768px) {
  .login-page {
    padding: 32px 16px;
  }

  .brand {
    gap: 14px;
    margin-bottom: 36px;
  }

  .brand-logo img {
    width: 56px;
    height: 56px;
  }

  .brand-name {
    font-size: 24px;
  }

  .brand-tagline {
    font-size: 13px;
  }

  .login-card {
    padding: 0 28px var(--space-5);
  }
}

@media (max-width: 480px) {
  .login-page {
    padding: var(--space-5) var(--space-4);
    align-items: flex-start;
    padding-top: 10vh;
  }

  .brand {
    gap: 10px;
    margin-bottom: 28px;
  }

  .brand-logo img {
    width: 52px;
    height: 52px;
  }

  .brand-name {
    font-size: 22px;
  }

  .brand-tagline {
    font-size: 13px;
  }

  .login-card {
    padding: 0 var(--space-5) 28px;
  }

  .card-header {
    padding: var(--space-5) 0 20px;
  }

  .card-header h2 {
    font-size: 20px;
  }

  .login-btn {
    height: 44px;
  }
}
</style>
