<template>
  <div class="textbook-list">
    <PageHeader
      title="教材管理"
      subtitle="基础数据"
      description="管理教材信息，包括书名、出版社和ISBN"
    >
      <template #extra>
        <el-button type="primary" @click="openDialog()">
          <el-icon><Plus /></el-icon> 新增教材
        </el-button>
      </template>
    </PageHeader>
    <el-card>
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
      <ListErrorState v-if="error" :message="error" @retry="load" />
      <el-table
        v-else
        v-loading="loading"
        :data="list"
        stripe
        row-key="id"
        @selection-change="handleSelectionChange"
      >
        <template #empty>
          <EmptyState type="textbook" description="暂无教材数据" />
        </template>
        <el-table-column type="selection" width="45" />
        <el-table-column label="序号" width="60">
          <template #default="{ row }">{{
            (currentPage - 1) * pageSize + globalIndex(row) + 1
          }}</template>
        </el-table-column>
        <el-table-column prop="title" label="书名" min-width="150" show-overflow-tooltip />
        <el-table-column prop="isbn" label="书号" min-width="120" show-overflow-tooltip />
        <el-table-column prop="publisher" label="出版社" min-width="120" show-overflow-tooltip />
        <el-table-column prop="author" label="作者" min-width="80" show-overflow-tooltip />
        <el-table-column prop="edition" label="版次" min-width="55" show-overflow-tooltip />
        <el-table-column label="出版日期" min-width="85">
          <template #default="{ row }">{{ row.publishDate || '-' }}</template>
        </el-table-column>
        <el-table-column label="定价" min-width="65" show-overflow-tooltip>
          <template #default="{ row }">{{ row.price || '-' }}</template>
        </el-table-column>
        <el-table-column label="类别" min-width="80">
          <template #default="{ row }">
            <el-tag
              v-if="row.category"
              :type="row.category === '技工' ? 'primary' : 'info'"
              size="small"
              disable-transitions
            >
              {{ row.category }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="65">
          <template #default="{ row }">
            <el-tag :type="row.isActive ? 'success' : 'info'" size="small" disable-transitions>
              {{ row.isActive ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="排序" min-width="100" align="center">
          <template #default="{ row }">
            <div class="sort-buttons">
              <el-button
                size="small"
                :icon="ArrowUp"
                :disabled="globalIndex(row) === 0"
                circle
                title="上移"
                @click="handleMoveUp(row)"
              />
              <el-button
                size="small"
                :icon="ArrowDown"
                :disabled="globalIndex(row) === list.length - 1"
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

      <div class="pagination-container">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="load"
          @size-change="handleSizeChange"
        />
      </div>

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
      width="var(--dialog-width-lg)"
      destroy-on-close
    >
      <el-form label-width="100px">
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
      width="var(--dialog-width-lg)"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="书名" prop="title" required>
              <el-input v-model="form.title" maxlength="200" />
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
      width="var(--dialog-width)"
      align-center
    >
      <BaseConfirmBody icon-color="var(--brand-danger)">{{
        batchDeleteConfirmMessage
      }}</BaseConfirmBody>
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
      width="var(--dialog-width)"
      align-center
    >
      <BaseConfirmBody icon-color="var(--brand-danger)" :warning="deleteWarning">
        确定要删除此教材吗？此操作不可撤销。
      </BaseConfirmBody>
      <template #footer>
        <el-button @click="cancelDelete">取消</el-button>
        <el-button type="danger" :loading="deleting" @click="confirmDelete">确定删除</el-button>
      </template>
    </el-dialog>

    <!-- 导入确认弹窗 -->
    <el-dialog
      v-model="importConfirmVisible"
      title="导入确认"
      width="var(--dialog-width)"
      align-center
    >
      <BaseConfirmBody>{{ confirmMessage }}</BaseConfirmBody>
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
import { ElMessage, ElNotification } from 'element-plus';
// 按需导入项目中 service 函数（ElNotification）的 CSS 不会自动注入，需手动导入样式
// 否则通知 DOM 渲染但不可见（无背景/定位/动画）
import 'element-plus/es/components/notification/style/css';
import {
  getTextbooks,
  createTextbook,
  updateTextbook,
  deleteTextbook,
  toggleTextbookStatus,
  batchUpdateTextbooks,
  batchDeleteTextbooks,
} from '../../api/textbook';
import { useExport } from '../../composables/useExport';
import { useImport } from '../../composables/useImport';
import { useSortable } from '../../composables/useSortable';
import { useResponsive } from '../../composables/useResponsive';
import { useDebounceFn } from '../../composables/useDebounce';
import EmptyState from '../../components/EmptyState.vue';
import PageHeader from '../../components/PageHeader.vue';
import BaseConfirmBody from '../../components/BaseConfirmBody.vue';
import ListErrorState from '../../components/ListErrorState.vue';

defineOptions({ name: 'TextbookList' });

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
// P0 修复：列表加载错误状态，供 ListErrorState 占位（替代静默失败→误显空状态）
const error = ref(null);
const dialogVisible = ref(false);
const saving = ref(false);
const filterTitle = ref('');
const debouncedFilterTitle = ref('');
const filterCategory = ref('');
const filterPublisher = ref('');

// 防抖：文本输入200ms后再触发筛选，减少每次按键的computed重算
const updateDebouncedFilter = useDebounceFn((val) => {
  debouncedFilterTitle.value = val;
}, 200);
watch(filterTitle, (val) => {
  updateDebouncedFilter(val);
});

// 表单引用与校验规则
const formRef = ref(null);
const rules = {
  title: [
    { required: true, message: '请输入教材名称', trigger: 'blur' },
    { min: 2, max: 200, message: '书名长度应在 2-200 个字符之间', trigger: 'blur' },
  ],
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

// 出版社筛选项（由后端聚合返回，不随分页/筛选变化）
const publishers = ref([]);

// 服务端已按筛选条件过滤并分页，前端仅持有当前页数据
const total = ref(0);

// 列表分页控件
const currentPage = ref(1);
const pageSize = ref(20);

// 拖拽排序作用于当前页（连续的 sort_order 切片，相邻交换即全局正确）；跨页排序不在本页能力范围内
const { handleMoveUp, handleMoveDown } = useSortable(list, updateTextbook, silentReload, {
  indexFinder: (item) => list.value.findIndex((i) => i.id === item.id),
});

// 行在当前页内的下标，用于序号与排序禁用判断
function globalIndex(row) {
  return list.value.findIndex((i) => i.id === row.id);
}

// 筛选条件变化后回到第一页并重新拉取（防抖，避免逐字符触发请求）
const reload = useDebounceFn(() => {
  currentPage.value = 1;
  load();
}, 300);
watch([debouncedFilterTitle, filterCategory, filterPublisher], () => reload());

// 每页大小变化：回到第一页重新拉取
function handleSizeChange() {
  currentPage.value = 1;
  load();
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const params = {
      page: currentPage.value,
      page_size: pageSize.value,
      title: debouncedFilterTitle.value || undefined,
      category: filterCategory.value || undefined,
      publisher: filterPublisher.value || undefined,
    };
    const res = await getTextbooks(params);
    list.value = res.data?.items || [];
    total.value = res.data?.total || 0;
    publishers.value = res.data?.publishers || [];
  } catch (e) {
    error.value = e?.response?.data?.message || '教材数据加载失败，请稍后重试';
    if (import.meta.env.DEV) console.error('加载失败:', e);
  } finally {
    loading.value = false;
  }
}

async function silentReload() {
  try {
    const params = {
      page: currentPage.value,
      page_size: pageSize.value,
      title: debouncedFilterTitle.value || undefined,
      category: filterCategory.value || undefined,
      publisher: filterPublisher.value || undefined,
    };
    const res = await getTextbooks(params);
    list.value = res.data?.items || [];
    total.value = res.data?.total || 0;
    publishers.value = res.data?.publishers || [];
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
  const targetName = pendingDeleteRow.value?.title || '该教材';
  try {
    // silent:true 抑制拦截器 ElMessage，由本函数统一用 ElNotification 展示原因与结果
    await deleteTextbook(pendingDeleteId, { silent: true });
    ElNotification({
      title: '删除成功',
      message: `已删除教材：${targetName}`,
      type: 'success',
      duration: 4000,
    });
    await silentReload();
    deleteConfirmVisible.value = false;
  } catch (err) {
    const reason = err?.response?.data?.message || err?.message || '未知错误';
    ElNotification({
      title: '删除失败',
      message: `${targetName}：${reason}`,
      type: 'error',
      duration: 6000,
    });
    deleteConfirmVisible.value = false;
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
    const updates = {};

    switch (type) {
      case 'publisher':
        updates.publisher = batchForm.value.publisher;
        break;
      case 'author':
        updates.author = batchForm.value.author;
        break;
      case 'category':
        updates.category = batchForm.value.category;
        break;
    }

    const { data } = await batchUpdateTextbooks(ids, updates);
    const { succeeded = [], failed = [] } = data || {};

    if (failed.length === 0) {
      ElMessage.success(`已成功更新 ${succeeded.length} 个教材`);
    } else if (succeeded.length === 0) {
      ElMessage.error(`批量更新失败：${failed[0]?.reason || '未知错误'}`);
    } else {
      ElMessage.warning(`批量更新部分成功：成功 ${succeeded.length} 个，失败 ${failed.length} 个`);
    }

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

  try {
    const { data } = await batchDeleteTextbooks(ids);
    const { succeeded = [], failed = [] } = data || {};

    if (failed.length === 0) {
      ElNotification({
        title: '批量删除完成',
        message: `已成功删除 ${succeeded.length} 个教材`,
        type: 'success',
        duration: 4000,
      });
    } else if (succeeded.length === 0) {
      const refCount = failed.filter((f) => f.reason?.includes('培养方案')).length;
      if (refCount === failed.length) {
        ElNotification({
          title: '批量删除失败',
          message: `${refCount} 个教材已被培养方案引用，无法删除`,
          type: 'warning',
          duration: 6000,
        });
      } else {
        ElNotification({
          title: '批量删除失败',
          message: `删除失败：${failed[0]?.reason || '未知错误'}`,
          type: 'error',
          duration: 6000,
        });
      }
    } else {
      const refCount = failed.filter((f) => f.reason?.includes('培养方案')).length;
      const otherCount = failed.length - refCount;
      let msg = `成功删除 ${succeeded.length} 个`;
      if (refCount > 0) msg += `，${refCount} 个被培养方案引用无法删除`;
      if (otherCount > 0) msg += `，${otherCount} 个删除失败`;
      ElNotification({
        title: '批量删除部分成功',
        message: msg,
        type: 'warning',
        duration: 6000,
      });
    }
  } catch (e) {
    if (import.meta.env.DEV) console.error('[BatchDelete] 批量删除请求失败:', e);
    const reason = e?.response?.data?.message || e?.message || '未知错误';
    ElNotification({
      title: '批量删除失败',
      message: reason,
      type: 'error',
      duration: 6000,
    });
  }

  selectedTextbooks.value = [];
  await silentReload();
}

onMounted(() => {
  load();
});
</script>

<style scoped></style>
