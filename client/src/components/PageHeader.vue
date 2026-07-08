<template>
  <div class="page-header">
    <!-- 标题行 -->
    <div class="page-header-main">
      <div class="page-header-left">
        <h2 class="page-header-title">{{ title }}</h2>
        <span v-if="subtitle" class="page-header-subtitle">{{ subtitle }}</span>
      </div>
      <div class="page-header-right">
        <slot name="extra" />
      </div>
    </div>

    <!-- 描述文字 -->
    <p v-if="description" class="page-header-desc">{{ description }}</p>
  </div>
</template>

<script setup>
defineProps({
  /** 页面标题 */
  title: { type: String, required: true },
  /** 副标题/所属模块标签 */
  subtitle: { type: String, default: '' },
  /** 描述文字 */
  description: { type: String, default: '' },
});
</script>

<style scoped>
.page-header {
  margin-bottom: var(--space-4);
}

.page-header-main {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
}

.page-header-left {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
  /* 左侧品牌强调条：与首页 welcome-section 共享同一强调语言,使概览页/列表页系统化统一 */
  border-left: 3px solid var(--brand-primary);
  padding-left: 12px;
}

.page-header-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
  white-space: nowrap;
}

.page-header-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--brand-primary-soft);
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
  white-space: nowrap;
}

.page-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.page-header-desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

@media (max-width: 768px) {
  .page-header-title {
    font-size: 20px;
  }

  .page-header-main {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .page-header-right {
    width: 100%;
  }
}
</style>
