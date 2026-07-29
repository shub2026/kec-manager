<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    :width="width"
    :close-on-click-modal="closeOnClickModal"
    destroy-on-close
    align-center
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- 自定义主体：消息或任意内容 -->
    <div class="base-confirm-body">
      <slot>
        <p v-if="message" class="base-confirm-message">{{ message }}</p>
      </slot>
    </div>

    <template #footer>
      <el-button @click="handleCancel">{{ cancelText }}</el-button>
      <el-button :type="confirmType" :loading="loading" @click="emit('confirm')">
        {{ confirmText }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '确认操作' },
  message: { type: String, default: '' },
  confirmText: { type: String, default: '确定' },
  cancelText: { type: String, default: '取消' },
  confirmType: { type: String, default: 'primary' }, // 'primary' | 'danger' | 'warning'
  loading: { type: Boolean, default: false },
  width: { type: String, default: 'var(--dialog-width)' },
  closeOnClickModal: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel']);

// 取消按钮：关闭弹窗并通知外部执行清理逻辑。
// 不挂在 @close 上，避免 confirm 流程关闭弹窗时误触发 cancel 清理
function handleCancel() {
  emit('update:modelValue', false);
  emit('cancel');
}
</script>

<style scoped>
.base-confirm-body {
  padding: var(--space-2) 0;
}

.base-confirm-message {
  margin: 0;
  font-size: 14px;
  color: var(--text-regular);
  line-height: 1.6;
}
</style>
