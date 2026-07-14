<template>
  <!-- 确认弹窗正文：统一的"图标 + 文字 + 可选危险提示"结构（修复 C10，替代 11 处内联副本） -->
  <div class="confirm-row">
    <el-icon v-if="icon" :size="24" :color="iconColor" class="confirm-icon">
      <component :is="icon" />
    </el-icon>
    <div class="confirm-text">
      <slot>
        <p v-if="message" class="confirm-message">{{ message }}</p>
      </slot>
      <p v-if="warning" class="confirm-warning">
        <el-icon class="warning-inline"><WarningFilled /></el-icon> {{ warning }}
      </p>
    </div>
  </div>
</template>

<script setup>
import { WarningFilled } from '@element-plus/icons-vue';

defineProps({
  message: { type: String, default: '' },
  warning: { type: String, default: '' },
  icon: { type: [Object, Function, String], default: WarningFilled },
  iconColor: { type: String, default: 'var(--brand-warning)' },
});
</script>

<style scoped>
.confirm-row {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
}
.confirm-icon {
  flex-shrink: 0;
  margin-top: 2px;
}
.confirm-text {
  flex: 1;
  min-width: 0;
  line-height: 1.6;
  color: var(--text-regular);
}
.confirm-message {
  margin: 0;
}
.confirm-warning {
  margin: var(--space-2) 0 0;
  color: var(--brand-danger-text);
  font-size: 13px;
  line-height: 1.6;
}
.warning-inline {
  vertical-align: -2px;
}
</style>
