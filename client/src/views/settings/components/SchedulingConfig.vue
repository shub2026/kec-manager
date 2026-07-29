<template>
  <el-card class="scheduling-card">
    <template #header>
      <SettingsCardHeader dot="green" tag="高级设置" tag-type="success"
        >排课优化</SettingsCardHeader
      >
    </template>

    <div class="scheduling-body">
      <div class="config-item">
        <div class="switch-row">
          <div class="switch-info">
            <label class="field-label">
              禁忌搜索优化
              <el-tag
                v-if="tabuDirty"
                size="small"
                type="warning"
                effect="plain"
                class="unsaved-tag"
                disable-transitions
                >未保存</el-tag
              >
            </label>
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
            <label class="field-label">
              允许编辑历史学期
              <el-tag
                v-if="historicalDirty"
                size="small"
                type="warning"
                effect="plain"
                class="unsaved-tag"
                disable-transitions
                >未保存</el-tag
              >
            </label>
            <p class="switch-desc">
              默认关闭：历史（非当前）学期在教学安排页为<strong>只读状态</strong>，禁止任何排课写操作，避免误改已结课数据。
              <br />
              开启后：历史学期可编辑，但在自动排课 / 手动安排 / 重置 /
              执行预览等写操作保存前，会弹出二次确认弹窗，确认后方可执行。
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
      <div v-if="dirty" class="dirty-hint">
        <el-icon color="var(--el-color-warning)"><WarningFilled /></el-icon>
        <span>有未保存的更改，请点击保存</span>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { WarningFilled } from '@element-plus/icons-vue';
import { useSettingsStore } from '../../../stores/settings';
import SettingsCardHeader from './SettingsCardHeader.vue';

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

// 各开关独立脏状态追踪，用于显示“未保存”标签
const tabuDirty = computed(() => enabled.value !== savedValue.value);
const historicalDirty = computed(() => allowHistoricalEdit.value !== savedAllow.value);

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
  /* 卡片在 tab-pane 内，无需底部间距 */
}

.scheduling-body {
  padding: var(--space-6, 24px) 0 var(--space-4, 16px);
}

.config-item {
  max-width: 800px;
  padding: var(--space-2) 0;
}

.config-item + .config-item {
  margin-top: var(--space-4);
}

.switch-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  /* --space-8 未在令牌中定义（只到 --space-7），会使 gap 失效为 0 */
  gap: var(--space-7);
}

.switch-info {
  flex: 1;
}

.field-label {
  display: block;
  margin-bottom: var(--space-3);
  font-weight: 500;
  font-size: 14px;
  color: var(--text-regular);
  letter-spacing: 0.01em;
}

.switch-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
}

.enabled-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--space-4);
  font-size: 13px;
  /* 白底小字需 -text 深阶达标对比度，400 档仅用于图形/图标 */
  color: var(--brand-success-text, #047857);
}

.enabled-hint.off {
  color: var(--text-secondary);
}

.scheduling-actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding-top: var(--space-5, 20px);
  border-top: 1px solid var(--border-light, #e2e8f0);
}

.dirty-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--el-color-warning, #ff6b1a);
}

.unsaved-tag {
  margin-left: 8px;
  vertical-align: middle;
}

@media (max-width: 768px) {
  .switch-row {
    flex-direction: column-reverse;
    align-items: flex-start;
  }
}
</style>
