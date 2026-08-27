<template>
  <div class="page-header">
    <!-- 返回按钮 + 标题行 -->
    <div class="page-header-main">
      <div class="page-header-left">
        <button
          v-if="backRoute"
          class="page-header-back"
          title="返回"
          @click="$router.push(backRoute)"
        >
          <el-icon :size="18"><ArrowLeft /></el-icon>
        </button>
        <h2 class="page-header-title">{{ title }}</h2>
        <span v-if="subtitle" class="page-header-subtitle">{{ subtitle }}</span>
        <slot name="tags" />
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
import { ArrowLeft } from '@element-plus/icons-vue';

defineProps({
  /** 页面标题 */
  title: { type: String, required: true },
  /** 副标题/所属模块标签 */
  subtitle: { type: String, default: '' },
  /** 描述文字 */
  description: { type: String, default: '' },
  /** 返回路由路径，提供时显示返回按钮 */
  backRoute: { type: String, default: '' },
});
</script>

<style scoped>
/* 桌面端：网格两列，右侧操作区相对「标题行 + 描述」整块垂直居中，
   避免宽屏下按钮悬在右上角与页面内容脱离 */
.page-header {
  margin-bottom: var(--space-4);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: var(--space-4);
}

.page-header-main {
  display: contents;
}

.page-header-left {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  min-width: 0;
  /* 左侧品牌强调条：与首页 welcome-section 共享同一强调语言,使概览页/列表页系统化统一 */
  border-left: 3px solid var(--brand-primary);
  padding-left: var(--space-3);
}

.page-header-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  align-self: center;
  flex-shrink: 0;
  margin-left: -4px;
}

.page-header-back:hover {
  background: var(--bg-subtle);
  color: var(--brand-primary);
}

.page-header-title {
  margin: 0;
  font-size: var(--font-size-display);
  font-weight: var(--fw-bold);
  color: var(--text-primary);
  line-height: 1.3;
  white-space: nowrap;
  /* 长标题（如完整方案名）窄屏防溢出容器 */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.page-header-subtitle {
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
  background: var(--brand-primary-soft);
  padding: 2px var(--space-2);
  border-radius: var(--radius-sm);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.page-header-right {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.page-header-desc {
  grid-column: 1;
  grid-row: 2;
  margin: 6px 0 0;
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}

@media (max-width: 768px) {
  .page-header-title {
    font-size: 20px;
  }

  /* 触控目标：返回钮在窄屏提升至 44×44 */
  .page-header-back {
    width: 44px;
    height: 44px;
  }

  /* 窄屏堆叠顺序：标题 → 描述 → 操作区（extra）。
     描述在 DOM 上位于 main 之外，用 display:contents 拍平 main 后以 order 重排，
     避免操作按钮把标题与描述隔开 */
  .page-header {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .page-header-main {
    display: contents;
  }

  .page-header-left {
    order: 1;
  }

  .page-header-desc {
    order: 2;
    margin: 0;
  }

  .page-header-right {
    order: 3;
    width: 100%;
    /* 重置桌面端 grid 居中对齐（align-self 在 flex 下同样生效） */
    align-self: auto;
  }
}
</style>
