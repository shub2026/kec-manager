<template>
  <el-card class="insight-card">
    <template #header>
      <span class="card-title" role="heading" aria-level="2">
        <el-icon><User /></el-icon>
        教师课时
      </span>
    </template>

    <div v-if="!data || data.assignedTeachers === 0" class="chart-empty">
      <span>暂无排课教师</span>
    </div>

    <div v-else class="load-body">
      <!-- 指标行：参与教师数 / 人均周课时 -->
      <div class="load-metrics">
        <div class="metric">
          <span class="metric-label">参与排课教师</span>
          <span class="metric-value">
            {{ data.assignedTeachers }}<i class="metric-total">/{{ data.totalTeachers }} 在职</i>
          </span>
        </div>
        <div class="metric">
          <span class="metric-label">人均周课时</span>
          <span class="metric-value">{{ data.avgHours }}</span>
        </div>
      </div>

      <!-- 课时 TOP3（防御性截断：后端已限 3 条，组件侧兼容超量数据） -->
      <div v-if="displayTop.length > 0" class="load-top">
        <div v-for="t in displayTop" :key="t.id" class="top-row">
          <span class="top-name" :title="t.name">{{ t.name }}</span>
          <span class="top-bar-wrap">
            <span class="top-bar" :style="{ transform: `scaleX(${barWidth(t.hours) / 100})` }" />
          </span>
          <span class="top-hours">{{ t.hours }}</span>
        </div>
      </div>

      <!-- 人员类别构成 -->
      <div v-if="personnelEntries.length > 0" class="load-personnel">
        <el-tag
          v-for="[type, count] in personnelEntries"
          :key="type"
          :type="personnelTagType(type)"
          size="small"
          effect="light"
          disable-transitions
        >
          {{ personnelLabel(type) }} {{ count }} 人
        </el-tag>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { computed } from 'vue';
import { User } from '@element-plus/icons-vue';
import { personnelLabel, personnelTagType, normalizePersonnelType } from '../utils/personnel.js';

const props = defineProps({
  data: {
    type: Object,
    default: () => ({
      totalTeachers: 0,
      assignedTeachers: 0,
      avgHours: 0,
      top: [],
      byPersonnelType: {},
    }),
  },
});

const maxHours = computed(() => {
  const top = props.data?.top || [];
  return Math.max(...top.map((t) => t.hours), 1);
});

const displayTop = computed(() => (props.data?.top || []).slice(0, 3));

// 人员类别展示顺序：专职 → 兼职 → 外聘，未知类别排最后（按归一化后的键比较，兼容驼峰变体）
const PERSONNEL_ORDER = ['full_time', 'part_time', 'external'];
const personnelEntries = computed(() => {
  const map = props.data?.byPersonnelType || {};
  return Object.entries(map).sort((a, b) => {
    const ia = PERSONNEL_ORDER.indexOf(normalizePersonnelType(a[0]));
    const ib = PERSONNEL_ORDER.indexOf(normalizePersonnelType(b[0]));
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
});

function barWidth(hours) {
  return Math.max(4, (hours / maxHours.value) * 100);
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

.load-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: 2px 0;
}

/* 指标行 */
.load-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--space-3);
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
}

.metric-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.metric-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.metric-total {
  font-style: normal;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary);
  margin-left: 4px;
}

/* 课时 TOP3 */
.load-top {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.top-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) 36px;
  gap: var(--space-2);
  align-items: center;
}

.top-name {
  font-size: 12px;
  color: var(--text-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.top-bar-wrap {
  height: 8px;
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
  min-width: 0;
}

.top-bar {
  display: block;
  height: 100%;
  width: 100%;
  transform-origin: left;
  transform: scaleX(0);
  /* 与排课进度卡进度条同款绿色渐变，保持首页绿色语义一致 */
  background: linear-gradient(90deg, var(--brand-success) 0%, var(--el-color-success-light-5) 100%);
  border-radius: var(--radius-sm);
  transition: transform var(--dur-slow) var(--ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .top-bar {
    transition: none;
  }
}

.top-hours {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 人员类别构成 */
.load-personnel {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-light);
}

/* ─── 移动端响应式 ─── */
@media (max-width: 768px) {
  .metric-value {
    font-size: 18px;
  }

  .top-row {
    grid-template-columns: 60px minmax(0, 1fr) 32px;
  }
}
</style>
