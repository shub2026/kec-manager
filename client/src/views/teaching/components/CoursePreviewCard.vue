<template>
  <el-card v-if="courseInfo" class="preview-card">
    <template #header>
      <div class="card-header">
        <el-button v-if="showBack" class="back-btn" size="small" @click="$emit('back')">
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
      <div v-if="(summary.inherentCount || 0) > 0" class="preview-stat-item">
        <el-tooltip content="自动排课时延续上学期教师-班级关系的班级占比" placement="top">
          <span class="stat-label">延续率</span>
        </el-tooltip>
        <span class="stat-value stat-inherent">{{ continuityRate }}<small>%</small></span>
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
import { computed } from 'vue';

const props = defineProps({
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
      inherentCount: 0,
      totalCourseHours: 0,
      remainingHours: 0,
    }),
  },
});

defineEmits(['back']);

// 延续率：延续班级数占已安排班级数的百分比
const continuityRate = computed(() => {
  const assigned = props.summary?.assignedCount || 0;
  const inherent = props.summary?.inherentCount || 0;
  if (assigned <= 0) return 0;
  return Math.round((inherent / assigned) * 100);
});

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
/* 返回按钮：品牌软色调次级按钮（极浅蓝底 + 主色文字），
   与页面主色按钮/标签同一视觉语言，避免纯白描边按钮的游离感 */
.back-btn {
  margin-right: var(--space-2);
  font-weight: normal;
  --el-button-bg-color: var(--brand-primary-soft);
  --el-button-border-color: transparent;
  --el-button-text-color: var(--brand-primary);
  --el-button-hover-bg-color: var(--brand-primary-lighter);
  --el-button-hover-border-color: transparent;
  --el-button-hover-text-color: var(--brand-primary-active);
  --el-button-active-bg-color: var(--brand-primary-lighter);
  --el-button-active-border-color: transparent;
  --el-button-active-text-color: var(--brand-primary-active);
  border-radius: var(--radius-sm);
  transition:
    background-color 0.2s,
    color 0.2s,
    box-shadow 0.2s;
}
.back-btn:hover {
  box-shadow: 0 2px 8px var(--brand-primary-shadow);
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
/* 固有班级延续：品牌紫，与锁定（绿）/未分配（红）区分开 */
.stat-inherent {
  color: #8b5cf6;
}
</style>
