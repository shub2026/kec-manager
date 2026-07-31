<template>
  <el-dialog
    :model-value="modelValue"
    title="排课优化结果"
    width="var(--dialog-width-xl)"
    align-center
    destroy-on-close
    class="optimize-result-dialog"
    @update:model-value="emit('update:modelValue', $event)"
    @close="emit('close')"
  >
    <template v-if="result">
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
            <div class="improvement-label">
              综合评分<span class="score-hint">（含惩罚项，可能为负）</span>
            </div>
            <div class="improvement-values">
              <span class="value-before">{{ formatScore(result.before?.score) }}</span>
              <el-icon class="arrow-icon"><ArrowRight /></el-icon>
              <span class="value-after">{{ formatScore(result.after?.score) }}</span>
            </div>
            <div
              class="improvement-delta"
              :class="deltaClass(result.improvements?.scoreImprovement)"
            >
              {{ deltaArrow(result.improvements?.scoreImprovement) }}
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
            <div
              class="improvement-delta"
              :class="deltaClass(result.improvements?.loadVarianceImprovement)"
            >
              {{ deltaArrow(result.improvements?.loadVarianceImprovement) }}
              {{ Math.abs(result.improvements?.loadVarianceImprovement || 0).toFixed(1) }}%
            </div>
          </div>

          <div class="improvement-item">
            <div class="improvement-label">教材内聚度</div>
            <div class="improvement-values">
              <span class="value-before">{{
                (result.before?.textbookCohesionRate || 0).toFixed(2)
              }}</span>
              <el-icon class="arrow-icon"><ArrowRight /></el-icon>
              <span class="value-after">{{
                (result.after?.textbookCohesionRate || 0).toFixed(2)
              }}</span>
            </div>
            <div
              class="improvement-delta"
              :class="deltaClass(result.improvements?.cohesionImprovement)"
            >
              {{ deltaArrow(result.improvements?.cohesionImprovement) }}
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
          当前优化未达到最小改进阈值（评分改进&gt;5%，或3+个班级变更且改进&gt;2%），建议保持现有排课方案。
          如果仍要应用，请点击下方"应用优化"按钮。
        </div>
      </el-alert>

      <!-- 变更详情 -->
      <div v-if="result.changes?.length > 0" class="changes-section">
        <div class="section-title">变更详情（{{ result.changes.length }}项）</div>
        <div class="changes-list">
          <div
            v-for="(change, index) in result.changes"
            :key="`${change.classId}-${change.courseId}`"
            class="change-item"
          >
            <div class="change-index">{{ index + 1 }}</div>
            <div class="change-content">
              <div class="change-class">{{ change.className }}</div>
              <div class="change-teachers">
                <span class="teacher-from">{{ change.fromTeacher?.name }}</span>
                <el-icon class="change-arrow"><Right /></el-icon>
                <span class="teacher-to">{{ change.toTeacher?.name }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-if="result" #footer>
      <div class="dialog-footer">
        <el-button @click="emit('close')">放弃优化</el-button>
        <el-button
          type="primary"
          :loading="applying"
          :disabled="!result.changes?.length"
          @click="emit('apply')"
        >
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

// 评分格式化：保留一位小数，负数加前缀便于辨识
function formatScore(score) {
  if (score == null) return '0';
  const n = Number(score);
  if (Number.isNaN(n)) return '0';
  return n.toFixed(1);
}

// 改进幅度样式类：正值→is-positive，负值→is-negative，0→is-neutral
// inverse=true 表示"降低为好"（预留参数）。注意：后端 improvements 各项
// 已统一为"正值=改善"口径（含负载方差：降低时为正），调用方不应再传 inverse
function deltaClass(val, inverse = false) {
  const n = Number(val) || 0;
  if (n === 0) return 'is-neutral';
  const positive = inverse ? n < 0 : n > 0;
  return positive ? 'is-positive' : 'is-negative';
}

// 改进幅度箭头：正面↑，负面↓，0→—
function deltaArrow(val, inverse = false) {
  const n = Number(val) || 0;
  if (n === 0) return '—';
  const positive = inverse ? n < 0 : n > 0;
  return positive ? '↑' : '↓';
}
</script>

<style scoped>
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
  font-size: var(--font-size-display);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
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

.score-hint {
  font-size: 10px;
  color: var(--text-placeholder);
  margin-left: 4px;
  font-weight: 400;
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

.improvement-delta.is-neutral {
  background: var(--bg-subtle);
  color: var(--text-secondary);
}

.threshold-warning {
  margin-bottom: var(--space-4);
}

.changes-section {
  margin-bottom: var(--space-3);
}

.changes-list {
  max-height: min(320px, 40vh);
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

/* 移动端响应式：网格重排 + footer 按钮等宽 */
@media (max-width: 480px) {
  .optimize-summary {
    grid-template-columns: repeat(2, 1fr);
  }

  .improvement-grid {
    grid-template-columns: 1fr;
  }

  .dialog-footer {
    flex-wrap: wrap;
    justify-content: stretch;
  }

  .dialog-footer .el-button {
    flex: 1;
  }
}
</style>

<!-- 非 scoped：el-dialog 根节点是 Teleport，scope 属性无法附着到弹窗 DOM，
     scoped 下的 :deep(.optimize-result-dialog) 永远不命中；用专属类名限定作用范围防泄漏 -->
<style>
.el-dialog.optimize-result-dialog .el-dialog__body {
  padding: var(--space-4) 20px;
  /* 移动端兜底：高内容弹窗允许 body 滚动，避免 footer 被裁出视口 */
  max-height: calc(90vh - 140px);
  max-height: calc(90dvh - 140px);
  overflow-y: auto;
}
</style>
