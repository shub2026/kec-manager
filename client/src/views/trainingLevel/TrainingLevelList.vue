<template>
  <div class="training-level-list">
    <PageHeader
      title="培养层次"
      subtitle="基础数据"
      description="管理培养层次信息，如高职、中职、技工等"
    >
      <template #extra>
        <el-button type="primary" @click="openDialog()">
          <el-icon><Plus /></el-icon> 新增层次
        </el-button>
      </template>
    </PageHeader>
    <el-card>
      <div class="page-toolbar">
        <el-input v-model="keyword" clearable placeholder="搜索名称或编码" class="filter-2xl" />
      </div>
      <el-table v-loading="loading" :data="filteredList" stripe row-key="id">
        <template #empty>
          <EmptyState type="generic" description="暂无培养层次数据" />
        </template>
        <el-table-column type="index" label="序号" width="60" />
        <el-table-column prop="name" label="层次名称" min-width="150" />
        <el-table-column prop="code" label="编码" min-width="120" />
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="班级数" min-width="80">
          <template #default="{ row }">{{ row.classCount || 0 }}</template>
        </el-table-column>
        <el-table-column label="排序" min-width="120" align="center">
          <template #default="{ row }">
            <div class="sort-buttons">
              <el-button
                size="small"
                :icon="ArrowUp"
                :disabled="realIndex(row) === 0"
                circle
                title="上移"
                @click="handleMoveUp(row, realIndex(row))"
              />
              <el-button
                size="small"
                :icon="ArrowDown"
                :disabled="realIndex(row) === filteredList.length - 1"
                circle
                title="下移"
                @click="handleMoveDown(row, realIndex(row))"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">
            <el-button size="small" :icon="Edit" circle @click="openDialog(row)" />
            <el-button
              size="small"
              type="danger"
              :icon="Delete"
              circle
              @click="handleDelete(row.id)"
            />
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="form.id ? '编辑层次' : '新增层次'"
      width="min(500px, 90vw)"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="层次名称" prop="name" required>
          <el-input v-model="form.name" placeholder="请输入层次名称" maxlength="100" />
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
    <el-dialog
      v-model="deleteConfirmVisible"
      title="确认删除"
      width="min(450px, 90vw)"
      align-center
    >
      <BaseConfirmBody icon-color="var(--brand-danger)" :warning="deleteWarning">
        确定要删除此培养层次吗？此操作不可撤销。
      </BaseConfirmBody>
      <template #footer>
        <el-button @click="cancelDelete">取消</el-button>
        <el-button type="danger" :loading="deleting" @click="confirmDelete">确定删除</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { ArrowUp, ArrowDown, Edit, Delete } from '@element-plus/icons-vue';
import {
  getTrainingLevels,
  createTrainingLevel,
  updateTrainingLevel,
  deleteTrainingLevel,
} from '../../api/trainingLevel';
import { useCrudList } from '../../composables/useCrudList';
import EmptyState from '../../components/EmptyState.vue';
import PageHeader from '../../components/PageHeader.vue';
import BaseConfirmBody from '../../components/BaseConfirmBody.vue';

defineOptions({ name: 'TrainingLevelList' });

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

const formRef = ref(null);
const rules = {
  name: [
    { required: true, message: '请输入层次名称', trigger: 'blur' },
    { min: 2, max: 100, message: '名称长度应在 2-100 个字符之间', trigger: 'blur' },
  ],
};

const {
  list,
  loading,
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
  {
    list: getTrainingLevels,
    create: createTrainingLevel,
    update: updateTrainingLevel,
    remove: deleteTrainingLevel,
  },
  {
    nameLabel: '层次名称',
    formRef,
    getDeleteWarning: (row) => {
      const parts = [];
      if (row.classCount > 0) parts.push(`${row.classCount} 个班级`);
      if (row.schedulingCount > 0) parts.push(`${row.schedulingCount} 位教师排课偏好`);
      if (row.planCount > 0) parts.push(`${row.planCount} 个培养方案`);
      if (parts.length === 0) return '';
      return `该层次仍被引用（${parts.join('、')}），删除将被拒绝。请先解除上述关联后再删除。`;
    },
  }
);
</script>
