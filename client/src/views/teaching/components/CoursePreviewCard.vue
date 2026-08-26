<template>
  <el-card v-if="courseInfo" class="preview-card">
    <template #header>
      <div class="card-header">
        <el-button v-if="showBack" class="back-btn" @click="$emit('back')">
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
/* 返回按钮：无边框中深蓝底（color-mix 在极浅底与浅阶之间取中间色）+ 主色 active 文字，
   默认尺寸 + 中粗字重承担存在感，避免描边过于抢眼；
   hover 时背景加深一档、文字提亮一档、图标向左轻移 2px 暗示“返回”方向，
   投影用中性浅影（--shadow-sm）而非主色光晕：有色光晕是主按钮专属语言，
   次要按钮借中性投影形成“轻微浮起”即可，不抢层级（动效走全局令牌） */
.back-btn {
  margin-right: var(--space-2);
  font-weight: 500;
  --el-button-bg-color: color-mix(in srgb, var(--brand-primary) 14%, white);
  --el-button-border-color: transparent;
  --el-button-text-color: var(--brand-primary-active);
  --el-button-hover-bg-color: color-mix(in srgb, var(--brand-primary) 22%, white);
  --el-button-hover-border-color: transparent;
  --el-button-hover-text-color: var(--brand-primary);
  --el-button-active-bg-color: color-mix(in srgb, var(--brand-primary) 26%, white);
  --el-button-active-border-color: transparent;
  --el-button-active-text-color: var(--brand-primary-active);
  border-radius: var(--radius-sm);
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}
.back-btn :deep(.el-icon) {
  transition: transform var(--dur-fast) var(--ease-out);
}
.back-btn:hover {
  box-shadow: var(--shadow-sm);
}
.back-btn:hover :deep(.el-icon) {
  transform: translateX(-2px);
}
.back-btn:active :deep(.el-icon) {
  transform: translateX(-1px);
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
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}
.stat-value {
  font-size: var(--font-size-h2);
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.stat-value small {
  font-size: var(--font-size-caption);
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
  color: var(--brand-violet-text);
}
</style>
