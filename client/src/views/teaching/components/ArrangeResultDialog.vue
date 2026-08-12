<template>
  <el-dialog
    :model-value="modelValue"
    :title="`${mode}排课结果`"
    width="var(--dialog-width-lg)"
    :fullscreen="isMobile"
    destroy-on-close
    class="arrange-result-dialog"
    align-center
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

    <!-- 固有班级延续统计（仅开启开关且上学期存在排课记录时返回） -->
    <div v-if="result.inherentContinuity" class="arrange-continuity">
      <div class="continuity-title">
        <el-icon><RefreshRight /></el-icon>
        固有班级延续
      </div>
      <div class="continuity-metrics">
        <div class="continuity-metric">
          <span class="continuity-num text-brand"
            >{{ result.inherentContinuity.continuityRate ?? '-'
            }}<small v-if="result.inherentContinuity.continuityRate != null">%</small></span
          >
          <span class="continuity-label">延续率</span>
        </div>
        <div class="continuity-metric">
          <span class="continuity-num">{{ result.inherentContinuity.continuedCount || 0 }}</span>
          <span class="continuity-label">实际延续</span>
        </div>
        <div class="continuity-metric">
          <span class="continuity-num">{{ result.inherentContinuity.candidateCount || 0 }}</span>
          <span class="continuity-label">可延续班级</span>
        </div>
      </div>
      <div class="continuity-hint">延续率 = 上学期任教教师本学期仍教该班的班级占比</div>
    </div>

    <!-- 警告信息 -->
    <div v-if="result.warnings?.length" class="arrange-warnings">
      <div v-for="w in result.warnings" :key="w" class="arrange-warning-item">
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
    </template>
  </el-dialog>
</template>

<script setup>
import { computed } from 'vue';
import { useResponsive } from '../../../composables/useResponsive';

const { isMobile } = useResponsive();

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  result: { type: Object, default: () => ({}) },
  mode: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const cohesionRateClass = computed(() => {
  const rate = props.result?.statistics?.textbookCohesionRate;
  if (rate == null) return '';
  if (rate >= 70) return 'text-success';
  if (rate >= 40) return 'text-warning';
  return 'text-danger';
});
</script>

<style scoped>
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
  font-size: var(--font-size-display);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
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
/* 固有班级延续统计块：与教材内聚度块同构，品牌紫左边条区分语义 */
.arrange-continuity {
  margin: var(--space-3) 0;
  padding: var(--space-3) 14px;
  background: var(--bg-subtle);
  border-radius: var(--radius-md);
  border-left: 3px solid #8b5cf6;
}
.continuity-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: var(--space-2);
}
.continuity-metrics {
  display: flex;
  gap: var(--space-5);
  margin-bottom: 6px;
}
.continuity-metric {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.continuity-num {
  font-size: var(--font-size-h2);
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.continuity-num.text-brand {
  color: #8b5cf6;
}
.continuity-num small {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-left: 1px;
}
.continuity-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.continuity-hint {
  font-size: 12px;
  color: var(--text-placeholder);
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
  font-size: var(--font-size-h2);
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
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
  /* 小视口下随视口收缩，避免与弹窗 body 限高叠加产生双层滚动 */
  max-height: min(260px, 36vh);
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

/* 移动端响应式：统计卡 2 列重排（与 OptimizeResultDialog 同方案） */
@media (max-width: 480px) {
  .arrange-summary {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>

<!-- 非 scoped：el-dialog 根节点是 Teleport，scope 属性无法附着到弹窗 DOM，
     scoped 下的 :deep(.arrange-result-dialog) 永远不命中；用专属类名限定作用范围防泄漏 -->
<style>
.el-dialog.arrange-result-dialog .el-dialog__body {
  padding: var(--space-4) 20px;
}
</style>
