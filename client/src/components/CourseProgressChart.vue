<template>
  <el-card class="insight-card">
    <template #header>
      <span class="card-title">
        <el-icon><TrendCharts /></el-icon>
        排课进度
      </span>
    </template>

    <div v-if="total === 0" class="chart-empty">
      <span>暂无排课数据</span>
    </div>

    <div v-else class="progress-chart">
      <!-- 汇总百分比 -->
      <div class="summary">
        <div class="summary-percent">{{ rate }}<span class="percent-sign">%</span></div>
        <div class="summary-label">已排课占比</div>
      </div>

      <!-- 进度条 -->
      <div class="progress-bar">
        <div class="progress-track">
          <div class="progress-filled" :style="{ width: rate + '%' }" />
        </div>
      </div>

      <!-- 图例 -->
      <div class="legend">
        <span class="legend-item">
          <i class="dot dot-filled"></i>
          已排课 <strong>{{ assigned }}</strong> 门
        </span>
        <span class="legend-item">
          <i class="dot dot-remaining"></i>
          剩余 <strong>{{ remaining }}</strong> 门
        </span>
      </div>

      <!-- 课时概要 -->
      <div class="hours-summary">
        <span class="hours-tag hours-tag-filled">
          已排 <strong>{{ assignedHours }}</strong> 课时
        </span>
        <span class="hours-tag hours-tag-remaining">
          剩余 <strong>{{ remainingHours }}</strong> 课时
        </span>
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
  data: {
    type: Object,
    default: () => ({ totalCourses: 0, assignedCourses: 0, rate: 0 }),
  },
  totalHours: { type: Number, default: 0 },
  // 真实已排周课时（后端合班去重值）；缺省时回退按课程门数比例估算
  assignedHours: { type: Number, default: null },
});

const total = computed(() => props.data?.totalCourses || 0);
const assigned = computed(() => props.data?.assignedCourses || 0);
const remaining = computed(() => Math.max(0, total.value - assigned.value));
const rate = computed(() => {
  if (total.value === 0) return 0;
  return Math.round((assigned.value / total.value) * 100);
});

// 课时回退估算的每门课平均周课时（仅在无后端实际值时使用）
const AVG_HOURS_PER_COURSE = 16;

// 统一保留一位小数，与后端 assignedWeeklyHours/totalWeeklyHours 精度对齐
function round1(n) {
  return Math.round(n * 10) / 10;
}

const assignedHours = computed(() => {
  if (props.assignedHours != null) {
    return round1(props.assignedHours);
  }
  if (props.totalHours > 0 && total.value > 0) {
    return round1(props.totalHours * (assigned.value / total.value));
  }
  return assigned.value * AVG_HOURS_PER_COURSE;
});
const remainingHours = computed(() => {
  if (props.assignedHours != null) {
    return Math.max(0, round1(props.totalHours - props.assignedHours));
  }
  if (props.totalHours > 0 && total.value > 0) {
    return round1(props.totalHours * (remaining.value / total.value));
  }
  return remaining.value * AVG_HOURS_PER_COURSE;
});
</script>

<style scoped>
.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6) 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.progress-chart {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* 汇总百分比 */
.summary {
  text-align: center;
  padding: 4px 0 0;
}

.summary-percent {
  font-size: var(--font-size-display-lg);
  font-weight: 700;
  /* 白底大数字需 600 档语义色达标对比度(3:1)，400 档仅用于图形填充 */
  color: var(--brand-success-text);
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

/* 进度条 */
.progress-track {
  height: 10px;
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.progress-filled {
  height: 100%;
  background: linear-gradient(90deg, var(--brand-success) 0%, var(--brand-success-soft) 100%);
  border-radius: var(--radius-sm);
  transition: width 0.6s var(--ease-out);
  min-width: 4px;
}

/* 图例 */
.legend {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-secondary);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

/* 课时概要标签 */
.hours-summary {
  display: flex;
  gap: var(--space-2);
}

.hours-tag {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
}

.hours-tag strong {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.hours-tag-filled {
  background: var(--brand-success-soft);
  color: var(--brand-success-text);
}

.hours-tag-remaining {
  background: var(--bg-subtle);
  color: var(--text-regular);
}

/* 完成提示 */
.complete-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px var(--space-3);
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
