<template>
  <div>
    <el-card>
      <template #header>
        <div class="card-header">
          <span>当前学期开课查询</span>
          <div class="card-header-actions">
            <el-select v-model="filterCollege" clearable placeholder="按学院筛选" @change="resetPaginationAndLoad" class="filter-select">
              <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
            <el-select v-model="filterMajor" clearable placeholder="按专业筛选" @change="resetPaginationAndLoad" class="filter-select">
              <el-option v-for="m in majors" :key="m.id" :label="m.name" :value="m.id" />
            </el-select>
            <el-select v-model="filterLevel" clearable placeholder="按层次筛选" @change="resetPaginationAndLoad" class="filter-select">
              <el-option v-for="l in levels" :key="l.id" :label="l.name" :value="l.id" />
            </el-select>
            <el-select v-model="filterEnrollmentYear" clearable placeholder="按入学年份筛选" @change="resetPaginationAndLoad" class="filter-select">
              <el-option v-for="year in enrollmentYears" :key="year" :label="year + '年'" :value="year" />
            </el-select>
            <el-select v-model="filterGrade" clearable placeholder="按年级筛选" @change="resetPaginationAndLoad" class="filter-select">
              <el-option v-for="g in grades" :key="g" :label="g + '年级'" :value="g" />
            </el-select>
            <el-button type="success" @click="exportExcel">
              <el-icon><Download /></el-icon> 导出Excel
            </el-button>
          </div>
        </div>
      </template>

      <el-alert v-if="semesterLabel" :title="`当前学期：${semesterLabel} | 共 ${totalClasses} 个班级`" type="info" :closable="false" class="alert-info" />

      <el-table :data="data" stripe row-key="classId" v-loading="loading">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="expand-content">
              <el-table :data="row.courses" size="small" border>
                <el-table-column prop="courseName" label="课程" min-width="150" show-overflow-tooltip />
                <el-table-column label="类型" min-width="100">
                  <template #default="{ row: c }">
                    <el-tag size="small" :type="c.courseType === 'public' ? 'success' : 'warning'">
                      {{ c.courseType === 'public' ? '公共基础课' : '专业课' }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="weeklyHours" label="周课时" min-width="80" />
                <el-table-column prop="totalHoursThisSemester" label="学期总课时" min-width="100" />
                <el-table-column label="使用教材" min-width="250">
                  <template #default="{ row: c }">
                    <div v-if="c.textbooks?.length">
                      <div v-for="tb in c.textbooks" :key="tb.id">
                        {{ tb.title }} <el-tag size="small" v-if="tb.isRequired">必订</el-tag>
                      </div>
                    </div>
                    <span v-else class="no-textbook">未指定</span>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="className" label="班级" min-width="180" show-overflow-tooltip />
        <el-table-column prop="collegeName" label="二级学院" min-width="115" show-overflow-tooltip />
        <el-table-column prop="majorName" label="专业" min-width="150" show-overflow-tooltip />
        <el-table-column prop="trainingLevelName" label="培养层次" min-width="100" show-overflow-tooltip />
        <el-table-column label="入学年份" min-width="90">
          <template #default="{ row }">{{ row.enrollmentYear }}年</template>
        </el-table-column>
        <el-table-column label="年级" min-width="80">
          <template #default="{ row }">{{ row.grade }}年级</template>
        </el-table-column>
        <el-table-column label="在读学期" min-width="100">
          <template #default="{ row }">第{{ row.currentSemester }}学期</template>
        </el-table-column>
        <el-table-column prop="studentCount" label="人数" min-width="70" />
        <el-table-column label="开课数" min-width="70">
          <template #default="{ row }">{{ row.courses?.length || 0 }}</template>
        </el-table-column>
        <el-table-column label="周课时合计" min-width="100">
          <template #default="{ row }">{{ (row.courses || []).reduce((s, c) => s + c.weeklyHours, 0) }}</template>
        </el-table-column>
        <el-table-column prop="planName" label="培养方案" min-width="180" show-overflow-tooltip />
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
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../../stores/auth'
import { getSemesterQuery } from '../../api/query'
import { getMajors } from '../../api/major'
import { getTrainingLevels } from '../../api/trainingLevel'
import { getColleges } from '../../api/college'
import request from '../../utils/request'

const data = ref([])
const loading = ref(false)
const majors = ref([])
const levels = ref([])
const colleges = ref([])
const filterCollege = ref(null)
const filterMajor = ref(null)
const filterLevel = ref(null)
const filterEnrollmentYear = ref(null)
const filterGrade = ref(null)
const semesterLabel = ref('')
const totalClasses = ref(0)

// 分页状态
const pagination = ref({
  page: 1,
  pageSize: 50,
  total: 0,
})

// 计算可用的入学年份列表（从数据中提取）
const enrollmentYears = computed(() => {
  const years = new Set()
  data.value.forEach(item => {
    if (item.enrollmentYear) years.add(item.enrollmentYear)
  })
  return Array.from(years).sort((a, b) => b - a)
})

// 计算可用的年级列表（从数据中提取）
const grades = computed(() => {
  const gradeSet = new Set()
  data.value.forEach(item => {
    if (item.grade) gradeSet.add(item.grade)
  })
  return Array.from(gradeSet).sort((a, b) => a - b)
})

async function load() {
  loading.value = true
  try {
    const params = {
      page: pagination.value.page,
      pageSize: pagination.value.pageSize,
    }
    if (filterCollege.value) params.collegeId = filterCollege.value
    if (filterMajor.value) params.majorId = filterMajor.value
    if (filterLevel.value) params.trainingLevelId = filterLevel.value
    if (filterEnrollmentYear.value) params.enrollmentYear = filterEnrollmentYear.value
    if (filterGrade.value) params.grade = filterGrade.value
    const res = await getSemesterQuery(params)
    data.value = res.data?.data || []
    semesterLabel.value = res.data?.semesterInfo?.label || ''
    totalClasses.value = res.data?.totalClasses || 0
    pagination.value.total = res.data?.total || 0
  } catch (e) { console.error(e) }
  finally { loading.value = false }
}

// 分页处理函数
function handlePageChange(page) {
  pagination.value.page = page
  load()
}

function handleSizeChange(size) {
  pagination.value.pageSize = size
  pagination.value.page = 1 // 重置到第一页
  load()
}

// 筛选条件变化时重置页码
function resetPaginationAndLoad() {
  pagination.value.page = 1
  load()
}

const authStore = useAuthStore()

async function exportExcel() {
  try {
    // FC2修复：使用POST请求 + Authorization Header，避免token暴露在URL中
    const params = {
      collegeId: filterCollege.value || undefined,
      majorId: filterMajor.value || undefined,
      trainingLevelId: filterLevel.value || undefined,
      enrollmentYear: filterEnrollmentYear.value || undefined,
      grade: filterGrade.value || undefined,
    }
    
    // 使用axios代替fetch，享受拦截器带来的自动token管理和错误处理
    const response = await request.post('/export/semester', params, {
      responseType: 'blob'  // 重要：指定响应类型为blob
    })
    
    // 处理blob下载
    const blob = new Blob([response], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `学期开课数据_${new Date().getTime()}.xlsx`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
    
    ElMessage.success('导出成功')
  } catch (e) {
    console.error('导出失败:', e)
    ElMessage.error(e.message || '导出失败，请重试')
  }
}

onMounted(async () => {
  const [levelRes, majorRes, collegeRes] = await Promise.all([
    getTrainingLevels(),
    getMajors(),
    getColleges()
  ])
  levels.value = levelRes.data || []
  majors.value = majorRes.data || []
  colleges.value = collegeRes.data || []
  load()
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
.filter-select {
  width: 140px;
}
.alert-info {
  margin-bottom: 16px;
}
.expand-content {
  padding: 12px 24px;
}
.no-textbook {
  color: #999;
}
.pagination-container {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
  padding: 12px 0;
}
</style>
