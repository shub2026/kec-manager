<template>
  <div>
    <el-card>
      <template #header>
        <div class="card-header">
          <span
            ><el-icon><Notebook /></el-icon> 教材管理</span
          >
          <el-button type="primary" @click="openDialog()">
            <el-icon><Plus /></el-icon> 新增教材
          </el-button>
        </div>
      </template>
      <div class="page-toolbar">
        <el-input v-model="filterTitle" clearable placeholder="按书名筛选" class="filter-2xl" />
        <el-select v-model="filterCategory" placeholder="类别筛选" clearable class="filter-md">
          <el-option label="技工" value="技工" />
          <el-option label="非技工" value="非技工" />
        </el-select>
        <el-select
          v-model="filterPublisher"
          placeholder="出版社筛选"
          clearable
          filterable
          class="filter-xl"
        >
          <el-option v-for="pub in publishers" :key="pub" :label="pub" :value="pub" />
        </el-select>
        <div class="action-buttons">
          <el-button @click="exportData">数据导出</el-button>
          <el-button @click="downloadTemplate">下载模板</el-button>
          <el-upload
            :show-file-list="false"
            accept=".xlsx,.xls"
            action="/api/import/textbooks"
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
      <el-table
        v-loading="loading"
        :data="filteredList"
        stripe
        row-key="id"
        @selection-change="handleSelectionChange"
      >
        <template #empty>
          <el-empty
            :description="
              list.length === 0 ? '暂无教材数据，请点击右上角新增' : '未匹配到筛选条件，请重置筛选'
            "
          />
        </template>
        <el-table-column type="selection" width="45" />
        <el-table-column type="index" label="序号" width="60" />
        <el-table-column prop="title" label="书名" min-width="150" show-overflow-tooltip />
        <el-table-column prop="isbn" label="书号" min-width="120" show-overflow-tooltip />
        <el-table-column prop="publisher" label="出版社" min-width="120" show-overflow-tooltip />
        <el-table-column prop="author" label="作者" min-width="80" show-overflow-tooltip />
        <el-table-column prop="edition" label="版次" min-width="55" />
        <el-table-column label="出版日期" min-width="85">
          <template #default="{ row }">{{ row.publishDate || '-' }}</template>
        </el-table-column>
        <el-table-column label="定价" min-width="65">
          <template #default="{ row }">{{ row.price || '-' }}</template>
        </el-table-column>
        <el-table-column label="类别" min-width="80">
          <template #default="{ row }">
            <el-tag
              v-if="row.category"
              :type="row.category === '技工' ? 'primary' : 'info'"
              size="small"
            >
              {{ row.category }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="65">
          <template #default="{ row }">
            <el-tag :type="row.isActive ? 'success' : 'info'" size="small">
              {{ row.isActive ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="排序" min-width="100" align="center">
          <template #default="{ row, $index }">
            <div class="sort-buttons">
              <el-button
                size="small"
                :icon="ArrowUp"
                :disabled="$index === 0"
                circle
                title="上移"
                @click="handleMoveUp(row)"
              />
              <el-button
                size="small"
                :icon="ArrowDown"
                :disabled="$index === filteredList.length - 1"
                circle
                title="下移"
                @click="handleMoveDown(row)"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" align="center">
          <template #default="{ row }">
            <div class="op-buttons">
              <el-button
                size="small"
                :type="row.isActive ? 'warning' : 'success'"
                @click="handleToggleStatus(row)"
              >
                {{ row.isActive ? '停用' : '启用' }}
              </el-button>
              <el-button size="small" :icon="Edit" circle title="编辑" @click="openDialog(row)" />
              <el-button
                size="small"
                :icon="Delete"
                circle
                type="danger"
                title="删除"
                @click="handleDelete(row)"
              />
            </div>
          </template>
        </el-table-column>
      </el-table>

      <!-- 批量操作栏 -->
      <div v-if="selectedTextbooks.length > 0" class="batch-operations">
        <span class="selected-count">已选择 {{ selectedTextbooks.length }} 个教材</span>
        <el-button size="small" @click="openBatchSetDialog('publisher')">
          <el-icon><Edit /></el-icon> 批量设置出版社
        </el-button>
        <el-button size="small" @click="openBatchSetDialog('author')">
          <el-icon><Edit /></el-icon> 批量设置作者
        </el-button>
        <el-button size="small" @click="openBatchSetDialog('category')">
          <el-icon><Edit /></el-icon> 批量设置类别
        </el-button>
        <el-button size="small" type="danger" @click="handleBatchDelete">
          <el-icon><Delete /></el-icon> 批量删除
        </el-button>
      </div>
    </el-card>

    <!-- 批量设置对话框 -->
    <el-dialog
      v-model="batchDialogVisible"
      :title="batchDialogTitle"
      width="min(500px, 90vw)"
      destroy-on-close
    >
      <el-form label-width="90px">
        <el-form-item v-if="batchFormType === 'publisher'" label="出版社">
          <el-input v-model="batchForm.publisher" placeholder="请输入出版社名称" />
        </el-form-item>
        <el-form-item v-else-if="batchFormType === 'author'" label="作者">
          <el-input v-model="batchForm.author" placeholder="请输入作者姓名" />
        </el-form-item>
        <el-form-item v-else-if="batchFormType === 'category'" label="类别">
          <el-select v-model="batchForm.category" placeholder="请选择类别" style="width: 100%">
            <el-option label="技工" value="技工" />
            <el-option label="非技工" value="非技工" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="batchSaving" @click="handleBatchSet">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="dialogVisible"
      :title="form.id ? '编辑教材' : '新增教材'"
      :fullscreen="isMobile"
      width="min(600px, 90vw)"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-row :gutter="16">
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="书名" prop="title" required>
              <el-input v-model="form.title" />
            </el-form-item>
          </el-col>
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="书号">
              <el-input v-model="form.isbn" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="出版社">
              <el-input v-model="form.publisher" />
            </el-form-item>
          </el-col>
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="版次">
              <el-input v-model="form.edition" placeholder="如：第3版" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="出版日期">
              <el-input v-model="form.publishDate" />
            </el-form-item>
          </el-col>
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="定价" prop="price">
              <el-input-number v-model="form.price" :min="0" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="作者">
              <el-input v-model="form.author" />
            </el-form-item>
          </el-col>
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="类别">
              <el-select v-model="form.category" style="width: 100%">
                <el-option label="技工" value="技工" />
                <el-option label="非技工" value="非技工" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="备注">
          <el-input v-model="form.description" type="textarea" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批量删除确认弹窗 -->
    <el-dialog
      v-model="batchDeleteConfirmVisible"
      title="批量删除"
      width="min(420px, 90vw)"
      align-center
    >
      <div style="display: flex; gap: 12px; align-items: flex-start">
        <el-icon :size="24" color="#F56C6C" style="flex-shrink: 0; margin-top: 2px"
          ><WarningFilled
        /></el-icon>
        <p style="margin: 0; line-height: 1.6; color: #606266">{{ batchDeleteConfirmMessage }}</p>
      </div>
      <template #footer>
        <el-button @click="batchDeleteConfirmVisible = false">取消</el-button>
        <el-button type="danger" :loading="batchDeleting" @click="confirmBatchDelete"
          >确定删除</el-button
        >
      </template>
    </el-dialog>

    <!-- 删除确认弹窗 -->
    <el-dialog
      v-model="deleteConfirmVisible"
      title="确认删除"
      width="min(420px, 90vw)"
      align-center
    >
      <div style="display: flex; gap: 12px; align-items: flex-start">
        <el-icon :size="24" color="#F56C6C" style="flex-shrink: 0; margin-top: 2px"
          ><WarningFilled
        /></el-icon>
        <div style="flex: 1; line-height: 1.6; color: #606266">
          <p style="margin: 0">确定要删除此教材吗？此操作不可撤销。</p>
          <p v-if="deleteWarning" style="margin: 8px 0 0; color: #f56c6c; font-size: 13px">
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
      width="min(420px, 90vw)"
      align-center
    >
      <div style="display: flex; gap: 12px; align-items: flex-start">
        <el-icon :size="24" color="#E6A23C" style="flex-shrink: 0; margin-top: 2px"
          ><WarningFilled
        /></el-icon>
        <p style="margin: 0; line-height: 1.6; color: #606266">{{ confirmMessage }}</p>
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
import { ArrowUp, ArrowDown, Edit, Delete } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import {
  getTextbooks,
  createTextbook,
  updateTextbook,
  deleteTextbook,
  toggleTextbookStatus,
} from '../../api/textbook';
import { useExport } from '../../composables/useExport';
import { useImport } from '../../composables/useImport';
import { useSortable } from '../../composables/useSortable';
import { useResponsive } from '../../composables/useResponsive';

const list = ref([]);

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
  '/import/textbooks',
  '导入将以数据第一列（书名）进行匹配，已存在的教材将被覆盖更新，确定继续导入吗？',
  silentReload
);

const loading = ref(false);
const dialogVisible = ref(false);
const saving = ref(false);
const filterTitle = ref('');
const debouncedFilterTitle = ref('');
const filterCategory = ref('');
const filterPublisher = ref('');

// 防抖：文本输入200ms后再触发筛选，减少每次按键的computed重算
let _filterTimer = null;
watch(filterTitle, (val) => {
  clearTimeout(_filterTimer);
  _filterTimer = setTimeout(() => {
    debouncedFilterTitle.value = val;
  }, 200);
});

// 表单引用与校验规则
const formRef = ref(null);
const rules = {
  title: [{ required: true, message: '请输入教材名称', trigger: 'blur' }],
  price: [{ type: 'number', min: 0, message: '定价必须大于等于0', trigger: 'blur' }],
};

// 弹窗小屏全屏：复用共享响应式断点（由 useResponsive 统一管理 resize 监听）
const { isMobile } = useResponsive();
const defaultForm = {
  id: null,
  title: '',
  isbn: '',
  publisher: '',
  author: '',
  edition: '',
  publishDate: '',
  price: null,
  category: '',
  description: '',
  isActive: true,
};
const form = ref({ ...defaultForm });

// 批量操作相关状态
const selectedTextbooks = ref([]);
const batchDialogVisible = ref(false);
const batchSaving = ref(false);
const batchFormType = ref(''); // publisher, author, category
const batchDialogTitle = ref('');
const batchForm = ref({
  publisher: '',
  author: '',
  category: '',
});

// 使用导出 composable
const { exportData, downloadTemplate } = useExport('textbooks', '教材数据');

// 获取所有出版社列表
const publishers = computed(() => {
  const pubs = new Set();
  list.value.forEach((item) => {
    if (item.publisher) pubs.add(item.publisher);
  });
  return Array.from(pubs).sort();
});

// 筛选后的列表
const filteredList = computed(() => {
  let result = list.value;
  if (debouncedFilterTitle.value) {
    const titleLower = debouncedFilterTitle.value.toLowerCase();
    result = result.filter((item) => item.title && item.title.toLowerCase().includes(titleLower));
  }
  if (filterCategory.value) {
    result = result.filter((item) => item.category === filterCategory.value);
  }
  if (filterPublisher.value) {
    result = result.filter((item) => item.publisher === filterPublisher.value);
  }
  return result;
});

// 使用排序 composable（注意：TextbookList 使用 filteredList 而非 list）
const { handleMoveUp, handleMoveDown } = useSortable(filteredList, updateTextbook, silentReload, {
  indexFinder: (item) => filteredList.value.findIndex((i) => i.id === item.id),
});

async function load() {
  loading.value = true;
  try {
    const res = await getTextbooks();
    list.value = res.data || [];
  } finally {
    loading.value = false;
  }
}

async function silentReload() {
  try {
    const res = await getTextbooks();
    list.value = res.data || [];
  } catch {
    // silently ignore
  }
}

function openDialog(row) {
  form.value = row ? { ...row } : { ...defaultForm };
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
    // 前端统一使用 camelCase，由 naming 中间件自动转换为 snake_case 给后端
    const textbookData = {
      title: form.value.title,
      isbn: form.value.isbn || undefined,
      publisher: form.value.publisher || undefined,
      author: form.value.author || undefined,
      edition: form.value.edition || undefined,
      publishDate: form.value.publishDate || undefined,
      price:
        form.value.price !== null && form.value.price !== '' ? Number(form.value.price) : undefined,
      category: form.value.category || undefined,
      description: form.value.description || undefined,
      isActive: form.value.isActive,
      sortOrder: form.value.sortOrder,
    };

    if (form.value.id) {
      await updateTextbook(form.value.id, textbookData);
    } else {
      await createTextbook(textbookData);
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
  const count = pendingDeleteRow.value?.usageCount || 0;
  return count > 0
    ? `该教材已被 ${count} 个培养方案引用，删除将被拒绝。请先解除关联后再删除。`
    : '';
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
    await deleteTextbook(pendingDeleteId);
    ElMessage.success('删除成功');
    await silentReload();
    deleteConfirmVisible.value = false;
  } catch {
    deleteConfirmVisible.value = false;
    // request.js 拦截器已显示后端返回的错误消息，此处不再重复弹窗
  } finally {
    pendingDeleteId = null;
    pendingDeleteRow.value = null;
    deleting.value = false;
  }
}

async function handleToggleStatus(row) {
  try {
    const res = await toggleTextbookStatus(row.id);
    // 使用后端返回的最新状态（命名转换中间件已统一转为 camelCase）
    const newStatus = res.data?.isActive;
    ElMessage.success(newStatus ? '已启用' : '已停用');
    await silentReload();
  } catch {
    // request.js 拦截器已显示后端返回的错误消息，此处不再重复弹窗
  }
}

// ==================== 批量操作函数 ====================

// 选择变化处理
function handleSelectionChange(selection) {
  selectedTextbooks.value = selection;
}

// 打开批量设置对话框
function openBatchSetDialog(type) {
  batchFormType.value = type;
  batchDialogTitle.value = {
    publisher: '批量设置出版社',
    author: '批量设置作者',
    category: '批量设置类别',
  }[type];

  // 重置表单
  batchForm.value = {
    publisher: '',
    author: '',
    category: '',
  };

  batchDialogVisible.value = true;
}

// 执行批量设置
async function handleBatchSet() {
  const type = batchFormType.value;

  // 验证
  if (type === 'publisher' && !batchForm.value.publisher) {
    return ElMessage.warning('请输入出版社名称');
  }
  if (type === 'author' && !batchForm.value.author) {
    return ElMessage.warning('请输入作者姓名');
  }
  if (type === 'category' && !batchForm.value.category) {
    return ElMessage.warning('请选择类别');
  }

  batchSaving.value = true;
  try {
    const ids = selectedTextbooks.value.map((t) => t.id);
    const updateData = {};

    switch (type) {
      case 'publisher':
        updateData.publisher = batchForm.value.publisher;
        break;
      case 'author':
        updateData.author = batchForm.value.author;
        break;
      case 'category':
        updateData.category = batchForm.value.category;
        break;
    }

    await Promise.all(ids.map((id) => updateTextbook(id, updateData)));
    ElMessage.success(`已成功更新 ${ids.length} 个教材`);
    batchDialogVisible.value = false;
    selectedTextbooks.value = [];
    await silentReload();
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('批量更新失败:', e);
    }
    // request.js 拦截器已显示后端返回的错误消息，此处不再重复弹窗
  } finally {
    batchSaving.value = false;
  }
}

// 批量删除
const batchDeleteConfirmVisible = ref(false);
const batchDeleteConfirmMessage = ref('');
const batchDeleting = ref(false);

function handleBatchDelete() {
  if (selectedTextbooks.value.length === 0) return;
  batchDeleteConfirmMessage.value = `确定要删除选中的 ${selectedTextbooks.value.length} 个教材吗？被培养方案引用的教材将无法删除。`;
  batchDeleteConfirmVisible.value = true;
}

async function confirmBatchDelete() {
  batchDeleteConfirmVisible.value = false;
  batchDeleting.value = true;
  try {
    await doBatchDelete();
  } finally {
    batchDeleting.value = false;
  }
}

async function doBatchDelete() {
  const ids = selectedTextbooks.value.map((t) => t.id);
  const titles = selectedTextbooks.value.map((t) => t.title);

  const results = await Promise.allSettled(ids.map((id) => deleteTextbook(id, { silent: true })));

  const succeeded = [];
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      succeeded.push(titles[i]);
    } else {
      // axios 错误：后端真实 message 在 error.response.data.message；
      // error.message 只是 "Request failed with status code 400" 这样的默认消息
      const reason = r.reason?.response?.data?.message || r.reason?.message || '未知错误';
      failed.push({ title: titles[i], reason });
    }
  });

  if (failed.length === 0) {
    ElMessage.success(`已成功删除 ${succeeded.length} 个教材`);
  } else if (succeeded.length === 0) {
    // 全部失败
    const refCount = failed.filter((f) => f.reason.includes('培养方案')).length;
    if (refCount === failed.length) {
      // 全部因被培养方案引用
      ElMessage.warning(`${refCount} 个教材已被培养方案引用，无法删除`);
    } else {
      // 其他原因导致的全失败，给出具体原因
      ElMessage.error(`删除失败：${failed[0].reason}`);
    }
  } else {
    // 部分成功部分失败
    const refCount = failed.filter((f) => f.reason.includes('培养方案')).length;
    const otherCount = failed.length - refCount;
    let msg = `成功删除 ${succeeded.length} 个`;
    if (refCount > 0) msg += `，${refCount} 个被培养方案引用无法删除`;
    if (otherCount > 0) msg += `，${otherCount} 个删除失败`;
    ElMessage({ message: msg, type: 'warning', duration: 8000, showClose: true });
  }

  selectedTextbooks.value = [];
  await silentReload();
}

onMounted(() => {
  load();
});
</script>

<style scoped></style>
