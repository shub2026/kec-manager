<template>
  <div>
    <el-card>
      <template #header>
        <div class="card-header">
          <span>班级管理</span>
          <div class="card-header-actions">
            <!-- 筛选器组件 -->
            <ClassFilterBar
              v-model:filters="filters"
              :colleges="colleges"
              :majors="majors"
              :training-levels="trainingLevels"
              :enrollment-years="enrollmentYears"
              :plans="plans"
              @change="resetPaginationAndLoad"
              @search="load"
              @export="handleExport"
              @download-template="downloadTemplate"
              @import-success="onImportSuccess"
              @import-error="onImportError"
              @before-upload="beforeImport"
              @add="openDialog"
            />
          </div>
        </div>
      </template>

      <!-- 表格组件 -->
      <ClassTable
        :classes="list"
        :loading="loading"
        :selected-classes="selectedClasses"
        :pagination="pagination"
        :semester-info="currentSemesterInfo"
        @selection-change="handleSelectionChange"
        @edit="openDialog"
        @delete="handleDelete"
        @batch-delete="handleBatchDelete"
        @batch-set="openBatchSetDialog"
        @size-change="handleSizeChange"
        @page-change="handlePageChange"
      />
    </el-card>

    <!-- 表单对话框组件 -->
    <ClassFormDialog
      v-model:visible="dialogVisible"
      v-model:batch-visible="batchDialogVisible"
      v-model:form="form"
      v-model:batch-form="batchForm"
      :batch-form-type="batchFormType"
      :batch-dialog-title="batchDialogTitle"
      :saving="saving || batchSaving"
      :majors="majors"
      :colleges="colleges"
      :training-levels="trainingLevels"
      :plans="plans"
      @save="handleSave"
      @batch-save="handleBatchSet"
      @close="resetForm"
      @batch-close="resetBatchForm"
    />

    <!-- 导入进度对话框 -->
    <el-dialog 
      v-model="progressDialogVisible" 
      title="正在导入" 
      width="500px" 
      :close-on-click-modal="false" 
      :show-close="false"
    >
      <div class="progress-container">
        <el-progress 
          :percentage="progressPercent" 
          :status="progressStatus"
          :stroke-width="20"
        />
        <div class="progress-info">
          <div class="progress-text">{{ progressText }}</div>
          <div class="progress-detail" v-if="progressDetail">
            {{ progressDetail }}
          </div>
        </div>
        <div class="progress-tip">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>请稍候，正在处理中...</span>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import request from '../../utils/request'
import { getClasses, createClass, updateClass, deleteClass } from '../../api/class'
import { getMajors } from '../../api/major'
import { getPlans } from '../../api/plan'
import { getTrainingLevels } from '../../api/trainingLevel'
import { getColleges } from '../../api/college'
import { useExport } from '../../composables/useExport'
import ClassFilterBar from './components/ClassFilterBar.vue'
import ClassTable from './components/ClassTable.vue'
import ClassFormDialog from './components/ClassFormDialog.vue'

const list = ref([])
const loading = ref(false)
const majors = ref([])
const plans = ref([])
const trainingLevels = ref([])
const colleges = ref([])
const allEnrollmentYears = ref([])
const selectedClasses = ref([])
const currentSemesterInfo = ref(null) // 当前学期信息

const filters = ref({
  name: '',
  majorId: null,
  collegeId: null,
  trainingLevelId: null,
  enrollmentYear: null,
  status: null,
  planId: null,
})

const pagination = ref({
  page: 1,
  pageSize: 20,
  total: 0,
})

const dialogVisible = ref(false)
const batchDialogVisible = ref(false)
const progressDialogVisible = ref(false)
const saving = ref(false)
const batchSaving = ref(false)
const progressPercent = ref(0)
const progressStatus = ref('')
const progressText = ref('')
const progressDetail = ref('')

const form = ref({
  id: null,
  name: '',
  majorId: null,
  collegeId: null,
  trainingLevelId: null,
  enrollmentYear: new Date().getFullYear(),
  durationYears: 3,
  studentCount: 0,
  isLeftSchool: false,
  customPlanId: null,
})

// 使用导出 composable
const { exportData, downloadTemplate } = useExport('classes', '班级数据')

const batchForm = ref({
  majorId: null,
  collegeId: null,
  trainingLevelId: null,
  enrollmentYear: new Date().getFullYear(),
  durationYears: 3,
  isLeftSchool: false,
})

const batchFormType = ref('')

const enrollmentYears = computed(() => {
  return allEnrollmentYears.value.filter(y => y != null)
})

const batchDialogTitle = computed(() => {
  const titles = {
    major: '批量设置专业',
    college: '批量设置学院',
    level: '批量设置培养层次',
    year: '批量设置入学年份',
    duration: '批量设置学制',
    leftSchool: '批量设置离校状态',
  }
  return titles[batchFormType.value] || '批量设置'
})

async function load() {
  loading.value = true
  try {
    const params = {
      ...filters.value,
      page: pagination.value.page,
      pageSize: pagination.value.pageSize,
    }
    
    const res = await getClasses(params)
    list.value = res?.data?.items || []
    pagination.value.total = res?.data?.total || 0
    
    if (res?.data?.allEnrollmentYears) {
      allEnrollmentYears.value = res.data.allEnrollmentYears
    }
  } catch (error) {
    ElMessage.error('加载失败：' + (error.message || '未知错误'))
  } finally {
    loading.value = false
  }
}

async function loadBaseData() {
  try {
    const [majorsRes, plansRes, levelsRes, collegesRes, settingsRes] = await Promise.all([
      getMajors(),
      getPlans(),
      getTrainingLevels(),
      getColleges(),
      request.get('/settings'),
    ])
    majors.value = majorsRes?.data || []
    plans.value = plansRes?.data || []
    trainingLevels.value = levelsRes?.data || []
    colleges.value = collegesRes?.data || []
    
    // 解析当前学期信息
    if (settingsRes?.data?.currentSemester?.value) {
      const semesterValue = settingsRes.data.currentSemester.value
      const parts = semesterValue.split('-')
      if (parts.length === 3) {
        currentSemesterInfo.value = {
          startYear: Number(parts[0]),
          endYear: Number(parts[1]),
          semesterIndex: Number(parts[2]),
        }
      }
    }
  } catch (error) {
    console.error('加载基础数据失败:', error)
    if (error.response?.status === 401) {
      ElMessage.warning('请先登录后再使用班级管理功能')
    } else {
      ElMessage.error('加载基础数据失败，请刷新页面重试')
    }
  }
}

function resetPaginationAndLoad() {
  pagination.value.page = 1
  load()
}

function handlePageChange() {
  load()
}

function handleSizeChange() {
  pagination.value.page = 1
  load()
}

function openDialog(row = null) {
  if (row) {
    form.value = { ...row }
  } else {
    resetForm()
  }
  dialogVisible.value = true
}

function resetForm() {
  form.value = {
    id: null,
    name: '',
    majorId: null,
    collegeId: null,
    trainingLevelId: null,
    enrollmentYear: new Date().getFullYear(),
    durationYears: 3,
    studentCount: 0,
    isLeftSchool: false,
    customPlanId: null,
  }
}

async function handleSave() {
  if (!form.value.name || !form.value.enrollmentYear || !form.value.durationYears || !form.value.trainingLevelId) {
    ElMessage.error('请填写必填项')
    return
  }

  saving.value = true
  try {
    // 转换字段名为snake_case以匹配后端期望，并过滤空值
    const classData = {
      name: form.value.name,
      enrollment_year: form.value.enrollmentYear,
      duration_years: form.value.durationYears,
      major_id: form.value.majorId || undefined,
      college_id: form.value.collegeId || undefined,
      training_level_id: form.value.trainingLevelId,
      student_count: form.value.studentCount !== null && form.value.studentCount !== undefined ? Number(form.value.studentCount) : undefined,
      custom_plan_id: form.value.customPlanId || undefined,
      is_left_school: form.value.isLeftSchool
    }
    
    if (form.value.id) {
      await updateClass(form.value.id, classData)
      ElMessage.success('更新成功')
    } else {
      await createClass(classData)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    await load()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '操作失败')
  } finally {
    saving.value = false
  }
}

async function handleDelete(id) {
  try {
    await deleteClass(id)
    ElMessage.success('删除成功')
    load()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '删除失败')
  }
}

function handleSelectionChange(selection) {
  selectedClasses.value = selection
}

async function handleBatchDelete() {
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${selectedClasses.value.length} 个班级吗？`, '批量删除', {
      type: 'warning',
    })
    
    for (const cls of selectedClasses.value) {
      await deleteClass(cls.id)
    }
    
    ElMessage.success('批量删除成功')
    selectedClasses.value = []
    load()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('批量删除失败')
    }
  }
}

function openBatchSetDialog(type) {
  batchFormType.value = type
  resetBatchForm()
  batchDialogVisible.value = true
}

function resetBatchForm() {
  batchForm.value = {
    majorId: null,
    collegeId: null,
    trainingLevelId: null,
    enrollmentYear: new Date().getFullYear(),
    durationYears: 3,
    isLeftSchool: false,
  }
}

async function handleBatchSet() {
  batchSaving.value = true
  try {
    const updates = {}
    
    if (batchFormType.value === 'major') {
      if (!batchForm.value.majorId) {
        ElMessage.error('请选择专业')
        return
      }
      updates.major_id = batchForm.value.majorId
    } else if (batchFormType.value === 'college') {
      updates.college_id = batchForm.value.collegeId
    } else if (batchFormType.value === 'level') {
      if (!batchForm.value.trainingLevelId) {
        ElMessage.error('请选择培养层次')
        return
      }
      updates.training_level_id = batchForm.value.trainingLevelId
    } else if (batchFormType.value === 'year') {
      updates.enrollment_year = batchForm.value.enrollmentYear
    } else if (batchFormType.value === 'duration') {
      updates.duration_years = batchForm.value.durationYears
    } else if (batchFormType.value === 'leftSchool') {
      updates.is_left_school = batchForm.value.isLeftSchool
    }
    
    for (const cls of selectedClasses.value) {
      await updateClass(cls.id, { ...cls, ...updates })
    }
    
    ElMessage.success('批量设置成功')
    batchDialogVisible.value = false
    selectedClasses.value = []
    load()
  } catch (error) {
    ElMessage.error('批量设置失败')
  } finally {
    batchSaving.value = false
  }
}

function beforeImport(file) {
  progressDialogVisible.value = true
  progressPercent.value = 0
  progressStatus.value = ''
  progressText.value = '正在上传文件...'
  progressDetail.value = ''
  return true
}

function onImportSuccess(res) {
  progressPercent.value = 100
  const data = res.data || {}
  const message = res.message || '导入完成'

  // 构建详细消息
  let detailMsg = message

  // 添加失败详情
  if (data.errors && data.errors.length > 0) {
    detailMsg += '\n\n❌ 失败详情：'
    data.errors.forEach((error, index) => {
      detailMsg += `\n${index + 1}. ${error}`
    })
  }

  // 根据结果显示不同类型的消息
  if (data.failed && data.failed > 0) {
    progressStatus.value = 'warning'
    progressText.value = '导入部分完成'
    progressDetail.value = detailMsg
    setTimeout(() => {
      progressDialogVisible.value = false
      ElMessage({ message: detailMsg, type: 'warning', duration: 10000, showClose: true })
      load()
    }, 1500)
  } else if (data.imported > 0 || data.overwritten > 0) {
    progressStatus.value = 'success'
    progressText.value = '导入完成'
    progressDetail.value = detailMsg
    setTimeout(() => {
      progressDialogVisible.value = false
      ElMessage({ message: detailMsg, type: 'success', duration: 8000, showClose: true })
      load()
    }, 1500)
  } else {
    progressStatus.value = 'exception'
    progressText.value = '导入失败'
    progressDetail.value = detailMsg
    setTimeout(() => {
      progressDialogVisible.value = false
      ElMessage({ message: detailMsg, type: 'info', duration: 6000, showClose: true })
      load()
    }, 1500)
  }
}

function onImportError(err) {
  progressPercent.value = 100
  progressStatus.value = 'exception'
  progressText.value = '导入失败'
  progressDetail.value = err.message || '请检查文件格式'
  
  setTimeout(() => {
    progressDialogVisible.value = false
    ElMessage.error('导入失败')
  }, 1500)
}

async function handleExport() {
  // 将filters转换为exportData需要的参数格式 to exportData需要的格式
  const customParams = {}
  if (filters.value.name) customParams.name = filters.value.name
  if (filters.value.majorId) customParams.majorId = filters.value.majorId
  if (filters.value.collegeId) customParams.collegeId = filters.value.collegeId
  if (filters.value.trainingLevelId) customParams.trainingLevelId = filters.value.trainingLevelId
  if (filters.value.enrollmentYear) customParams.enrollmentYear = filters.value.enrollmentYear
  if (filters.value.status) customParams.status = filters.value.status
  if (filters.value.planId) customParams.planId = filters.value.planId
  
  await exportData(customParams)
}

onMounted(() => {
  load()
  loadBaseData()
})
</script>

<style scoped>
.progress-container {
  padding: 20px 0;
}

.progress-info {
  margin-top: 20px;
  text-align: center;
}

.progress-text {
  font-size: 16px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 8px;
}

.progress-detail {
  font-size: 14px;
  color: #909399;
}

.progress-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #ebeef5;
  color: #409eff;
  font-size: 14px;
}
</style>
