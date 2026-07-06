<template>
  <el-card class="scheduling-card" shadow="never">
    <template #header>
      <div class="card-title-row">
        <span class="card-dot dot-green"></span>
        <span class="card-title-text">排课优化</span>
        <el-tag size="small" type="success" effect="plain">高级设置</el-tag>
      </div>
    </template>

    <div class="scheduling-body">
      <div class="config-item">
        <div class="switch-row">
          <div class="switch-info">
            <label class="field-label">禁忌搜索优化</label>
            <p class="switch-desc">
              在贪心算法排课完成后，启用禁忌搜索迭代优化。可减少未分配班级数量、提升教师间教材内聚度和工作量均衡性。
              对 200 班级以上的大规模课程效果显著。
            </p>
          </div>
          <el-switch
            v-model="enabled"
            :loading="saving"
            inline-prompt
            active-text="开"
            inactive-text="关"
            size="large"
          />
        </div>

        <div v-if="enabled" class="enabled-hint">
          <el-icon color="var(--brand-success)"><CircleCheckFilled /></el-icon>
          <span>已启用 — 排课时将在贪心算法后自动执行禁忌搜索优化阶段</span>
        </div>
        <div v-else class="enabled-hint off">
          <el-icon><InfoFilled /></el-icon>
          <span>已关闭 — 排课仅使用贪心算法 + 置换回溯，行为与之前版本一致</span>
        </div>
      </div>
    </div>

    <div class="scheduling-actions">
      <el-button
        type="primary"
        size="large"
        :loading="saving"
        :disabled="!dirty"
        @click="handleSave"
      >
        <el-icon><Check /></el-icon>
        保存设置
      </el-button>
      <span v-if="dirty" class="dirty-hint">有未保存的更改</span>
    </div>
  </el-card>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useSettingsStore } from '../../../stores/settings';

const settingsStore = useSettingsStore();
const enabled = ref(false);
const savedValue = ref(false);
const saving = ref(false);
const dirty = ref(false);

watch(enabled, () => {
  dirty.value = enabled.value !== savedValue.value;
});

async function loadState() {
  await settingsStore.load();
  const s = settingsStore.settings;
  const val = s.tabuSearchEnabled?.value === 'true';
  enabled.value = val;
  savedValue.value = val;
  dirty.value = false;
}

async function handleSave() {
  saving.value = true;
  try {
    await settingsStore.save({ tabuSearchEnabled: enabled.value });
    savedValue.value = enabled.value;
    dirty.value = false;
    ElMessage.success(enabled.value ? '禁忌搜索已启用' : '禁忌搜索已关闭');
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || '未知错误'));
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  loadState();
});
</script>

<style scoped>
.scheduling-card {
  margin-bottom: 20px;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot-green {
  background-color: var(--brand-success, #67c23a);
}

.card-title-text {
  font-weight: 600;
  font-size: 16px;
  color: var(--text-primary);
}

.scheduling-body {
  padding: var(--space-5, 20px) 0 var(--space-2, 8px);
}

.config-item {
  max-width: 640px;
}

.switch-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
}

.switch-info {
  flex: 1;
}

.field-label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  font-size: 14px;
  color: var(--text-regular);
}

.switch-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.enabled-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--brand-success, #67c23a);
}

.enabled-hint.off {
  color: var(--text-secondary);
}

.scheduling-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: var(--space-4, 16px);
  border-top: 1px solid var(--border-light, #ebeef5);
}

.dirty-hint {
  font-size: 13px;
  color: var(--el-color-warning, #e6a23c);
}

@media (max-width: 768px) {
  .switch-row {
    flex-direction: column-reverse;
    align-items: flex-start;
  }
}
</style>
