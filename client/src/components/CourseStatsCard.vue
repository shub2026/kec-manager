<template>
  <el-card class="insight-card">
    <template #header>
      <span class="card-title">
        <el-icon><Document /></el-icon>
        课程课时概览
      </span>
    </template>

    <div v-if="!data || data.length === 0" class="chart-empty">
      <span>暂无排课数据</span>
    </div>

    <div v-else class="stats-table">
      <!-- 表头 -->
      <div class="table-head">
        <span class="col-name">课程</span>
        <span class="col-hours-head">课时</span>
        <span class="col-meta-head">
          <span>班</span>
          <span>人</span>
        </span>
      </div>

      <!-- 数据行 -->
      <div v-for="(item, idx) in displayData" :key="item.id" class="table-row">
        <div class="col-name" :title="item.name">
          <i class="row-dot" :style="{ background: barColor(idx) }"></i>
          <span class="name-text">{{ item.name }}</span>
        </div>
        <div class="col-hours">
          <span class="hours-bar-wrap">
            <span
              class="hours-bar"
              :style="{ width: barWidth(item.totalHours) + '%', backgroundColor: barColor(idx) }"
            />
          </span>
          <span class="hours-value">{{ item.totalHours }}</span>
        </div>
        <div class="col-meta">
          <span class="meta-num" data-unit="班">{{ item.classCount }}</span>
          <span class="meta-num" data-unit="人">{{ item.teacherCount }}</span>
        </div>
      </div>

      <!-- 底部汇总 -->
      <div class="table-footer">
        <span>共 {{ data.length }} 门课程</span>
        <span
          >合计 <strong>{{ totalHours }}</strong> 课时</span
        >
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { computed } from 'vue';
import { Document } from '@element-plus/icons-vue';

const props = defineProps({
  data: { type: Array, default: () => [] },
});

const maxHours = computed(() => {
  if (!props.data || props.data.length === 0) return 1;
  return Math.max(...props.data.map((d) => d.totalHours), 1);
});

const totalHours = computed(() => {
  return Math.round(props.data.reduce((sum, d) => sum + d.totalHours, 0) * 10) / 10;
});

const displayData = computed(() => {
  if (!props.data || props.data.length === 0) return [];
  return [...props.data].sort((a, b) => b.totalHours - a.totalHours).slice(0, 8);
});

function barWidth(hours) {
  return Math.max(4, (hours / maxHours.value) * 100);
}

// 主蓝同色阶：与 HoursChart 保持色系一致,中性不引发告警联想
const palette = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

function barColor(idx) {
  return palette[idx % palette.length];
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

.stats-table {
  padding: 2px 0;
}

/* 表头与数据行共用固定轨道:课程名 120px / 课时区 1fr / 班+人 90px */
.table-head,
.table-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr) 90px;
  gap: 10px;
  align-items: center;
}

.table-head {
  padding: 0 0 8px;
  border-bottom: 1px solid var(--border-light);
  margin-bottom: 2px;
}

.table-head .col-name,
.col-hours-head,
.col-meta-head {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
}

.col-hours-head {
  text-align: right;
  padding-right: 46px;
}

.col-meta-head {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
  text-align: center;
}

/* 数据行 */
.table-row {
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
  transition: opacity var(--dur-fast) var(--ease-out);
}

.table-row:last-of-type {
  border-bottom: none;
}

.stats-table:hover .table-row:not(:hover) {
  opacity: 0.55;
}

.col-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-regular);
  min-width: 0;
}

.name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.row-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* 课时列 */
.col-hours {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.hours-bar-wrap {
  flex: 1;
  height: 10px;
  background: var(--bg-subtle);
  border-radius: 3px;
  overflow: hidden;
  min-width: 0;
}

.hours-bar {
  display: block;
  height: 100%;
  border-radius: 3px;
  transition: width 0.6s var(--ease-out);
  min-width: 3px;
}

.hours-value {
  width: 40px;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 班级+教师列 */
.col-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}

.meta-num {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-regular);
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.meta-num::after {
  content: attr(data-unit);
  font-size: 10px;
  font-weight: 400;
  color: var(--text-secondary);
  margin-left: 2px;
}

/* 底部汇总 */
.table-footer {
  display: flex;
  justify-content: space-between;
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1.5px solid var(--border-light);
  font-size: 12px;
  color: var(--text-secondary);
}

.table-footer strong {
  color: var(--text-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
