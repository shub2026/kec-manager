<template>
  <el-card class="insight-card">
    <template #header>
      <span class="card-title" role="heading" aria-level="2">
        <el-icon><User /></el-icon>
        教师情况
      </span>
    </template>

    <div v-if="!data || data.assignedTeachers === 0" class="chart-empty">
      <span>暂无排课教师</span>
    </div>

    <div v-else class="load-body">
      <!-- 上部：环图居左、图例居右铺满卡片宽度 -->
      <div class="load-main">
        <div
          class="donut"
          role="img"
          :aria-label="`人员构成环状图，共 ${personnelTotal} 人`"
          :style="{ background: donutBackground }"
        >
          <div class="donut-hole">
            <span class="donut-total">{{ personnelTotal }}</span>
            <span class="donut-unit">人</span>
          </div>
        </div>
        <ul class="donut-legend">
          <li v-for="[type, count] in personnelEntries" :key="type" class="legend-item">
            <i class="legend-dot" :style="{ background: personnelColor(type) }" />
            <span class="legend-label">{{ personnelLabel(type) }}</span>
            <span class="legend-value">{{ count }} 人</span>
            <span class="legend-percent">{{ personnelPercent(count) }}%</span>
          </li>
        </ul>
      </div>

      <!-- 下部：指标行填充环图下方空间（参与排课教师 / 人均周课时）；
           整块可点击跳转对应处理页面：教师信息 / 课时统计 -->
      <div class="load-metrics">
        <router-link to="/teaching/teachers" class="metric metric-link">
          <span class="metric-label">参与排课教师</span>
          <span class="metric-value">
            {{ data.assignedTeachers }}<i class="metric-total">/{{ data.totalTeachers }} 在职</i>
          </span>
        </router-link>
        <router-link to="/teaching/statistics" class="metric metric-link">
          <span class="metric-label">人均周课时</span>
          <span class="metric-value">{{ data.avgHours }}</span>
        </router-link>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { computed } from 'vue';
import { User } from '@element-plus/icons-vue';
import { personnelLabel, normalizePersonnelType } from '../utils/personnel.js';

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

// 人员类别展示顺序：专职 → 兼职 → 外聘，未知类别排最后（按归一化后的键比较，兼容驼峰变体）
const PERSONNEL_ORDER = ['full_time', 'part_time', 'external'];
// 环状图用色：与全站人员类别 TAG 语义色同色相（专职=绿、兼职=橙、外聘=灰），
// color-mix 混白 20% 降饱和:环图是大面积数据图形,全饱和语义色过于抢眼,色相不变故与 TAG 的颜色联想仍成立
const PERSONNEL_COLORS = {
  full_time: 'color-mix(in srgb, var(--brand-success) 80%, white)',
  part_time: 'color-mix(in srgb, var(--brand-warning) 80%, white)',
  external: 'color-mix(in srgb, var(--el-color-info) 80%, white)',
};

const personnelEntries = computed(() => {
  const map = props.data?.byPersonnelType || {};
  return Object.entries(map).sort((a, b) => {
    const ia = PERSONNEL_ORDER.indexOf(normalizePersonnelType(a[0]));
    const ib = PERSONNEL_ORDER.indexOf(normalizePersonnelType(b[0]));
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
});

const personnelTotal = computed(() => personnelEntries.value.reduce((s, [, c]) => s + c, 0));

function personnelColor(type) {
  // fallback 与 external 同阶:未知类别不出现未降饱和的突兀灰
  return (
    PERSONNEL_COLORS[normalizePersonnelType(type)] ||
    'color-mix(in srgb, var(--el-color-info) 80%, white)'
  );
}

function personnelPercent(count) {
  return personnelTotal.value > 0 ? Math.round((count / personnelTotal.value) * 100) : 0;
}

// conic-gradient 分段生成环状图：按固定顺序累计占比，双位置色标保证段间硬边界
const donutBackground = computed(() => {
  const total = personnelTotal.value;
  if (!total) return 'none';
  let acc = 0;
  const stops = personnelEntries.value.map(([type, count]) => {
    const from = acc;
    acc += (count / total) * 100;
    return `${personnelColor(type)} ${from}% ${acc}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
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

/* 上下两行：上部环图 + 图例，下部指标行；
   height:100% + space-between 使内容垂直铺满卡片（兄弟卡片等高时指标行沉底） */
.load-body {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--space-4);
  height: 100%;
  padding: var(--space-2) 0;
}

/* 环图 + 图例作为整体水平居中，与卡片左右边缘保留呼吸感；
   组内间距 24px 形成清晰视觉分区，避免两端顶满、中间空旷 */
.load-main {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-6);
}

/* 底部指标行：两列等分浅底块 */
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

/* 指标块整体可点击：默认样式不变，hover 主色浅底提示可跳转 */
.metric-link {
  text-decoration: none;
  transition: background-color 0.2s ease;
}

.metric-link:hover {
  background: color-mix(in srgb, var(--el-color-primary) 8%, transparent);
}

.metric-label {
  font-size: var(--font-size-caption);
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
  font-size: var(--font-size-micro);
  font-weight: 400;
  color: var(--text-secondary);
  margin-left: 4px;
}

.donut {
  position: relative;
  width: 116px;
  height: 116px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* 中心挖空成环：挖孔色与卡片背景一致，中心展示总人数 */
.donut-hole {
  position: absolute;
  inset: 20px;
  border-radius: 50%;
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.donut-total {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.donut-unit {
  font-size: var(--font-size-micro);
  color: var(--text-secondary);
}

.donut-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.legend-item {
  display: grid;
  /* 人数列与占比列固定宽度，多行数值纵向严格对齐 */
  grid-template-columns: auto 1fr 52px 44px;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-caption);
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-label {
  color: var(--text-regular);
}

.legend-value {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/* 占比右对齐加粗，突出构成比例这一核心信息 */
.legend-percent {
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/* ─── 移动端响应式 ─── */
@media (max-width: 768px) {
  .load-main {
    gap: var(--space-5);
  }

  .metric-value {
    font-size: 18px;
  }

  .donut {
    width: 96px;
    height: 96px;
  }

  .donut-hole {
    inset: 17px;
  }

  .donut-total {
    font-size: 19px;
  }

  /* 窄屏人数列收窄，避免挤压类别名 */
  .legend-item {
    grid-template-columns: auto 1fr 46px 40px;
  }
}
</style>
