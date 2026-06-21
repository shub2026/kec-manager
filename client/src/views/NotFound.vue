<template>
  <div class="not-found">
    <el-result icon="warning" title="页面不存在" sub-title="您访问的页面不存在">
      <template #extra>
        <el-button type="primary" @click="goHome">返回首页</el-button>
      </template>
    </el-result>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const authStore = useAuthStore();

function goHome() {
  if (authStore.isLoggedIn) {
    router.push('/query/semester');
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
}
</style>
