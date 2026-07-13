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

      <el-divider />

      <div class="config-item">
        <div class="switch-row">
          <div class="switch-info">
            <label class="field-label">允许编辑历史学期</label>
            <p class="switch-desc">
              默认关闭：历史（非当前）学期在教学安排页为<strong>只读状态</strong>，禁止任何排课写操作，避免误改已结课数据。
              开启后：历史学期可编辑，但在自动排课 / 手动安排 / 重置 / 执行预览等写操作保存前，会弹出二次确认弹窗，确认后方可执行。
            </p>
          </div>
          <el-switch
            v-model="allowHistoricalEdit"
            :loading="saving"
            inline-prompt
            active-text="开"
            inactive-text="关"
            size="large"
          />
        </div>
        <div v-if="allowHistoricalEdit" class="enabled-hint">
          <el-icon color="var(--brand-success)"><CircleCheckFilled /></el-icon>
          <span>已开启 — 历史学期可编辑，但写操作保存前需二次确认</span>
        </div>
        <div v-else class="enabled-hint off">
          <el-icon><InfoFilled /></el-icon>
          <span>已关闭 — 历史学期为只读状态，禁止编辑（默认）</span>
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
const allowHistoricalEdit = ref(false);
const savedAllow = ref(false);
const saving = ref(false);
const dirty = ref(false);

watch([enabled, allowHistoricalEdit], () => {
  dirty.value =
    enabled.value !== savedValue.value || allowHistoricalEdit.value !== savedAllow.value;
});

async function loadState() {
  await settingsStore.load();
  const s = settingsStore.settings;
  const tabu = s.tabuSearchEnabled?.value === 'true';
  const allow = s.allowHistoricalEdit?.value === 'true';
  enabled.value = tabu;
  savedValue.value = tabu;
  allowHistoricalEdit.value = allow;
  savedAllow.value = allow;
  dirty.value = false;
}

async function handleSave() {
  saving.value = true;
  try {
    await settingsStore.save({
      tabuSearchEnabled: enabled.value,
      allowHistoricalEdit: allowHistoricalEdit.value,
    });
    savedValue.value = enabled.value;
    savedAllow.value = allowHistoricalEdit.value;
    dirty.value = false;
    ElMessage.success('设置已保存');
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
  background-color: var(--brand-success, #34d399);
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
  color: var(--brand-success, #34d399);
}

.enabled-hint.off {
  color: var(--text-secondary);
}

.scheduling-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: var(--space-4, 16px);
  border-top: 1px solid var(--border-light, #e2e8f0);
}

.dirty-hint {
  font-size: 13px;
  color: var(--el-color-warning, #fbbf24);
}

@media (max-width: 768px) {
  .switch-row {
    flex-direction: column-reverse;
    align-items: flex-start;
  }
}
</style>
