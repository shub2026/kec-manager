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
      <el-icon :size="32" color="var(--brand-success)"><CircleCheckFilled /></el-icon>
      <span>暂无异常，一切正常</span>
    </div>

    <div v-else class="alert-list">
      <!-- 未排课课程 -->
      <div v-if="data.unassignedCourses?.length > 0" class="alert-group">
        <div class="alert-group-title">
          <el-icon color="var(--brand-warning)"><WarningFilled /></el-icon>
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
          <el-icon color="var(--brand-danger)"><CircleCloseFilled /></el-icon>
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
.insight-card {
  height: 100%;
}

.alert-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.alert-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.alert-group {
  margin-bottom: 16px;
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
  margin-bottom: 8px;
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
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 13px;
  margin-bottom: 4px;
}

.alert-item-warning {
  background: var(--brand-warning-soft);
  color: var(--text-regular);
}

.alert-item-danger {
  background: var(--brand-danger-soft);
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
  margin-left: 8px;
  font-weight: 600;
  color: var(--brand-danger-text);
  font-variant-numeric: tabular-nums;
}
</style>
