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
    <div style="padding: 8px 0">
      <!-- 单课程确认 -->
      <template v-if="type === 'single'">
        <p style="font-size: 14px; color: var(--text-primary); margin: 0 0 12px">
          <el-icon style="vertical-align: middle; color: var(--brand-warning); margin-right: 6px"
            ><SetUp
          /></el-icon>
          <strong>{{ data.courseName }}</strong>
        </p>
        <p style="font-size: 14px; color: var(--text-regular); margin: 0 0 8px">
          排课模式：<el-tag :type="data.mode === '全量模式' ? 'warning' : 'primary'" size="small">{{
            data.mode
          }}</el-tag>
        </p>
        <p style="font-size: 13px; color: var(--text-secondary); margin: 0">{{ data.message }}</p>
      </template>

      <!-- 批量确认 -->
      <template v-else>
        <p style="font-size: 14px; color: var(--text-primary); margin: 0 0 12px">
          <el-icon style="vertical-align: middle; color: var(--brand-warning); margin-right: 6px"
            ><MagicStick
          /></el-icon>
          将对<strong>当前学期所有课程</strong>进行批量排课
        </p>
        <p style="font-size: 14px; color: var(--text-regular); margin: 0 0 8px">
          排课模式：<el-tag :type="data.mode === '全量模式' ? 'warning' : 'primary'" size="small">{{
            data.mode
          }}</el-tag>
        </p>
        <p style="font-size: 13px; color: var(--text-secondary); margin: 0">{{ data.message }}</p>
      </template>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="warning" :loading="loading" @click="emit('confirm')">{{
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
