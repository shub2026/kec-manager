<template>
  <div>
    <!-- 复杂操作确认弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="480px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <div class="confirm-dialog">
        <div class="confirm-alert">
          <el-icon :size="20"><WarningFilled /></el-icon>
          <span>此操作不可恢复，请谨慎执行！</span>
        </div>

        <div class="confirm-description">
          <p>{{ confirmText }}</p>
        </div>

        <el-alert
          v-if="cascadeInfo"
          :title="'级联影响：' + cascadeInfo"
          type="warning"
          :closable="false"
          show-icon
          class="confirm-cascade"
        />

        <div class="confirm-input-area">
          <label v-if="!isSimpleConfirmType"
            >请输入 <strong>{{ expectedConfirmText }}</strong> 以确认操作：</label
          >
          <label v-else>请输入 <strong>确认</strong> 以继续：</label>
          <el-input
            v-model="confirmInput"
            :placeholder="isSimpleConfirmType ? '请输入：确认' : '请输入：' + expectedConfirmText"
            size="large"
            clearable
            @keyup.enter="handleConfirm"
          />
        </div>

        <!-- 操作原因（系统重置时显示） -->
        <div v-if="resetType === 'settings'" class="reason-area">
          <label>操作原因（可选，需≥10字符）：</label>
          <el-input
            v-model="reasonInput"
            type="textarea"
            :rows="3"
            placeholder="请输入操作原因（至少10个字符）"
            maxlength="500"
            show-word-limit
            @keyup.enter="handleConfirm"
          />
        </div>
      </div>

      <template #footer>
        <el-button size="large" @click="dialogVisible = false">取消</el-button>
        <el-button
          type="danger"
          size="large"
          :loading="resetting"
          :disabled="!canConfirm"
          @click="handleConfirm"
        >
          <el-icon><WarningFilled /></el-icon>
          确认清空
        </el-button>
      </template>
    </el-dialog>

    <!-- 简单确认弹窗（用于日志清空） -->
    <el-dialog
      v-model="simpleDialogVisible"
      title="清空操作日志"
      width="500px"
      :close-on-click-modal="false"
    >
      <el-alert title="此操作不可恢复！" type="error" :closable="false" show-icon />
      <p class="confirm-text">确定要清空所有操作日志吗？此操作将永久删除所有日志记录。</p>
      <template #footer>
        <el-button @click="simpleDialogVisible = false">取消</el-button>
        <el-button type="danger" :loading="resetting" @click="$emit('confirm-simple')">
          确认清空
        </el-button>
      </template>
    </el-dialog>

    <!-- 保存设置确认弹窗 -->
    <el-dialog
      v-model="saveDialogVisible"
      title="确认保存"
      width="450px"
      :close-on-click-modal="false"
    >
      <p class="confirm-text">确定要保存当前配置吗？这将更新学期设置和系统标识。</p>
      <template #footer>
        <el-button @click="saveDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="$emit('confirm-save')">
          确认保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { WarningFilled } from '@element-plus/icons-vue';

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

const dialogTitle = computed(() => {
  const titles = {
    teachers: '清空教师数据',
    majors: '清空专业数据',
    colleges: '清空学院数据',
    levels: '清空培养层次',
    courses: '清空课程数据',
    textbooks: '清空教材数据',
    classes: '清空班级数据',
    plans: '清空培养方案',
    settings: '系统重置',
  };
  return titles[props.resetType] || '确认操作';
});

const confirmTextMap = {
  teachers: '将永久删除所有教师数据及教学安排。',
  majors: '将永久删除所有专业数据，级联清空相关培养方案。',
  colleges: '将永久删除所有学院数据，级联清空相关培养方案。',
  levels: '将永久删除所有培养层次数据，级联清空相关培养方案。',
  courses: '将永久删除所有课程数据，级联清空培养方案中的课程安排。',
  textbooks: '将永久删除所有教材数据，级联清空培养方案中的教材关联。',
  classes: '将永久删除所有班级数据。',
  plans: '将永久删除所有培养方案及其课程安排、教材关联数据。',
  settings:
    '将系统恢复到初始化状态，清空所有业务数据（教师、班级、培养方案、课程、教材、专业、学院、培养层次、系统设置、操作日志），仅保留用户账号。此操作不可恢复！',
};

const confirmText = computed(() => confirmTextMap[props.resetType] || '');

const cascadeInfoMap = {
  teachers: null,
  majors: '清空专业将同时清空所有培养方案，班级数据存在时将阻止操作',
  colleges: '清空学院将同时清空所有培养方案，班级数据存在时将阻止操作',
  levels: '清空层次将同时清空所有培养方案，班级数据存在时将阻止操作',
  courses: '清空课程将同时清空培养方案中的课程安排',
  textbooks: '清空教材将同时清空培养方案中的教材关联',
  classes: null,
  plans: null,
  settings: null,
};

const cascadeInfo = computed(() => cascadeInfoMap[props.resetType] || null);

// 判断是否为简单确认类型(只需输入"确认")
const isSimpleConfirmType = computed(() => {
  const simpleTypes = [
    'teachers',
    'majors',
    'colleges',
    'levels',
    'courses',
    'textbooks',
    'classes',
    'plans',
  ];
  return simpleTypes.includes(props.resetType);
});

const expectedConfirmText = computed(() => {
  // 简单确认类型统一使用"确认"
  if (isSimpleConfirmType.value) {
    return '确认';
  }

  // 系统设置使用原有的详细确认文本
  const texts = {
    settings: '系统重置',
  };
  return texts[props.resetType] || '确认';
});

const canConfirm = computed(() => {
  return props.confirmInput === expectedConfirmText.value;
});

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
  padding: 12px 16px;
  background: #fef0f0;
  border-left: 4px solid #f56c6c;
  border-radius: 4px;
  margin-bottom: 20px;
  color: #f56c6c;
  font-weight: 500;
}

.confirm-description p {
  margin: 0 0 15px 0;
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
}

.confirm-cascade {
  margin-bottom: 20px;
}

.confirm-input-area {
  margin-top: 20px;
}

.confirm-input-area label {
  display: block;
  margin-bottom: 10px;
  font-size: 14px;
  color: #303133;
}

.confirm-text {
  margin: 20px 0;
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
}

.reason-area {
  margin-top: 16px;
}

.reason-area label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  color: #606266;
}
</style>
