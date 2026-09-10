<script setup>
import { ref, onMounted } from 'vue';

// 异步加载 zhCn locale，避免阻塞首屏主 chunk
const locale = ref(null);

// clearable 控件清空后默认吐 undefined，会被 JSON.stringify 丢键，
// 使"清空"传不到后端（旧值残留）；统一改为 null 保留清空意图。
// 必须传函数：valueOnClear 的 prop 类型为 String|Number|Boolean|Function
const valueOnClear = () => null;

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
  <el-config-provider :locale="locale" :value-on-clear="valueOnClear">
    <router-view />
  </el-config-provider>
</template>
