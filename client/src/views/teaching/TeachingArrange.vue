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
              <el-checkbox value="same_college">同学院</el-checkbox>
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

    <!-- 预览区 -->
    <el-card v-if="selectedCourseId && courseInfo" class="preview-card">
      <el-descriptions :column="4" size="small" border>
        <el-descriptions-item label="课程名称">{{ courseInfo.name }}</el-descriptions-item>
        <el-descriptions-item label="课程类型">{{ courseTypeLabel(courseInfo.type) }}</el-descriptions-item>
        <el-descriptions-item label="班级数量">{{ summary.totalClasses }} 个</el-descriptions-item>
        <el-descriptions-item label="教师数量">{{ teacherList.length }} 人</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- 内容区：矩阵表 -->
    <el-card v-if="selectedCourseId" class="matrix-card">
      <template #header>
        <div class="card-header">
          <span>教学安排</span>
          <div class="card-header-actions">
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

      <el-table :data="classList" stripe v-loading="tableLoading" row-key="classId" :row-class-name="tableRowClassName">
        <el-table-column type="index" label="#" width="50" />
        <el-table-column prop="className" label="班级名称" min-width="120" />
        <el-table-column prop="collegeName" label="学院" width="120" show-overflow-tooltip />
        <el-table-column prop="majorName" label="专业" width="120" show-overflow-tooltip />
        <el-table-column label="年级" width="70">
          <template #default="{ row }">{{ row.grade }}</template>
        </el-table-column>
        <el-table-column prop="trainingLevelName" label="层次" width="80" />
        <el-table-column label="周课时" width="80" align="center">
          <template #default="{ row }">{{ row.weeklyHours }}</template>
        </el-table-column>
        <el-table-column label="任课教师" min-width="160">
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
        <el-table-column label="设置" width="80" align="center">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openTeacherSelect(row)">
              <el-icon><Edit /></el-icon>
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 底部报告区 -->
    <el-card v-if="selectedCourseId && classList.length" class="report-card">
      <el-row :gutter="20">
        <el-col :span="6">
          <el-statistic title="总班级数" :value="summary.totalClasses" />
        </el-col>
        <el-col :span="6">
          <el-statistic title="已安排" :value="summary.assignedCount" />
        </el-col>
        <el-col :span="6">
          <el-statistic title="总课时" :value="summary.totalCourseHours" suffix="课时" />
        </el-col>
        <el-col :span="6">
          <el-statistic title="剩余课时" :value="summary.remainingHours" suffix="课时"
            :value-style="{ color: summary.remainingHours >= 0 ? '#67C23A' : '#F56C6C' }"
          />
        </el-col>
      </el-row>
    </el-card>

    <!-- 教师选择弹窗 -->
    <el-dialog v-model="teacherDialogVisible" title="选择任课教师" width="600px" destroy-on-close>
      <el-table :data="teacherList" stripe highlight-current-row @current-change="onTeacherSelect" size="small">
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column label="人员类别" width="90">
          <template #default="{ row }">{{ personnelLabel(row.personnelType) }}</template>
        </el-table-column>
        <el-table-column label="当前总课时" width="100" align="center">
          <template #default="{ row }">
            <span :class="{ 'text-warning': row.totalWeeklyHours > (hourSettings[row.personnelType || 'full_time']?.standard || 16) }">
              {{ row.totalWeeklyHours }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="班级数" width="70" align="center">
          <template #default="{ row }">{{ row.totalClassCount }}</template>
        </el-table-column>
        <el-table-column label="学科" min-width="120">
          <template #default="{ row }">
            <el-tag v-for="c in row.courseList" :key="c.id" size="small" class="tag-item">{{ c.name }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="上课学院" min-width="120">
          <template #default="{ row }">
            <el-tag v-for="c in row.collegeList" :key="c.id" size="small" type="info" class="tag-item">{{ c.name }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="默认周课时" width="100" align="center">
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

// 自动排课状态
const arranging = ref(false)

// 教师选择弹窗
const teacherDialogVisible = ref(false)
const currentClass = ref(null)
const selectedTeacher = ref(null)
const assigning = ref(false)
const savingSettings = ref(false)

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
    const { default: request } = await import('../../utils/request')
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
.matrix-card {
  margin-bottom: 16px;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
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
.report-card {
  margin-bottom: 16px;
}
:deep(.unassigned-row) {
  background-color: #fff5f5 !important;
}
</style>
