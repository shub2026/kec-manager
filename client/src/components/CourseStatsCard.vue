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
      <!-- 表头:与数据行共用同一套 grid 轨道,列边界严格对齐 -->
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
  /** [{ id, name, totalHours, classCount, teacherCount }] */
  data: { type: Array, default: () => [] },
});

const maxHours = computed(() => {
  if (!props.data || props.data.length === 0) return 1;
  return Math.max(...props.data.map((d) => d.totalHours), 1);
});

const totalHours = computed(() => {
  return Math.round(props.data.reduce((sum, d) => sum + d.totalHours, 0) * 10) / 10;
});

// 展示数据：按课时降序，最多显示前8条（紧凑布局）
const displayData = computed(() => {
  if (!props.data || props.data.length === 0) return [];
  return [...props.data].sort((a, b) => b.totalHours - a.totalHours).slice(0, 8);
});

function barWidth(hours) {
  return Math.max(4, (hours / maxHours.value) * 100);
}

// 暖珊瑚红单色阶：与主蓝互补，引用 design token 统一管理
const palette = [
  'var(--chart-danger-1)',
  'var(--chart-danger-2)',
  'var(--chart-danger-3)',
  'var(--chart-danger-4)',
  'var(--chart-danger-5)',
];

function barColor(idx) {
  return palette[idx % palette.length];
}
</script>

<style scoped>
.insight-card {
  height: 100%;
}

.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5) 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.stats-table {
  padding: 2px 0;
}

/* —— 表头：与数据行共用固定轨道,保证列边界严格对齐 —— */
/* 轨道:课程名 96px / 课时区 1fr / 班+人 64px */
.table-head,
.table-row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) 64px;
  gap: 10px;
  align-items: center;
}

.table-head {
  padding: 0 0 6px;
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

/* —— 数据行 —— */
.table-row {
  padding: 7px 0;
  border-bottom: 1px solid var(--border-light);
  transition: opacity var(--dur-fast) var(--ease-out);
}

.table-row:last-of-type {
  border-bottom: none;
}

.stats-table:hover .table-row:not(:hover) {
  opacity: 0.55;
}

/* 课程名列:固定宽度,名称超长省略,圆点+名称垂直居中 */
.col-name {
  display: flex;
  align-items: center;
  gap: 6px;
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

/* 课时列:进度条 flex + 数值固定 40px 右对齐 */
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

/* 班级+教师列:内部 1:1 双格 grid,数字右对齐等宽,单位下沉为小字 */
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

/* 为区分两列含义,给数值加极小号单位后缀(不破坏对齐) */
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
  border-top: 1px solid var(--border-light);
  font-size: 12px;
  color: var(--text-secondary);
}

.table-footer strong {
  color: var(--text-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
