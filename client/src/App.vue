<script setup>
import { ref, onMounted } from 'vue';

// 异步加载 zhCn locale，避免阻塞首屏主 chunk
const locale = ref(null);

onMounted(async () => {
  try {
    const mod = await import('element-plus/dist/locale/zh-cn.mjs');
    locale.value = mod.default;
  } catch {
    // 加载失败回退到默认 locale，组件仍可正常使用
  }
});
</script>

<template>
  <el-config-provider :locale="locale">
    <router-view />
  </el-config-provider>
</template>
