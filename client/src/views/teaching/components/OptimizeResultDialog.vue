<template>
  <el-dialog
    :model-value="modelValue"
    title="排课优化结果"
    width="var(--dialog-width-xl)"
    destroy-on-close
    class="optimize-result-dialog"
    top="6vh"
    @update:model-value="emit('update:modelValue', $event)"
    @close="emit('close')"
  >
    <!-- 汇总统计 -->
    <div class="optimize-summary">
      <div class="optimize-stat-card is-primary">
        <div class="optimize-stat-num text-brand">
          {{ result.summary?.changedClasses || 0 }}
        </div>
        <div class="optimize-stat-label">优化班级数</div>
      </div>
      <div class="optimize-stat-card is-success">
        <div class="optimize-stat-num text-success">
          {{ result.summary?.improvedCourses || 0 }}
        </div>
        <div class="optimize-stat-label">改善课程数</div>
      </div>
      <div class="optimize-stat-card">
        <div class="optimize-stat-num">
          {{ result.summary?.affectedTeachers || 0 }}
        </div>
        <div class="optimize-stat-label">涉及教师数</div>
      </div>
      <div class="optimize-stat-card">
        <div class="optimize-stat-num">
          {{ result.summary?.totalIterations || 0 }}
        </div>
        <div class="optimize-stat-label">优化迭代次数</div>
      </div>
    </div>

    <!-- 改进幅度 -->
    <div class="improvement-section">
      <div class="section-title">优化效果</div>
      <div class="improvement-grid">
        <div class="improvement-item">
          <div class="improvement-label">综合评分</div>
          <div class="improvement-values">
            <span class="value-before">{{ result.before?.score || 0 }}</span>
            <el-icon class="arrow-icon"><ArrowRight /></el-icon>
            <span class="value-after">{{ result.after?.score || 0 }}</span>
          </div>
          <div class="improvement-delta" :class="result.improvements?.scoreImprovement > 0 ? 'is-positive' : 'is-negative'">
            {{ result.improvements?.scoreImprovement > 0 ? '↓' : '↑' }}
            {{ Math.abs(result.improvements?.scoreImprovement || 0).toFixed(1) }}%
          </div>
        </div>

        <div class="improvement-item">
          <div class="improvement-label">负载均衡度</div>
          <div class="improvement-values">
            <span class="value-before">{{ (result.before?.loadVariance || 0).toFixed(4) }}</span>
            <el-icon class="arrow-icon"><ArrowRight /></el-icon>
            <span class="value-after">{{ (result.after?.loadVariance || 0).toFixed(4) }}</span>
          </div>
          <div class="improvement-delta" :class="result.improvements?.loadVarianceImprovement > 0 ? 'is-positive' : 'is-negative'">
            {{ result.improvements?.loadVarianceImprovement > 0 ? '↓' : '↑' }}
            {{ Math.abs(result.improvements?.loadVarianceImprovement || 0).toFixed(1) }}%
          </div>
        </div>

        <div class="improvement-item">
          <div class="improvement-label">教材内聚度</div>
          <div class="improvement-values">
            <span class="value-before">{{ (result.before?.cohesionScore || 0).toFixed(2) }}</span>
            <el-icon class="arrow-icon"><ArrowRight /></el-icon>
            <span class="value-after">{{ (result.after?.cohesionScore || 0).toFixed(2) }}</span>
          </div>
          <div class="improvement-delta" :class="result.improvements?.cohesionImprovement > 0 ? 'is-positive' : 'is-negative'">
            {{ result.improvements?.cohesionImprovement > 0 ? '↑' : '↓' }}
            {{ Math.abs(result.improvements?.cohesionImprovement || 0).toFixed(1) }}%
          </div>
        </div>
      </div>
    </div>

    <!-- 阈值警告 -->
    <el-alert
      v-if="!result.meetsThreshold"
      type="warning"
      :closable="false"
      show-icon
      class="threshold-warning"
    >
      <template #title>优化效果未达到阈值</template>
      <div>
        当前优化未达到最小改进阈值（至少3个班级变更且评分改进>5%），建议保持现有排课方案。
        如果仍要应用，请点击下方"应用优化"按钮。
      </div>
    </el-alert>

    <!-- 变更详情 -->
    <div v-if="result.changes?.length > 0" class="changes-section">
      <div class="section-title">变更详情（{{ result.changes.length }}项）</div>
      <div class="changes-list">
        <div v-for="(change, index) in result.changes" :key="index" class="change-item">
          <div class="change-index">{{ index + 1 }}</div>
          <div class="change-content">
            <div class="change-class">{{ change.className }}</div>
            <div class="change-teachers">
              <span class="teacher-from">{{ change.fromTeacherName }}</span>
              <el-icon class="change-arrow"><Right /></el-icon>
              <span class="teacher-to">{{ change.toTeacherName }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="emit('close')">取消</el-button>
        <el-button type="primary" :loading="applying" @click="emit('apply')">
          应用优化（{{ result.changes?.length || 0 }}个变更）
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ArrowRight, Right } from '@element-plus/icons-vue';

defineProps({
  modelValue: { type: Boolean, default: false },
  result: { type: Object, default: () => ({}) },
  applying: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'apply', 'close']);
</script>

<style scoped>
:deep(.optimize-result-dialog) .el-dialog__body {
  padding: var(--space-4) 20px;
}

.optimize-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.optimize-stat-card {
  background: var(--bg-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-2);
  text-align: center;
  border: 1px solid transparent;
  transition: border-color var(--dur-base) var(--ease-out);
}

.optimize-stat-card.is-primary {
  background: var(--brand-primary-soft);
  border-color: var(--brand-primary-lighter);
}

.optimize-stat-card.is-success {
  background: var(--brand-success-soft);
  border-color: var(--brand-success-lighter);
}

.optimize-stat-num {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.optimize-stat-num.text-brand {
  color: var(--brand-primary);
}

.optimize-stat-num.text-success {
  color: var(--brand-success-text);
}

.optimize-stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: var(--space-1);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-3);
}

.improvement-section {
  margin-bottom: var(--space-4);
}

.improvement-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-3);
}

.improvement-item {
  background: var(--bg-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  border: 1px solid var(--border-light);
}

.improvement-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: var(--space-2);
}

.improvement-values {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
  font-variant-numeric: tabular-nums;
}

.value-before {
  font-size: 16px;
  color: var(--text-secondary);
  font-weight: 500;
}

.value-after {
  font-size: 18px;
  color: var(--text-primary);
  font-weight: 700;
}

.arrow-icon {
  color: var(--text-placeholder);
}

.improvement-delta {
  font-size: 13px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  display: inline-block;
}

.improvement-delta.is-positive {
  background: var(--brand-success-soft);
  color: var(--brand-success-text);
}

.improvement-delta.is-negative {
  background: var(--brand-danger-soft);
  color: var(--brand-danger-text);
}

.threshold-warning {
  margin-bottom: var(--space-4);
}

.changes-section {
  margin-bottom: var(--space-3);
}

.changes-list {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
}

.change-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-light);
  transition: background 0.15s;
}

.change-item:last-child {
  border-bottom: none;
}

.change-item:hover {
  background: var(--bg-subtle);
}

.change-index {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--brand-primary-soft);
  color: var(--brand-primary);
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.change-content {
  flex: 1;
  min-width: 0;
}

.change-class {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.change-teachers {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 13px;
}

.teacher-from {
  color: var(--text-secondary);
}

.change-arrow {
  color: var(--brand-primary);
}

.teacher-to {
  color: var(--brand-primary);
  font-weight: 500;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
