<template>
  <div>
    <el-card>
      <template #header>
        <div class="card-header">
          <span
            ><el-icon><DataAnalysis /></el-icon> 培养层次管理</span
          >
          <el-button type="primary" @click="openDialog()">
            <el-icon><Plus /></el-icon> 新增层次
          </el-button>
        </div>
      </template>
      <el-table v-loading="loading" :data="list" stripe row-key="id">
        <template #empty>
          <el-empty description="暂无数据" />
        </template>
        <el-table-column type="index" label="序号" width="60" />
        <el-table-column prop="name" label="层次名称" min-width="150" />
        <el-table-column prop="code" label="编码" min-width="120" />
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="班级数" min-width="80">
          <template #default="{ row }">{{ row.classCount || 0 }}</template>
        </el-table-column>
        <el-table-column label="排序" min-width="120" align="center">
          <template #default="{ row, $index }">
            <div class="sort-buttons">
              <el-button
                size="small"
                :icon="ArrowUp"
                :disabled="$index === 0"
                circle
                title="上移"
                @click="handleMoveUp(row, $index)"
              />
              <el-button
                size="small"
                :icon="ArrowDown"
                :disabled="$index === list.length - 1"
                circle
                title="下移"
                @click="handleMoveDown(row, $index)"
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
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="层次名称" prop="name" required>
          <el-input v-model="form.name" placeholder="请输入层次名称" />
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
      <div style="display: flex; gap: 12px; align-items: flex-start">
        <el-icon :size="24" color="var(--brand-danger)" style="flex-shrink: 0; margin-top: 2px"
          ><WarningFilled
        /></el-icon>
        <div style="flex: 1; line-height: 1.6; color: var(--text-regular)">
          <p style="margin: 0">确定要删除此培养层次吗？此操作不可撤销。</p>
          <p
            v-if="deleteWarning"
            style="margin: 8px 0 0; color: var(--brand-danger); font-size: 13px"
          >
            <el-icon style="vertical-align: -2px"><WarningFilled /></el-icon> {{ deleteWarning }}
          </p>
        </div>
      </div>
      <template #footer>
        <el-button @click="cancelDelete">取消</el-button>
        <el-button type="danger" :loading="deleting" @click="confirmDelete">确定删除</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ArrowUp, ArrowDown, Edit, Delete, WarningFilled } from '@element-plus/icons-vue';
import {
  getTrainingLevels,
  createTrainingLevel,
  updateTrainingLevel,
  deleteTrainingLevel,
} from '../../api/trainingLevel';
import { useCrudList } from '../../composables/useCrudList';

const formRef = ref(null);
const rules = {
  name: [{ required: true, message: '请输入层次名称', trigger: 'blur' }],
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
