<template>
  <div class="settings-page">
    <PageHeader
      title="系统设置"
      subtitle="系统管理"
      description="配置学期、管理系统数据、查看操作日志"
    />

    <div class="settings-card">
      <el-tabs v-model="activeTab" class="settings-tabs">
        <el-tab-pane label="学期配置" name="semester">
          <SemesterConfig
            v-model:form="form"
            v-model:selected-semester="selectedSemester"
            :saved-semester="savedSemester"
            :saving="saving"
            @save="handleSave"
          />
        </el-tab-pane>

        <el-tab-pane label="排课优化" name="scheduling">
          <SchedulingConfig />
        </el-tab-pane>

        <el-tab-pane label="数据管理" name="data">
          <DataReset :resetting="resetting" @reset="showResetDialog" />
        </el-tab-pane>
      </el-tabs>
    </div>

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
import { resetAuditLogs, resetSettings } from '../../api/settings';
import PageHeader from '../../components/PageHeader.vue';
import SemesterConfig from './components/SemesterConfig.vue';
import SchedulingConfig from './components/SchedulingConfig.vue';
import DataReset from './components/DataReset.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';

defineOptions({ name: 'SystemSettings' });

const settingsStore = useSettingsStore();
const activeTab = ref('semester');
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
    // 保存后从 store 重新同步表单，确保 UI 与后端数据一致
    const s = settingsStore.settings;
    const semesterValue = s.currentSemester?.value || '';
    const orgName = s.organizationName?.value || '欢迎回来';
    form.value.currentSemester = semesterValue;
    form.value.organizationName = orgName;
    selectedSemester.value = semesterValue;
    savedSemester.value = semesterValue;
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
  // 仅支持 'settings'（系统重置）
  resetType.value = type;
  confirmInput.value = '';
  reasonInput.value = '';
  dialogVisible.value = true;
}

async function handleReset() {
  // 系统重置要求输入「系统重置」确认文字
  if (confirmInput.value !== '系统重置') {
    ElMessage.error('确认文字不正确');
    return;
  }

  resetting.value = true;
  try {
    await resetSettings({
      confirm: 'DELETE',
      ...(reasonInput.value.length >= 10 ? { reason: reasonInput.value } : {}),
    });
    ElMessage.success('系统重置成功');
    dialogVisible.value = false;
    await load();
  } catch {
    // request.js 拦截器已统一弹错误提示，此处不再重复
  } finally {
    resetting.value = false;
  }
}

async function handleClearAuditLogs() {
  resetting.value = true;
  try {
    await resetAuditLogs({ confirm: 'DELETE' });
    ElMessage.success('操作日志已清空');
    clearAuditDialogVisible.value = false;
  } catch {
    // request.js 拦截器已统一弹错误提示，此处不再重复
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
}

.settings-card {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  padding: var(--space-5) var(--space-6);
}

/* Tabs 样式微调 */
.settings-tabs :deep(.el-tabs__header) {
  margin-bottom: var(--space-6);
}

.settings-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
}

.settings-tabs :deep(.el-tabs__item) {
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.02em;
}

/* 内部卡片融入外层容器，不重复投影；统一宽度占容器 60% 保持呼吸感 */
.settings-tabs :deep(.el-card) {
  box-shadow: none;
  border: none;
  max-width: 60%;
}

/* 卡片整体呼吸感 */
.settings-tabs :deep(.el-card__header) {
  padding: 20px 28px;
}

.settings-tabs :deep(.el-card__body) {
  padding: 28px;
}

/* 响应式 */
@media (max-width: 768px) {
  .settings-page {
    padding: var(--space-3);
  }

  .settings-card {
    padding: var(--space-3) var(--space-4);
  }

  .settings-tabs :deep(.el-card) {
    max-width: 100%;
  }

  .settings-tabs :deep(.el-card__header) {
    padding: 16px 20px;
  }

  .settings-tabs :deep(.el-card__body) {
    padding: 20px;
  }
}
</style>
