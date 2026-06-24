<template>
  <div>
    <el-card>
      <template #header>
        <div class="card-header">
          <span
            ><el-icon><Notebook /></el-icon> 教材查询</span
          >
          <div class="card-header-actions">
            <el-button @click="goToCurrentSemester">
              <el-icon><Calendar /></el-icon> 当前学期
            </el-button>
            <el-select
              v-model="selectedSemester"
              placeholder="选择学期"
              class="semester-select"
              @change="handleSemesterChange"
            >
              <el-option
                v-for="sem in availableSemesters"
                :key="sem.value"
                :label="sem.label"
                :value="sem.value"
              />
            </el-select>
            <el-select
              v-model="selectedTextbook"
              filterable
              placeholder="搜索并选择教材"
              class="filter-select-wide"
              :disabled="!selectedSemester"
              @change="loadDetail"
            >
              <el-option
                v-for="tb in textbooks"
                :key="tb.id"
                :label="`${tb.title} - ${tb.publisher || '未知出版社'}`"
                :value="tb.id"
              />
            </el-select>
            <el-button :disabled="!selectedSemester && !selectedTextbook" @click="resetFilters">
              <el-icon><Refresh /></el-icon> 重置
            </el-button>
            <el-button
              type="success"
              :disabled="!selectedTextbook || !selectedSemester"
              @click="exportExcel"
            >
              <el-icon><Download /></el-icon> 导出Excel
            </el-button>
          </div>
        </div>
      </template>

      <!-- 统一使用一个容器，保持最小高度 -->
      <div v-loading="loadingDetail" class="content-container">
        <!-- 空状态提示 -->
        <el-empty
          v-if="!selectedSemester"
          description="请先选择要查询的学期，然后选择教材查看详情"
        />
        <el-empty
          v-else-if="!selectedTextbook && !loadingDetail"
          description="请选择要查询的教材查看详情"
        />

        <!-- 详情内容区：用 hasDetail 控制，加载期间保持旧数据在 DOM 中不卸载 -->
        <div v-else-if="hasDetail" class="detail-content">
          <el-descriptions :column="3" border :label-width="'90px'" class="textbook-descriptions">
            <el-descriptions-item label="书名">
              <div class="description-content">{{ detail?.textbook?.title || '-' }}</div>
            </el-descriptions-item>
            <el-descriptions-item label="书号">
              <div class="description-content">{{ detail?.textbook?.isbn || '-' }}</div>
            </el-descriptions-item>
            <el-descriptions-item label="出版社">
              <div class="description-content">{{ detail?.textbook?.publisher || '-' }}</div>
            </el-descriptions-item>
            <el-descriptions-item label="作者">
              <div class="description-content">{{ detail?.textbook?.author || '-' }}</div>
            </el-descriptions-item>
            <el-descriptions-item label="出版日期">
              <div class="description-content">{{ detail?.textbook?.publishDate || '-' }}</div>
            </el-descriptions-item>
            <el-descriptions-item label="查询学期">
              <div class="description-content">{{ detail?.semesterInfo?.label || '-' }}</div>
            </el-descriptions-item>
          </el-descriptions>

          <el-alert
            :title="`共 ${detail?.totalClasses ?? 0} 个班级使用，合计 ${detail?.totalStudents ?? 0} 名学生`"
            type="success"
            :closable="false"
            class="alert-success"
          />

          <el-table :data="paginatedClasses" stripe class="textbook-query-table" :fit="true">
            <el-table-column prop="className" label="班级" min-width="260" show-overflow-tooltip />
            <el-table-column
              prop="courseName"
              label="对应课程"
              min-width="180"
              show-overflow-tooltip
            />
            <el-table-column prop="majorName" label="专业" min-width="150" show-overflow-tooltip />
            <el-table-column
              prop="trainingLevelName"
              label="培养层次"
              min-width="120"
              show-overflow-tooltip
            />
            <el-table-column label="年级" min-width="90" align="center">
              <template #default="{ row }">{{ row.grade }}年级</template>
            </el-table-column>
            <el-table-column prop="studentCount" label="学生人数" min-width="100" align="center" />
            <el-table-column label="使用学期" min-width="110" align="center">
              <template #default="{ row }">第{{ row.semester }}学期</template>
            </el-table-column>
            <el-table-column label="是否必订" min-width="110" align="center">
              <template #default="{ row }">
                <el-tag :type="row.isRequired ? 'danger' : 'info'" size="small">{{
                  row.isRequired ? '必订' : '选修'
                }}</el-tag>
              </template>
            </el-table-column>
          </el-table>

          <!-- 分页 -->
          <div class="pagination-container">
            <el-pagination
              v-model:current-page="pagination.page"
              v-model:page-size="pagination.pageSize"
              :page-sizes="[10, 20, 50, 100]"
              :total="pagination.total"
              layout="total, sizes, prev, pager, next, jumper"
              @size-change="handleSizeChange"
              @current-change="handlePageChange"
            />
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Download, Refresh, Calendar } from '@element-plus/icons-vue';
import { getTextbooks } from '../../api/textbook';
import { getTextbookQuery } from '../../api/query';
import request from '../../utils/request';
import { useSemesters, downloadBlob } from '../../composables/useSemesters';

const textbooks = ref([]);
const loadingDetail = ref(false);
const selectedTextbook = ref(null);
const selectedSemester = ref('');
const detail = ref(null);
// 标记是否已加载过详情，加载期间保持 true 防止 DOM 卸载导致抖动
const hasDetail = ref(false);

// 分页状态
const pagination = ref({
  page: 1,
  pageSize: 50,
  total: 0,
});

// 计算分页后的班级数据
const paginatedClasses = computed(() => {
  if (!detail.value || !detail.value.classes) return [];
  const start = (pagination.value.page - 1) * pagination.value.pageSize;
  const end = start + pagination.value.pageSize;
  return detail.value.classes.slice(start, end);
});

// 学期相关逻辑
const { availableSemesters, getCurrentSemester } = useSemesters();

async function loadDetail(id) {
  if (!id || !selectedSemester.value) {
    detail.value = null;
    hasDetail.value = false;
    pagination.value.total = 0;
    return;
  }

  // 先标记 hasDetail，保持 DOM 挂载，避免切换教材时内容块卸载重挂
  hasDetail.value = true;
  loadingDetail.value = true;
  try {
    const res = await getTextbookQuery(id, { semester: selectedSemester.value });
    detail.value = res.data;
    // 重置分页并设置总数
    pagination.value.page = 1;
    pagination.value.total = res.data?.totalClasses || 0;
  } catch (e) {
    ElMessage.error('加载教材使用详情失败');
    detail.value = null;
    hasDetail.value = false;
    pagination.value.total = 0;
  } finally {
    loadingDetail.value = false;
  }
}

// 学期变化时处理
function handleSemesterChange() {
  // 切换学期时清空已选教材和详情
  selectedTextbook.value = null;
  detail.value = null;
  hasDetail.value = false;
  pagination.value.total = 0;
}

// 分页处理函数
function handlePageChange(page) {
  pagination.value.page = page;
}

function handleSizeChange(size) {
  pagination.value.pageSize = size;
  pagination.value.page = 1; // 重置到第一页
}

function resetFilters() {
  // 不重置学期选择器，只重置其他筛选条件
  selectedTextbook.value = null;
  detail.value = null;
  hasDetail.value = false;
  pagination.value.total = 0;
}

// 跳转到当前学期
function goToCurrentSemester() {
  selectedSemester.value = getCurrentSemester();
  // 清空已选教材和其他状态
  selectedTextbook.value = null;
  detail.value = null;
  hasDetail.value = false;
  pagination.value.total = 0;
  pagination.value.page = 1;
}

async function exportExcel() {
  if (!selectedTextbook.value || !selectedSemester.value) {
    ElMessage.warning('请先选择学期和教材');
    return;
  }

  try {
    const response = await request.get(`/export/textbook/${selectedTextbook.value}`, {
      params: { semester: selectedSemester.value },
      responseType: 'blob',
    });

    downloadBlob(response, `教材使用_${selectedSemester.value}_${new Date().getTime()}.xlsx`);

    ElMessage.success('导出成功');
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('导出失败:', error);
    }
    ElMessage.error(error.message || '导出失败，请重试');
  }
}

onMounted(async () => {
  // 设置默认学期为当前学期
  selectedSemester.value = getCurrentSemester();

  // 初始加载教材列表（所有启用的教材）
  try {
    const res = await getTextbooks();
    // 只显示启用的教材
    textbooks.value = (res.data || []).filter((t) => t.isActive);
  } catch (e) {
    ElMessage.error('加载教材列表失败');
    textbooks.value = [];
  }
});
</script>

<style scoped>
.semester-select {
  width: auto;
  min-width: 240px;
}
.filter-select-wide {
  min-width: 300px;
  flex: 1.5;
  max-width: 500px;
}

/* 内容容器，保持最小高度 */
.content-container {
  min-height: 400px;
  position: relative;
}

.detail-content {
  animation: fadeIn 0.2s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.textbook-descriptions {
  margin-bottom: 20px;
}

/* 强制 descriptions 内部表格固定布局，切换教材时列宽不跳动 */
.textbook-descriptions :deep(table) {
  table-layout: fixed !important;
  width: 100% !important;
}

/* 固定标签列宽度，保证切换教材时标题不换行、不抖动 */
.textbook-descriptions :deep(.el-descriptions__label) {
  width: 90px !important;
  min-width: 90px !important;
  flex-shrink: 0;
  font-weight: 500;
  color: #606266;
  white-space: nowrap;
}

.textbook-descriptions :deep(.el-descriptions__content) {
  min-width: 0;
  word-break: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
}

.description-content {
  word-break: break-word;
  overflow-wrap: break-word;
  white-space: normal;
  line-height: 1.6;
}

.alert-success {
  margin-bottom: 16px;
}

/* 表格容器，确保撑满可用宽度 */
.textbook-query-table {
  width: 100%;
}
</style>
