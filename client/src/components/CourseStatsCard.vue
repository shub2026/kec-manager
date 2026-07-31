<template>
  <el-card class="insight-card">
    <template #header>
      <span class="card-title" role="heading" aria-level="2">
        <el-icon><Document /></el-icon>
        课时概览
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
          <span class="name-text">{{ item.name }}</span>
        </div>
        <div class="col-hours">
          <span class="hours-bar-wrap">
            <span
              class="hours-bar"
              :style="{
                transform: `scaleX(${barWidth(item.totalHours) / 100})`,
                backgroundColor: barColor(idx),
              }"
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

/* 数据行固定轨道:课程名 120px / 课时区 1fr / 班+人 104px */
.table-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr) 104px;
  gap: 12px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-light);
  transition: opacity var(--dur-fast) var(--ease-out);
}

.table-row:last-of-type {
  border-bottom: none;
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
  gap: var(--space-3);
  min-width: 0;
}

.hours-bar-wrap {
  flex: 1;
  height: 10px;
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
  min-width: 0;
}

.hours-bar {
  display: block;
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
  .stats-table:hover .table-row:not(:hover) {
    opacity: 0.55;
  }

  .table-row:hover .hours-bar {
    filter: brightness(1.12);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hours-bar {
    transition: none;
  }
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
  gap: var(--space-3);
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

/* ─── 移动端响应式 ─── */
@media (max-width: 768px) {
  .table-row {
    grid-template-columns: 90px minmax(0, 1fr) 88px;
    gap: 8px;
  }

  .hours-value {
    width: 34px;
    font-size: 12px;
  }

  .meta-num {
    font-size: 12px;
  }

  .meta-num::after {
    font-size: 9px;
    margin-left: 1px;
  }

  .name-text {
    font-size: 12px;
  }
}
</style>
