<template>
  <div v-loading="loading" class="overview-section">
    <div class="overview-header">
      <span class="overview-title">课程安排概览</span>
      <span v-if="!loading && !error && courses.length" class="overview-hint">
        共 {{ courses.length }} 门课程，点击卡片查看安排明细
      </span>
      <div v-if="$slots['header-actions']" class="overview-actions">
        <slot name="header-actions" />
      </div>
    </div>

    <ListErrorState v-if="error" :message="error" @retry="$emit('retry')" />
    <EmptyState
      v-else-if="!loading && !courses.length"
      type="course"
      description="本学期暂无课程安排"
    />
    <div v-else class="overview-grid">
      <div
        v-for="c in courses"
        :key="c.courseId"
        class="overview-card"
        role="button"
        tabindex="0"
        @click="$emit('select-course', c.courseId)"
        @keydown.enter="$emit('select-course', c.courseId)"
      >
        <div class="card-title-row">
          <span class="card-course-name">{{ c.courseName }}</span>
          <el-tag size="small" :type="courseTypeTagType(c.courseType)" disable-transitions>
            {{ courseTypeLabel(c.courseType) }}
          </el-tag>
        </div>

        <div class="card-progress-row">
          <span class="progress-label">
            已安排 {{ c.assignedCount }}/{{ c.totalClasses }} 个班级
          </span>
          <el-tag
            v-if="c.totalClasses > 0 && c.assignedCount >= c.totalClasses"
            type="success"
            size="small"
            disable-transitions
          >
            全部安排完成
          </el-tag>
          <el-tag v-else-if="c.assignedCount === 0" type="warning" size="small" disable-transitions>
            待安排
          </el-tag>
        </div>
        <el-progress
          :percentage="progressPercent(c)"
          :status="progressPercent(c) >= 100 ? 'success' : undefined"
          :stroke-width="8"
        />

        <div class="card-stats">
          <div class="card-stat-item">
            <span class="stat-label">已排教师</span>
            <span class="stat-value">{{ c.teacherCount }}<small>人</small></span>
          </div>
          <div class="card-stat-item">
            <span class="stat-label">已锁定</span>
            <span class="stat-value">{{ c.lockedCount }}<small>个</small></span>
          </div>
          <div class="card-stat-item">
            <span class="stat-label">总课时</span>
            <span class="stat-value">{{ c.totalCourseHours }}<small>课时</small></span>
          </div>
          <div class="card-stat-item">
            <span class="stat-label">剩余课时</span>
            <span
              class="stat-value"
              :class="c.remainingHours >= 0 ? 'text-success' : 'text-danger'"
            >
              {{ c.remainingHours }}<small>课时</small>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import ListErrorState from '../../../components/ListErrorState.vue';
import EmptyState from '../../../components/EmptyState.vue';

defineProps({
  courses: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: null },
});

defineEmits(['select-course', 'retry']);

function courseTypeLabel(type) {
  return { public: '公共课', professional: '专业课', elective: '选修课' }[type] || type;
}

// 与课程管理页类型标签配色保持一致：公共课蓝（primary）、专业课绿
// 注意：不能传空字符串，el-tag 的 type 校验器只接受具名类型值
function courseTypeTagType(type) {
  return { professional: 'success' }[type] || 'primary';
}

function progressPercent(c) {
  if (!c.totalClasses) return 0;
  return Math.min(100, Math.round((c.assignedCount / c.totalClasses) * 100));
}
</script>

<style scoped>
.overview-section {
  margin-bottom: var(--space-4);
}
.overview-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.overview-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.overview-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}
.overview-hint {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 0;
}
.overview-grid {
  display: grid;
  /* min(100%, 280px)：超窄屏（<320px）单列自适应，避免最小列宽撑出横向滚动条 */
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  gap: var(--space-3);
}
.overview-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: var(--el-border-radius-base, 4px);
  cursor: pointer;
  transition:
    box-shadow 0.2s,
    border-color 0.2s;
}
.overview-card:hover {
  border-color: var(--el-color-primary-light-5, #a0cfff);
  box-shadow: var(--el-box-shadow-light, 0 2px 12px rgba(0, 0, 0, 0.08));
}
.overview-card:focus-visible {
  outline: 2px solid var(--el-color-primary, #409eff);
  outline-offset: 2px;
}
.card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.card-course-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-progress-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.progress-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.card-stats {
  display: flex;
  flex-wrap: wrap;
  border-top: 1px solid var(--el-border-color-extra-light, #f2f6fc);
  padding-top: var(--space-2);
}
.card-stat-item {
  flex: 1 1 0;
  min-width: 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.stat-value {
  font-size: var(--font-size-h3, 18px);
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

/* 移动端（≤768px）：标题与操作按钮换行堆叠，按钮组铺满并允许换行防溢出 */
@media (max-width: 768px) {
  .overview-header {
    flex-wrap: wrap;
  }
  .overview-hint {
    flex: 1 1 100%;
    order: 3;
  }
  .overview-actions {
    width: 100%;
    margin-left: 0;
    gap: var(--space-2);
    /* 三列等宽网格：三个学期级操作按钮严格对齐，避免内容宽度差异导致左右不齐 */
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  /* 学期级操作按钮（含批量排课下拉）填满网格单元；
     按钮为父组件插槽内容，需 :deep 穿透 scoped 作用域 */
  .overview-actions :deep(.el-dropdown),
  .overview-actions :deep(.el-button) {
    width: 100%;
    margin-left: 0;
  }
  .overview-actions :deep(.el-dropdown) .el-button {
    width: 100%;
  }
}

/* 超窄屏（≤480px）：操作按钮纵向全宽排列；卡片统计项改两列，避免四指标挤成一行 */
@media (max-width: 480px) {
  .overview-actions {
    grid-template-columns: 1fr;
  }
  .card-stats {
    gap: var(--space-2);
  }
  .card-stat-item {
    flex: 1 1 40%;
  }
}
</style>
