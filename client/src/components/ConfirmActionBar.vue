<template>
  <div class="confirm-action-bar" :class="{ 'is-danger': danger }">
    <span class="confirm-text">{{ message }}</span>
    <div class="confirm-buttons">
      <el-button size="small" @click="$emit('cancel')">取消</el-button>
      <el-button
        size="small"
        :type="danger ? 'danger' : 'primary'"
        :loading="loading"
        @click="$emit('confirm')"
      >
        {{ confirmText }}
      </el-button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  message: { type: String, required: true },
  confirmText: { type: String, default: '确认' },
  danger: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
});
defineEmits(['confirm', 'cancel']);
</script>

<style scoped>
.confirm-action-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-subtle, #f1f5f9);
  border-radius: var(--el-border-radius-base, 4px);
  margin-top: 8px;
}
.confirm-action-bar.is-danger {
  background: var(--brand-danger-soft, #fee2e2);
}
.confirm-text {
  flex: 1;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.confirm-buttons {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
</style>
