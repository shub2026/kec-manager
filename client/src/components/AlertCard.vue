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
        <!-- 分组标题即折叠头：默认收拢只显示标题，点击展开/收起该组明细 -->
        <div
          class="alert-group-title"
          role="button"
          tabindex="0"
          :aria-expanded="expandedGroups.has(group.key)"
          @click="toggleExpand(group.key)"
          @keydown.enter="toggleExpand(group.key)"
        >
          <el-icon :color="group.iconColor"><component :is="group.icon" /></el-icon>
          <span class="alert-group-label">{{ group.title }}</span>
          <el-icon
            class="alert-group-arrow"
            :class="{ 'is-expanded': expandedGroups.has(group.key) }"
          >
            <ArrowDown />
          </el-icon>
        </div>
        <ul v-if="expandedGroups.has(group.key)" class="alert-items">
          <li v-for="item in group.items" :key="item.key" :class="['alert-item', group.itemClass]">
            <!-- 整项可点击跳转对应处理页面，承载待办"去哪里处理"的动线 -->
            <router-link :to="group.route" class="alert-item-link">
              <span class="alert-item-name">{{ item.name }}</span>
              <span v-if="item.detail" class="alert-item-detail">{{ item.detail }}</span>
            </router-link>
          </li>
        </ul>
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
      underGuaranteedTeachers: [],
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

// 分组定义驱动渲染：四类待办统一"标题 + 明细 + 跳转动线"结构；
// 顺序即处理优先级——未排课课程 > 未安排班级 > 保障未达标 > 课时超限
const visibleGroups = computed(() => {
  const d = props.data;
  const groups = [
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
      key: 'underGuaranteedTeachers',
      title: `${d.underGuaranteedTeachers?.length || 0} 位教师保障课时未达标`,
      icon: 'InfoFilled',
      iconColor: 'var(--el-color-primary)',
      itemClass: 'alert-item-info',
      route: '/teaching/teachers',
      items: (d.underGuaranteedTeachers || []).map((t) => ({
        key: t.id,
        name: t.name,
        detail: `${t.hours}/${t.limit} 课时`,
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
  return groups.filter((g) => g.items.length > 0);
});

const totalCount = computed(() => {
  const d = props.data;
  return (
    (d.unassignedCourses?.length || 0) +
    (d.overloadedTeachers?.length || 0) +
    (d.unassignedClasses?.count || 0) +
    (d.underGuaranteedTeachers?.length || 0)
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
  font-size: 14px;
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
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  /* 不用负边距：.alert-list 开启纵向滚动后 overflow-x 会同步变为 auto，负边距溢出会带出横向滚动条 */
  padding: 6px 8px;
  margin: 0 0 var(--space-1);
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s;
}

.alert-group-title:hover {
  background: var(--bg-subtle);
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
  font-size: 13px;
  margin-bottom: var(--space-1);
}

/* 降低告警项背景饱和度,避免与数据图表争抢注意力 */
.alert-item-warning {
  background: color-mix(in srgb, var(--brand-warning) 8%, transparent);
}

.alert-item-info {
  background: color-mix(in srgb, var(--el-color-primary) 8%, transparent);
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

.alert-item-info .alert-item-link:hover {
  background: color-mix(in srgb, var(--el-color-primary) 16%, transparent);
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
</style>
