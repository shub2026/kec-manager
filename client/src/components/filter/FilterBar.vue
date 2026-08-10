<template>
  <!-- 桌面端（>=768px）：保持既有横向工具栏布局，容器类由 toolbarClass 指定 -->
  <div v-if="!isMobile" :class="toolbarClass">
    <slot name="primary" />
    <slot />
    <div v-if="$slots.actions" class="action-buttons">
      <slot name="actions" />
    </div>
  </div>

  <!-- 移动端（<768px）：主筛选器常驻，其余筛选器收进底部抽屉 -->
  <div v-else class="filter-bar-mobile">
    <div v-if="$slots.primary" class="filter-bar-mobile__primary">
      <slot name="primary" />
    </div>
    <div class="filter-bar-mobile__row">
      <el-badge v-if="$slots.default" :value="activeCount" :hidden="!activeCount">
        <el-button :type="activeCount > 0 ? 'primary' : ''" @click="drawerVisible = true">
          <el-icon><Filter /></el-icon>
          更多筛选
        </el-button>
      </el-badge>
      <div v-if="$slots.actions" class="filter-bar-mobile__actions action-buttons">
        <slot name="actions" />
      </div>
    </div>

    <el-drawer
      v-model="drawerVisible"
      :title="drawerTitle"
      direction="btt"
      size="60%"
      class="filter-drawer"
      append-to-body
    >
      <div class="filter-drawer__body">
        <slot />
      </div>
      <template #footer>
        <div class="filter-drawer__footer">
          <el-button :disabled="!activeCount" @click="emit('reset')">重置</el-button>
          <el-button type="primary" @click="drawerVisible = false">完成</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { Filter } from '@element-plus/icons-vue';
import { useResponsive } from '@/composables/useResponsive';

defineOptions({ name: 'FilterBar' });

defineProps({
  /** 生效中的筛选条件数量，>0 时"更多筛选"按钮显示角标并转 primary 色 */
  activeCount: {
    type: Number,
    default: 0,
  },
  /** 抽屉标题 */
  drawerTitle: {
    type: String,
    default: '更多筛选',
  },
  /** 桌面端容器类名（默认 page-toolbar；卡片头部场景可传 card-header-actions） */
  toolbarClass: {
    type: String,
    default: 'page-toolbar',
  },
});

// 抽屉内筛选值与页面共享同一 filter 对象（v-model 绑定），改动实时生效，无需同步
const emit = defineEmits(['reset']);

const { isMobile } = useResponsive();
const drawerVisible = ref(false);
</script>
