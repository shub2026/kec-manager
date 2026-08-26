<template>
  <el-card class="insight-card">
    <template #header>
      <div class="alert-header">
        <span class="card-title" role="heading" aria-level="2">
          <el-icon><Warning /></el-icon>
          待办提醒
        </span>
        <el-tag v-if="totalCount > 0" type="warning" size="small" round disable-transitions>{{
          totalCount
        }}</el-tag>
      </div>
    </template>

    <div v-if="totalCount === 0" class="alert-empty">
      <el-icon :size="36" class="empty-check-icon"><CircleCheckFilled /></el-icon>
      <span>暂无待办，一切正常</span>
    </div>

    <div v-else class="alert-list">
      <div v-for="group in visibleGroups" :key="group.key" class="alert-group">
        <!-- 分组标题 -->
        <div class="alert-group-title">
          <el-icon :color="group.iconColor"><component :is="group.icon" /></el-icon>
          <span class="alert-group-label">{{ group.title }}</span>
          <el-icon
            v-if="group.hiddenCount > 0"
            class="alert-group-arrow"
            :class="{ 'is-expanded': expandedGroups.has(group.key) }"
          >
            <ArrowDown />
          </el-icon>
        </div>
        <!-- 预览项始终可见（最多 previewCount 条） -->
        <ul class="alert-items">
          <li
            v-for="item in group.previewItems"
            :key="item.key"
            :class="['alert-item', group.itemClass]"
          >
            <router-link :to="group.route" class="alert-item-link">
              <span class="alert-item-name">{{ item.name }}</span>
              <span v-if="item.detail" class="alert-item-detail">{{ item.detail }}</span>
            </router-link>
          </li>
          <!-- 超出预览数的项：点击“展开更多”后显示 -->
          <template v-if="expandedGroups.has(group.key)">
            <li
              v-for="item in group.hiddenItems"
              :key="item.key"
              :class="['alert-item', group.itemClass]"
            >
              <router-link :to="group.route" class="alert-item-link">
                <span class="alert-item-name">{{ item.name }}</span>
                <span v-if="item.detail" class="alert-item-detail">{{ item.detail }}</span>
              </router-link>
            </li>
          </template>
        </ul>
        <!-- 展开/收起按钮 -->
        <div
          v-if="group.hiddenCount > 0"
          class="alert-toggle"
          role="button"
          tabindex="0"
          @click="toggleExpand(group.key)"
          @keydown.enter="toggleExpand(group.key)"
        >
          {{ expandedGroups.has(group.key) ? '收起' : `展开 ${group.hiddenCount} 条更多` }}
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { computed, reactive } from 'vue';

const props = defineProps({
  data: {
    type: Object,
    default: () => ({
      unassignedCourses: [],
      overloadedTeachers: [],
      unassignedClasses: { count: 0, courses: [] },
    }),
  },
});

const expandedGroups = reactive(new Set());

function toggleExpand(key) {
  if (expandedGroups.has(key)) {
    expandedGroups.delete(key);
  } else {
    expandedGroups.add(key);
  }
}

// 分组定义驱动渲染：三类待办统一"标题 + 明细 + 跳转动线"结构；
// 每组直接展示前 previewCount 条明细，超出时出现"展开更多"按钮
// 顺序即处理优先级——未排课课程 > 未安排班级 > 课时超限
const PREVIEW_COUNT = 4;
const visibleGroups = computed(() => {
  const d = props.data;
  const defs = [
    {
      key: 'unassignedCourses',
      title: `${d.unassignedCourses?.length || 0} 门课程未排课`,
      icon: 'WarningFilled',
      iconColor: 'var(--brand-warning-text)',
      itemClass: 'alert-item-warning',
      route: '/teaching/arrange',
      items: (d.unassignedCourses || []).map((c) => ({ key: c.id, name: c.name })),
    },
    {
      key: 'unassignedClasses',
      title: `${d.unassignedClasses?.count || 0} 个班级未安排`,
      icon: 'WarningFilled',
      iconColor: 'var(--brand-warning-text)',
      itemClass: 'alert-item-warning',
      route: '/teaching/arrange',
      items: (d.unassignedClasses?.courses || []).map((c) => ({
        key: c.id,
        name: c.name,
        detail: `还差 ${c.missing}/${c.total} 班`,
      })),
    },
    {
      key: 'overloadedTeachers',
      title: `${d.overloadedTeachers?.length || 0} 位教师课时超限`,
      icon: 'CircleCloseFilled',
      iconColor: 'var(--brand-danger-text)',
      itemClass: 'alert-item-danger',
      route: '/teaching/teachers',
      items: (d.overloadedTeachers || []).map((t) => ({
        key: t.id,
        name: t.name,
        detail: `${t.hours}/${t.limit} 课时`,
      })),
    },
  ];
  return defs
    .filter((g) => g.items.length > 0)
    .map((g) => ({
      ...g,
      previewItems: g.items.slice(0, PREVIEW_COUNT),
      hiddenItems: g.items.slice(PREVIEW_COUNT),
      hiddenCount: Math.max(0, g.items.length - PREVIEW_COUNT),
    }));
});

const totalCount = computed(() => {
  const d = props.data;
  return (
    (d.unassignedCourses?.length || 0) +
    (d.overloadedTeachers?.length || 0) +
    (d.unassignedClasses?.count || 0)
  );
});
</script>

<style scoped>
.alert-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* 空状态：脉冲呼吸动效,传递"一切正常"的正向反馈 */
.alert-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-6) 0;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
}

.empty-check-icon {
  color: var(--brand-success);
  animation: pulse-gentle 2.4s ease-in-out infinite;
}

@keyframes pulse-gentle {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(1.08);
  }
}

.alert-group {
  margin-bottom: var(--space-4);
}

.alert-group:last-child {
  margin-bottom: 0;
}

.alert-group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  color: var(--text-primary);
  /* 不用负边距：.alert-list 开启纵向滚动后 overflow-x 会同步变为 auto，负边距溢出会带出横向滚动条 */
  padding: 6px 8px;
  margin: 0 0 var(--space-1);
  border-radius: var(--radius-sm);
}

.alert-group-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 折叠箭头：展开时旋转 180°，明示可折叠语义 */
.alert-group-arrow {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 12px;
  transition: transform 0.2s ease;
}

.alert-group-arrow.is-expanded {
  transform: rotate(180deg);
}

/* 展开内容封顶 + 内部滚动：多组同时展开也不撑高卡片，避免连带拉伸同行卡片；
   显式锁死横向溢出，避免任何子元素宽度异常时出现横向滚动条 */
.alert-list {
  max-height: 320px;
  overflow-y: auto;
  overflow-x: hidden;
}

.alert-items {
  list-style: none;
  margin: 0;
  padding: 0;
}

.alert-item {
  border-radius: var(--radius-sm);
  font-size: var(--font-size-body-sm);
  margin-bottom: var(--space-1);
}

/* 降低告警项背景饱和度,避免与数据图表争抢注意力 */
.alert-item-warning {
  background: color-mix(in srgb, var(--brand-warning) 8%, transparent);
}

.alert-item-danger {
  background: color-mix(in srgb, var(--brand-danger) 8%, transparent);
}

/* 待办项整体可点击：继承文字颜色、悬停加深背景提示可交互 */
.alert-item-link {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  color: var(--text-regular);
  text-decoration: none;
  transition: background-color 0.2s;
}

.alert-item-warning .alert-item-link:hover {
  background: color-mix(in srgb, var(--brand-warning) 16%, transparent);
}

.alert-item-danger .alert-item-link:hover {
  background: color-mix(in srgb, var(--brand-danger) 16%, transparent);
}

.alert-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alert-item-detail {
  flex-shrink: 0;
  margin-left: var(--space-2);
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* 展开/收起按钮：居中文字链，低调但与分组标题区分 */
.alert-toggle {
  text-align: center;
  font-size: var(--font-size-caption);
  color: var(--el-color-primary);
  padding: 4px 0 2px;
  cursor: pointer;
  user-select: none;
  transition: opacity 0.2s;
}

.alert-toggle:hover {
  opacity: 0.7;
}
</style>
