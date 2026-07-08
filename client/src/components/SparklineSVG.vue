<template>
  <svg
    v-if="points.length >= 2"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    class="sparkline"
    aria-hidden="true"
  >
    <!-- 填充区域 -->
    <path :d="areaPath" :fill="`url(#sparkGrad-${uid})`" />
    <!-- 线条 -->
    <path :d="linePath" fill="none" :stroke="color" :stroke-width="strokeWidth" stroke-linecap="round" stroke-linejoin="round" />
    <!-- 末端圆点 -->
    <circle
      :cx="coords[coords.length - 1].x"
      :cy="coords[coords.length - 1].y"
      :r="dotRadius"
      :fill="color"
    />
    <defs>
      <linearGradient :id="`sparkGrad-${uid}`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="color" stop-opacity="0.2" />
        <stop offset="100%" :stop-color="color" stop-opacity="0.02" />
      </linearGradient>
    </defs>
  </svg>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  /** 数据点数组 */
  points: { type: Array, required: true },
  /** SVG 宽度 */
  width: { type: Number, default: 80 },
  /** SVG 高度 */
  height: { type: Number, default: 32 },
  /** 线条颜色 */
  color: { type: String, default: 'var(--brand-primary)' },
  /** 线条粗细 */
  strokeWidth: { type: Number, default: 1.5 },
  /** 末端圆点半径 */
  dotRadius: { type: Number, default: 2.5 },
  /** 上下内边距 */
  padding: { type: Number, default: 4 },
  /** 唯一 ID 用于渐变引用 */
  uid: { type: String, default: () => Math.random().toString(36).slice(2, 8) },
});

const coords = computed(() => {
  const { points, width, height, padding } = props;
  if (points.length < 2) return [];
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const usableHeight = height - padding * 2;

  return points.map((val, i) => ({
    x: (i / (points.length - 1)) * width,
    y: padding + usableHeight - ((val - min) / range) * usableHeight,
  }));
});

const linePath = computed(() => {
  const pts = coords.value;
  if (pts.length < 2) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
});

const areaPath = computed(() => {
  const pts = coords.value;
  if (pts.length < 2) return '';
  const { width, height } = props;
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return `${line} L${pts[pts.length - 1].x.toFixed(1)},${height} L0,${height} Z`;
});
</script>

<style scoped>
.sparkline {
  display: block;
  overflow: visible;
}
</style>
