<template>
  <div
    class="stat-item"
    :class="{ 'stat-core': core }"
    role="button"
    tabindex="0"
    @click="route && $router.push(route)"
    @keyup.enter="route && $router.push(route)"
  >
    <div class="stat-item-left">
      <div
        class="stat-icon"
        :style="{ backgroundColor: bgColor, color: iconColor }"
      >
        <el-icon :size="core ? 28 : 22"><component :is="icon" /></el-icon>
      </div>
    </div>
    <div class="stat-item-body">
      <div class="stat-top">
        <div class="stat-info">
          <div class="stat-value" :class="{ 'stat-value-lg': core }">
            {{ displayValue }}
          </div>
          <div class="stat-label">{{ label }}</div>
        </div>
        <SparklineSVG
          v-if="sparkData.length >= 2"
          :points="sparkData"
          :color="iconColor"
          :width="core ? 72 : 56"
          :height="core ? 28 : 22"
          class="stat-spark"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useCountUp } from '../composables/useCountUp';
import SparklineSVG from './SparklineSVG.vue';

const props = defineProps({
  /** 当前数值 */
  value: { type: Number, default: 0 },
  /** 标签 */
  label: { type: String, default: '' },
  /** Element Plus 图标组件 */
  icon: { type: [Object, String], default: null },
  /** 图标背景色 */
  bgColor: { type: String, default: 'var(--brand-primary-soft)' },
  /** 图标/线条颜色 */
  iconColor: { type: String, default: 'var(--brand-primary)' },
  /** 是否为核心指标（大卡片） */
  core: { type: Boolean, default: false },
  /** 点击跳转路由 */
  route: { type: String, default: '' },
  /** sparkline 数据点数组（不传则自动生成） */
  sparkData: { type: Array, default: () => [] },
});

const router = useRouter();
const targetRef = ref(0);
const { displayValue } = useCountUp(targetRef, { duration: 900 });

// 当 value 变化时触发 countup
watch(
  () => props.value,
  (v) => {
    targetRef.value = v;
  },
  { immediate: true }
);
</script>

<style scoped>
.stat-item {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  background: var(--bg-card);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-light);
  cursor: pointer;
  transition: all 0.2s var(--ease-out);
  height: 100%;
}

.stat-item:hover {
  border-color: var(--brand-primary-lighter);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

/* 核心指标卡片 — 更强的阴影和边框 */
.stat-core {
  border-left: 3px solid var(--brand-primary);
  box-shadow: var(--shadow-sm);
}

.stat-core:hover {
  box-shadow: 0 8px 24px rgba(14, 165, 233, 0.12);
}

.stat-item-left {
  flex-shrink: 0;
}

.stat-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-item-body {
  flex: 1;
  min-width: 0;
}

.stat-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 8px;
}

.stat-info {
  flex: 1;
  min-width: 0;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
  margin-bottom: 2px;
  font-variant-numeric: tabular-nums;
}

.stat-value-lg {
  font-size: 28px;
}

.stat-label {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
  white-space: nowrap;
}

.stat-spark {
  flex-shrink: 0;
  opacity: 0.8;
}

@media (max-width: 768px) {
  .stat-item {
    padding: 10px 12px;
    gap: 10px;
  }
  .stat-icon {
    width: 36px;
    height: 36px;
  }
  .stat-value {
    font-size: 18px;
  }
  .stat-value-lg {
    font-size: 22px;
  }
  .stat-spark {
    display: none;
  }
}
</style>
