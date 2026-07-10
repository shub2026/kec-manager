<template>
  <el-card class="insight-card">
    <template #header>
      <span class="card-title">
        <el-icon><TrendCharts /></el-icon>
        课程排课进度
      </span>
    </template>

    <div v-if="total === 0" class="chart-empty">
      <span>暂无排课数据</span>
    </div>

    <div v-else class="progress-chart">
      <!-- 汇总环形指标 -->
      <div class="summary">
        <div class="summary-percent">{{ rate }}<span class="percent-sign">%</span></div>
        <div class="summary-label">已排课占比</div>
      </div>

      <!-- 双段对比条：已排课(品牌绿) + 剩余(浅灰) -->
      <div class="dual-bar">
        <div class="dual-bar-track">
          <div class="dual-bar-filled" :style="{ width: rate + '%' }" />
        </div>
        <div class="dual-bar-legend">
          <span class="legend-item">
            <i class="dot dot-filled"></i>
            已排课 <strong>{{ assigned }}</strong> 门
          </span>
          <span class="legend-item">
            <i class="dot dot-remaining"></i>
            剩余 <strong>{{ remaining }}</strong> 门
          </span>
        </div>
      </div>

      <!-- 课时维度对比 -->
      <div class="hours-compare">
        <div class="compare-row">
          <span class="compare-label">已排课时</span>
          <span class="compare-value compare-value-filled">{{ assignedHours }}</span>
        </div>
        <div class="compare-divider"></div>
        <div class="compare-row">
          <span class="compare-label">剩余课时</span>
          <span class="compare-value compare-value-remaining">{{ remainingHours }}</span>
        </div>
      </div>

      <div v-if="remaining === 0" class="complete-hint">
        <el-icon><CircleCheckFilled /></el-icon>
        <span>全部课程已排课完成</span>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { computed } from 'vue';
import { TrendCharts, CircleCheckFilled } from '@element-plus/icons-vue';

const props = defineProps({
  /** 排课完成度数据：{ totalCourses, assignedCourses, rate } */
  data: {
    type: Object,
    default: () => ({ totalCourses: 0, assignedCourses: 0, rate: 0 }),
  },
  /** 全局本学期开设课程总周课时(来自培养方案),用于按比例分摊已排/剩余课时 */
  totalHours: { type: Number, default: 0 },
});

const total = computed(() => props.data?.totalCourses || 0);
const assigned = computed(() => props.data?.assignedCourses || 0);
const remaining = computed(() => Math.max(0, total.value - assigned.value));
// rate 后端可能缺失或未更新,以前端派生为准确保一致
const rate = computed(() => {
  if (total.value === 0) return 0;
  return Math.round((assigned.value / total.value) * 100);
});

// 课时维度：按课程排课比例分摊计划总课时
// totalHours = 本学期开设课程总周课时（来自培养方案），按 assigned/total 比例拆分
const AVG_HOURS_PER_COURSE = 16;
const assignedHours = computed(() => {
  if (props.totalHours > 0 && total.value > 0) {
    return Math.round(props.totalHours * (assigned.value / total.value));
  }
  return assigned.value * AVG_HOURS_PER_COURSE;
});
const remainingHours = computed(() => {
  if (props.totalHours > 0 && total.value > 0) {
    return Math.round(props.totalHours * (remaining.value / total.value));
  }
  return remaining.value * AVG_HOURS_PER_COURSE;
});
</script>

<style scoped>
.insight-card {
  height: 100%;
}

.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.progress-chart {
  padding: 4px 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 汇总百分比 — 视觉焦点 */
.summary {
  text-align: center;
  padding: 4px 0 0;
}

.summary-percent {
  font-size: 32px;
  font-weight: 700;
  color: var(--brand-success);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
}

.percent-sign {
  font-size: 18px;
  font-weight: 600;
  margin-left: 2px;
}

.summary-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}

/* 双段对比条 */
.dual-bar-track {
  height: 10px;
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.dual-bar-filled {
  height: 100%;
  background: linear-gradient(90deg, var(--brand-success) 0%, #86EFAC 100%);
  border-radius: var(--radius-sm);
  transition: width 0.6s var(--ease-out);
  min-width: 4px;
}

.dual-bar-legend {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.legend-item strong {
  color: var(--text-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot-filled {
  background: var(--brand-success);
}

.dot-remaining {
  background: var(--border-base);
}

/* 课时维度对比 */
.hours-compare {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
}

.compare-row {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.compare-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.compare-value {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.compare-value-filled {
  color: var(--brand-success);
}

.compare-value-remaining {
  color: var(--text-regular);
}

.compare-divider {
  width: 1px;
  height: 32px;
  background: var(--border-light);
}

/* 完成提示 */
.complete-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--brand-success-soft);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--brand-success-text);
  font-weight: 500;
}

.complete-hint .el-icon {
  color: var(--brand-success);
}
</style>
