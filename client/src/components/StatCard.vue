<template>
  <div
    class="stat-item"
    :class="{ 'stat-core': core, 'is-clickable': !!route }"
    :role="route ? 'button' : undefined"
    :tabindex="route ? 0 : undefined"
    :aria-label="route ? `${label} ${displayValue}` : undefined"
    @click="route && $router.push(route)"
    @keyup.enter="route && $router.push(route)"
  >
    <div class="stat-icon" :style="{ backgroundColor: bgColor, color: iconColor }">
      <el-icon :size="core ? 20 : 18"><component :is="icon" /></el-icon>
    </div>
    <span class="stat-label">{{ label }}</span>
    <span class="stat-value">
      {{ displayValue }}
    </span>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useCountUp } from '../composables/useCountUp';

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
});

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
/* —— 次要卡：横向布局,图标+标签居左,数字居右 —— */
.stat-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 20px;
  background: var(--bg-card);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  transition: all var(--dur-base) var(--ease-out);
  height: 100%;
  min-height: 64px;
  position: relative;
}

/* 仅有跳转路由的卡片才可交互（指针态 + hover 跨升） */
.stat-item.is-clickable {
  cursor: pointer;
}

.stat-item.is-clickable:hover {
  border-color: var(--brand-primary-lighter);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

/* —— 核心卡：纵向堆叠(图标+标签一行,大数字独占一行) ——
   用 grid areas 在不改变 template 结构的前提下重排,浅蓝底+左色条强化焦点 */
.stat-core {
  display: grid;
  grid-template-areas:
    'icon label'
    'value value';
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: var(--space-3);
  padding: 20px 22px;
  min-height: 96px;
  background: var(--brand-primary-soft);
  border: 1px solid var(--brand-primary-lighter);
  border-left: 3px solid var(--brand-primary);
  box-shadow: var(--shadow-sm);
}

.stat-core.is-clickable:hover {
  box-shadow: var(--shadow-glow-soft), var(--shadow-md);
  border-color: var(--brand-primary-lighter);
}

/* —— 图标容器 —— */
.stat-icon {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px var(--overlay-white-stroke);
}

.stat-core .stat-icon {
  grid-area: icon;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
}

/* 图标容器叠加柔光渐变层 — 通透质感 */
.stat-icon::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0) 55%);
  pointer-events: none;
}

/* —— 标签 —— */
.stat-label {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-core .stat-label {
  grid-area: label;
  font-size: var(--font-size-body-sm);
  color: var(--text-regular);
}

/* —— 次要卡数值：右对齐 ——
   统计卡数字双档：次要 22 / 核心 30（移动端 20/26），页面级展示例外，不入全站字阶令牌 */
.stat-value {
  flex: 1;
  text-align: right;
  font-size: 22px;
  font-weight: var(--fw-bold);
  color: var(--text-primary);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

/* —— 核心卡数值：左对齐大号,作为视觉锚点 —— */
.stat-core .stat-value {
  grid-area: value;
  flex: none;
  text-align: left;
  font-size: 30px;
  letter-spacing: -0.03em;
}

/* 移动端：卡片内部收缩,保持各自布局节奏 */
@media (max-width: 768px) {
  .stat-item {
    padding: var(--space-3) var(--space-4);
    min-height: 0;
  }

  .stat-core {
    padding: var(--space-4);
    min-height: 0;
  }

  .stat-icon {
    width: 34px;
    height: 34px;
  }

  .stat-core .stat-icon {
    width: 36px;
    height: 36px;
  }

  .stat-value {
    font-size: 20px;
  }

  .stat-core .stat-value {
    font-size: 26px;
  }
}
</style>
