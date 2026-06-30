<template>
  <div class="settings-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <div class="header-icon">
          <el-icon :size="28"><Setting /></el-icon>
        </div>
        <div class="header-info">
          <h2 class="page-title">系统设置</h2>
          <p class="page-desc">配置学期、管理系统数据、查看操作日志</p>
        </div>
      </div>
    </div>

    <!-- 学期配置组件 -->
    <SemesterConfig
      v-model:form="form"
      v-model:selected-semester="selectedSemester"
      :saved-semester="savedSemester"
      :saving="saving"
      @save="handleSave"
    />

    <!-- 数据重置组件 -->
    <DataReset :resetting="resetting" @reset="showResetDialog" />

    <!-- 确认对话框组件 -->
    <ConfirmDialog
      v-model:dialog-visible="dialogVisible"
      v-model:simple-dialog-visible="clearAuditDialogVisible"
      v-model:save-dialog-visible="saveConfirmVisible"
      v-model:confirm-input="confirmInput"
      v-model:reason-input="reasonInput"
      :reset-type="resetType"
      :resetting="resetting"
      :saving="saving"
      @confirm="handleReset"
      @confirm-simple="handleClearAuditLogs"
      @confirm-save="confirmSave"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { useSettingsStore } from '../../stores/settings';
import {
  resetAuditLogs,
  resetTeachers,
  resetMajors,
  resetColleges,
  resetLevels,
  resetCourses,
  resetTextbooks,
  resetClasses,
  resetPlans,
  resetSettings,
} from '../../api/settings';
import SemesterConfig from './components/SemesterConfig.vue';
import DataReset from './components/DataReset.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';

const settingsStore = useSettingsStore();
const saving = ref(false);
const resetting = ref(false);
const form = ref({
  currentSemester: '',
  organizationName: '',
});

// 跟踪当前选中的学期和已保存的学期
const selectedSemester = ref('');
const savedSemester = ref('');

// 对话框状态
const dialogVisible = ref(false);
const resetType = ref('');
const confirmInput = ref('');
const reasonInput = ref('');
const clearAuditDialogVisible = ref(false);
const saveConfirmVisible = ref(false);

async function load() {
  await settingsStore.load();
  const s = settingsStore.settings;
  const semesterValue = s.currentSemester?.value || '';
  const orgName = s.organizationName?.value || '欢迎回来';
  form.value.currentSemester = semesterValue;
  form.value.organizationName = orgName;
  selectedSemester.value = semesterValue;
  savedSemester.value = semesterValue;
}

function handleSave() {
  saveConfirmVisible.value = true;
}

async function confirmSave() {
  saving.value = true;
  try {
    await settingsStore.save(form.value);
    savedSemester.value = form.value.currentSemester;
    ElMessage.success('学期设置已保存');
    saveConfirmVisible.value = false;
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || '未知错误'));
  } finally {
    saving.value = false;
  }
}

function showResetDialog(type) {
  if (type === 'audit-logs') {
    clearAuditDialogVisible.value = true;
    return;
  }

  resetType.value = type;
  confirmInput.value = '';
  reasonInput.value = '';
  dialogVisible.value = true;
}

async function handleReset() {
  const expectedTextMap = {
    teachers: '确认',
    majors: '确认',
    colleges: '确认',
    levels: '确认',
    courses: '确认',
    textbooks: '确认',
    classes: '确认',
    plans: '确认',
    settings: '系统重置',
  };

  if (confirmInput.value !== expectedTextMap[resetType.value]) {
    ElMessage.error('确认文字不正确');
    return;
  }

  resetting.value = true;
  try {
    const resetFnMap = {
      teachers: resetTeachers,
      majors: resetMajors,
      colleges: resetColleges,
      levels: resetLevels,
      courses: resetCourses,
      textbooks: resetTextbooks,
      classes: resetClasses,
      plans: resetPlans,
      settings: resetSettings,
    };

    await resetFnMap[resetType.value]({
      confirm: 'DELETE',
      ...(reasonInput.value.length >= 10 ? { reason: reasonInput.value } : {}),
    });
    const successMsg =
      expectedTextMap[resetType.value] === '确认'
        ? '数据已清空'
        : `${expectedTextMap[resetType.value]}成功`;
    ElMessage.success(successMsg);
    dialogVisible.value = false;

    if (resetType.value === 'settings') {
      await load();
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '操作失败');
  } finally {
    resetting.value = false;
  }
}

async function handleClearAuditLogs() {
  resetting.value = true;
  try {
    await resetAuditLogs();
    ElMessage.success('操作日志已清空');
    clearAuditDialogVisible.value = false;
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '清空失败');
  } finally {
    resetting.value = false;
  }
}

onMounted(() => {
  load();
});
</script>

<style scoped>
.settings-page {
  max-width: 1400px;
  margin: 0 auto;
}

/* 页面头部 */
.page-header {
  background: white;
  border-radius: 4px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  padding: 24px 28px;
  margin-bottom: 20px;
}

.header-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ecf5ff;
  border-radius: 8px;
  color: #409eff;
}

.header-info {
  flex: 1;
}

.page-title {
  margin: 0 0 6px 0;
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}

.page-desc {
  margin: 0;
  font-size: 14px;
  color: #909399;
}

/* 响应式 */
@media (max-width: 768px) {
  .settings-page {
    padding: 12px;
  }

  .page-header {
    padding: 16px 20px;
  }

  .header-icon {
    width: 40px;
    height: 40px;
  }

  .page-title {
    font-size: 18px;
  }
}
</style>
