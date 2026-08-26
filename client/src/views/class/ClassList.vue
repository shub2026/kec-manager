<template>
  <div class="class-list">
    <PageHeader title="班级管理" subtitle="基础数据" description="管理各专业的教学班级信息">
      <template #extra>
        <el-button type="primary" @click="openDialog()">
          <el-icon><Plus /></el-icon> 新增班级
        </el-button>
      </template>
    </PageHeader>
    <el-card>
      <!-- 筛选器组件：参考数据从 classDataStore 获取，无需 prop drilling -->
      <ClassFilterBar
        v-model:filters="filters"
        @change="resetPaginationAndLoad"
        @search="load"
        @export="handleExport"
        @download-template="downloadTemplate"
        @import-success="onImportSuccess"
        @import-error="onImportError"
        @before-upload="beforeImport"
        @add="openDialog"
      />

      <!-- 表格组件 -->
      <ListErrorState v-if="error" :message="error" @retry="load" />
      <ClassTable
        v-else
        :classes="list"
        :loading="loading"
        :selected-classes="selectedClasses"
        :pagination="pagination"
        :semester-info="currentSemesterInfo"
        @selection-change="handleSelectionChange"
        @edit="openDialog"
        @delete="handleDelete"
        @batch-delete="handleBatchDelete"
        @batch-set="openBatchSetDialog"
        @size-change="handleSizeChange"
        @page-change="handlePageChange"
      />
    </el-card>

    <!-- 表单对话框组件：参考数据从 classDataStore 获取，无需 prop drilling -->
    <ClassFormDialog
      v-model:visible="dialogVisible"
      v-model:batch-visible="batchDialogVisible"
      v-model:form="form"
      v-model:batch-form="batchForm"
      :batch-form-type="batchFormType"
      :batch-dialog-title="batchDialogTitle"
      :saving="saving || batchSaving"
      :classes="allClassOptions"
      @save="handleSave"
      @batch-save="handleBatchSet"
      @close="resetForm"
      @batch-close="resetBatchForm"
    />

    <!-- 导入进度对话框 -->
    <el-dialog
      v-model="progressDialogVisible"
      title="正在导入"
      width="var(--dialog-width-lg)"
      :close-on-click-modal="false"
      :show-close="false"
      :fullscreen="isMobile"
    >
      <div class="progress-container">
        <el-progress :percentage="progressPercent" :status="progressStatus" :stroke-width="20" />
        <div class="progress-info">
          <div class="progress-text">{{ progressText }}</div>
          <div v-if="progressDetail" class="progress-detail">
            {{ progressDetail }}
          </div>
        </div>
        <div class="progress-tip">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>请稍候，正在处理中...</span>
        </div>
      </div>
    </el-dialog>

    <!-- 单个删除确认弹窗：复用全局 DeleteConfirmDialog，与列表页保持一致 -->
    <DeleteConfirmDialog
      v-model="deleteConfirmVisible"
      :loading="deleting"
      @confirm="confirmDelete"
    >
      确定要删除此班级吗？此操作不可撤销。
    </DeleteConfirmDialog>

    <!-- 批量删除确认弹窗 -->
    <DeleteConfirmDialog
      v-model="batchDeleteConfirmVisible"
      :loading="batchDeleting"
      @confirm="confirmBatchDelete"
    >
      {{ batchDeleteConfirmMessage }}
    </DeleteConfirmDialog>

    <!-- 批量离校确认弹窗（warning 语义，使用 warning 按钮） -->
    <el-dialog
      v-model="leftSchoolConfirmVisible"
      title="确认批量离校"
      width="var(--dialog-width)"
      align-center
      :fullscreen="isMobile"
    >
      <BaseConfirmBody>{{ leftSchoolConfirmMessage }}</BaseConfirmBody>
      <template #footer>
        <el-button @click="cancelLeftSchoolConfirm">取消</el-button>
        <el-button type="primary" @click="confirmLeftSchool">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { useResponsive } from '../../composables/useResponsive';
import PageHeader from '../../components/PageHeader.vue';
import DeleteConfirmDialog from '../../components/DeleteConfirmDialog.vue';
import BaseConfirmBody from '../../components/BaseConfirmBody.vue';
import ListErrorState from '../../components/ListErrorState.vue';
import ClassFilterBar from './components/ClassFilterBar.vue';
import ClassTable from './components/ClassTable.vue';
import ClassFormDialog from './components/ClassFormDialog.vue';
import { useClassList } from './composables/useClassList';

defineOptions({ name: 'ClassList' });

// 移动端表单/确认弹窗全屏，统一各模块弹窗在窄屏下的展示策略
const { isMobile } = useResponsive();

// 列表/表单/删除/批量操作/导入导出等业务逻辑集中在 composable，
// 本组件仅保留模板与布局编排
const {
  list,
  loading,
  error,
  filters,
  pagination,
  currentSemesterInfo,
  selectedClasses,
  load,
  resetPaginationAndLoad,
  handlePageChange,
  handleSizeChange,
  handleSelectionChange,
  dialogVisible,
  form,
  allClassOptions,
  saving,
  openDialog,
  resetForm,
  handleSave,
  deleteConfirmVisible,
  deleting,
  handleDelete,
  confirmDelete,
  batchDeleteConfirmVisible,
  batchDeleteConfirmMessage,
  batchDeleting,
  handleBatchDelete,
  confirmBatchDelete,
  batchDialogVisible,
  batchForm,
  batchFormType,
  batchDialogTitle,
  batchSaving,
  openBatchSetDialog,
  resetBatchForm,
  handleBatchSet,
  confirmLeftSchool,
  cancelLeftSchoolConfirm,
  leftSchoolConfirmVisible,
  leftSchoolConfirmMessage,
  progressDialogVisible,
  progressPercent,
  progressStatus,
  progressText,
  progressDetail,
  beforeImport,
  onImportSuccess,
  onImportError,
  handleExport,
  downloadTemplate,
} = useClassList();
</script>

<style scoped>
.progress-container {
  padding: var(--space-card) 0;
}

.progress-info {
  margin-top: var(--space-card);
  text-align: center;
}

.progress-text {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: var(--space-2);
}

.progress-detail {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
}

.progress-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-card);
  padding-top: var(--space-card);
  border-top: 1px solid var(--border-light);
  color: var(--brand-primary);
  font-size: var(--font-size-body);
}
</style>
