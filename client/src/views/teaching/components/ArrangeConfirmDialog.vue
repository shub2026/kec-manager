<template>
  <el-dialog
    :model-value="modelValue"
    :title="data.title"
    width="min(480px, 90vw)"
    :close-on-click-modal="false"
    destroy-on-close
    align-center
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="dialog-body">
      <!-- 单课程确认 -->
      <template v-if="type === 'single'">
        <p class="info-title">
          <el-icon class="info-icon"><SetUp /></el-icon>
          <strong>{{ data.courseName }}</strong>
        </p>
        <p class="info-row">
          排课模式：<el-tag :type="data.mode === '全量模式' ? 'warning' : 'success'" size="small">{{
            data.mode
          }}</el-tag>
        </p>
        <p class="info-detail">{{ data.message }}</p>
      </template>

      <!-- 批量确认 -->
      <template v-else>
        <p class="info-title">
          <el-icon class="info-icon"><MagicStick /></el-icon>
          将对<strong>当前学期所有课程</strong>进行批量排课
        </p>
        <p class="info-row">
          排课模式：<el-tag :type="data.mode === '全量模式' ? 'warning' : 'success'" size="small">{{
            data.mode
          }}</el-tag>
        </p>
        <p class="info-detail">{{ data.message }}</p>
      </template>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="loading" @click="emit('confirm')">{{
        data.confirmText || '确定'
      }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
defineProps({
  modelValue: { type: Boolean, default: false },
  type: { type: String, default: 'single' }, // 'single' | 'batch'
  data: {
    type: Object,
    default: () => ({
      title: '',
      mode: '',
      courseName: '',
      message: '',
      confirmText: '',
    }),
  },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'confirm']);
</script>

<style scoped>
.dialog-body {
  padding: 8px 0;
}

.info-title {
  font-size: 14px;
  color: var(--text-primary);
  margin: 0 0 12px;
}

.info-icon {
  vertical-align: middle;
  color: var(--brand-warning);
  margin-right: 6px;
}

.info-row {
  font-size: 14px;
  color: var(--text-regular);
  margin: 0 0 8px;
}

.info-detail {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}
</style>
