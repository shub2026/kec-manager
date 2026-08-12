<template>
  <div class="college-list">
    <PageHeader title="学院管理" subtitle="基础数据" description="管理学院的名称、编码和描述信息">
      <template #extra>
        <el-button type="primary" @click="openDialog()">
          <el-icon><Plus /></el-icon> 新增学院
        </el-button>
      </template>
    </PageHeader>
    <el-card>
      <div class="page-toolbar">
        <el-input v-model="keyword" clearable placeholder="搜索名称或编码" class="filter-2xl" />
      </div>
      <ListErrorState v-if="error" :message="error" @retry="load" />
      <el-table v-else v-loading="loading" :data="pagedList" stripe row-key="id">
        <template #empty>
          <EmptyState type="college" description="暂无学院数据" />
        </template>
        <el-table-column
          type="index"
          label="序号"
          width="60"
          :index="(i) => (currentPage - 1) * pageSize + i + 1"
        />
        <el-table-column prop="name" label="学院名称" min-width="150" />
        <el-table-column prop="code" label="编码" min-width="120" />
        <el-table-column
          v-if="!isMobile"
          prop="description"
          label="描述"
          min-width="200"
          show-overflow-tooltip
        />
        <el-table-column label="班级数" min-width="80">
          <template #default="{ row }">{{ row.classCount || 0 }}</template>
        </el-table-column>
        <el-table-column v-if="!isMobile" label="排序" min-width="120" align="center">
          <template #default="{ row }">
            <div class="sort-buttons">
              <el-button
                size="small"
                :icon="ArrowUp"
                :disabled="realIndex(row) === 0"
                circle
                title="上移"
                aria-label="上移"
                @click="handleMoveUp(row, realIndex(row))"
              />
              <el-button
                size="small"
                :icon="ArrowDown"
                :disabled="realIndex(row) === filteredList.length - 1"
                circle
                title="下移"
                aria-label="下移"
                @click="handleMoveDown(row, realIndex(row))"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">
            <el-button
              size="small"
              :icon="Edit"
              circle
              title="编辑"
              aria-label="编辑"
              @click="openDialog(row)"
            />
            <el-button
              size="small"
              type="danger"
              :icon="Delete"
              circle
              title="删除"
              aria-label="删除"
              @click="handleDelete(row.id)"
            />
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-container">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="filteredList.length"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          :layout="isMobile ? 'prev, pager, next' : 'total, sizes, prev, pager, next'"
          background
          @size-change="currentPage = 1"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="form.id ? '编辑学院' : '新增学院'"
      width="var(--dialog-width-lg)"
      :fullscreen="isMobile"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="学院名称" prop="name" required>
          <el-input v-model="form.name" placeholder="请输入学院名称" maxlength="100" />
        </el-form-item>
        <el-form-item label="编码">
          <el-input v-model="form.code" placeholder="请输入编码（可选）" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            placeholder="请输入描述信息（可选）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 删除确认弹窗 -->
    <DeleteConfirmDialog
      v-model="deleteConfirmVisible"
      :loading="deleting"
      :warning="deleteWarning"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    >
      确定要删除此学院吗？此操作不可撤销。
    </DeleteConfirmDialog>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { ArrowUp, ArrowDown, Edit, Delete } from '@element-plus/icons-vue';
import { getColleges, createCollege, updateCollege, deleteCollege } from '../../api/college';
import { useCrudList } from '../../composables/useCrudList';
import { useResponsive } from '../../composables/useResponsive';
import EmptyState from '../../components/EmptyState.vue';
import PageHeader from '../../components/PageHeader.vue';
import DeleteConfirmDialog from '../../components/DeleteConfirmDialog.vue';
import ListErrorState from '../../components/ListErrorState.vue';

defineOptions({ name: 'CollegeList' });

// 移动端表单弹窗全屏，统一各模块弹窗在窄屏下的展示策略
const { isMobile } = useResponsive();

const formRef = ref(null);
const rules = {
  name: [
    { required: true, message: '请输入学院名称', trigger: 'blur' },
    { min: 2, max: 100, message: '名称长度应在 2-100 个字符之间', trigger: 'blur' },
  ],
};

const {
  list,
  loading,
  error,
  load,
  dialogVisible,
  saving,
  form,
  handleMoveUp,
  handleMoveDown,
  openDialog,
  handleSave,
  handleDelete,
  deleteConfirmVisible,
  deleting,
  deleteWarning,
  confirmDelete,
  cancelDelete,
} = useCrudList(
  { list: getColleges, create: createCollege, update: updateCollege, remove: deleteCollege },
  {
    nameLabel: '学院名称',
    formRef,
    getDeleteWarning: (row) => {
      const parts = [];
      if (row.classCount > 0) parts.push(`${row.classCount} 个班级`);
      if (row.schedulingCount > 0) parts.push(`${row.schedulingCount} 位教师排课偏好`);
      if (row.planCount > 0) parts.push(`${row.planCount} 个培养方案`);
      if (row.affiliatedCount > 0) parts.push(`${row.affiliatedCount} 位教师所属`);
      if (parts.length === 0) return '';
      return `该学院仍被引用（${parts.join('、')}），删除将被拒绝。请先解除上述关联后再删除。`;
    },
  }
);

// A2：补搜索工具条，维持"标题→筛选→表格"节奏；客户端按名称/编码过滤
const keyword = ref('');
const filteredList = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return list.value;
  return list.value.filter(
    (i) =>
      (i.name && i.name.toLowerCase().includes(kw)) || (i.code && i.code.toLowerCase().includes(kw))
  );
});
const realIndex = (row) => filteredList.value.findIndex((i) => i.id === row.id);

// P1-2：客户端切片分页（对齐 Plan/Course），低频实体无需后端分页
const currentPage = ref(1);
const pageSize = ref(20);
const pagedList = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredList.value.slice(start, start + pageSize.value);
});
// 筛选变化后回到第 1 页，避免停留在空页
watch(keyword, () => {
  currentPage.value = 1;
});
// 数据缩减后收敛页码
watch(filteredList, (l) => {
  const maxPage = Math.max(1, Math.ceil((l?.length || 0) / pageSize.value));
  if (currentPage.value > maxPage) currentPage.value = maxPage;
});
</script>
