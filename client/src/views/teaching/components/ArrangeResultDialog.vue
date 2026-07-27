<template>
  <el-dialog
    :model-value="modelValue"
    :title="`${mode}排课结果`"
    width="var(--dialog-width-lg)"
    destroy-on-close
    class="arrange-result-dialog"
    top="10vh"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- 汇总统计 -->
    <div class="arrange-summary">
      <div class="arrange-stat-card is-success">
        <div class="arrange-stat-num text-success">{{ result.autoCount || 0 }}</div>
        <div class="arrange-stat-label">自动安排</div>
      </div>
      <div class="arrange-stat-card">
        <div class="arrange-stat-num">{{ result.manualCount || 0 }}</div>
        <div class="arrange-stat-label">手动安排</div>
      </div>
      <div class="arrange-stat-card" :class="{ 'is-warning': (result.unassignedCount || 0) > 0 }">
        <div
          class="arrange-stat-num"
          :class="(result.unassignedCount || 0) > 0 ? 'text-warning' : ''"
        >
          {{ result.unassignedCount || 0 }}
        </div>
        <div class="arrange-stat-label">未分配</div>
      </div>
      <div class="arrange-stat-card is-primary">
        <div class="arrange-stat-num text-brand">{{ result.totalClasses || 0 }}</div>
        <div class="arrange-stat-label">班级总数</div>
      </div>
    </div>

    <!-- 教材内聚度指标 -->
    <div v-if="result.statistics" class="arrange-cohesion">
      <div class="cohesion-title">教材内聚度</div>
      <div class="cohesion-metrics">
        <div class="cohesion-metric">
          <span class="cohesion-num" :class="cohesionRateClass"
            >{{ result.statistics.textbookCohesionRate ?? '-' }}%</span
          >
          <span class="cohesion-label">内聚率</span>
        </div>
        <div class="cohesion-metric">
          <span class="cohesion-num">{{ result.statistics.avgTextbookPerTeacher ?? '-' }}</span>
          <span class="cohesion-label">人均教材数</span>
        </div>
        <div class="cohesion-metric">
          <span
            class="cohesion-num"
            :class="{ 'text-warning': (result.statistics.scatteredTeacherCount || 0) > 0 }"
            >{{ result.statistics.scatteredTeacherCount ?? 0 }}</span
          >
          <span class="cohesion-label">分散教师数</span>
        </div>
      </div>
      <div class="cohesion-hint">内聚率越高表示教师教材越集中；分散教师数指教材数≥2 的教师</div>
    </div>

    <!-- 警告信息 -->
    <div v-if="result.warnings?.length" class="arrange-warnings">
      <div v-for="(w, i) in result.warnings" :key="i" class="arrange-warning-item">
        <el-icon><Warning /></el-icon> {{ w }}
      </div>
    </div>

    <!-- 未分配班级详情 -->
    <div v-if="result.unassigned?.length" class="arrange-unassigned">
      <div class="arrange-section-title">未分配班级（{{ result.unassigned.length }}）</div>
      <div v-for="u in result.unassigned" :key="u.classId" class="arrange-unassigned-item">
        <span class="unassigned-class-name">{{ u.className }}</span>
        <span class="unassigned-hours">{{ u.weeklyHours }} 课时</span>
        <span v-if="u.reason" class="unassigned-reason">{{ u.reason }}</span>
      </div>
    </div>

    <!-- 全部完成 -->
    <div v-if="!result.unassigned?.length && !result.warnings?.length" class="arrange-all-done">
      <div class="all-done-icon">
        <el-icon :size="26"><CircleCheckFilled /></el-icon>
      </div>
      <span>所有班级均已安排</span>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
      <el-button v-if="previewMode" type="primary" :loading="arranging" @click="emit('execute')">
        <el-icon><Check /></el-icon> 执行排课
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  result: { type: Object, default: () => ({}) },
  mode: { type: String, default: '' },
  previewMode: { type: Boolean, default: false },
  arranging: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'execute']);

const cohesionRateClass = computed(() => {
  const rate = props.result?.statistics?.textbookCohesionRate;
  if (rate == null) return '';
  if (rate >= 70) return 'text-success';
  if (rate >= 40) return 'text-warning';
  return 'text-danger';
});
</script>

<style scoped>
:deep(.arrange-result-dialog) .el-dialog__body {
  padding: var(--space-4) 20px;
}
.arrange-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: var(--space-4);
}
.arrange-stat-card {
  background: var(--bg-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-2);
  text-align: center;
  border: 1px solid transparent;
  transition: border-color var(--dur-base) var(--ease-out);
}
.arrange-stat-card.is-success {
  background: var(--brand-success-soft);
  border-color: var(--brand-success-lighter);
}
.arrange-stat-card.is-warning {
  background: var(--brand-warning-soft);
  border-color: var(--brand-warning-lighter);
}
.arrange-stat-card.is-primary {
  background: var(--brand-primary-soft);
  border-color: var(--brand-primary-lighter);
}
.arrange-stat-num {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.arrange-stat-num.text-success {
  color: var(--brand-success-text);
}
.arrange-stat-num.text-warning {
  color: var(--brand-warning-text);
}
.arrange-stat-num.text-brand {
  color: var(--brand-primary);
}
.arrange-stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: var(--space-1);
}
.arrange-cohesion {
  margin: var(--space-3) 0;
  padding: var(--space-3) 14px;
  background: var(--bg-subtle);
  border-radius: var(--radius-md);
  border-left: 3px solid var(--brand-primary);
}
.cohesion-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: var(--space-2);
}
.cohesion-metrics {
  display: flex;
  gap: var(--space-5);
  margin-bottom: 6px;
}
.cohesion-metric {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.cohesion-num {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.2;
}
.cohesion-num.text-success {
  color: var(--brand-success-text);
}
.cohesion-num.text-warning {
  color: var(--brand-warning-text);
}
.cohesion-num.text-danger {
  color: var(--brand-danger-text);
}
.cohesion-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.cohesion-hint {
  font-size: 11px;
  color: var(--text-placeholder);
  margin-top: var(--space-1);
}
.arrange-warnings {
  margin-bottom: var(--space-3);
}
.arrange-warning-item {
  color: var(--brand-warning-text);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-2) var(--space-3);
  background: var(--brand-warning-soft);
  border-left: 3px solid var(--brand-warning);
  border-radius: var(--radius-sm);
  margin-bottom: 6px;
  font-size: 13px;
}
.arrange-unassigned {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-3) 14px;
  max-height: 260px;
  overflow-y: auto;
}
.arrange-unassigned .arrange-section-title {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 600;
  margin-bottom: var(--space-2);
}
.arrange-unassigned-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  border-bottom: 1px solid var(--bg-subtle);
}
.arrange-unassigned-item:last-child {
  border-bottom: none;
}
.unassigned-class-name {
  font-weight: 500;
  color: var(--text-primary);
}
.unassigned-hours {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.unassigned-reason {
  font-size: 12px;
  color: var(--brand-warning-text);
  margin-left: auto;
}
.arrange-all-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-5) 0 var(--space-4);
  color: var(--brand-success-text);
  font-size: 14px;
  font-weight: 500;
}
.all-done-icon {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--brand-success-soft);
  color: var(--brand-success-text);
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
