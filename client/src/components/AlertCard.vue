<template>
  <el-card class="insight-card">
    <template #header>
      <div class="alert-header">
        <span class="card-title">
          <el-icon><Warning /></el-icon>
          异常提醒
        </span>
        <el-tag v-if="totalCount > 0" type="warning" size="small" round>{{ totalCount }}</el-tag>
      </div>
    </template>

    <div v-if="totalCount === 0" class="alert-empty">
      <el-icon :size="36" class="empty-check-icon"><CircleCheckFilled /></el-icon>
      <span>暂无异常，一切正常</span>
    </div>

    <div v-else class="alert-list">
      <!-- 未排课课程 -->
      <div v-if="data.unassignedCourses?.length > 0" class="alert-group">
        <div class="alert-group-title">
          <el-icon color="var(--brand-warning-text)"><WarningFilled /></el-icon>
          <span>{{ data.unassignedCourses.length }} 门课程未排课</span>
          <el-button
            v-if="data.unassignedCourses.length > 3"
            text
            size="small"
            @click="showAllCourses = !showAllCourses"
          >
            {{ showAllCourses ? '收起' : '展开全部' }}
          </el-button>
        </div>
        <ul class="alert-items">
          <li
            v-for="course in displayedCourses"
            :key="course.id"
            class="alert-item alert-item-warning"
          >
            <span class="alert-item-name">{{ course.name }}</span>
          </li>
        </ul>
      </div>

      <!-- 课时超限教师 -->
      <div v-if="data.overloadedTeachers?.length > 0" class="alert-group">
        <div class="alert-group-title">
          <el-icon color="var(--brand-danger-text)"><CircleCloseFilled /></el-icon>
          <span>{{ data.overloadedTeachers.length }} 位教师课时超限</span>
          <el-button
            v-if="data.overloadedTeachers.length > 3"
            text
            size="small"
            @click="showAllTeachers = !showAllTeachers"
          >
            {{ showAllTeachers ? '收起' : '展开全部' }}
          </el-button>
        </div>
        <ul class="alert-items">
          <li
            v-for="teacher in displayedTeachers"
            :key="teacher.id"
            class="alert-item alert-item-danger"
          >
            <span class="alert-item-name">{{ teacher.name }}</span>
            <span class="alert-item-detail"> {{ teacher.hours }}/{{ teacher.limit }} 课时 </span>
          </li>
        </ul>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  data: {
    type: Object,
    default: () => ({ unassignedCourses: [], overloadedTeachers: [] }),
  },
});

const showAllCourses = ref(false);
const showAllTeachers = ref(false);

const totalCount = computed(() => {
  return (props.data.unassignedCourses?.length || 0) + (props.data.overloadedTeachers?.length || 0);
});

const displayedCourses = computed(() => {
  const list = props.data.unassignedCourses || [];
  return showAllCourses.value ? list : list.slice(0, 3);
});

const displayedTeachers = computed(() => {
  const list = props.data.overloadedTeachers || [];
  return showAllTeachers.value ? list : list.slice(0, 3);
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
  margin-bottom: var(--space-2);
}

.alert-items {
  list-style: none;
  margin: 0;
  padding: 0;
}

.alert-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  margin-bottom: var(--space-1);
}

/* 降低告警项背景饱和度,避免与数据图表争抢注意力 */
.alert-item-warning {
  background: color-mix(in srgb, var(--brand-warning) 8%, transparent);
  color: var(--text-regular);
}

.alert-item-danger {
  background: color-mix(in srgb, var(--brand-danger) 8%, transparent);
  color: var(--text-regular);
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
  color: var(--brand-danger-text);
  font-variant-numeric: tabular-nums;
}
</style>
