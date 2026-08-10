<template>
  <el-card v-if="courseInfo" class="preview-card">
    <template #header>
      <div class="card-header">
        <el-button v-if="showBack" class="back-btn" size="small" plain @click="$emit('back')">
          <el-icon><Back /></el-icon>
          返回课程概览
        </el-button>
        <div class="preview-title">
          <span class="course-name">{{ courseInfo.name }}</span>
          <el-tag
            size="small"
            :type="courseInfo.type === 'professional' ? 'success' : 'primary'"
            disable-transitions
          >
            {{ courseTypeLabel(courseInfo.type) }}
          </el-tag>
        </div>
      </div>
    </template>
    <div class="preview-stats">
      <div class="preview-stat-item">
        <span class="stat-label">教师</span>
        <span class="stat-value">{{ teacherCount }}<small>人</small></span>
      </div>
      <div class="preview-stat-item">
        <span class="stat-label">班级</span>
        <span class="stat-value">{{ summary.totalClasses }}<small>个</small></span>
      </div>
      <div class="preview-stat-item">
        <span class="stat-label">已安排</span>
        <span class="stat-value">{{ summary.assignedCount }}<small>个</small></span>
      </div>
      <div class="preview-stat-item">
        <span class="stat-label">已锁定</span>
        <span class="stat-value stat-locked">{{ summary.lockedCount || 0 }}<small>个</small></span>
      </div>
      <div class="preview-stat-item">
        <span class="stat-label">总课时</span>
        <span class="stat-value">{{ summary.totalCourseHours }}<small>课时</small></span>
      </div>
      <div class="preview-stat-item">
        <span class="stat-label">剩余课时</span>
        <span
          class="stat-value"
          :class="summary.remainingHours >= 0 ? 'text-success' : 'text-danger'"
        >
          {{ summary.remainingHours }}<small>课时</small>
        </span>
      </div>
    </div>
  </el-card>
</template>

<script setup>
defineProps({
  courseInfo: { type: Object, default: null },
  teacherCount: { type: Number, default: 0 },
  // 是否显示「返回课程概览」按钮（从概览卡片进入时开启）
  showBack: { type: Boolean, default: false },
  summary: {
    type: Object,
    default: () => ({
      totalClasses: 0,
      assignedCount: 0,
      lockedCount: 0,
      totalCourseHours: 0,
      remainingHours: 0,
    }),
  },
});

defineEmits(['back']);

function courseTypeLabel(type) {
  return { public: '公共课', professional: '专业课', elective: '选修课' }[type] || type;
}
</script>

<style scoped>
.preview-card {
  margin-bottom: var(--space-4);
}
.preview-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.back-btn {
  margin-right: var(--space-2);
  font-weight: normal;
}
.course-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}
.preview-stats {
  display: flex;
  flex-wrap: wrap;
}
.preview-stat-item {
  flex: 1 1 0;
  min-width: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) 0;
}
.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.stat-value {
  font-size: var(--font-size-h2);
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.stat-value small {
  font-size: 12px;
  font-weight: normal;
  color: var(--text-secondary);
  margin-left: 2px;
}
.text-success {
  color: var(--brand-success-text);
}
.text-danger {
  color: var(--brand-danger-text);
}
.stat-locked {
  color: var(--el-color-success);
}
</style>
