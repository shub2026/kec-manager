<template>
  <div class="list-error-state" role="alert" aria-live="assertive">
    <div class="error-illustration" aria-hidden="true">
      <svg viewBox="0 0 120 120" width="120" height="120" fill="none" xmlns="http://www.w3.org/2000/svg">
        <!-- 背景圆 -->
        <circle cx="60" cy="60" r="56" fill="var(--illust-bg)" />
        <!-- 装饰圆点 -->
        <circle cx="22" cy="28" r="4" fill="var(--illust-dot)" />
        <circle cx="98" cy="88" r="3" fill="var(--illust-dot)" />
        <circle cx="90" cy="24" r="5" fill="var(--illust-dot)" opacity="0.5" />
        <!-- 警告三角 -->
        <path d="M60 36 L84 78 L36 78 Z" fill="var(--illust-main)" opacity="0.15" />
        <path
          d="M60 36 L84 78 L36 78 Z"
          stroke="var(--illust-main)"
          stroke-width="2.5"
          stroke-linejoin="round"
          fill="none"
        />
        <!-- 感叹号 -->
        <line
          x1="60"
          y1="52"
          x2="60"
          y2="66"
          stroke="var(--illust-main)"
          stroke-width="3"
          stroke-linecap="round"
        />
        <circle cx="60" cy="72" r="2.4" fill="var(--illust-main)" />
      </svg>
    </div>

    <p class="error-description">{{ message }}</p>

    <div class="error-actions">
      <slot name="action" />
      <el-button v-if="showRetry" type="primary" :icon="Refresh" :loading="loading" @click="$emit('retry')">
        {{ retryText }}
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { Refresh } from '@element-plus/icons-vue';

defineProps({
  /**
   * 错误描述文案
   */
  message: {
    type: String,
    default: '数据加载失败，请稍后重试',
  },
  /**
   * 重试按钮文案
   */
  retryText: {
    type: String,
    default: '重新加载',
  },
  /**
   * 是否显示重试按钮（部分场景仅需提示，不需重试）
   */
  showRetry: {
    type: Boolean,
    default: true,
  },
  /**
   * 重试按钮 loading 态（避免重复点击）
   */
  loading: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['retry']);
</script>

<style scoped>
/* 复用 EmptyState 的视觉语言：插画 + 文案 + 操作，仅主色切换为 danger，
   保证全站空/错状态风格统一 */
.list-error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-7) var(--space-5);
  min-height: 240px;
}

.error-illustration {
  margin-bottom: var(--space-4);
  --illust-bg: var(--brand-danger-soft, #fee2e2);
  --illust-main: var(--brand-danger, #f87171);
  --illust-dot: var(--brand-danger-lighter, #fecaca);
}

.error-description {
  margin: 0 0 var(--space-4);
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
  text-align: center;
  max-width: 420px;
}

.error-actions {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
}
</style>
