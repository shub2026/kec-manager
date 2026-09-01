<template>
  <div class="document-list">
    <PageHeader
      title="文档资料"
      subtitle="系统管理"
      description="管理常用文档资料，支持 Word、Excel、PDF、图片的上传与下载"
    >
      <template #extra>
        <el-upload
          :show-file-list="false"
          multiple
          accept=".doc,.docx,.xls,.xlsx,.pdf,.jpg,.jpeg"
          action="/api/documents/upload"
          name="file"
          :headers="uploadHeaders"
          :before-upload="beforeUpload"
          :on-success="handleUploadSuccess"
          :on-error="handleUploadError"
        >
          <el-button type="primary">
            <el-icon><Upload /></el-icon>
            上传文档
          </el-button>
        </el-upload>
      </template>
    </PageHeader>

    <el-card>
      <div class="page-toolbar">
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索文件名"
          class="filter-2xl"
          :prefix-icon="Search"
        />
        <el-select
          v-model="fileType"
          placeholder="全部类型"
          clearable
          class="filter-type"
          @change="handleFilterChange"
        >
          <el-option label="Word" value="word" />
          <el-option label="Excel" value="excel" />
          <el-option label="PDF" value="pdf" />
          <el-option label="图片" value="image" />
        </el-select>
      </div>

      <!-- 文档列表 -->
      <ListErrorState v-if="error" :message="error" @retry="loadDocuments" />
      <!-- 外层横向滚动容器兼容窄屏；移动端隐藏次要列，保留核心信息 -->
      <div v-else class="table-scroll-wrap">
        <el-table v-loading="loading" :data="documents" stripe row-key="id">
          <template #empty>
            <EmptyState type="generic" description="暂无文档资料" />
          </template>
          <!-- 列宽策略：短内容列固定宽度，文件名为唯一弹性列吸收剩余宽度 -->
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column prop="originalName" label="文件名" min-width="260" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="doc-name">{{ row.originalName }}</span>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="80" align="center">
            <template #default="{ row }">
              <el-tag
                :type="extInfo(row.fileExt).tagType"
                size="small"
                effect="plain"
                disable-transitions
              >
                {{ extInfo(row.fileExt).label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="大小" width="100" align="center">
            <template #default="{ row }">{{ formatBytes(row.fileSize) }}</template>
          </el-table-column>
          <el-table-column
            v-if="!isMobile"
            prop="uploaderName"
            label="上传人"
            width="120"
            show-overflow-tooltip
          />
          <el-table-column v-if="!isMobile" label="上传时间" width="170">
            <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" :width="isMobile ? 150 : 230" align="center">
            <template #default="{ row }">
              <el-button
                size="small"
                type="primary"
                plain
                :loading="downloadingId === row.id"
                aria-label="下载文档"
                @click="handleDownload(row)"
              >
                下载
              </el-button>
              <el-button
                v-if="!isMobile"
                size="small"
                aria-label="重命名文档"
                @click="showRenameDialog(row)"
              >
                重命名
              </el-button>
              <el-button
                size="small"
                type="danger"
                aria-label="删除文档"
                @click="showDeleteConfirm(row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 分页 -->
      <div class="pagination-container">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[20, 50, 100]"
          :total="total"
          layout="total, sizes, prev, pager, next"
          background
          @size-change="loadDocuments"
          @current-change="loadDocuments"
        />
      </div>
    </el-card>

    <!-- 重命名对话框 -->
    <el-dialog
      v-model="renameDialogVisible"
      title="重命名文档"
      width="var(--dialog-width)"
      align-center
      :close-on-click-modal="false"
    >
      <el-input
        v-model="renameInput"
        placeholder="请输入新文件名（扩展名自动保留）"
        maxlength="200"
        show-word-limit
        @keyup.enter="confirmRename"
      >
        <!-- 扩展名以只读后缀展示，防止误改 -->
        <template #append>.{{ pendingRenameDoc?.fileExt }}</template>
      </el-input>
      <template #footer>
        <el-button @click="renameDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="renaming" @click="confirmRename">确定</el-button>
      </template>
    </el-dialog>

    <!-- 删除确认弹窗 -->
    <DeleteConfirmDialog
      v-model="deleteConfirmVisible"
      :loading="deleting"
      @confirm="confirmDelete"
    >
      确定要删除文档"{{ pendingDeleteDoc?.originalName }}"吗？此操作不可撤销。
    </DeleteConfirmDialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { Search, Upload } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { getCookie } from '@/utils/cookies';
import { useResponsive } from '../../composables/useResponsive';
import { getDocuments, downloadDocument, renameDocument, deleteDocument } from '../../api/document';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';
import DeleteConfirmDialog from '../../components/DeleteConfirmDialog.vue';
import ListErrorState from '../../components/ListErrorState.vue';

defineOptions({ name: 'DocumentList' });

/* 响应式断点：复用全局共享实例，移动端隐藏次要列避免表格被极限压缩 */
const { isMobile } = useResponsive();

const authStore = useAuthStore();
// el-upload 不走 axios 拦截器，须手动附加认证与 CSRF 请求头
const uploadHeaders = computed(() => {
  const headers = {};
  if (authStore.token) headers.Authorization = `Bearer ${authStore.token}`;
  const csrfToken = getCookie('XSRF-TOKEN');
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  return headers;
});

const documents = ref([]);
const loading = ref(false);
const error = ref(null);

// 分页
const currentPage = ref(1);
const pageSize = ref(20);
const total = ref(0);

// 搜索与筛选
const keyword = ref('');
const fileType = ref('');

// 搜索词变化：防抖 300ms 后回第 1 页重新拉取
let keywordTimer = null;
watch(keyword, () => {
  clearTimeout(keywordTimer);
  keywordTimer = setTimeout(() => {
    currentPage.value = 1;
    loadDocuments();
  }, 300);
});

function handleFilterChange() {
  currentPage.value = 1;
  loadDocuments();
}

async function loadDocuments() {
  loading.value = true;
  error.value = null;
  try {
    const response = await getDocuments({
      page: currentPage.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      fileType: fileType.value || undefined,
    });
    const data = response.data;
    documents.value = data.items || [];
    total.value = data.total || 0;
  } catch (err) {
    error.value = err?.response?.data?.message || '文档列表加载失败，请稍后重试';
    if (import.meta.env.DEV) console.error('加载文档列表失败:', err);
  } finally {
    loading.value = false;
  }
}

// ── 上传 ──────────────────────────────

// 客户端大小上限提示与后端 DOCUMENT_MAX_SIZE 默认值一致，实际以后端校验为准
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTS = ['doc', 'docx', 'xls', 'xlsx', 'pdf', 'jpg', 'jpeg'];

function beforeUpload(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_EXTS.includes(ext)) {
    ElMessage.error(`不支持的文件格式：${file.name}（仅支持 Word/Excel/PDF/JPG）`);
    return false;
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    ElMessage.error(`文件过大：${file.name}（单文件上限 50MB）`);
    return false;
  }
  return true;
}

function handleUploadSuccess(response) {
  if (response?.success) {
    ElMessage.success(response.message || '上传成功');
    loadDocuments();
  } else {
    ElMessage.error(response?.message || '上传失败');
  }
}

function handleUploadError(err) {
  // el-upload 的 on-error 传入 Error，message 为服务端响应体文本
  let message = '上传失败，请稍后重试';
  try {
    const parsed = JSON.parse(err.message);
    if (parsed?.message) message = parsed.message;
  } catch {
    /* 非 JSON 响应保持默认提示 */
  }
  ElMessage.error(message);
}

// ── 下载 ──────────────────────────────

const downloadingId = ref(null);

async function handleDownload(row) {
  downloadingId.value = row.id;
  try {
    const response = await downloadDocument(row.id);
    const blob = new Blob([response], { type: row.mimeType || 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = row.originalName;
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }
    ElMessage.success('下载成功');
  } catch (err) {
    ElMessage.error(err?.response?.data?.message || '下载失败');
  } finally {
    downloadingId.value = null;
  }
}

// ── 重命名 ──────────────────────────────

const renameDialogVisible = ref(false);
const renameInput = ref('');
const renaming = ref(false);
const pendingRenameDoc = ref(null);

/** 去除扩展名返回基础名（重命名输入框不展示扩展名，防止误改） */
function baseNameOf(row) {
  const suffix = `.${row.fileExt}`;
  const name = row.originalName || '';
  return name.toLowerCase().endsWith(suffix.toLowerCase()) ? name.slice(0, -suffix.length) : name;
}

function showRenameDialog(row) {
  pendingRenameDoc.value = row;
  renameInput.value = baseNameOf(row);
  renameDialogVisible.value = true;
}

async function confirmRename() {
  const ext = pendingRenameDoc.value.fileExt;
  const suffix = `.${ext}`;
  let base = renameInput.value.trim();
  // 容错：用户若手动输入了原扩展名则剥离，避免重复拼接
  if (base.toLowerCase().endsWith(suffix.toLowerCase())) {
    base = base.slice(0, -suffix.length).trim();
  }
  if (!base) {
    ElMessage.warning('文件名不能为空');
    return;
  }
  if (base === baseNameOf(pendingRenameDoc.value)) {
    renameDialogVisible.value = false;
    return;
  }
  renaming.value = true;
  try {
    await renameDocument(pendingRenameDoc.value.id, { originalName: `${base}${suffix}` });
    ElMessage.success('重命名成功');
    renameDialogVisible.value = false;
    loadDocuments();
  } catch (err) {
    ElMessage.error(err?.response?.data?.message || '重命名失败');
  } finally {
    renaming.value = false;
  }
}

// ── 删除 ──────────────────────────────

const deleteConfirmVisible = ref(false);
const deleting = ref(false);
const pendingDeleteDoc = ref(null);

function showDeleteConfirm(row) {
  pendingDeleteDoc.value = row;
  deleteConfirmVisible.value = true;
}

async function confirmDelete() {
  deleting.value = true;
  try {
    await deleteDocument(pendingDeleteDoc.value.id);
    ElMessage.success('删除成功');
    deleteConfirmVisible.value = false;
    // 删除后当前页可能为空，回退一页
    if (documents.value.length === 1 && currentPage.value > 1) {
      currentPage.value -= 1;
    }
    loadDocuments();
  } catch (err) {
    ElMessage.error(err?.response?.data?.message || '删除失败');
  } finally {
    deleting.value = false;
  }
}

// ── 展示辅助 ──────────────────────────────

/** 扩展名 → 类型标签（与后端 FILE_TYPE_GROUPS 对应） */
function extInfo(ext) {
  const map = {
    doc: { label: 'Word', tagType: '' },
    docx: { label: 'Word', tagType: '' },
    xls: { label: 'Excel', tagType: 'success' },
    xlsx: { label: 'Excel', tagType: 'success' },
    pdf: { label: 'PDF', tagType: 'danger' },
    jpg: { label: '图片', tagType: 'warning' },
    jpeg: { label: '图片', tagType: 'warning' },
  };
  return map[ext] || { label: ext || '未知', tagType: 'info' };
}

function formatBytes(size) {
  if (typeof size !== 'number' || size < 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(date) {
  return new Date(date).toLocaleString('zh-CN');
}

onMounted(() => {
  loadDocuments();
});
</script>

<style scoped>
.page-toolbar {
  display: flex;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
  flex-wrap: wrap;
}

.filter-type {
  width: 140px;
}

.table-scroll-wrap {
  overflow-x: auto;
}

.doc-name {
  font-weight: var(--fw-medium);
}

.pagination-container {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-4);
}
</style>
