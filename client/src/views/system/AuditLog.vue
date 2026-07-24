<template>
  <div class="audit-log">
    <PageHeader title="操作日志" subtitle="系统管理" description="查看系统操作记录和变更历史">
      <template #extra>
        <el-button type="danger" size="small" :loading="clearing" @click="showClearDialog">
          <el-icon><Delete /></el-icon> 清空日志
        </el-button>
      </template>
    </PageHeader>
    <el-card>
      <div class="page-toolbar">
        <el-select
          v-model="filterAction"
          clearable
          placeholder="操作类型"
          class="filter-lg"
          @change="loadLogs"
        >
          <el-option label="登录" value="login" />
          <el-option label="登出" value="logout" />
          <el-option label="导入" value="import" />
          <el-option label="导出" value="export" />
          <el-option label="创建" value="create" />
          <el-option label="更新" value="update" />
          <el-option label="删除" value="delete" />
        </el-select>
        <el-select
          v-model="filterModule"
          clearable
          placeholder="所属模块"
          class="filter-lg"
          @change="loadLogs"
        >
          <el-option label="认证" value="auth" />
          <el-option label="用户" value="user" />
          <el-option label="班级" value="class" />
          <el-option label="课程" value="course" />
          <el-option label="教材" value="textbook" />
          <el-option label="专业" value="major" />
          <el-option label="学院" value="college" />
          <el-option label="培养方案" value="trainingPlan" />
          <el-option label="培养层次" value="training_level" />
          <el-option label="教师" value="teacher" />
          <el-option label="教学安排" value="teachingArrange" />
          <el-option label="系统" value="system" />
        </el-select>
        <el-select
          v-model="filterResult"
          clearable
          placeholder="执行结果"
          class="filter-md"
          @change="loadLogs"
        >
          <el-option label="成功" value="success" />
          <el-option label="失败" value="failed" />
        </el-select>
        <el-button @click="resetFilters">
          <el-icon><Refresh /></el-icon> 重置
        </el-button>
      </div>

      <el-table
        v-loading="loading"
        :data="logs"
        stripe
        row-key="id"
        :default-sort="{ prop: 'createdAt', order: 'descending' }"
      >
        <template #empty>
          <EmptyState type="generic" description="暂无数据" />
        </template>
        <el-table-column label="时间" min-width="165" prop="createdAt" sortable>
          <template #default="{ row }">
            <span class="time-text">{{ formatDateTime(row.createdAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作类型" min-width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="getActionTagType(row.action)" size="small">
              {{ getActionLabel(row.action) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="结果" min-width="70" align="center">
          <template #default="{ row }">
            <el-tag
              :type="row.result === 'success' ? 'success' : 'danger'"
              size="small"
              effect="light"
            >
              {{ row.result === 'success' ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="模块" min-width="140" align="center">
          <template #default="{ row }">
            <el-tag type="info" size="small" effect="plain">{{
              getModuleLabel(row.module)
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="消息" min-width="280">
          <template #default="{ row }">
            <div class="message-cell">
              <span>{{ row.message }}</span>
              <el-button
                v-if="row.details"
                link
                type="primary"
                size="small"
                class="details-btn"
                @click="showDetails(row.details)"
              >
                详情
              </el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="IP 地址" min-width="130">
          <template #default="{ row }">
            <span class="ip-text">{{ row.ip || '-' }}</span>
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
          @size-change="loadLogs"
          @current-change="loadLogs"
        />
      </div>
    </el-card>

    <!-- 详情对话框 -->
    <el-dialog v-model="detailsVisible" title="操作详情" width="var(--dialog-width-lg)">
      <div class="details-toggle" style="text-align: right; margin-bottom: 8px">
        <el-button link type="primary" size="small" @click="showRawJson = !showRawJson">
          {{ showRawJson ? '查看表格' : '查看原始数据' }}
        </el-button>
      </div>
      <!-- 表格视图 -->
      <div v-if="!showRawJson" class="details-table-wrap">
        <el-table :data="parsedDetails" stripe size="small" border row-key="label">
          <el-table-column label="字段" prop="label" min-width="140" />
          <el-table-column label="值" prop="value" min-width="200">
            <template #default="{ row }">
              <span v-if="row.isObject" class="nested-value">{{ row.value }}</span>
              <span v-else>{{ row.value }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <!-- 原始 JSON 视图 -->
      <pre v-else class="details-content">{{ formatDetails(detailsContent) }}</pre>
      <template #footer>
        <el-button type="primary" @click="detailsVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 清空日志确认对话框 -->
    <el-dialog
      v-model="clearDialogVisible"
      title="清空操作日志"
      width="var(--dialog-width-lg)"
      :close-on-click-modal="false"
    >
      <el-alert title="此操作不可恢复！" type="error" :closable="false" show-icon />
      <p class="confirm-text">确定要清空所有操作日志吗？此操作将永久删除所有日志记录。</p>
      <template #footer>
        <el-button @click="clearDialogVisible = false">取消</el-button>
        <el-button type="danger" :loading="clearing" @click="handleClearLogs"> 确认清空 </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { getAuditLogs } from '../../api/audit';
import { resetAuditLogs } from '../../api/settings';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';

defineOptions({ name: 'AuditLog' });

const logs = ref([]);
const loading = ref(false);
const filterAction = ref(null);
const filterModule = ref(null);
const filterResult = ref(null);
const currentPage = ref(1);
const pageSize = ref(20);
const total = ref(0);
const detailsVisible = ref(false);
const detailsContent = ref(null);
const clearDialogVisible = ref(false);
const clearing = ref(false);
const showRawJson = ref(false);

const fieldLabels = {
  id: 'ID',
  name: '名称',
  username: '用户名',
  enrollment_year: '入学年份',
  student_count: '学生人数',
  duration_years: '学制',
  college_id: '学院 ID',
  major_id: '专业 ID',
  training_level_id: '培养层次 ID',
  is_left_school: '已离校',
  is_active: '启用状态',
  type: '类型',
  action: '操作',
  module: '模块',
  result: '结果',
  message: '消息',
  total: '总数',
  imported: '已导入',
  failed: '失败数',
  overwritten: '覆盖数',
  changes: '变更内容',
  autoCreated: '自动创建',
  trainingLevels: '培养层次',
  colleges: '学院',
  ip: 'IP 地址',
  operator_id: '操作人 ID',
  created_at: '创建时间',
  updated_at: '更新时间',
};

const parsedDetails = computed(() => {
  if (!detailsContent.value) return [];
  let obj;
  try {
    obj =
      typeof detailsContent.value === 'string'
        ? JSON.parse(detailsContent.value)
        : detailsContent.value;
  } catch {
    return [{ label: '内容', value: String(detailsContent.value), isObject: false }];
  }
  if (typeof obj !== 'object' || obj === null) {
    return [{ label: '内容', value: String(obj), isObject: false }];
  }
  return Object.entries(obj).map(([key, val]) => {
    const label = fieldLabels[key] || key;
    if (val !== null && typeof val === 'object') {
      return { label, value: JSON.stringify(val, null, 2), isObject: true };
    }
    return { label, value: val === null ? '-' : String(val), isObject: false };
  });
});

const actionLabels = {
  login: '登录',
  logout: '登出',
  import: '导入',
  export: '导出',
  create: '创建',
  update: '更新',
  delete: '删除',
};

const moduleLabels = {
  auth: '认证',
  user: '用户',
  class: '班级',
  course: '课程',
  textbook: '教材',
  major: '专业',
  college: '学院',
  trainingPlan: '培养方案',
  training_level: '培养层次',
  teacher: '教师',
  teachingArrange: '教学安排',
  system: '系统',
};

const actionTagTypes = {
  login: 'primary',
  logout: 'info',
  import: 'success',
  export: 'warning',
  create: 'primary',
  update: 'info',
  delete: 'danger',
};

function getActionLabel(action) {
  return actionLabels[action] || action;
}

function getModuleLabel(module) {
  return moduleLabels[module] || module;
}

function getActionTagType(action) {
  return actionTagTypes[action] || 'info';
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function showDetails(details) {
  detailsContent.value = details;
  showRawJson.value = false;
  detailsVisible.value = true;
}

function formatDetails(details) {
  try {
    const obj = typeof details === 'string' ? JSON.parse(details) : details;
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return details;
  }
}

function resetFilters() {
  filterAction.value = null;
  filterModule.value = null;
  filterResult.value = null;
  currentPage.value = 1;
  loadLogs();
}

function showClearDialog() {
  clearDialogVisible.value = true;
}

async function handleClearLogs() {
  clearing.value = true;
  try {
    // 后端 validateAuditLogReset 中间件要求 body.confirm === 'DELETE'，否则 400
    await resetAuditLogs({ confirm: 'DELETE' });
    ElMessage.success('操作日志已清空');
    loadLogs();
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('清空操作日志失败:', e);
    }
  } finally {
    clearDialogVisible.value = false;
    clearing.value = false;
  }
}

async function loadLogs() {
  loading.value = true;
  try {
    const params = {
      page: currentPage.value,
      pageSize: pageSize.value,
    };
    if (filterAction.value) params.action = filterAction.value;
    if (filterModule.value) params.module = filterModule.value;
    if (filterResult.value) params.result = filterResult.value;

    const res = await getAuditLogs(params);
    // FC3修复：移除调试输出
    logs.value = res.data.logs;
    total.value = res.data.total;
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('加载操作日志失败:', e);
    }
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadLogs();
});
</script>

<style scoped>
.time-text {
  color: var(--text-regular);
  font-size: 13px;
}

.ip-text {
  color: var(--text-secondary);
  font-size: 13px;
  font-family: monospace;
}

.details-content {
  background-color: var(--el-fill-color-light);
  padding: var(--space-4);
  border-radius: var(--radius-sm);
  max-height: 400px;
  overflow: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.6;
}

.details-table-wrap {
  max-height: 420px;
  overflow: auto;
}

.nested-value {
  white-space: pre-wrap;
  word-break: break-all;
  font-family: monospace;
  font-size: 12px;
  color: var(--text-regular);
}

.confirm-text {
  margin: var(--space-4) 0 0;
  color: var(--text-regular);
  font-size: 14px;
  line-height: 1.6;
}

.details-btn {
  margin-left: 6px;
}
</style>
