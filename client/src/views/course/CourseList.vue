<template>
  <div class="course-list">
    <PageHeader
      title="课程管理"
      subtitle="基础数据"
      description="管理课程信息，包括课程名称、编码和学分设置"
    >
      <template #extra>
        <el-button type="primary" @click="openDialog()">
          <el-icon><Plus /></el-icon> 新增课程
        </el-button>
      </template>
    </PageHeader>
    <el-card>
      <div class="page-toolbar">
        <el-input v-model="filterName" clearable placeholder="搜索课程名称" class="filter-2xl" />
        <div class="action-buttons">
          <el-button @click="exportData">数据导出</el-button>
          <el-button @click="downloadTemplate">下载模板</el-button>
          <el-upload
            :show-file-list="false"
            accept=".xlsx,.xls"
            action="/api/import/courses"
            name="file"
            :headers="uploadHeaders"
            :on-success="onImportSuccess"
            :on-error="onImportError"
            :before-upload="beforeImport"
          >
            <el-button>导入Excel</el-button>
          </el-upload>
        </div>
      </div>

      <el-table v-loading="loading" :data="filteredList" stripe row-key="id">
        <template #empty>
          <EmptyState type="course" description="暂无课程数据" />
        </template>
        <el-table-column type="index" label="序号" width="60" />
        <el-table-column prop="name" label="课程名称" min-width="150" />
        <el-table-column prop="code" label="编码" min-width="120" />
        <el-table-column label="类型" min-width="120">
          <template #default="{ row }">
            <el-tag :type="row.type === 'public' ? 'success' : 'warning'">
              {{ row.type === 'public' ? '公共基础课' : '专业课' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
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
                :disabled="$index === filteredList.length - 1"
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
              @click="handleDelete(row)"
            />
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="form.id ? '编辑课程' : '新增课程'"
      width="min(500px, 90vw)"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="课程名称" prop="name" required>
          <el-input v-model="form.name" placeholder="请输入课程名称" />
        </el-form-item>
        <el-form-item label="编码" prop="code">
          <el-input v-model="form.code" placeholder="请输入编码（可选）" />
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="form.type">
            <el-radio value="public">公共基础课</el-radio>
            <el-radio value="professional">专业课</el-radio>
          </el-radio-group>
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
          <p style="margin: 0">确定要删除此课程吗？此操作不可撤销。</p>
          <p
            v-if="deleteWarning"
            style="margin: 8px 0 0; color: var(--brand-danger-text); font-size: 13px"
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

    <!-- 导入确认弹窗 -->
    <el-dialog
      v-model="importConfirmVisible"
      title="导入确认"
      width="min(450px, 90vw)"
      align-center
    >
      <div style="display: flex; gap: 12px; align-items: flex-start">
        <el-icon :size="24" color="var(--brand-warning)" style="flex-shrink: 0; margin-top: 2px"
          ><WarningFilled
        /></el-icon>
        <p style="margin: 0; line-height: 1.6; color: var(--text-regular)">{{ confirmMessage }}</p>
      </div>
      <template #footer>
        <el-button @click="cancelImport">取消</el-button>
        <el-button type="warning" :loading="importing" @click="confirmImport">确定导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { ArrowUp, ArrowDown, Edit, Delete, WarningFilled } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getCourses, createCourse, updateCourse, deleteCourse } from '../../api/course';
import { useExport } from '../../composables/useExport';
import { useImport } from '../../composables/useImport';
import { useSortable } from '../../composables/useSortable';
import { useDebounceFn } from '../../composables/useDebounce';
import EmptyState from '../../components/EmptyState.vue';
import PageHeader from '../../components/PageHeader.vue';

defineOptions({ name: 'CourseList' });

const list = ref([]);
const filterName = ref('');
const debouncedFilterName = ref('');

// 防抖：文本输入200ms后再触发筛选，减少每次按键的computed重算
const applyFilter = useDebounceFn((val) => {
  debouncedFilterName.value = val;
}, 200);
watch(filterName, (val) => applyFilter(val));
const loading = ref(false);
const dialogVisible = ref(false);
const saving = ref(false);
const form = ref({ id: null, name: '', code: '', type: 'public', description: '' });

// 表单引用与校验规则
const formRef = ref(null);
const rules = {
  name: [{ required: true, message: '请输入课程名称', trigger: 'blur' }],
};

// 使用导入 composable
const {
  uploadHeaders,
  beforeImport,
  onImportSuccess,
  onImportError,
  importConfirmVisible,
  confirmMessage,
  importing,
  confirmImport,
  cancelImport,
} = useImport(
  '/import/courses',
  '导入将以数据第一列（课程名称）进行匹配，已存在的课程将被覆盖更新，确定继续导入吗？',
  silentReload
);

// 使用导出 composable
const { exportData, downloadTemplate } = useExport('courses', '课程数据');

// 筛选后的列表
const filteredList = computed(() => {
  if (!debouncedFilterName.value) return list.value;
  const keyword = debouncedFilterName.value.toLowerCase();
  return list.value.filter((item) => item.name && item.name.toLowerCase().includes(keyword));
});

// 使用排序 composable（注意：CourseList 使用 filteredList 而非 list）
const { handleMoveUp, handleMoveDown } = useSortable(filteredList, updateCourse, silentReload, {
  indexFinder: (item) => filteredList.value.findIndex((i) => i.id === item.id),
});

async function load() {
  loading.value = true;
  try {
    const res = await getCourses();
    list.value = res.data || [];
  } finally {
    loading.value = false;
  }
}

async function silentReload() {
  try {
    const res = await getCourses();
    list.value = res.data || [];
  } catch (e) {
    // silently ignore
  }
}

function openDialog(row) {
  form.value = row ? { ...row } : { id: null, name: '', code: '', type: 'public', description: '' };
  dialogVisible.value = true;
}

async function handleSave() {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }
  saving.value = true;
  try {
    if (form.value.id) {
      await updateCourse(form.value.id, form.value);
    } else {
      await createCourse(form.value);
    }
    ElMessage.success('保存成功');
    dialogVisible.value = false;
    await silentReload();
  } finally {
    saving.value = false;
  }
}

const deleteConfirmVisible = ref(false);
const deleting = ref(false);
const pendingDeleteRow = ref(null);
const deleteWarning = computed(() => {
  const row = pendingDeleteRow.value;
  if (!row) return '';
  const parts = [];
  if (row.planCount > 0) parts.push(`${row.planCount} 个培养方案`);
  if (row.assignmentCount > 0) parts.push(`${row.assignmentCount} 条排课记录`);
  if (row.teacherCourseCount > 0) parts.push(`${row.teacherCourseCount} 位教师关联`);
  if (parts.length === 0) return '';
  return `该课程已被使用（${parts.join('、')}），删除将被拒绝。请先解除上述关联后再删除。`;
});
let pendingDeleteId = null;

function handleDelete(row) {
  pendingDeleteRow.value = row;
  pendingDeleteId = row?.id ?? null;
  deleteConfirmVisible.value = true;
}

function cancelDelete() {
  deleteConfirmVisible.value = false;
  pendingDeleteRow.value = null;
  pendingDeleteId = null;
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  deleting.value = true;
  try {
    await deleteCourse(pendingDeleteId);
    ElMessage.success('删除成功');
    await silentReload();
    deleteConfirmVisible.value = false;
  } catch (e) {
    deleteConfirmVisible.value = false;
    // request.js 拦截器已显示后端返回的错误消息，此处不再重复弹窗
  } finally {
    pendingDeleteId = null;
    pendingDeleteRow.value = null;
    deleting.value = false;
  }
}

onMounted(() => {
  load();
});
</script>

<style scoped></style>
