<template>
  <el-card class="insight-card">
    <template #header>
      <span class="card-title" role="heading" aria-level="2">
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
        <div class="summary-label">课时完成率</div>
      </div>

      <!-- 进度条 -->
      <div class="progress-bar">
        <div
          class="progress-track"
          role="progressbar"
          :aria-valuenow="rate"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`课时完成率 ${rate}%`"
        >
          <div class="progress-filled" :style="{ transform: `scaleX(${rate / 100})` }" />
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

      <!-- 常驻状态条：完成态绿色提示；未完成态提示待排并支持管理员点击跳转教学安排 -->
      <router-link
        v-if="!isComplete && isAdmin"
        :to="{ name: 'TeachingArrange' }"
        class="status-hint is-pending is-clickable"
      >
        <el-icon><Clock /></el-icon>
        <span>{{ statusText }}</span>
        <el-icon class="status-hint-arrow"><ArrowRight /></el-icon>
      </router-link>
      <div v-else class="status-hint" :class="isComplete ? 'is-done' : 'is-pending'">
        <el-icon>
          <CircleCheckFilled v-if="isComplete" />
          <Clock v-else />
        </el-icon>
        <span>{{ isComplete ? '全部课程已排课完成' : statusText }}</span>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { computed } from 'vue';
import { TrendCharts, CircleCheckFilled, Clock, ArrowRight } from '@element-plus/icons-vue';

const props = defineProps({
  data: {
    type: Object,
    default: () => ({ totalCourses: 0, assignedCourses: 0, rate: 0 }),
  },
  totalHours: { type: Number, default: 0 },
  // 真实已排周课时（后端合班去重值）；缺省时回退按课程门数比例估算
  assignedHours: { type: Number, default: null },
  // 管理员才可跳转教学安排页（路由 requiresAdmin），非管理员状态条仅展示
  isAdmin: { type: Boolean, default: false },
});

const total = computed(() => props.data?.totalCourses || 0);
const assigned = computed(() => props.data?.assignedCourses || 0);
const remaining = computed(() => Math.max(0, total.value - assigned.value));
// rate 使用后端课时口径（已排课时 ÷ 总课时），避免按门数计数时部分排课也虚高至 100%
const rate = computed(() => props.data?.rate ?? 0);

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

// 完成态沿用课时口径 rate>=100 判定，与上方百分比自洽
const isComplete = computed(() => rate.value >= 100);

// 未完成态文案：优先按剩余门数；全部课程均已开排但课时未满的边界态回退为剩余课时
const statusText = computed(() => {
  if (remaining.value > 0) {
    return `剩余 ${remaining.value} 门课程待排课`;
  }
  return `剩余 ${remainingHours.value} 课时待安排`;
});
</script>

<style scoped>
.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6) 0;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
}

.progress-chart {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  /* 撑满卡片高度，配合状态条 margin-top:auto 钉底，吸收同行卡片等高拉伸的留白 */
  height: 100%;
}

/* 汇总百分比 */
.summary {
  text-align: center;
  padding: 4px 0 0;
}

.summary-percent {
  font-size: var(--font-size-display-lg);
  font-weight: 700;
  /* 大数字用深色中性:首屏最大视觉焦点不占色相,绿色语义仅保留在进度条/标签/状态条等小面积元素 */
  color: var(--text-primary);
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
  font-size: var(--font-size-caption);
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
  width: 100%;
  transform-origin: left;
  transform: scaleX(0);
  background: linear-gradient(90deg, var(--brand-success) 0%, var(--el-color-success-light-5) 100%);
  border-radius: var(--radius-sm);
  transition: transform var(--dur-slow) var(--ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .progress-filled {
    transition: none;
  }
}

/* 图例 */
.legend {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-body-sm);
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
  font-size: var(--font-size-body-sm);
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

/* 常驻状态条：钉在卡片底部，按完成/未完成切换色调 */
.status-hint {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-body-sm);
  font-weight: 500;
}

.status-hint.is-done {
  background: var(--brand-success-soft);
  color: var(--brand-success-text);
}

.status-hint.is-done .el-icon {
  color: var(--brand-success);
}

.status-hint.is-pending {
  background: var(--brand-primary-soft);
  /* 深蓝字配极浅蓝底，白底对比度达标 */
  color: var(--brand-primary-active);
}

.status-hint.is-pending .el-icon {
  color: var(--brand-primary);
}

/* 可点击态（管理员未完成）：去下划线 + hover 加深底色、箭头微位移 */
.status-hint.is-clickable {
  text-decoration: none;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.status-hint.is-clickable:hover,
.status-hint.is-clickable:focus-visible {
  background: var(--brand-primary-lighter);
}

.status-hint-arrow {
  transition: transform var(--dur-fast) var(--ease-out);
}

.status-hint.is-clickable:hover .status-hint-arrow {
  transform: translateX(2px);
}

@media (prefers-reduced-motion: reduce) {
  .status-hint.is-clickable,
  .status-hint-arrow {
    transition: none;
  }
}
</style>
