<template>
  <div class="matrix-legend" role="note" aria-label="课程矩阵颜色语义说明">
    <span class="legend-title">
      <el-icon><InfoFilled /></el-icon>
      图例说明
    </span>

    <!-- 课程类别 -->
    <div class="legend-group">
      <span class="legend-group-label">课程类别</span>
      <span class="legend-tag legend-tag--public">公共课</span>
      <span class="legend-tag legend-tag--pro">专业课</span>
    </div>

    <!-- 课时强度热力 -->
    <div class="legend-group">
      <span class="legend-group-label">课时强度</span>
      <span class="legend-item">
        <i class="legend-swatch" :style="swatch('low')"></i>少（≤2 课时）
      </span>
      <span class="legend-item">
        <i class="legend-swatch" :style="swatch('mid')"></i>中（3–4 课时）
      </span>
      <span class="legend-item">
        <i class="legend-swatch" :style="swatch('high')"></i>多（≥5 课时）
      </span>
    </div>

    <!-- 教材状态 -->
    <div class="legend-group">
      <span class="legend-group-label">教材状态</span>
      <span class="legend-item">
        <i class="legend-dot" :style="{ background: 'var(--brand-success, #10B981)' }"></i>正常启用
      </span>
      <span class="legend-item">
        <i class="legend-dot" :style="{ background: 'var(--brand-warning, #FF6B1A)' }"></i>未指定
      </span>
      <span class="legend-item">
        <i class="legend-dot" :style="{ background: 'var(--brand-danger, #F87171)' }"></i>已停用
      </span>
    </div>

    <!-- 其他 -->
    <div class="legend-group">
      <span class="legend-group-label">其他</span>
      <span class="legend-item">
        <i class="legend-swatch legend-swatch--out"></i>超出开课范围
      </span>
    </div>
  </div>
</template>

<script setup>
import { InfoFilled } from '@element-plus/icons-vue';

// 与 CourseMatrixTable.vue 的课时热力配色保持一致
const heatColors = {
  low: 'var(--brand-primary-soft, #E8F3FE)',
  mid: 'var(--brand-primary-lighter, #B5D6FC)',
  high: 'var(--el-color-primary-light-5)',
};

function swatch(key) {
  return { background: heatColors[key] };
}
</script>

<style scoped>
.matrix-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) 18px;
  padding: 10px 14px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-regular);
  line-height: 1.4;
}

.legend-title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-weight: 600;
  color: var(--text-primary);
}

.legend-group {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding-left: 18px;
  border-left: 1px solid var(--border-light);
}

.legend-group-label {
  color: var(--text-secondary);
  font-weight: 500;
}

/* 课程类别标签（复刻 el-tag 默认蓝 / success 绿 观感） */
.legend-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px var(--space-2);
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
}

.legend-tag--public {
  background: var(--brand-primary-soft, #e8f3fe);
  color: var(--brand-primary-active, #1668c4);
}

.legend-tag--pro {
  background: var(--brand-success-soft, #e7f8f2);
  color: var(--brand-success-text, #047857);
}

/* 课时热力色块 */
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.legend-swatch {
  display: inline-block;
  width: 16px;
  height: 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-light);
  flex-shrink: 0;
}

.legend-swatch--out {
  background: var(--bg-subtle);
}

/* 状态圆点 */
.legend-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
