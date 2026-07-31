<template>
  <!--
    FE-P2 抽公共组件：统一删除确认弹窗外壳。
    替代各列表页中重复的 <el-dialog v-model="deleteConfirmVisible" title="确认删除"> + BaseConfirmBody 模板。
    通过默认插槽传入实体特定的提示文案，通过 warning 传入级联引用警告。
  -->
  <el-dialog
    :model-value="modelValue"
    title="确认删除"
    width="var(--dialog-width)"
    align-center
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <BaseConfirmBody icon-color="var(--brand-danger)" :warning="warning">
      <slot>确定要删除吗？此操作不可撤销。</slot>
    </BaseConfirmBody>
    <template #footer>
      <el-button @click="handleCancel">取消</el-button>
      <el-button type="danger" :loading="loading" @click="emit('confirm')">确定删除</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import BaseConfirmBody from './BaseConfirmBody.vue';

defineProps({
  modelValue: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  warning: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel']);

// 与 BaseConfirmDialog 对齐：cancel 仅在显式点击取消时触发，不随任意关闭（ESC/关闭钮）重复发射
function handleCancel() {
  emit('update:modelValue', false);
  emit('cancel');
}
</script>
