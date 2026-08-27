<template>
  <el-card class="insight-card">
    <template #header>
      <span class="card-title" role="heading" aria-level="2">
        <el-icon><Histogram /></el-icon>
        计划课时分布
      </span>
    </template>

    <div v-if="!data || data.length === 0" class="chart-empty">
      <span>暂无计划课时数据</span>
    </div>

    <div v-else class="chart-container">
      <div v-for="item in data" :key="item.name" class="chart-row">
        <div class="chart-label" :title="item.name">{{ item.name }}</div>
        <div class="chart-bar-wrap">
          <div
            class="chart-bar"
            :style="{
              transform: `scaleX(${barWidth(item.hours) / 100})`,
              backgroundColor: barColor(item),
            }"
          />
        </div>
        <div class="chart-value">{{ item.hours }}</div>
      </div>

      <div class="chart-footer">
        <span>单位：计划课时/周</span>
        <span>共 {{ totalHours }} 计划课时</span>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  data: { type: Array, default: () => [] },
});

const maxHours = computed(() => {
  if (!props.data || props.data.length === 0) return 1;
  return Math.max(...props.data.map((d) => d.hours), 1);
});

const totalHours = computed(() => {
  // 保留一位小数，与 CourseStatsCard / 后端 distribution.hours 精度对齐，避免浮点尾差
  return Math.round(props.data.reduce((sum, d) => sum + d.hours, 0) * 10) / 10;
});

function barWidth(hours) {
  return Math.max(2, (hours / maxHours.value) * 100);
}

const palette = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

function barColor(item) {
  const idx = props.data.indexOf(item) % palette.length;
  return palette[idx];
}
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

.chart-container {
  padding: 2px 0;
}

.chart-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-light);
  transition: opacity var(--dur-fast) var(--ease-out);
}

.chart-row:last-of-type {
  border-bottom: none;
}

.chart-label {
  width: 88px;
  flex-shrink: 0;
  font-size: var(--font-size-caption);
  color: var(--text-regular);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chart-bar-wrap {
  flex: 1;
  height: 10px;
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.chart-bar {
  height: 100%;
  width: 100%;
  transform-origin: left;
  transform: scaleX(0);
  border-radius: var(--radius-sm);
  transition:
    transform var(--dur-slow) var(--ease-out),
    filter var(--dur-fast) var(--ease-out);
}

@media (hover: hover) {
  .chart-row:hover .chart-bar {
    filter: brightness(1.12);
  }

  .chart-container:hover .chart-row:not(:hover) {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chart-bar {
    transition: none;
  }
}

.chart-value {
  width: 36px;
  flex-shrink: 0;
  font-size: var(--font-size-body-sm);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.chart-footer {
  display: flex;
  justify-content: space-between;
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1.5px solid var(--border-light);
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}
</style>
