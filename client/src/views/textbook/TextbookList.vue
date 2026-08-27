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
          <el-button @click="downloadTemplate"
            ><el-icon><Document /></el-icon> 下载模板</el-button
          >
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
            <el-button
              ><el-icon><Upload /></el-icon> 导入Excel</el-button
            >
          </el-upload>
          <el-button @click="exportData"
            ><el-icon><Download /></el-icon> 导出Excel</el-button
          >
        </div>
      </div>
      <ListErrorState v-if="error" :message="error" @retry="load" />
      <!-- 外层横向滚动容器兼容窄屏；移动端隐藏次要列，保留核心信息 -->
      <div v-else class="table-scroll-wrap">
        <el-table
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
          <el-table-column
            v-if="!isMobile"
            prop="isbn"
            label="书号"
            min-width="120"
            show-overflow-tooltip
          />
          <el-table-column
            v-if="!isMobile"
            prop="publisher"
            label="出版社"
            min-width="120"
            show-overflow-tooltip
          />
          <el-table-column
            v-if="!isMobile"
            prop="author"
            label="作者"
            min-width="80"
            show-overflow-tooltip
          />
          <el-table-column
            v-if="!isMobile"
            prop="edition"
            label="版次"
            min-width="55"
            show-overflow-tooltip
          />
          <el-table-column v-if="!isMobile" label="出版日期" min-width="85">
            <template #default="{ row }">{{ row.publishDate || '-' }}</template>
          </el-table-column>
          <el-table-column v-if="!isMobile" label="定价" min-width="65" show-overflow-tooltip>
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
          <el-table-column v-if="!isMobile" label="排序" min-width="100" align="center">
            <template #default="{ row }">
              <div class="sort-buttons">
                <el-button
                  size="small"
                  :icon="ArrowUp"
                  :disabled="globalIndex(row) === 0"
                  circle
                  title="上移"
                  aria-label="上移"
                  @click="handleMoveUp(row)"
                />
                <el-button
                  size="small"
                  :icon="ArrowDown"
                  :disabled="globalIndex(row) === list.length - 1"
                  circle
                  title="下移"
                  aria-label="下移"
                  @click="handleMoveDown(row)"
                />
              </div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" align="center">
            <template #default="{ row }">
              <el-button
                size="small"
                :type="row.isActive ? 'warning' : 'success'"
                @click="handleToggleStatus(row)"
              >
                {{ row.isActive ? '停用' : '启用' }}
              </el-button>
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
                :icon="Delete"
                circle
                type="danger"
                title="删除"
                aria-label="删除"
                @click="handleDelete(row)"
              />
            </template>
          </el-table-column>
        </el-table>
      </div>

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

      <!-- 批量操作栏组件（含批量设置/批量删除弹窗） -->
      <TextbookBatchBar :selected-textbooks="selectedTextbooks" @completed="onBatchCompleted" />
    </el-card>

    <!-- 新增/编辑弹窗组件 -->
    <TextbookFormDialog ref="formDialogRef" :saving="saving" @save="handleSave" />

    <!-- 删除确认弹窗 -->
    <DeleteConfirmDialog
      v-model="deleteConfirmVisible"
      :loading="deleting"
      :warning="deleteWarning"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    >
      确定要删除此教材吗？此操作不可撤销。
    </DeleteConfirmDialog>

    <!-- 导入确认弹窗：复用全局 BaseConfirmDialog，避免手写 el-dialog + footer -->
    <BaseConfirmDialog
      v-model="importConfirmVisible"
      title="导入确认"
      :message="confirmMessage"
      confirm-text="确定导入"
      :loading="importing"
      @confirm="confirmImport"
      @cancel="cancelImport"
    />
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
} from '../../api/textbook';
import { useExport } from '../../composables/useExport';
import { useImport } from '../../composables/useImport';
import { useSortable } from '../../composables/useSortable';
import { useDebounceFn } from '../../composables/useDebounce';
import { useResponsive } from '../../composables/useResponsive';
import EmptyState from '../../components/EmptyState.vue';
import PageHeader from '../../components/PageHeader.vue';
import BaseConfirmDialog from '../../components/BaseConfirmDialog.vue';
import DeleteConfirmDialog from '../../components/DeleteConfirmDialog.vue';
import ListErrorState from '../../components/ListErrorState.vue';
import TextbookFormDialog from './components/TextbookFormDialog.vue';
import TextbookBatchBar from './components/TextbookBatchBar.vue';

defineOptions({ name: 'TextbookList' });

/* 响应式断点：复用全局共享实例，移动端隐藏次要列避免表格被极限压缩 */
const { isMobile } = useResponsive();

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

// 表单弹窗组件引用
const formDialogRef = ref(null);

// 批量操作：表格选择状态
const selectedTextbooks = ref([]);

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
  formDialogRef.value?.open(row);
}

async function handleSave({ id, data }) {
  saving.value = true;
  try {
    if (id) {
      await updateTextbook(id, data);
    } else {
      await createTextbook(data);
    }
    ElMessage.success('保存成功');
    formDialogRef.value?.close();
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

// 选择变化处理
function handleSelectionChange(selection) {
  selectedTextbooks.value = selection;
}

// 批量操作完成：清空选择并静默刷新列表
async function onBatchCompleted() {
  selectedTextbooks.value = [];
  await silentReload();
}

onMounted(() => {
  load();
});
</script>

<style scoped></style>
