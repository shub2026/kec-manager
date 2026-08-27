<template>
  <div class="custom-empty" role="status" :aria-label="description">
    <div class="empty-illustration" :class="`empty-${type}`">
      <EmptyIllustration :type="type" />
    </div>

    <div class="empty-content">
      <p class="empty-description">{{ description }}</p>
      <slot name="action" />
    </div>
  </div>
</template>

<script setup>
import EmptyIllustration from './EmptyIllustration.vue';

defineProps({
  /**
   * 插画类型: course | class | teacher | textbook | plan | college | major | generic
   */
  type: {
    type: String,
    default: 'generic',
  },
  /**
   * 描述文字
   */
  description: {
    type: String,
    default: '暂无数据',
  },
});
</script>

<style scoped>
.custom-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* 与 ListErrorState 一致，消除空/错/加载三态切换时的高度跳变 */
  min-height: 240px;
  padding: var(--space-7) var(--space-5);
}

.empty-illustration {
  margin-bottom: var(--space-4);
  --illust-bg: var(--brand-primary-soft);
  --illust-main: var(--brand-primary);
  --illust-dot: var(--brand-primary-lighter);
}

/* 不同类型使用不同色调（CSS 变量级联进子组件 SVG） */
.empty-class,
.empty-college,
.empty-major {
  --illust-bg: var(--brand-warning-soft);
  --illust-main: var(--brand-warning);
  --illust-dot: var(--brand-warning-lighter);
}

.empty-teacher {
  --illust-bg: var(--brand-success-soft);
  --illust-main: var(--brand-success);
  --illust-dot: var(--brand-success-lighter);
}

.empty-textbook {
  --illust-bg: var(--brand-danger-soft);
  --illust-main: var(--brand-danger);
  --illust-dot: var(--brand-danger-lighter);
}

.empty-plan {
  --illust-bg: var(--brand-indigo-soft);
  --illust-main: var(--brand-indigo);
  --illust-dot: var(--brand-indigo-lighter);
}

.empty-content {
  text-align: center;
}

.empty-description {
  margin: 0 0 var(--space-3);
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  line-height: 1.5;
}
</style>
