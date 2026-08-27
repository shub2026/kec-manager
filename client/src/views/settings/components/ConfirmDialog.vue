<template>
  <div>
    <!-- 系统重置确认弹窗（需输入「系统重置」+ 可选原因） -->
    <el-dialog
      v-model="dialogVisible"
      title="系统重置"
      width="var(--dialog-width)"
      :fullscreen="isMobile"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <div class="confirm-dialog">
        <div class="confirm-alert">
          <el-icon :size="20"><WarningFilled /></el-icon>
          <span>此操作不可恢复，请谨慎执行！</span>
        </div>

        <div class="confirm-description">
          <p>
            将系统恢复到初始化状态，清空所有业务数据（教师、班级、培养方案、课程、教材、专业、学院、培养层次、系统设置、操作日志），仅保留用户账号。
          </p>
        </div>

        <div class="confirm-input-area">
          <label for="reset-confirm-input">请输入 <strong>系统重置</strong> 以确认操作：</label>
          <el-input
            id="reset-confirm-input"
            v-model="confirmInput"
            placeholder="请输入：系统重置"
            size="large"
            clearable
            @keyup.enter="handleConfirm"
          />
        </div>

        <!-- 操作原因（可选，需≥10字符） -->
        <div class="reason-area">
          <label for="reset-reason-input">操作原因（可选，需≥10字符）：</label>
          <el-input
            id="reset-reason-input"
            v-model="reasonInput"
            type="textarea"
            :rows="3"
            placeholder="请输入操作原因（至少10个字符）"
            maxlength="500"
            show-word-limit
            @keyup.ctrl.enter="handleConfirm"
          />
        </div>
      </div>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="resetting"
          :disabled="!canConfirm"
          @click="handleConfirm"
        >
          <el-icon><WarningFilled /></el-icon>
          确认系统重置
        </el-button>
      </template>
    </el-dialog>

    <!-- 清空操作日志确认弹窗：复用全局 BaseConfirmDialog（确认类小窗，用默认 --dialog-width） -->
    <BaseConfirmDialog
      v-model="simpleDialogVisible"
      title="清空操作日志"
      confirm-type="danger"
      confirm-text="确认清空"
      :loading="resetting"
      @confirm="$emit('confirm-simple')"
    >
      <el-alert title="此操作不可恢复！" type="error" :closable="false" show-icon />
      <p class="confirm-text">确定要清空所有操作日志吗？此操作将永久删除所有日志记录。</p>
    </BaseConfirmDialog>

    <!-- 保存设置确认弹窗：复用全局 BaseConfirmDialog -->
    <BaseConfirmDialog
      v-model="saveDialogVisible"
      title="确认保存"
      message="确定要保存当前配置吗？这将更新学期设置和系统标识。"
      confirm-text="确认保存"
      :loading="saving"
      @confirm="$emit('confirm-save')"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import BaseConfirmDialog from '@/components/BaseConfirmDialog.vue';
import { useResponsive } from '@/composables/useResponsive';

// 系统重置弹窗含确认输入 + 原因文本域，属表单类弹窗，手机端全屏
const { isMobile } = useResponsive();

const props = defineProps({
  dialogVisible: {
    type: Boolean,
    default: false,
  },
  simpleDialogVisible: {
    type: Boolean,
    default: false,
  },
  saveDialogVisible: {
    type: Boolean,
    default: false,
  },
  resetType: {
    type: String,
    default: '',
  },
  confirmInput: {
    type: String,
    default: '',
  },
  reasonInput: {
    type: String,
    default: '',
  },
  resetting: {
    type: Boolean,
    default: false,
  },
  saving: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  'update:dialogVisible',
  'update:simpleDialogVisible',
  'update:saveDialogVisible',
  'update:confirmInput',
  'update:reasonInput',
  'confirm',
  'confirm-simple',
  'confirm-save',
]);

const dialogVisible = computed({
  get: () => props.dialogVisible,
  set: (val) => emit('update:dialogVisible', val),
});

const simpleDialogVisible = computed({
  get: () => props.simpleDialogVisible,
  set: (val) => emit('update:simpleDialogVisible', val),
});

const saveDialogVisible = computed({
  get: () => props.saveDialogVisible,
  set: (val) => emit('update:saveDialogVisible', val),
});

const confirmInput = computed({
  get: () => props.confirmInput,
  set: (val) => emit('update:confirmInput', val),
});

const reasonInput = computed({
  get: () => props.reasonInput,
  set: (val) => emit('update:reasonInput', val),
});

// 系统重置要求输入「系统重置」确认文字
const canConfirm = computed(() => props.confirmInput === '系统重置');

function handleConfirm() {
  if (canConfirm.value) {
    emit('confirm');
  }
}
</script>

<style scoped>
.confirm-dialog {
  padding: 10px 0;
}

.confirm-alert {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: var(--space-3) var(--space-4);
  background: var(--brand-danger-soft);
  border-left: 4px solid var(--brand-danger);
  border-radius: var(--radius-sm);
  margin-bottom: var(--space-block);
  color: var(--brand-danger-text);
  font-weight: var(--fw-medium);
}

.confirm-description p {
  margin: 0 0 var(--space-block) 0;
  font-size: var(--font-size-body);
  color: var(--text-regular);
  line-height: var(--leading-relaxed);
}

.confirm-input-area {
  margin-top: var(--space-block);
}

.confirm-input-area label {
  display: block;
  margin-bottom: 10px;
  font-size: var(--font-size-body);
  color: var(--text-primary);
}

.confirm-text {
  margin: var(--space-block) 0 0;
  font-size: var(--font-size-body);
  color: var(--text-regular);
  line-height: var(--leading-relaxed);
}

.reason-area {
  margin-top: var(--space-4);
}

.reason-area label {
  display: block;
  margin-bottom: var(--space-2);
  font-size: var(--font-size-body-sm);
  color: var(--text-regular);
}
</style>
