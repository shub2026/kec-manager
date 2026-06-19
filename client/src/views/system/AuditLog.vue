<template>
  <div class="audit-log">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>操作日志</span>
          <el-button type="danger" size="small" @click="showClearDialog" :loading="clearing">
            <el-icon><Delete /></el-icon> 清空日志
          </el-button>
        </div>
      </template>

      <div class="query-toolbar">
        <el-select v-model="filterAction" clearable placeholder="选择操作类型" @change="loadLogs" style="width: 150px">
          <el-option label="登录" value="login" />
          <el-option label="登出" value="logout" />
          <el-option label="导入" value="import" />
          <el-option label="导出" value="export" />
          <el-option label="创建" value="create" />
          <el-option label="更新" value="update" />
          <el-option label="删除" value="delete" />
        </el-select>
        <el-select v-model="filterModule" clearable placeholder="选择模块" @change="loadLogs" style="width: 150px">
          <el-option label="认证" value="auth" />
          <el-option label="用户" value="user" />
          <el-option label="班级" value="class" />
          <el-option label="课程" value="course" />
          <el-option label="教材" value="textbook" />
          <el-option label="专业" value="major" />
          <el-option label="学院" value="college" />
          <el-option label="培养方案" value="trainingPlan" />
          <el-option label="培养层次" value="training_level" />
          <el-option label="系统" value="system" />
        </el-select>
        <el-select v-model="filterResult" clearable placeholder="选择结果" @change="loadLogs" style="width: 120px">
          <el-option label="成功" value="success" />
          <el-option label="失败" value="failed" />
        </el-select>
        <el-button @click="resetFilters">
          <el-icon><Refresh /></el-icon> 重置
        </el-button>
      </div>

      <el-table :data="logs" stripe v-loading="loading">
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-tag :type="getActionTagType(row.action)" size="small">
              {{ getActionLabel(row.action) }}
            </el-tag>
            <el-tag :type="row.result === 'success' ? 'success' : 'danger'" size="small" style="margin-left: 4px">
              {{ row.result === 'success' ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="module" label="模块" width="100">
          <template #default="{ row }">
            <el-tag type="info" size="small">{{ getModuleLabel(row.module) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="消息" min-width="300" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.message }}</span>
            <el-button v-if="row.details" link type="primary" size="small" style="margin-left: 8px" @click="showDetails(row.details)">
              详情
            </el-button>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="时间" width="170">
          <template #default="{ row }">
            {{ formatDateTime(row.createdAt) }}
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="loadLogs"
          @current-change="loadLogs"
        />
      </div>
    </el-card>

    <!-- 详情对话框 -->
    <el-dialog v-model="detailsVisible" title="操作详情" width="600px">
      <pre class="details-content">{{ formatDetails(detailsContent) }}</pre>
      <template #footer>
        <el-button type="primary" @click="detailsVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 清空日志确认对话框 -->
    <el-dialog v-model="clearDialogVisible" title="清空操作日志" width="500px" :close-on-click-modal="false">
      <el-alert
        title="此操作不可恢复！"
        type="error"
        :closable="false"
        show-icon
      />
      <p class="confirm-text">确定要清空所有操作日志吗？此操作将永久删除所有日志记录。</p>
      <template #footer>
        <el-button @click="clearDialogVisible = false">取消</el-button>
        <el-button type="danger" @click="handleClearLogs" :loading="clearing">
          确认清空
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getAuditLogs } from '../../api/audit'
import request from '../../utils/request'

const logs = ref([])
const loading = ref(false)
const filterAction = ref(null)
const filterModule = ref(null)
const filterResult = ref(null)
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)
const detailsVisible = ref(false)
const detailsContent = ref(null)
const clearDialogVisible = ref(false)
const clearing = ref(false)

const actionLabels = {
  login: '登录',
  logout: '登出',
  import: '导入',
  export: '导出',
  create: '创建',
  update: '更新',
  delete: '删除',
}

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
  system: '系统',
}

const actionTagTypes = {
  login: 'primary',
  logout: 'info',
  import: 'success',
  export: 'warning',
  create: 'primary',
  update: 'info',
  delete: 'danger',
}

function getActionLabel(action) {
  return actionLabels[action] || action
}

function getModuleLabel(module) {
  return moduleLabels[module] || module
}

function getActionTagType(action) {
  return actionTagTypes[action] || 'info'
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function showDetails(details) {
  detailsContent.value = details
  detailsVisible.value = true
}

function formatDetails(details) {
  try {
    const obj = typeof details === 'string' ? JSON.parse(details) : details
    return JSON.stringify(obj, null, 2)
  } catch (e) {
    return details
  }
}

function resetFilters() {
  filterAction.value = null
  filterModule.value = null
  filterResult.value = null
  currentPage.value = 1
  loadLogs()
}

function showClearDialog() {
  clearDialogVisible.value = true
}

async function handleClearLogs() {
  clearing.value = true
  try {
    await request.post('/settings/reset/audit-logs')
    ElMessage.success('操作日志已清空')
    clearDialogVisible.value = false
    loadLogs()
  } catch (e) {
    ElMessage.error('清空操作日志失败：' + (e.message || '未知错误'))
  } finally {
    clearing.value = false
  }
}

async function loadLogs() {
  loading.value = true
  try {
    const params = {
      page: currentPage.value,
      pageSize: pageSize.value,
    }
    if (filterAction.value) params.action = filterAction.value
    if (filterModule.value) params.module = filterModule.value
    if (filterResult.value) params.result = filterResult.value

    const res = await getAuditLogs(params)
    // FC3修复：移除调试输出
    logs.value = res.data.logs
    total.value = res.data.total
  } catch (e) {
    ElMessage.error('加载操作日志失败')
    if (import.meta.env.DEV) { console.error('加载操作日志失败:', e) }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadLogs()
})
</script>

<style scoped>
.audit-log {
  padding: 20px;
}

.query-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.details-content {
  background-color: var(--el-fill-color-light);
  padding: 16px;
  border-radius: 4px;
  max-height: 400px;
  overflow: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.6;
}

.confirm-text {
  margin: 16px 0 0;
  color: #606266;
  font-size: 14px;
  line-height: 1.6;
}
</style>
