<template>
  <div class="not-found">
    <div class="not-found-content">
      <div class="not-found-icon">
        <el-icon :size="80" color="var(--text-placeholder)"><Warning /></el-icon>
      </div>
      <h1 class="not-found-code">404</h1>
      <h2 class="not-found-title">页面不存在</h2>
      <p class="not-found-desc">抱歉，您访问的页面不存在或已被移除。</p>
      <div class="not-found-actions">
        <el-button type="primary" size="large" @click="goHome">
          <el-icon><House /></el-icon> 返回首页
        </el-button>
        <el-button size="large" @click="$router.back()">
          <el-icon><ArrowLeft /></el-icon> 返回上一页
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { Warning, House, ArrowLeft } from '@element-plus/icons-vue';

defineOptions({ name: 'NotFound' });

const router = useRouter();
const authStore = useAuthStore();

function goHome() {
  if (authStore.isLoggedIn) {
    // FE-P1-2修复：按钮文案为"返回首页"，应跳转到仪表盘（路由 / → /dashboard，侧边栏首项也是 /dashboard）
    router.push('/dashboard');
  } else {
    router.push('/login');
  }
}
</script>

<style scoped>
.not-found {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--bg-page);
}
.not-found-content {
  text-align: center;
  padding: var(--space-7) var(--space-6);
}
.not-found-icon {
  margin-bottom: var(--space-4);
}
.not-found-code {
  /* 404 展示数字：页面级 display 例外（72px/800），不入全站字阶令牌 */
  font-size: 72px;
  font-weight: 800;
  color: var(--text-placeholder);
  margin: 0;
  line-height: 1;
  letter-spacing: 4px;
}
.not-found-title {
  font-size: var(--font-size-display);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  margin: var(--space-4) 0 var(--space-2);
}
.not-found-desc {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  margin: 0 0 var(--space-6);
}
.not-found-actions {
  display: flex;
  gap: var(--space-3);
  justify-content: center;
}
</style>
