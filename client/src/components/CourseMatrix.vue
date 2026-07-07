<template>
  <div class="matrix-container">
    <!-- 顶部工具栏 -->
    <CourseMatrixToolbar :all-courses="allCourses" @add-course="$emit('add-course')" />

    <!-- 矩阵表格 -->
    <CourseMatrixTable
      :raw-courses="rawCourses"
      :loading="loading"
      :global-weeks="globalWeeks"
      :total-all-hours="totalAllHours"
      @edit="openEdit"
      @delete-course="(course) => $emit('delete-course', course)"
      @move-up="handleMoveUp"
      @move-down="handleMoveDown"
      @set-semester="openSemesterSettings"
      @apply-weeks="applyGlobalWeeks"
      @update-global-weeks="globalWeeks = $event"
    />

    <!-- 编辑对话框 -->
    <CourseEditPopover
      :popover-visible="popoverVisible"
      :semester-dialog-visible="semesterDialogVisible"
      :editing-course="editingCourse"
      :editing-semester="editingSemester"
      :editing-course-for-semester="editingCourseForSemester"
      :semester-form="semesterForm"
      :editing-textbook-id="editingTextbookId"
      :saving="saving"
      :all-textbooks="allTextbooks"
      @close-popover="popoverVisible = false"
      @save-edit="saveEdit"
      @close-semester="semesterDialogVisible = false"
      @save-semester="saveSemesterSettings"
      @update-editing-semester="editingSemester = $event"
      @update-editing-textbook-id="editingTextbookId = $event"
      @update-semester-dialog-visible="semesterDialogVisible = $event"
      @update-semester-form="semesterForm = $event"
    />
  </div>
</template>

<script setup>
import CourseMatrixToolbar from './CourseMatrixToolbar.vue';
import CourseMatrixTable from './CourseMatrixTable.vue';
import CourseEditPopover from './CourseEditPopover.vue';
import { useCourseMatrixData } from '../composables/useCourseMatrixData';
import { useCourseMatrixEditing } from '../composables/useCourseMatrixEditing';

const props = defineProps({
  planId: { type: Number, required: true },
  allCourses: { type: Array, default: () => [] },
  allTextbooks: { type: Array, default: () => [] },
});

defineEmits(['add-course', 'delete-course']);

// 数据层：加载、状态、计算
const {
  loading,
  rawCourses,
  globalWeeks,
  totalAllHours,
  isInRange,
  loadData,
} = useCourseMatrixData(() => props.planId);

// 编辑层：CRUD、排序、学期设置
const {
  popoverVisible,
  saving,
  editingCourse,
  editingSemester,
  editingTextbookId,
  semesterDialogVisible,
  editingCourseForSemester,
  semesterForm,
  openEdit,
  saveEdit,
  applyGlobalWeeks,
  openSemesterSettings,
  saveSemesterSettings,
  handleMoveUp,
  handleMoveDown,
} = useCourseMatrixEditing({
  getPlanId: () => props.planId,
  rawCourses,
  globalWeeks,
  isInRange,
  loadData,
});

// 暴露刷新方法
defineExpose({ refresh: loadData });
</script>

<style scoped>
.matrix-container {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 260px);
  min-height: 500px;
}
</style>
