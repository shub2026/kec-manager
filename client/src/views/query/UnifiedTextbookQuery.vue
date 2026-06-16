<template>
  <div>
    <el-card>
      <template #header>
        <div class="card-header">
          <span>教材查询</span>
          <div class="card-header-actions">
            <el-select v-model="selectedSemester" placeholder="选择学期" @change="handleSemesterChange" class="semester-select">
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
              @change="loadDetail" 
              class="filter-select-wide"
              :disabled="!selectedSemester"
            >
              <el-option v-for="tb in textbooks" :key="tb.id" :label="`${tb.title} - ${tb.publisher || '未知出版社'}`" :value="tb.id" />
            </el-select>
            <el-button @click="goToCurrentSemester">
              <el-icon><Calendar /></el-icon> 当前学期
            </el-button>
            <el-button @click="resetFilters">
              <el-icon><Refresh /></el-icon> 重置
            </el-button>
            <el-button type="success" :disabled="!selectedTextbook || !selectedSemester" @click="exportExcel">
              <el-icon><Download /></el-icon> 导出Excel
            </el-button>
          </div>
        </div>
      </template>

      <el-alert v-if="!selectedSemester" title="请先选择要查询的学期，然后选择教材查看详情" type="warning" :closable="false" class="alert-info" />
      
      <div v-else-if="detail">
        <el-descriptions :column="3" border class="textbook-descriptions">
          <el-descriptions-item label="书名" :width="120">{{ detail.textbook?.title }}</el-descriptions-item>
          <el-descriptions-item label="书号" :width="150">{{ detail.textbook?.isbn || '-' }}</el-descriptions-item>
          <el-descriptions-item label="出版社" :width="100">{{ detail.textbook?.publisher || '-' }}</el-descriptions-item>
          <el-descriptions-item label="作者" :width="180">{{ detail.textbook?.author || '-' }}</el-descriptions-item>
          <el-descriptions-item label="出版日期" :width="150">{{ detail.textbook?.publishDate || '-' }}</el-descriptions-item>
          <el-descriptions-item label="查询学期" :width="200">{{ detail.semesterInfo?.label }}</el-descriptions-item>
        </el-descriptions>

        <el-alert :title="`共 ${detail.totalClasses} 个班级使用，合计 ${detail.totalStudents} 名学生`" type="success" :closable="false" class="alert-success" />

        <el-table :data="paginatedClasses" stripe v-loading="loadingDetail">
          <el-table-column prop="className" label="班级" min-width="180" show-overflow-tooltip />
          <el-table-column prop="courseName" label="对应课程" min-width="160" show-overflow-tooltip />
          <el-table-column prop="majorName" label="专业" min-width="140" show-overflow-tooltip />
          <el-table-column prop="trainingLevelName" label="培养层次" width="120" show-overflow-tooltip />
          <el-table-column label="年级" width="90" align="center">
            <template #default="{ row }">{{ row.grade }}年级</template>
          </el-table-column>
          <el-table-column prop="studentCount" label="学生人数" width="100" align="center" />
          <el-table-column label="使用学期" width="100" align="center">
            <template #default="{ row }">第{{ row.semester }}学期</template>
          </el-table-column>
          <el-table-column label="是否必订" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="row.isRequired ? 'danger' : 'info'" size="small">{{ row.isRequired ? '必订' : '选修' }}</el-tag>
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

      <el-empty v-else-if="selectedSemester && !selectedTextbook" description="请选择要查询的教材" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Refresh, Calendar } from '@element-plus/icons-vue'
import { useAuthStore } from '../../stores/auth'
import { getTextbooks } from '../../api/textbook'
import { getTextbookQuery } from '../../api/query'
import request from '../../utils/request'

const textbooks = ref([])
const loadingDetail = ref(false)
const selectedTextbook = ref(null)
const selectedSemester = ref('')
const detail = ref(null)

// 分页状态
const pagination = ref({
  page: 1,
  pageSize: 50,
  total: 0,
})

// 计算分页后的班级数据
const paginatedClasses = computed(() => {
  if (!detail.value || !detail.value.classes) return []
  const start = (pagination.value.page - 1) * pagination.value.pageSize
  const end = start + pagination.value.pageSize
  return detail.value.classes.slice(start, end)
})

// 生成可选学期列表（前后各3年）
const availableSemesters = computed(() => {
  const currentYear = new Date().getFullYear()
  const semesters = []
  for (let y = currentYear - 3; y <= currentYear + 3; y++) {
    semesters.push(
      { value: `${y}-${y + 1}-1`, label: `${y}-${y + 1}学年 秋季(第1学期)` },
      { value: `${y}-${y + 1}-2`, label: `${y}-${y + 1}学年 春季(第2学期)` }
    )
  }
  return semesters
})

// 获取当前学期信息
function getCurrentSemester() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1 // 1-12
  
  // 秋季学期：8月-次年1月，标记为当年-次年-1
  // 春季学期：2月-7月，标记为上年-当年-2
  if (month >= 8) {
    return `${year}-${year + 1}-1`
  } else {
    return `${year - 1}-${year}-2`
  }
}

async function loadDetail(id) {
  if (!id || !selectedSemester.value) { 
    detail.value = null
    pagination.value.total = 0
    return 
  }
  
  loadingDetail.value = true
  try {
    const res = await getTextbookQuery(id, { semester: selectedSemester.value })
    detail.value = res.data
    // 重置分页并设置总数
    pagination.value.page = 1
    pagination.value.total = res.data?.totalClasses || 0
  } catch (e) { 
    ElMessage.error('加载教材使用详情失败')
    detail.value = null 
    pagination.value.total = 0
  }
  finally { 
    loadingDetail.value = false 
  }
}

// 学期变化时处理
function handleSemesterChange() {
  // 切换学期时清空已选教材和详情
  selectedTextbook.value = null
  detail.value = null
  pagination.value.total = 0
}

// 分页处理函数
function handlePageChange(page) {
  pagination.value.page = page
}

function handleSizeChange(size) {
  pagination.value.pageSize = size
  pagination.value.page = 1 // 重置到第一页
}

function resetFilters() {
  // 不重置学期选择器，只重置其他筛选条件
  selectedTextbook.value = null
  detail.value = null
  pagination.value.total = 0
}

// 跳转到当前学期
function goToCurrentSemester() {
  selectedSemester.value = getCurrentSemester()
  // 清空已选教材和其他状态
  selectedTextbook.value = null
  detail.value = null
  pagination.value.total = 0
  pagination.value.page = 1
}

async function exportExcel() {
  if (!selectedTextbook.value || !selectedSemester.value) {
    ElMessage.warning('请先选择学期和教材')
    return
  }
  
  try {
    const response = await request.get(`/export/textbook/${selectedTextbook.value}`, {
      params: { semester: selectedSemester.value },
      responseType: 'blob'
    })
    
    const blob = new Blob([response], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `教材使用_${selectedSemester.value}_${new Date().getTime()}.xlsx`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
    
    ElMessage.success('导出成功')
  } catch (error) {
    console.error('导出失败:', error)
    ElMessage.error(error.message || '导出失败，请重试')
  }
}

onMounted(async () => {
  // 设置默认学期为当前学期
  selectedSemester.value = getCurrentSemester()
  
  // 初始加载教材列表（所有启用的教材）
  try {
    const res = await getTextbooks()
    // 只显示启用的教材
    textbooks.value = (res.data || []).filter(t => t.isActive)
  } catch (e) {
    ElMessage.error('加载教材列表失败')
    textbooks.value = []
  }
})
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-header-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.semester-select {
  width: auto;
  min-width: 240px;
}
.filter-select-wide {
  min-width: 300px;
  flex: 1.5;
  max-width: 500px;
}
.textbook-descriptions {
  margin-bottom: 20px;
}
.alert-info {
  margin-bottom: 16px;
}
.alert-success {
  margin-bottom: 16px;
}
.pagination-container {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
  padding: 12px 0;
}
</style>
