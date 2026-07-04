<template>
  <div class="login-page">
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
        >
          <el-form-item label="用户名" prop="username">
            <el-input
              v-model="loginForm.username"
              placeholder="请输入用户名"
              size="large"
              clearable
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
  } catch {
    // 拦截器已弹窗，避免重复提示
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
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-page);
  padding: 40px 20px;
}

.login-container {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* ==================== 品牌 ==================== */
.brand {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 48px;
}

.brand-logo {
  flex-shrink: 0;
}

.brand-logo img {
  width: 64px;
  height: 64px;
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
  border-radius: var(--radius-md);
  padding: 0 36px 32px;
  box-shadow: var(--shadow-md);
  position: relative;
  overflow: hidden;
}

.card-accent {
  height: 3px;
  background: linear-gradient(
    90deg,
    var(--brand-primary) 0%,
    var(--brand-primary-lighter) 50%,
    var(--brand-success) 100%
  );
}

.card-header {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  padding: 24px 0 20px;
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
  padding: 4px 12px;
  transition: box-shadow var(--dur-base) var(--ease-out);
}

.login-form :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--border-base) inset;
}

.login-form :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1.5px var(--brand-primary) inset;
}

.login-btn {
  width: 100%;
  height: 46px;
  border-radius: var(--radius-sm);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 6px;
  text-indent: 6px;
  margin-top: 6px;
  background: var(--brand-primary);
  border: none;
  box-shadow: var(--shadow-sm);
  transition: all var(--dur-base) var(--ease-out);
}

.login-btn:hover,
.login-btn:focus {
  background: var(--brand-primary-hover);
  box-shadow: 0 6px 16px rgba(67, 97, 238, 0.32);
}

.login-btn:active {
  background: var(--brand-primary-active);
  transform: scale(0.98);
}

/* ==================== 账号提示 ==================== */
.account-hint {
  border-top: 1px solid var(--border-light);
  padding-top: 12px;
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
  padding: 0 0 4px;
}

.hint-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hint-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-regular);
}

.hint-row code {
  background: var(--bg-subtle);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-primary);
}

/* ==================== 底部 ==================== */
.page-footer {
  margin-top: 32px;
  text-align: center;
  color: var(--text-placeholder);
  font-size: 12px;
}

/* ==================== 响应式 ==================== */
@media (max-width: 480px) {
  .login-page {
    padding: 24px 16px;
    align-items: flex-start;
    padding-top: 12vh;
  }

  .brand {
    gap: 14px;
    margin-bottom: 36px;
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
    padding: 0 24px 28px;
  }

  .card-header {
    padding: 24px 0 20px;
  }

  .card-header h2 {
    font-size: 20px;
  }
}
</style>
