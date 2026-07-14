<template>
  <el-card class="insight-card">
    <template #header>
      <span class="card-title">
        <el-icon><Histogram /></el-icon>
        课时分布
      </span>
    </template>

    <div v-if="!data || data.length === 0" class="chart-empty">
      <span>暂无课时数据</span>
    </div>

    <div v-else class="chart-container">
      <div v-for="item in data" :key="item.name" class="chart-row">
        <div class="chart-label" :title="item.name">{{ item.name }}</div>
        <div class="chart-bar-wrap">
          <div
            class="chart-bar"
            :style="{
              width: barWidth(item.hours) + '%',
              backgroundColor: barColor(item),
            }"
          />
        </div>
        <div class="chart-value">{{ item.hours }}</div>
      </div>

      <div class="chart-footer">
        <span>单位：课时/周</span>
        <span>共 {{ totalHours }} 课时</span>
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
  return props.data.reduce((sum, d) => sum + d.hours, 0);
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
  font-size: 14px;
}

.chart-container {
  padding: var(--space-1) 0;
}

.chart-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: 10px;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.chart-row:last-of-type {
  margin-bottom: 0;
}

.chart-label {
  width: 88px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-regular);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chart-bar-wrap {
  flex: 1;
  height: 20px;
  background: var(--bg-subtle);
  border-radius: 3px;
  overflow: hidden;
}

.chart-bar {
  height: 100%;
  border-radius: 3px;
  transition:
    width 0.6s var(--ease-out),
    filter var(--dur-fast) var(--ease-out);
  min-width: 4px;
}

.chart-row:hover .chart-bar {
  filter: brightness(1.12);
}

.chart-container:hover .chart-row:not(:hover) {
  opacity: 0.55;
}

.chart-value {
  width: 36px;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.chart-footer {
  display: flex;
  justify-content: space-between;
  margin-top: var(--space-3);
  padding-top: 10px;
  border-top: 1px solid var(--border-light);
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
