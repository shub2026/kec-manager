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
      <!-- 数据行 -->
      <div v-for="(item, idx) in displayData" :key="item.id" class="table-row">
        <div class="col-name" :title="item.name">
          <i class="row-dot" :style="{ background: barColor(idx) }"></i>
          {{ item.name }}
        </div>
        <div class="col-hours">
          <span class="hours-bar-wrap">
            <span class="hours-bar" :style="{ width: barWidth(item.totalHours) + '%', backgroundColor: barColor(idx) }" />
          </span>
          <span class="hours-value">{{ item.totalHours }}</span>
        </div>
        <div class="col-meta">
          <span class="meta-label">{{ item.classCount }}<small>班</small></span>
          <span class="meta-divider"></span>
          <span class="meta-label">{{ item.teacherCount }}<small>人</small></span>
        </div>
      </div>

      <!-- 底部汇总 -->
      <div class="table-footer">
        <span>共 {{ data.length }} 门课程</span>
        <span>合计 <strong>{{ totalHours }}</strong> 课时</span>
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
  return [...props.data]
    .sort((a, b) => b.totalHours - a.totalHours)
    .slice(0, 8);
});

function barWidth(hours) {
  return Math.max(4, (hours / maxHours.value) * 100);
}

// 暖珊瑚红单色阶：与主蓝 #1C82F5 形成互补对比，饱和度/亮度与整体风格统一
const palette = [
  '#F87171', // red-400
  'rgba(248, 113, 113, 0.78)',
  'rgba(248, 113, 113, 0.58)',
  'rgba(248, 113, 113, 0.42)',
  'rgba(248, 113, 113, 0.28)',
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
  padding: 24px 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.stats-table {
  padding: 2px 0;
}

/* 数据行 */
.table-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 140px 92px;
  gap: 8px;
  align-items: center;
  padding: 4px 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.stats-table:hover .table-row:not(:hover) {
  opacity: 0.55;
}

.col-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-regular);
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

.col-hours {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hours-bar-wrap {
  flex: 1;
  height: 10px;
  background: var(--bg-subtle);
  border-radius: 3px;
  overflow: hidden;
}

.hours-bar {
  display: block;
  height: 100%;
  border-radius: 3px;
  transition: width 0.6s var(--ease-out);
  min-width: 3px;
}

.hours-value {
  width: 36px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 班级+教师合并列 */
.col-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-regular);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.col-meta small {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary);
  margin-left: 1px;
}

.meta-divider {
  width: 1px;
  height: 12px;
  background: var(--border-light);
}

/* 底部汇总 */
.table-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border-light);
  font-size: 12px;
  color: var(--text-secondary);
}

.table-footer strong {
  color: var(--text-primary);
  font-weight: 600;
}
</style>
