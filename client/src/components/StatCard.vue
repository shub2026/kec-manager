<template>
  <div
    class="stat-item"
    :class="{ 'stat-core': core }"
    role="button"
    tabindex="0"
    @click="route && $router.push(route)"
    @keyup.enter="route && $router.push(route)"
  >
    <div class="stat-icon" :style="{ backgroundColor: bgColor, color: iconColor }">
      <el-icon :size="core ? 20 : 18"><component :is="icon" /></el-icon>
    </div>
    <span class="stat-label">{{ label }}</span>
    <span class="stat-value" :class="{ 'stat-value-lg': core }">
      {{ displayValue }}
    </span>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
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
/* —— 统一水平布局：图标 + 文字在左，数字居中 —— */
.stat-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  background: var(--bg-card);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  cursor: pointer;
  transition: all var(--dur-base) var(--ease-out);
  height: 100%;
  min-height: 78px;
  position: relative;
}

.stat-item:hover {
  border-color: var(--brand-primary-lighter);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

/* 核心指标卡片 — 仅以左侧色条 + 柔光晕区分,布局与次要卡片保持一致 */
.stat-core {
  border-left: 3px solid var(--brand-primary);
  box-shadow: var(--shadow-sm);
  padding-left: 17px;
}

.stat-core:hover {
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
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.6);
}

/* 核心卡片图标略放大,强化焦点 */
.stat-core .stat-icon {
  width: 42px;
  height: 42px;
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

/* —— 标签：与图标同处左侧 —— */
.stat-label {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--text-secondary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* —— 数值：占据剩余空间并水平居中,作为视觉焦点 —— */
.stat-value {
  flex: 1;
  text-align: center;
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

/* 核心指标数值加大,强化数据冲击力 */
.stat-value-lg {
  font-size: 28px;
  letter-spacing: -0.03em;
}

/* 移动端：卡片内部改为纵向 —
   图标+标签占上行、大数字独占整行居左，
   保留 2 列网格节奏的同时给数字完整宽度，
   避免窄屏下「居中数字」被挤压/溢出 */
@media (max-width: 768px) {
  .stat-item {
    flex-wrap: wrap;
    align-content: center;
    gap: 4px 12px;
    padding: 13px 16px;
    min-height: 0;
  }
  .stat-core {
    padding-left: 14px;
  }
  .stat-icon {
    width: 34px;
    height: 34px;
  }
  .stat-core .stat-icon {
    width: 38px;
    height: 38px;
  }
  .stat-label {
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }
  .stat-value {
    flex: 0 0 100%;
    text-align: left;
    font-size: 23px;
    margin-top: 2px;
  }
  .stat-value-lg {
    font-size: 26px;
  }
}
</style>
