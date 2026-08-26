<template>
  <div class="login-page">
    <!-- 左侧品牌/插画区 -->
    <aside class="login-brand" aria-hidden="true">
      <div class="brand-bg">
        <div class="bg-blob blob-1"></div>
        <div class="bg-blob blob-2"></div>
        <div class="bg-blob blob-3"></div>
      </div>

      <div class="brand-inner">
        <header class="brand-header">
          <img src="/icons.svg" class="brand-mark" alt="KEC Logo" />
          <div class="brand-text">
            <h1 class="brand-name"><span class="brand-name__logo">KEC</span>课程管理平台</h1>
            <p class="brand-slogan">面向职业院校的轻量级教学管理系统</p>
          </div>
        </header>

        <div class="brand-illustration">
          <svg viewBox="0 0 520 380" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="k-top" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--brand-primary-lighter)" />
                <stop offset="100%" stop-color="var(--brand-primary-hover)" />
              </linearGradient>
              <linearGradient id="k-front" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--brand-primary-hover)" />
                <stop offset="100%" stop-color="var(--brand-primary)" />
              </linearGradient>
              <linearGradient id="k-side" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="var(--brand-primary-active)" />
                <stop offset="100%" stop-color="var(--brand-primary-active)" />
              </linearGradient>
              <linearGradient id="cloud-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--bg-card)" />
                <stop offset="100%" stop-color="var(--brand-primary-lighter)" />
              </linearGradient>
              <filter id="soft-shadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow
                  dx="0"
                  dy="12"
                  stdDeviation="14"
                  flood-color="var(--brand-primary)"
                  flood-opacity="0.10"
                />
              </filter>
              <filter id="card-shadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow
                  dx="0"
                  dy="8"
                  stdDeviation="12"
                  flood-color="var(--brand-primary)"
                  flood-opacity="0.12"
                />
              </filter>
            </defs>

            <!-- 柔和背景光斑 -->
            <ellipse
              cx="260"
              cy="220"
              rx="220"
              ry="120"
              fill="var(--brand-primary-soft)"
              opacity="0.6"
            />

            <!-- 底座平台 -->
            <g transform="translate(110, 260)">
              <path d="M0,20 L150,0 L300,20 L150,40 Z" fill="var(--bg-card)" />
              <path d="M0,20 L150,40 L150,56 L0,36 Z" fill="var(--brand-primary-soft)" />
              <path d="M150,40 L300,20 L300,36 L150,56 Z" fill="var(--brand-primary-lighter)" />
            </g>

            <!-- 立体 K -->
            <g transform="translate(190, 140)" filter="url(#soft-shadow)">
              <!-- 厚度 -->
              <path d="M10,10 L50,10 L50,130 L10,130 Z" fill="url(#k-side)" />
              <path d="M10,130 L50,130 L58,138 L18,138 Z" fill="var(--brand-primary-active)" />
              <!-- 主体 -->
              <path
                d="M10,10 L50,10 L50,50 L80,10 L120,10 L70,70 L120,130 L80,130 L50,90 L50,130 L10,130 Z"
                fill="url(#k-front)"
              />
              <!-- 顶面 -->
              <path d="M10,10 L14,6 L54,6 L50,10 Z" fill="url(#k-top)" />
              <path d="M50,10 L54,6 L84,6 L80,10 Z" fill="url(#k-top)" />
              <path d="M80,10 L84,6 L124,6 L120,10 Z" fill="url(#k-top)" />
              <path d="M50,50 L54,46 L84,46 L80,50 Z" fill="url(#k-top)" />
              <path d="M50,90 L54,86 L84,86 L80,90 Z" fill="url(#k-top)" />
              <!-- 右侧厚度 -->
              <path d="M120,10 L124,6 L124,126 L120,130 Z" fill="url(#k-side)" />
              <path d="M80,10 L84,6 L84,86 L80,90 Z" fill="url(#k-side)" />
            </g>

            <!-- 左侧课程卡 -->
            <g
              class="ill-card ill-card--left"
              transform="translate(60, 160)"
              filter="url(#card-shadow)"
            >
              <rect
                x="0"
                y="0"
                width="90"
                height="70"
                rx="10"
                fill="var(--bg-card)"
                fill-opacity="0.95"
                stroke="var(--brand-primary-soft)"
                stroke-width="1"
              />
              <rect x="0" y="0" width="90" height="18" rx="10" fill="var(--brand-primary-soft)" />
              <rect x="0" y="0" width="90" height="18" rx="0" fill="var(--brand-primary-soft)" />
              <circle cx="12" cy="9" r="3" fill="var(--brand-primary)" opacity="0.5" />
              <rect
                x="22"
                y="7"
                width="40"
                height="4"
                rx="2"
                fill="var(--brand-primary)"
                opacity="0.25"
              />
              <rect
                x="12"
                y="28"
                width="66"
                height="5"
                rx="2.5"
                fill="var(--brand-primary)"
                opacity="0.15"
              />
              <rect
                x="12"
                y="38"
                width="52"
                height="5"
                rx="2.5"
                fill="var(--brand-primary)"
                opacity="0.12"
              />
              <rect
                x="12"
                y="48"
                width="60"
                height="5"
                rx="2.5"
                fill="var(--brand-primary)"
                opacity="0.12"
              />
            </g>

            <!-- 右侧统计卡 -->
            <g
              class="ill-card ill-card--right"
              transform="translate(360, 150)"
              filter="url(#card-shadow)"
            >
              <rect
                x="0"
                y="0"
                width="90"
                height="80"
                rx="10"
                fill="var(--bg-card)"
                fill-opacity="0.95"
                stroke="var(--brand-primary-soft)"
                stroke-width="1"
              />
              <rect
                x="12"
                y="12"
                width="28"
                height="4"
                rx="2"
                fill="var(--brand-primary)"
                opacity="0.3"
              />
              <rect
                x="12"
                y="22"
                width="48"
                height="8"
                rx="2"
                fill="var(--brand-primary)"
                opacity="0.12"
              />
              <rect
                x="12"
                y="38"
                width="10"
                height="28"
                rx="3"
                fill="var(--brand-primary)"
                opacity="0.18"
              />
              <rect
                x="26"
                y="46"
                width="10"
                height="20"
                rx="3"
                fill="var(--brand-primary)"
                opacity="0.28"
              />
              <rect
                x="40"
                y="38"
                width="10"
                height="28"
                rx="3"
                fill="var(--brand-primary)"
                opacity="0.22"
              />
              <rect
                x="54"
                y="50"
                width="10"
                height="16"
                rx="3"
                fill="var(--brand-primary)"
                opacity="0.35"
              />
              <rect
                x="68"
                y="42"
                width="10"
                height="24"
                rx="3"
                fill="var(--brand-primary)"
                opacity="0.25"
              />
            </g>

            <!-- 云 -->
            <g class="ill-cloud" transform="translate(360, 60)" filter="url(#card-shadow)">
              <path
                d="M20,30 Q25,10 45,15 Q55,0 80,10 Q100,5 110,25 Q130,25 125,45 Q135,60 115,65 L35,65 Q10,60 20,30 Z"
                fill="url(#cloud-grad)"
                fill-opacity="0.95"
                stroke="var(--brand-primary-soft)"
                stroke-width="1"
              />
              <circle cx="55" cy="42" r="3" fill="var(--brand-primary)" opacity="0.3" />
              <circle cx="68" cy="42" r="3" fill="var(--brand-primary)" opacity="0.3" />
              <circle cx="81" cy="42" r="3" fill="var(--brand-primary)" opacity="0.3" />
              <line
                x1="55"
                y1="50"
                x2="81"
                y2="50"
                stroke="var(--brand-primary)"
                stroke-width="1.5"
                stroke-linecap="round"
                opacity="0.4"
              />
            </g>

            <!-- 完成徽章 -->
            <g class="ill-badge" transform="translate(390, 270)" filter="url(#card-shadow)">
              <circle
                cx="20"
                cy="20"
                r="20"
                fill="var(--bg-card)"
                fill-opacity="0.95"
                stroke="var(--brand-primary-soft)"
                stroke-width="1"
              />
              <circle cx="20" cy="20" r="20" fill="url(#k-front)" opacity="0.1" />
              <path
                d="M12,20 L18,26 L29,14"
                stroke="var(--brand-primary)"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              />
            </g>

            <!-- 装饰元素 -->
            <circle
              cx="40"
              cy="80"
              r="6"
              fill="var(--bg-card)"
              stroke="var(--brand-primary-lighter)"
              stroke-width="1.5"
            />
            <circle cx="460" cy="110" r="5" fill="var(--brand-primary-lighter)" />
            <circle cx="80" cy="310" r="4" fill="var(--brand-primary-lighter)" />
            <circle
              cx="430"
              cy="320"
              r="7"
              fill="var(--bg-card)"
              stroke="var(--brand-primary-lighter)"
              stroke-width="1.5"
            />
            <g transform="translate(450, 70)" opacity="0.4">
              <line
                x1="0"
                y1="5"
                x2="10"
                y2="5"
                stroke="var(--brand-primary)"
                stroke-width="1.5"
                stroke-linecap="round"
              />
              <line
                x1="5"
                y1="0"
                x2="5"
                y2="10"
                stroke="var(--brand-primary)"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </g>
            <g transform="translate(60, 110)" opacity="0.35">
              <line
                x1="0"
                y1="4"
                x2="8"
                y2="4"
                stroke="var(--brand-primary)"
                stroke-width="1.2"
                stroke-linecap="round"
              />
              <line
                x1="4"
                y1="0"
                x2="4"
                y2="8"
                stroke="var(--brand-primary)"
                stroke-width="1.2"
                stroke-linecap="round"
              />
            </g>
            <!-- 连接虚线 -->
            <path
              d="M160,200 Q210,180 260,200"
              stroke="var(--brand-primary)"
              stroke-width="1"
              fill="none"
              stroke-dasharray="4 4"
              opacity="0.2"
            />
            <path
              d="M280,200 Q330,220 370,200"
              stroke="var(--brand-primary)"
              stroke-width="1"
              fill="none"
              stroke-dasharray="4 4"
              opacity="0.2"
            />
          </svg>

          <p class="brand-features">基础数据管理 · 智能培养方案 · 自动教学安排</p>
        </div>
      </div>
    </aside>

    <!-- 右侧表单区 -->
    <main class="login-main">
      <div class="login-container">
        <div class="login-card">
          <div class="login-card-header">
            <img src="/icons.svg" class="card-logo" alt="" aria-hidden="true" />
            <h2 class="form-title">{{ organizationName }}</h2>
            <p class="form-subtitle">
              登录进入 <span class="form-subtitle__logo">KEC</span> 课程管理平台
            </p>
          </div>

          <el-form
            ref="formRef"
            :model="loginForm"
            :rules="rules"
            class="login-form"
            aria-label="用户登录表单"
          >
            <el-form-item prop="username">
              <el-input
                v-model="loginForm.username"
                placeholder="请输入账号"
                size="large"
                clearable
                autocomplete="username"
                aria-label="用户名"
                :prefix-icon="User"
                @keyup.enter="handleLogin"
              />
            </el-form-item>

            <el-form-item prop="password">
              <el-input
                v-model="loginForm.password"
                type="password"
                placeholder="请输入密码"
                size="large"
                show-password
                autocomplete="current-password"
                aria-label="密码"
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

        <footer class="page-footer">
          <span>KEC Platform v{{ appVersion }}</span>
        </footer>
      </div>
    </main>
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
    // 兜底：确保登录失败状态下一定有提示（拦截器对 /auth/login 的 401 不弹窗）
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
   登录页 — 探迹风格轻量 3D 等距插画 + 纯白卡片
   ================================================================ */

.login-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 58fr 42fr;
  overflow: hidden;
  background: var(--bg-card);
}

/* ==================== 左侧品牌/插画区 ==================== */
.login-brand {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background:
    radial-gradient(
      circle at 20% 20%,
      color-mix(in srgb, var(--brand-primary-soft) 90%, transparent),
      transparent 45%
    ),
    radial-gradient(
      circle at 85% 80%,
      color-mix(in srgb, var(--brand-primary-lighter) 80%, transparent),
      transparent 45%
    ),
    linear-gradient(
      150deg,
      var(--bg-card) 0%,
      color-mix(in srgb, var(--bg-card) 97%, var(--brand-primary-soft)) 45%,
      var(--brand-primary-soft) 100%
    );
}

.brand-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.bg-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
}
.blob-1 {
  width: 420px;
  height: 420px;
  background: var(--brand-primary-soft);
  top: -120px;
  left: -120px;
  opacity: 0.7;
}
.blob-2 {
  width: 320px;
  height: 320px;
  background: var(--brand-primary-lighter);
  bottom: -60px;
  right: 40px;
  opacity: 0.6;
}
.blob-3 {
  width: 220px;
  height: 220px;
  background: var(--brand-primary-lighter);
  top: 45%;
  left: 38%;
  opacity: 0.35;
}

.brand-inner {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  position: relative;
  z-index: 1;
  padding: 40px 48px;
  animation: brand-in 0.8s var(--ease-out) both;
}

@keyframes brand-in {
  from {
    opacity: 0;
    transform: translateX(-12px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* 品牌标识 (左上角) */
.brand-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 56px;
  margin-left: 24px;
}

.brand-mark {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 9px;
  box-shadow: 0 8px 22px var(--brand-primary-shadow);
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-name {
  margin: 0;
  color: var(--text-primary);
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 1px;
  line-height: 1.25;
}
.brand-name__logo {
  color: var(--brand-primary);
  margin-right: 4px;
}

.brand-slogan {
  margin: 12px 0 0;
  color: var(--text-regular);
  font-size: var(--font-size-body);
  line-height: 1.7;
  letter-spacing: 0.3px;
  max-width: 360px;
}

/* ==================== 产品插画 ==================== */
.brand-illustration {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: 24px 0;
}

.brand-illustration svg {
  width: 100%;
  height: auto;
  overflow: visible;
}

/* 插画下方功能亮点：紧跟插画，与其整体居中 */
.brand-features {
  margin: 20px 0 0;
  text-align: center;
  color: var(--text-regular);
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 1px;
  line-height: 1.6;
}

/* 浮动微动效 */
.ill-card {
  transform-box: fill-box;
  transform-origin: center;
  animation: float 6s var(--ease-in-out) infinite;
}
.ill-card--left {
  animation-delay: 0s;
}
.ill-card--right {
  animation-delay: -2s;
}

.ill-cloud {
  transform-box: fill-box;
  transform-origin: center;
  animation: float 7s var(--ease-in-out) infinite;
  animation-delay: -1s;
}

.ill-badge {
  transform-box: fill-box;
  transform-origin: center;
  animation: float 5s var(--ease-in-out) infinite;
  animation-delay: -3s;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}

/* ==================== 右侧表单区 ==================== */
.login-main {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 40px 32px;
  background: var(--bg-card);
  overflow: hidden;
}

.login-main::before {
  content: '';
  position: absolute;
  top: -200px;
  right: -200px;
  width: 500px;
  height: 500px;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--brand-primary-soft) 70%, transparent),
    transparent 70%
  );
  filter: blur(40px);
  pointer-events: none;
}

/* ==================== 居中容器 ==================== */
.login-container {
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  z-index: 1;
  animation: form-in 0.8s var(--ease-out) 0.1s both;
}

@keyframes form-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ==================== 登录卡片 ==================== */
.login-card {
  width: 100%;
  background: color-mix(in srgb, var(--bg-card) 95%, transparent);
  border: 1px solid color-mix(in srgb, var(--brand-primary-soft) 80%, transparent);
  border-radius: 22px;
  padding: 44px;
  /* 三层阴影:贴边描边感 + 中景品牌色晕染 + 远景弥散,静止态保持轻盈 */
  box-shadow:
    var(--shadow-xs),
    0 10px 28px color-mix(in srgb, var(--brand-primary) 8%, transparent),
    0 24px 64px color-mix(in srgb, var(--brand-primary) 6%, transparent);
  transition:
    box-shadow var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}
.login-card:hover {
  box-shadow:
    var(--shadow-sm),
    0 14px 34px color-mix(in srgb, var(--brand-primary) 12%, transparent),
    0 30px 76px color-mix(in srgb, var(--brand-primary) 9%, transparent);
  transform: translateY(-2px);
}

/* ==================== 卡片头部 ==================== */
.login-card-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: 0 0 36px;
}

/* 卡片LOGO：仅移动端显示，补位左侧隐藏后的品牌标识 */
.card-logo {
  display: none;
  width: 48px;
  height: 48px;
  border-radius: 9px;
  box-shadow: 0 8px 22px var(--brand-primary-shadow);
  margin-bottom: 18px;
}

.form-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  text-align: center;
  letter-spacing: 0.01em;
}

.form-subtitle {
  margin: 8px 0 0;
  font-size: var(--font-size-body-sm);
  color: var(--text-regular);
  text-align: center;
}

.form-subtitle__logo {
  color: var(--brand-primary);
  font-weight: 600;
}

/* ==================== 表单 ==================== */
.login-form :deep(.el-form-item) {
  margin-bottom: 26px;
}

.login-form :deep(.el-input__wrapper) {
  border-radius: 12px;
  background: var(--bg-subtle);
  box-shadow: none;
  padding: 10px 18px;
  height: 52px;
  transition:
    background var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.login-form :deep(.el-input__wrapper:hover) {
  background: var(--bg-subtle);
}

.login-form :deep(.el-input__wrapper.is-focus) {
  background: var(--bg-card);
  box-shadow: 0 0 0 2px var(--brand-primary-shadow);
}

.login-form :deep(.el-input__prefix .el-icon) {
  color: var(--text-secondary);
  font-size: 16px;
  margin-right: 4px;
}

/* ==================== 登录按钮 ==================== */
.login-btn {
  width: 100%;
  height: 50px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 4px;
  text-indent: 4px;
  margin-top: 4px;
  background: linear-gradient(135deg, var(--brand-primary), var(--brand-primary-hover));
  border: none;
  color: var(--bg-card);
  box-shadow: var(--shadow-glow);
  transition:
    box-shadow var(--dur-base) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}
.login-btn:hover,
.login-btn:focus {
  box-shadow: 0 12px 28px color-mix(in srgb, var(--brand-primary) 35%, transparent);
  transform: translateY(-1px);
}
.login-btn:active {
  transform: translateY(0) scale(0.985);
}

/* ==================== 账号提示 ==================== */
.account-hint {
  border-top: 1px solid var(--border-light);
  padding-top: 12px;
  margin-top: 8px;
}

.account-hint :deep(.el-collapse) {
  border: none;
}

.account-hint :deep(.el-collapse-item__header) {
  font-size: var(--font-size-caption);
  color: var(--text-regular);
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
  font-size: var(--font-size-caption);
  color: var(--text-regular);
}

.hint-row code {
  background: var(--brand-primary-soft);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: var(--font-size-micro);
  color: var(--brand-primary-active);
}

/* ==================== 底部 ==================== */
.page-footer {
  margin-top: 22px;
  text-align: center;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  letter-spacing: 0.02em;
}

/* ==================== 响应式 ==================== */
@media (max-width: 992px) {
  .login-page {
    grid-template-columns: 1fr 1fr;
  }
  .brand-illustration {
    max-width: 420px;
  }
}

@media (max-width: 768px) {
  .login-page {
    grid-template-columns: 1fr;
  }
  .login-brand {
    display: none;
  }
  .login-main {
    padding: 32px 20px;
  }
  .login-card {
    padding: 32px 28px;
  }
  .card-logo {
    display: block;
  }
}

@media (max-width: 480px) {
  .login-main {
    padding: 24px 16px;
    align-items: flex-start;
    padding-top: 8vh;
  }
  .login-card {
    padding: 28px 22px;
  }
  .form-title {
    font-size: 21px;
  }
  .form-subtitle {
    font-size: 12px;
  }
  .login-btn {
    height: 44px;
  }
}

/* ==================== 动效偏好 ==================== */
@media (prefers-reduced-motion: reduce) {
  .brand-inner,
  .login-container,
  .ill-card,
  .ill-cloud,
  .ill-badge {
    animation: none !important;
  }
  .login-card:hover {
    transform: none;
  }
  .login-btn:hover {
    transform: none;
  }
}
</style>
