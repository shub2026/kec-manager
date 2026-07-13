<template>
  <el-dialog
    :model-value="modelValue"
    title="批量排课结果"
    width="min(900px, 95vw)"
    destroy-on-close
    class="batch-result-dialog"
    top="6vh"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- 汇总统计 -->
    <div class="batch-summary">
      <div class="batch-stat-card is-success">
        <div class="batch-stat-num">{{ result.summary?.totalCourses || 0 }}</div>
        <div class="batch-stat-label">课程总数</div>
      </div>
      <div class="batch-stat-card is-success">
        <div class="batch-stat-num text-success">
          {{ result.summary?.totalAssigned || 0 }}
        </div>
        <div class="batch-stat-label">已安排班级</div>
      </div>
      <div
        class="batch-stat-card"
        :class="{ 'is-warning': (result.summary?.totalUnassigned || 0) > 0 }"
      >
        <div
          class="batch-stat-num"
          :class="(result.summary?.totalUnassigned || 0) > 0 ? 'text-warning' : ''"
        >
          {{ result.summary?.totalUnassigned || 0 }}
        </div>
        <div class="batch-stat-label">未分配班级</div>
      </div>
      <div class="batch-stat-card" :class="{ 'is-danger': (result.summary?.errorCount || 0) > 0 }">
        <div
          class="batch-stat-num"
          :class="(result.summary?.errorCount || 0) > 0 ? 'text-danger' : ''"
        >
          {{ result.summary?.errorCount || 0 }}
        </div>
        <div class="batch-stat-label">出错课程</div>
      </div>
    </div>

    <!-- 筛选标签 -->
    <div class="batch-filter-tabs">
      <el-radio-group v-model="batchResultFilter" size="small">
        <el-radio-button value="all"
          >全部 ({{ (result.courseResults || []).length }})</el-radio-button
        >
        <el-radio-button value="issue">有问题 ({{ batchIssueCount }})</el-radio-button>
      </el-radio-group>
    </div>

    <!-- 课程结果列表 -->
    <div class="batch-course-list">
      <div
        v-for="r in filteredBatchResults"
        :key="r.courseId"
        class="batch-course-item"
        :class="{ 'has-error': r.error, 'has-unassigned': r.unassignedCount > 0 }"
      >
        <div class="course-item-header" @click="toggleCourseDetail(r.courseId)">
          <div class="course-item-left">
            <el-icon class="expand-icon" :class="{ expanded: expandedCourses.has(r.courseId) }"
              ><ArrowRight
            /></el-icon>
            <span class="course-item-name">{{ r.courseName }}</span>
          </div>
          <div class="course-item-right">
            <el-tag v-if="r.error" type="danger" size="small">出错</el-tag>
            <el-tag v-if="r.unassignedCount > 0" type="warning" size="small"
              >{{ r.unassignedCount }} 未分配</el-tag
            >
            <el-tag v-if="!r.error && r.unassignedCount === 0" type="success" size="small"
              >完成</el-tag
            >
            <span class="course-item-stat">{{ r.autoCount || 0 }}/{{ r.totalClasses || 0 }}</span>
          </div>
        </div>
        <div v-if="expandedCourses.has(r.courseId)" class="course-item-detail">
          <div v-if="r.error" class="detail-error">
            <el-icon><WarningFilled /></el-icon> {{ r.error }}
          </div>
          <div v-if="r.warnings?.length" class="detail-warnings">
            <div v-for="(w, i) in r.warnings" :key="w" class="detail-warning-item">
              <el-icon><Warning /></el-icon> {{ w }}
            </div>
          </div>
          <div v-if="r.unassigned?.length" class="detail-unassigned">
            <div class="detail-section-title">未分配班级</div>
            <div v-for="u in r.unassigned" :key="u.classId" class="detail-unassigned-item">
              <span class="unassigned-class-name">{{ u.className }}</span>
              <span class="unassigned-hours">{{ u.weeklyHours }} 课时</span>
              <span v-if="u.reason" class="unassigned-reason">{{ u.reason }}</span>
            </div>
          </div>
          <div v-if="!r.error && !r.unassigned?.length && !r.warnings?.length" class="detail-ok">
            所有 {{ r.autoCount || 0 }} 个班级均已安排
          </div>
        </div>
      </div>
      <el-empty v-if="filteredBatchResults.length === 0" description="暂无数据" :image-size="60" />
    </div>

    <template #footer>
      <el-button type="primary" @click="emit('update:modelValue', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  result: { type: Object, default: () => ({}) },
});

const emit = defineEmits(['update:modelValue']);

const batchResultFilter = ref('all');
const expandedCourses = ref(new Set());

const batchIssueCount = computed(() => {
  const results = props.result.courseResults || [];
  return results.filter((r) => r.error || r.unassignedCount > 0).length;
});

const filteredBatchResults = computed(() => {
  const results = props.result.courseResults || [];
  if (batchResultFilter.value === 'issue') {
    return results.filter((r) => r.error || r.unassignedCount > 0);
  }
  return results;
});

function toggleCourseDetail(courseId) {
  const s = new Set(expandedCourses.value);
  if (s.has(courseId)) s.delete(courseId);
  else s.add(courseId);
  expandedCourses.value = s;
}
</script>

<style scoped>
:deep(.batch-result-dialog) .el-dialog__body {
  padding: 16px 20px;
}
.batch-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.batch-stat-card {
  background: var(--bg-subtle);
  border-radius: 8px;
  padding: 12px 8px;
  text-align: center;
  border: 1px solid transparent;
  transition: border-color 0.2s;
}
.batch-stat-card.is-warning {
  background: var(--brand-warning-soft);
  border-color: var(--brand-warning);
}
.batch-stat-card.is-danger {
  background: var(--brand-danger-soft);
  border-color: var(--brand-danger);
}
.batch-stat-num {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}
.batch-stat-num.text-success {
  color: var(--brand-success-text);
}
.batch-stat-num.text-warning {
  color: var(--brand-warning-text);
}
.batch-stat-num.text-danger {
  color: var(--brand-danger-text);
}
.batch-stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}
.batch-filter-tabs {
  margin-bottom: 12px;
  display: flex;
  justify-content: flex-end;
}
.batch-course-list {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--border-light);
  border-radius: 6px;
}
.batch-course-item {
  border-bottom: 1px solid var(--border-light);
}
.batch-course-item:last-child {
  border-bottom: none;
}
.batch-course-item.has-error {
  background: var(--brand-danger-soft);
}
.batch-course-item.has-unassigned {
  background: var(--brand-warning-soft);
}
.course-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.course-item-header:hover {
  background: rgba(0, 0, 0, 0.03);
}
.course-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.expand-icon {
  transition: transform 0.2s;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.expand-icon.expanded {
  transform: rotate(90deg);
}
.course-item-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.course-item-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.course-item-stat {
  font-size: 12px;
  color: var(--text-secondary);
}
.course-item-detail {
  padding: 8px 14px 12px 34px;
  border-top: 1px dashed var(--border-light);
  font-size: 13px;
}
.detail-error {
  color: var(--brand-danger-text);
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.detail-warnings {
  margin-bottom: 8px;
}
.detail-warning-item {
  color: var(--brand-warning-text);
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.detail-unassigned {
  margin-top: 4px;
}
.detail-section-title {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
  font-weight: 600;
}
.detail-unassigned-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  border-bottom: 1px solid var(--bg-subtle);
}
.detail-unassigned-item:last-child {
  border-bottom: none;
}
.unassigned-class-name {
  font-weight: 500;
  color: var(--text-primary);
}
.unassigned-hours {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.unassigned-reason {
  font-size: 12px;
  color: var(--brand-warning-text);
  margin-left: auto;
}
.detail-ok {
  color: var(--brand-success-text);
  font-size: 13px;
}
</style>
