<template>
  <div class="teaching-arrange">
    <!-- 设置区 -->
    <el-card class="settings-card">
      <template #header>
        <div class="card-header">
          <span>教学安排设置</span>
          <div class="card-header-actions">
            <el-tag type="info">{{ currentSemesterLabel }}</el-tag>
            <el-select v-model="selectedCourseId" placeholder="请选择课程" filterable clearable @change="onCourseChange" style="width: 220px">
              <el-option v-for="c in allCourses" :key="c.id" :label="c.name" :value="c.id">
                <span>{{ c.name }}</span>
                <span style="color: #999; font-size: 12px; margin-left: 8px">{{ c.code }}</span>
              </el-option>
            </el-select>
            <el-checkbox-group v-model="scheduleConditions">
              <el-checkbox value="same_textbook">同教材</el-checkbox>
            </el-checkbox-group>
          </div>
        </div>
      </template>

      <!-- 课时设置 -->
      <div v-if="selectedCourseId" class="hour-settings">
        <span class="hour-settings-title">课时要求</span>
        <div class="hour-setting-item" v-for="type in personnelTypes" :key="type.key">
          <span class="type-label">{{ type.label }}</span>
          <span class="setting-field">
            <span class="field-label">标准</span>
            <el-input-number v-model="hourSettings[type.key].standard" :min="0" :max="40" :step="1" controls-position="right" size="small" style="width: 80px" />
          </span>
          <span class="setting-field">
            <span class="field-label">最大</span>
            <el-input-number v-model="hourSettings[type.key].max" :min="0" :max="40" :step="1" controls-position="right" size="small" style="width: 80px" />
          </span>
        </div>
        <el-button type="primary" size="small" @click="handleSaveHourSettings" :loading="savingSettings">
          <el-icon><Check /></el-icon> 确定
        </el-button>
      </div>
    </el-card>

    <!-- 预览区（合并课程信息 + 统计报告） -->
    <el-card v-if="selectedCourseId && courseInfo" class="preview-card">
      <template #header>
        <div class="card-header">
          <div class="preview-title">
            <span class="course-name">{{ courseInfo.name }}</span>
            <el-tag size="small">{{ courseTypeLabel(courseInfo.type) }}</el-tag>
          </div>
          <el-button v-if="classList.length" @click="handleExportArrange" :loading="exporting">数据导出</el-button>
        </div>
      </template>
      <div class="preview-stats">
        <div class="preview-stat-item">
          <span class="stat-label">教师</span>
          <span class="stat-value">{{ teacherList.length }}<small>人</small></span>
        </div>
        <div class="preview-stat-item">
          <span class="stat-label">班级</span>
          <span class="stat-value">{{ summary.totalClasses }}<small>个</small></span>
        </div>
        <div class="preview-stat-item">
          <span class="stat-label">已安排</span>
          <span class="stat-value">{{ summary.assignedCount }}<small>个</small></span>
        </div>
        <div class="preview-stat-item">
          <span class="stat-label">总课时</span>
          <span class="stat-value">{{ summary.totalCourseHours }}<small>课时</small></span>
        </div>
        <div class="preview-stat-item">
          <span class="stat-label">剩余课时</span>
          <span class="stat-value" :class="summary.remainingHours >= 0 ? 'text-success' : 'text-danger'">
            {{ summary.remainingHours }}<small>课时</small>
          </span>
        </div>
      </div>
    </el-card>

    <!-- 内容区：矩阵表 -->
    <el-card v-if="selectedCourseId" class="matrix-card">
      <template #header>
        <div class="card-header">
          <span>教学安排</span>
          <div class="card-header-actions">
            <el-select v-model="filterCollege" placeholder="学院" clearable filterable style="width: 130px" @change="filterMajor = ''">
              <el-option v-for="v in collegeOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-select v-model="filterMajor" placeholder="专业" clearable filterable style="width: 130px">
              <el-option v-for="v in majorOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-select v-model="filterGrade" placeholder="年级" clearable style="width: 90px">
              <el-option v-for="v in gradeOptions" :key="v" :label="v + '年级'" :value="v" />
            </el-select>
            <el-select v-model="filterTrainingLevel" placeholder="层次" clearable style="width: 100px">
              <el-option v-for="v in trainingLevelOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-button type="success" @click="handleAutoArrange('full')" :loading="arranging">
              <el-icon><MagicStick /></el-icon> 全量模式
            </el-button>
            <el-button type="warning" @click="handleAutoArrange('standard')" :loading="arranging">
              <el-icon><SetUp /></el-icon> 标准模式
            </el-button>
            <el-popconfirm title="确定重置所有自动安排？" @confirm="handleReset">
              <template #reference>
                <el-button type="danger">
                  <el-icon><RefreshRight /></el-icon> 重置
                </el-button>
              </template>
            </el-popconfirm>
          </div>
        </div>
      </template>

      <el-table :data="filteredClassList" stripe v-loading="tableLoading" row-key="classId" :row-class-name="tableRowClassName" class="adaptive-table">
        <el-table-column type="index" label="#" width="50" />
        <el-table-column prop="className" label="班级名称" min-width="140" show-overflow-tooltip />
        <el-table-column prop="collegeName" label="学院" min-width="100" show-overflow-tooltip />
        <el-table-column prop="majorName" label="专业" min-width="100" show-overflow-tooltip />
        <el-table-column prop="trainingLevelName" label="培养层次" min-width="80" show-overflow-tooltip />
        <el-table-column label="入学年份" min-width="80" align="center">
          <template #default="{ row }">{{ row.enrollmentYear }}</template>
        </el-table-column>
        <el-table-column label="年级" min-width="60" align="center">
          <template #default="{ row }">{{ row.grade }}</template>
        </el-table-column>
        <el-table-column label="在读学期" min-width="80" align="center">
          <template #default="{ row }">第{{ row.currentSemester }}学期</template>
        </el-table-column>
        <el-table-column label="人数" min-width="60" align="center">
          <template #default="{ row }">{{ row.studentCount }}</template>
        </el-table-column>
        <el-table-column label="周课时" min-width="70" align="center">
          <template #default="{ row }">{{ row.weeklyHours }}</template>
        </el-table-column>
        <el-table-column label="任课教师" min-width="140">
          <template #default="{ row }">
            <div
              class="teacher-cell"
              :class="{ 'has-teacher': row.assignment, 'no-teacher': !row.assignment }"
              @click="openTeacherSelect(row)"
            >
              <template v-if="row.assignment">
                <el-tag :type="row.assignment.isAuto ? 'info' : 'primary'" size="small" closable @close.stop="handleRemoveAssignment(row)">
                  {{ row.assignment.teacherName }}
                </el-tag>
              </template>
              <span v-else class="text-placeholder">点击安排</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="设置" width="60" align="center">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openTeacherSelect(row)">
              <el-icon><Edit /></el-icon>
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 教师选择弹窗 -->
    <el-dialog v-model="teacherDialogVisible" title="选择任课教师" width="80%" destroy-on-close class="teacher-dialog">
      <el-table :data="teacherList" stripe highlight-current-row @current-change="onTeacherSelect" size="small">
        <el-table-column prop="name" label="姓名" min-width="70" />
        <el-table-column label="人员类别" min-width="80">
          <template #default="{ row }">{{ personnelLabel(row.personnelType) }}</template>
        </el-table-column>
        <el-table-column label="当前总课时" min-width="90" align="center">
          <template #default="{ row }">
            <span :class="{ 'text-warning': row.totalWeeklyHours > (row.defaultWeeklyHours ?? hourSettings[row.personnelType || 'full_time']?.standard ?? 16) }">
              {{ row.totalWeeklyHours }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="班级数" min-width="60" align="center">
          <template #default="{ row }">{{ row.totalClassCount }}</template>
        </el-table-column>
        <el-table-column label="学科" min-width="140">
          <template #default="{ row }">
            <el-tag v-for="c in row.courseList" :key="c.id" size="small" class="tag-item">{{ c.name }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="任课学院" min-width="140">
          <template #default="{ row }">
            <el-tag v-for="c in row.collegeList" :key="c.id" size="small" type="info" class="tag-item">{{ c.name }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="任课层次" min-width="120">
          <template #default="{ row }">
            <el-tag v-for="l in row.trainingLevelList" :key="l.id" size="small" type="warning" class="tag-item">{{ l.name }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="特定周课时" min-width="90" align="center">
          <template #default="{ row }">{{ row.defaultWeeklyHours ?? '-' }}</template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="teacherDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmTeacherSelect" :disabled="!selectedTeacher" :loading="assigning">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { Edit, MagicStick, SetUp, RefreshRight, Check } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getCourses } from '../../api/course'
import request from '../../utils/request'
import {
  getCourseClasses,
  getCourseTeachers,
  assignTeacher,
  deleteAssignment,
  runAutoArrange,
  resetAutoAssignments,
  getHourSettings,
  saveHourSettings,
} from '../../api/teachingArrange'

// 学期相关
const currentSemesterLabel = ref('')
const selectedCourseId = ref(null)
const allCourses = ref([])
const courseInfo = ref(null)

// 课时设置
const personnelTypes = [
  { key: 'full_time', label: '专职' },
  { key: 'part_time', label: '兼职' },
  { key: 'external', label: '外聘' },
]
const defaultHourSettings = {
  full_time: { standard: 16, max: 20 },
  part_time: { standard: 12, max: 16 },
  external: { standard: 12, max: 16 },
}
const hourSettings = reactive({
  full_time: { standard: 16, max: 20 },
  part_time: { standard: 12, max: 16 },
  external: { standard: 12, max: 16 },
})

// 排课条件
const scheduleConditions = ref([])

// 数据
const classList = ref([])
const teacherList = ref([])
const tableLoading = ref(false)
const summary = ref({ totalClasses: 0, assignedCount: 0, unassignedCount: 0, totalCourseHours: 0, assignedHours: 0, remainingHours: 0 })

// 筛选器
const filterCollege = ref('')
const filterMajor = ref('')
const filterGrade = ref('')
const filterTrainingLevel = ref('')

const collegeOptions = computed(() => {
  const set = new Set(classList.value.map(c => c.collegeName).filter(Boolean))
  return [...set].sort()
})

const majorOptions = computed(() => {
  let list = classList.value
  if (filterCollege.value) list = list.filter(c => c.collegeName === filterCollege.value)
  const set = new Set(list.map(c => c.majorName).filter(Boolean))
  return [...set].sort()
})

const gradeOptions = computed(() => {
  const set = new Set(classList.value.map(c => c.grade).filter(Boolean))
  return [...set].sort((a, b) => a - b)
})

const trainingLevelOptions = computed(() => {
  const set = new Set(classList.value.map(c => c.trainingLevelName).filter(Boolean))
  return [...set].sort()
})

const filteredClassList = computed(() => {
  return classList.value.filter(c => {
    if (filterCollege.value && c.collegeName !== filterCollege.value) return false
    if (filterMajor.value && c.majorName !== filterMajor.value) return false
    if (filterGrade.value && c.grade !== filterGrade.value) return false
    if (filterTrainingLevel.value && c.trainingLevelName !== filterTrainingLevel.value) return false
    return true
  })
})

// 自动排课状态
const arranging = ref(false)

// 教师选择弹窗
const teacherDialogVisible = ref(false)
const currentClass = ref(null)
const selectedTeacher = ref(null)
const assigning = ref(false)
const savingSettings = ref(false)
const exporting = ref(false)

function personnelLabel(type) {
  return { full_time: '专职', part_time: '兼职', external: '外聘' }[type] || type
}

function courseTypeLabel(type) {
  return { public: '公共课', professional: '专业课', elective: '选修课' }[type] || type
}

function tableRowClassName({ row }) {
  return row.assignment ? '' : 'unassigned-row'
}

async function loadHourSettings(courseId) {
  // 先重置为默认值
  Object.assign(hourSettings, JSON.parse(JSON.stringify(defaultHourSettings)))
  if (!courseId) return
  try {
    const res = await getHourSettings({ course_id: courseId })
    if (res.data) {
      Object.assign(hourSettings, res.data)
    }
  } catch (e) {
    console.error('加载课时设置失败:', e)
  }
}

async function handleSaveHourSettings() {
  savingSettings.value = true
  try {
    await saveHourSettings({
      course_id: selectedCourseId.value,
      hour_settings: hourSettings,
    })
    ElMessage.success('课时要求已保存')
  } catch (e) {
    ElMessage.error('保存失败')
    console.error('保存课时设置失败:', e)
  } finally {
    savingSettings.value = false
  }
}

async function loadSemester() {
  try {
    const res = await request.get('/settings')
    const settings = res.data || {}
    if (settings.currentSemester) {
      currentSemesterLabel.value = settings.currentSemester.value
    }
  } catch (e) {
    console.error('获取学期失败:', e)
  }
}

async function loadCourses() {
  try {
    const res = await getCourses()
    allCourses.value = res.data || []
  } catch (e) {
    console.error('加载课程列表失败:', e)
  }
}

async function onCourseChange(courseId) {
  // 重置筛选器
  filterCollege.value = ''
  filterMajor.value = ''
  filterGrade.value = ''
  filterTrainingLevel.value = ''
  if (!courseId) {
    classList.value = []
    teacherList.value = []
    courseInfo.value = null
    loadHourSettings(null)
    return
  }
  courseInfo.value = allCourses.value.find(c => c.id === courseId) || null
  loadHourSettings(courseId)
  await loadData()
}

async function loadData() {
  if (!selectedCourseId.value || !currentSemesterLabel.value) return
  tableLoading.value = true
  try {
    const [classesRes, teachersRes] = await Promise.all([
      getCourseClasses({ course_id: selectedCourseId.value, semester: currentSemesterLabel.value }),
      getCourseTeachers({ course_id: selectedCourseId.value, semester: currentSemesterLabel.value }),
    ])
    const classData = classesRes.data || {}
    classList.value = classData.classes || []
    summary.value = classData.summary || { totalClasses: 0, assignedCount: 0, unassignedCount: 0, totalCourseHours: 0, assignedHours: 0, remainingHours: 0 }
    teacherList.value = teachersRes.data || []
  } catch (e) {
    ElMessage.error('加载数据失败')
    console.error('加载数据失败:', e)
  } finally {
    tableLoading.value = false
  }
}

function openTeacherSelect(row) {
  currentClass.value = row
  selectedTeacher.value = null
  teacherDialogVisible.value = true
}

function onTeacherSelect(teacher) {
  selectedTeacher.value = teacher
}

async function confirmTeacherSelect() {
  if (!selectedTeacher.value || !currentClass.value) return
  assigning.value = true
  try {
    await assignTeacher({
      classId: currentClass.value.classId,
      courseId: selectedCourseId.value,
      semester: currentSemesterLabel.value,
      teacherId: selectedTeacher.value.id,
      weeklyHours: currentClass.value.weeklyHours,
    })
    ElMessage.success('安排成功')
    teacherDialogVisible.value = false
    await loadData()
  } catch (e) {
    ElMessage.error('安排失败')
  } finally {
    assigning.value = false
  }
}

async function handleRemoveAssignment(row) {
  if (!row.assignment?.id) return
  try {
    await deleteAssignment(row.assignment.id)
    ElMessage.success('已移除安排')
    await loadData()
  } catch (e) {
    ElMessage.error('操作失败')
  }
}

async function handleAutoArrange(mode) {
  arranging.value = true
  try {
    const res = await runAutoArrange({
      courseId: selectedCourseId.value,
      semester: currentSemesterLabel.value,
      mode,
      hourSettings,
      scheduleConditions: scheduleConditions.value,
    })
    const data = res.data || {}
    ElMessage.success(res.message || `自动排课完成：安排${data.autoCount || 0}个班级`)
    await loadData()
  } catch (e) {
    ElMessage.error('自动排课失败')
    console.error('自动排课失败:', e)
  } finally {
    arranging.value = false
  }
}

async function handleReset() {
  try {
    const res = await resetAutoAssignments({
      courseId: selectedCourseId.value,
      semester: currentSemesterLabel.value,
    })
    ElMessage.success(res.message || '已重置')
    await loadData()
  } catch (e) {
    ElMessage.error('重置失败')
  }
}

async function handleExportArrange() {
  if (!selectedCourseId.value || !currentSemesterLabel.value) return
  exporting.value = true
  try {
    const response = await request.get('/export/teaching-arrange', {
      params: { course_id: selectedCourseId.value, semester: currentSemesterLabel.value },
      responseType: 'blob',
    })
    const blob = new Blob([response], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `教学安排_${courseInfo.value?.name || ''}_${currentSemesterLabel.value}.xlsx`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
    ElMessage.success('导出成功')
  } catch (e) {
    console.error('导出失败:', e)
    ElMessage.error('导出失败')
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  loadSemester()
  loadCourses()
})
</script>

<style scoped>
.settings-card {
  margin-bottom: 16px;
}
.hour-settings {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding-top: 4px;
}
.hour-settings-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  white-space: nowrap;
}
.hour-setting-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: #f5f7fa;
  border-radius: 4px;
}
.type-label {
  font-weight: bold;
  font-size: 13px;
  color: #303133;
}
.setting-field {
  display: flex;
  align-items: center;
  gap: 4px;
}
.field-label {
  font-size: 12px;
  color: #606266;
}
.preview-card {
  margin-bottom: 16px;
}
.preview-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.course-name {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}
.preview-stats {
  display: flex;
  flex-wrap: wrap;
}
.preview-stat-item {
  flex: 1 1 0;
  min-width: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}
.stat-label {
  font-size: 12px;
  color: #909399;
}
.stat-value {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}
.stat-value small {
  font-size: 12px;
  font-weight: normal;
  color: #909399;
  margin-left: 2px;
}
.text-success {
  color: #67C23A;
}
.text-danger {
  color: #F56C6C;
}
.matrix-card {
  margin-bottom: 16px;
}
.card-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.card-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.teacher-cell {
  cursor: pointer;
  min-height: 32px;
  display: flex;
  align-items: center;
}
.text-placeholder {
  color: #c0c4cc;
  font-size: 12px;
}
.text-warning {
  color: #E6A23C;
  font-weight: bold;
}
.tag-item {
  margin: 2px;
}
:deep(.unassigned-row) {
  background-color: #fff5f5 !important;
}
.adaptive-table :deep(.el-table__header th .cell) {
  white-space: nowrap;
}
.adaptive-table :deep(.el-table__body td .cell) {
  white-space: nowrap;
}
</style>

<style>
.teacher-dialog .el-dialog__body {
  overflow-x: hidden;
}
</style>