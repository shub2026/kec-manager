<template>
  <div class="teacher-list">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>教师信息</span>
          <div class="card-header-actions">
            <el-input v-model="filterName" placeholder="搜索姓名" clearable class="filter-item" />
            <el-select v-model="filterPersonnelType" placeholder="人员类别" clearable class="filter-item">
              <el-option label="专职" value="full_time" />
              <el-option label="兼职" value="part_time" />
              <el-option label="外聘" value="external" />
            </el-select>
            <el-select v-model="filterCourseId" placeholder="学科" clearable filterable class="filter-item">
              <el-option v-for="c in allCourses" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
            <el-select v-model="filterCollegeId" placeholder="任课学院" clearable filterable class="filter-item">
              <el-option v-for="c in allColleges" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
            <el-select v-model="filterTrainingLevelId" placeholder="任课层次" clearable filterable class="filter-item">
              <el-option v-for="l in allTrainingLevels" :key="l.id" :label="l.name" :value="l.id" />
            </el-select>
            <el-select v-model="filterAffiliatedCollegeId" placeholder="归属学院" clearable filterable class="filter-item">
              <el-option v-for="c in allColleges" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
            <el-select v-model="filterStatus" placeholder="状态" clearable class="filter-item">
              <el-option label="启用" value="active" />
              <el-option label="禁用" value="disabled" />
            </el-select>
            <div class="action-buttons">
              <el-button @click="exportData">数据导出</el-button>
              <el-button @click="downloadTemplate">下载模板</el-button>
              <el-upload
                :show-file-list="false"
                accept=".xlsx,.xls"
                action="/api/import/teachers"
                name="file"
                :headers="uploadHeaders"
                :on-success="onImportSuccess"
                :on-error="onImportError"
                :before-upload="beforeImport"
              >
                <el-button>导入Excel</el-button>
              </el-upload>
              <el-button type="primary" @click="openDialog()">
                <el-icon><Plus /></el-icon> 新增教师
              </el-button>
              <el-button @click="batchDialogVisible = true">
                <el-icon><Edit /></el-icon> 批量修改周课时
              </el-button>
            </div>
          </div>
        </div>
      </template>

      <el-table :data="filteredlist" stripe v-loading="loading" row-key="id">
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="name" label="姓名" width="100">
          <template #default="{ row }">
            <span :style="row.status === 'disabled' ? 'color: #999; text-decoration: line-through' : ''">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="性别" width="70" align="center">
          <template #default="{ row }">{{ row.gender === 'male' ? '男' : row.gender === 'female' ? '女' : '-' }}</template>
        </el-table-column>
        <el-table-column label="出生年月" width="100" align="center">
          <template #default="{ row }">{{ formatBirthDate(row.birthDate) }}</template>
        </el-table-column>
        <el-table-column label="年龄" width="70" align="center">
          <template #default="{ row }">{{ calcAge(row.birthDate) }}</template>
        </el-table-column>
        <el-table-column prop="qualificationType" label="教师资格类型" min-width="120">
          <template #default="{ row }">{{ row.qualificationType || '-' }}</template>
        </el-table-column>
        <el-table-column label="归属学院" min-width="120">
          <template #default="{ row }">
            <span>{{ row.affiliatedCollege?.name || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="人员类别" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="personnelTagType(row.personnelType)" size="small">
              {{ personnelLabel(row.personnelType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="学科" min-width="160">
          <template #default="{ row }">
            <el-tag v-for="c in row.courseList" :key="c.id" size="small" class="tag-item">{{ c.name }}</el-tag>
            <span v-if="!row.courseList?.length" class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="任课学院" min-width="140">
          <template #default="{ row }">
            <el-tag v-for="c in row.collegeList" :key="c.id" size="small" type="info" class="tag-item">{{ c.name }}</el-tag>
            <span v-if="!row.collegeList?.length" class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="任课层次" min-width="120">
          <template #default="{ row }">
            <el-tag v-for="l in row.trainingLevelList" :key="l.id" size="small" type="warning" class="tag-item">{{ l.name }}</el-tag>
            <span v-if="!row.trainingLevelList?.length" class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="特定周课时" width="100" align="center">
          <template #default="{ row }">
            <span>{{ row.defaultWeeklyHours != null ? row.defaultWeeklyHours : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.status !== 'disabled'"
              @change="(val) => handleToggleStatus(row, val)"
              inline-prompt
              active-text="启"
              inactive-text="禁"
              size="small"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right" align="center">
          <template #default="{ row }">
            <el-button size="small" :icon="Edit" circle @click="openDialog(row)" />
            <el-popconfirm title="确定删除该教师？" @confirm="handleDelete(row.id)">
              <template #reference>
                <el-button size="small" type="danger" :icon="Delete" circle />
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新增/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑教师' : '新增教师'" width="600px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="教师姓名" required>
          <el-input v-model="form.name" placeholder="请输入教师姓名" />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="性别">
              <el-select v-model="form.gender" placeholder="请选择" clearable style="width: 100%">
                <el-option label="男" value="male" />
                <el-option label="女" value="female" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="出生年月">
              <el-date-picker v-model="form.birthDate" type="month" placeholder="选择年月" value-format="YYYY-MM" :clearable="true" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="归属学院">
              <el-select v-model="form.affiliatedCollegeId" placeholder="选择归属学院" clearable filterable style="width: 100%">
                <el-option v-for="c in allColleges" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="人员类别">
              <el-select v-model="form.personnelType" placeholder="请选择" style="width: 100%">
                <el-option label="专职" value="full_time" />
                <el-option label="兼职" value="part_time" />
                <el-option label="外聘" value="external" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="状态">
              <el-select v-model="form.status" style="width: 100%">
                <el-option label="启用" value="active" />
                <el-option label="禁用" value="disabled" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="教师资格类型">
          <el-input v-model="form.qualificationType" placeholder="如：高中语文" clearable />
        </el-form-item>
        <el-form-item label="学科（课程）">
          <el-select v-model="form.courseIds" multiple filterable placeholder="选择可教授的课程" style="width: 100%">
            <el-option v-for="c in allCourses" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="任课学院">
          <el-select v-model="form.collegeIds" multiple filterable placeholder="选择优先指定学院" style="width: 100%">
            <el-option v-for="c in availableColleges" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="任课层次">
          <el-select v-model="form.trainingLevelIds" multiple filterable placeholder="选择优先指定层次" style="width: 100%">
            <el-option v-for="l in availableTrainingLevels" :key="l.id" :label="l.name" :value="l.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="特定周课时">
          <el-input-number v-model="form.defaultWeeklyHours" :min="0" :max="40" :step="1" placeholder="不填使用课时要求" controls-position="right" style="width: 200px" />
          <span class="form-tip">不填则使用课时要求的标准周课时</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批量修改特定周课时弹窗 -->
    <el-dialog v-model="batchDialogVisible" title="批量修改特定周课时" width="500px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="选择教师">
          <el-select v-model="batchTeacherIds" multiple filterable placeholder="选择要修改的教师" style="width: 100%">
            <el-option v-for="t in list" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="特定周课时">
          <el-input-number v-model="batchHours" :min="0" :max="40" :step="1" :precision="1" controls-position="right" style="width: 200px" />
          <span class="form-tip">设为空值可清除特定周课时</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleBatchUpdate" :loading="batchSaving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { Plus, Edit, Delete } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getCookie } from '@/utils/cookies'
import { getTeachers, createTeacher, updateTeacher, deleteTeacher, batchUpdateDefaultHours, toggleTeacherStatus } from '../../api/teacher'
import { getColleges, getCollegeLevelMapping } from '../../api/college'
import { getTrainingLevels } from '../../api/trainingLevel'
import { getCourses } from '../../api/course'
import { useExport } from '../../composables/useExport'
import request from '../../utils/request'

const list = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const saving = ref(false)
const allCourses = ref([])
const allColleges = ref([])
const allTrainingLevels = ref([])
const collegeLevelMapping = ref({ collegeToLevels: {}, levelToColleges: {} })

const uploadHeaders = computed(() => {
  const token = getCookie('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
})

const { exportData, downloadTemplate } = useExport('teachers', '教师数据')

// 导入相关状态
const pendingFile = ref(null)

// 筛选器状态
const filterName = ref('')
const filterCourseId = ref('')
const filterPersonnelType = ref('')
const filterCollegeId = ref('')
const filterTrainingLevelId = ref('')
const filterAffiliatedCollegeId = ref('')
const filterStatus = ref('')

// 客户端筛选
const filteredlist = computed(() => {
  let result = list.value
  if (filterName.value) {
    const keyword = filterName.value.toLowerCase()
    result = result.filter(t => t.name && t.name.toLowerCase().includes(keyword))
  }
  if (filterCourseId.value) {
    const cid = Number(filterCourseId.value)
    result = result.filter(t => t.courseList?.some(c => c.id === cid))
  }
  if (filterPersonnelType.value) {
    result = result.filter(t => t.personnelType === filterPersonnelType.value)
  }
  if (filterCollegeId.value) {
    const cid = Number(filterCollegeId.value)
    result = result.filter(t => t.collegeList?.some(c => c.id === cid))
  }
  if (filterTrainingLevelId.value) {
    const lid = Number(filterTrainingLevelId.value)
    result = result.filter(t => t.trainingLevelList?.some(l => l.id === lid))
  }
  if (filterAffiliatedCollegeId.value) {
    const cid = Number(filterAffiliatedCollegeId.value)
    result = result.filter(t => t.affiliatedCollege?.id === cid)
  }
  if (filterStatus.value) {
    result = result.filter(t => (t.status || 'active') === filterStatus.value)
  }
  return result
})

const defaultForm = {
  id: null,
  name: '',
  gender: null,
  birthDate: null,
  personnelType: 'full_time',
  qualificationType: null,
  affiliatedCollegeId: null,
  defaultWeeklyHours: null,
  status: 'active',
  courseIds: [],
  collegeIds: [],
  trainingLevelIds: [],
}
const form = ref({ ...defaultForm })

// 任课学院/任课层次双向联动筛选
const availableColleges = computed(() => {
  const selectedLevelIds = form.value.trainingLevelIds || []
  if (!selectedLevelIds.length) return allColleges.value
  const mapping = collegeLevelMapping.value.levelToColleges
  const allowedIds = new Set()
  for (const lid of selectedLevelIds) {
    const cids = mapping[lid] || []
    cids.forEach(id => allowedIds.add(id))
  }
  return allColleges.value.filter(c => allowedIds.has(c.id))
})

const availableTrainingLevels = computed(() => {
  const selectedCollegeIds = form.value.collegeIds || []
  if (!selectedCollegeIds.length) return allTrainingLevels.value
  const mapping = collegeLevelMapping.value.collegeToLevels
  const allowedIds = new Set()
  for (const cid of selectedCollegeIds) {
    const lids = mapping[cid] || []
    lids.forEach(id => allowedIds.add(id))
  }
  return allTrainingLevels.value.filter(l => allowedIds.has(l.id))
})

// 批量修改相关
const batchDialogVisible = ref(false)
const batchTeacherIds = ref([])
const batchHours = ref(null)
const batchSaving = ref(false)

function personnelLabel(type) {
  return { full_time: '专职', part_time: '兼职', external: '外聘' }[type] || type
}

function personnelTagType(type) {
  return { full_time: 'success', part_time: 'warning', external: 'info' }[type] || ''
}

function formatBirthDate(birthDate) {
  if (!birthDate) return '-'
  // 只显示到月份: "YYYY-MM" 或截取前7位
  const str = String(birthDate)
  if (str.length >= 7) return str.substring(0, 7)
  return str
}

function calcAge(birthDate) {
  if (!birthDate) return '-'
  const str = String(birthDate)
  // 支持 "YYYY-MM" 或 "YYYY-MM-DD"
  const parts = str.split('-')
  if (parts.length < 2) return '-'
  const birthYear = parseInt(parts[0], 10)
  const birthMonth = parseInt(parts[1], 10) - 1 // 0-indexed
  if (isNaN(birthYear) || isNaN(birthMonth)) return '-'
  const now = new Date()
  let age = now.getFullYear() - birthYear
  const m = now.getMonth() - birthMonth
  if (m < 0) age--
  return age > 0 ? age : '-'
}

async function load() {
  loading.value = true
  try {
    const res = await getTeachers()
    list.value = res.data || []
  } finally {
    loading.value = false
  }
}

async function loadOptions() {
  try {
    const [coursesRes, collegesRes, levelsRes, mappingRes] = await Promise.all([
      getCourses(), getColleges(), getTrainingLevels(), getCollegeLevelMapping()
    ])
    allCourses.value = coursesRes.data || []
    allColleges.value = collegesRes.data || []
    allTrainingLevels.value = levelsRes.data || []
    collegeLevelMapping.value = mappingRes.data || { collegeToLevels: {}, levelToColleges: {} }
  } catch (e) {
    console.error('加载选项失败:', e)
  }
}

function openDialog(row) {
  if (row) {
    form.value = {
      ...row,
      birthDate: row.birthDate ? String(row.birthDate).substring(0, 7) : null,
      affiliatedCollegeId: row.affiliatedCollege?.id || null,
      courseIds: row.courseList?.map(c => c.id) || [],
      collegeIds: row.collegeList?.map(c => c.id) || [],
      trainingLevelIds: row.trainingLevelList?.map(l => l.id) || [],
    }
  } else {
    form.value = { ...defaultForm }
  }
  dialogVisible.value = true
}

async function handleSave() {
  if (!form.value.name) return ElMessage.warning('请输入教师姓名')
  saving.value = true
  try {
    const data = {
      name: form.value.name,
      gender: form.value.gender,
      birthDate: form.value.birthDate,
      personnelType: form.value.personnelType,
      qualificationType: form.value.qualificationType,
      affiliatedCollegeId: form.value.affiliatedCollegeId,
      defaultWeeklyHours: form.value.defaultWeeklyHours,
      status: form.value.status || 'active',
      courseIds: form.value.courseIds,
      collegeIds: form.value.collegeIds,
      trainingLevelIds: form.value.trainingLevelIds,
    }
    if (form.value.id) {
      await updateTeacher(form.value.id, data)
    } else {
      await createTeacher(data)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function handleDelete(id) {
  try {
    await deleteTeacher(id)
    ElMessage.success('删除成功')
    await load()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '删除失败')
  }
}

async function handleToggleStatus(row, val) {
  const newStatus = val ? 'active' : 'disabled'
  try {
    await toggleTeacherStatus(row.id, newStatus)
    ElMessage.success(val ? '已启用' : '已禁用')
    await load()
  } catch (e) {
    ElMessage.error('状态切换失败')
  }
}

async function handleBatchUpdate() {
  if (!batchTeacherIds.value.length) return ElMessage.warning('请选择教师')
  batchSaving.value = true
  try {
    await batchUpdateDefaultHours({
      teacherIds: batchTeacherIds.value,
      defaultWeeklyHours: batchHours.value,
    })
    ElMessage.success('批量修改成功')
    batchDialogVisible.value = false
    batchTeacherIds.value = []
    batchHours.value = null
    await load()
  } finally {
    batchSaving.value = false
  }
}

// 导入前拦截，显示确认提示
async function beforeImport(file) {
  const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')
  if (!isExcel) {
    ElMessage.error('请上传Excel文件')
    return false
  }

  pendingFile.value = file

  try {
    await ElMessageBox.confirm(
      '导入将以教师姓名进行匹配，已存在的教师将被覆盖更新，确定继续导入吗？',
      '导入确认',
      {
        confirmButtonText: '确定导入',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    confirmImport()
  } catch {
    pendingFile.value = null
  }

  return false
}

async function confirmImport() {
  try {
    const formData = new FormData()
    formData.append('file', pendingFile.value)

    const response = await request.post('/import/teachers', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })

    onImportSuccess(response)
  } catch (err) {
    onImportError(err)
  } finally {
    pendingFile.value = null
  }
}

function onImportSuccess(res) {
  const data = res.data || {}
  const message = res.message || '导入完成'

  let detailMsg = message

  if (data.errors && data.errors.length > 0) {
    detailMsg += '\n\n❌ 失败详情：'
    data.errors.forEach((error, index) => {
      detailMsg += `\n${index + 1}. ${error}`
    })
  }

  if (data.failed && data.failed > 0) {
    ElMessage({ message: detailMsg, type: 'warning', duration: 10000, showClose: true })
  } else if (data.imported > 0 || data.overwritten > 0) {
    ElMessage({ message: detailMsg, type: 'success', duration: 8000, showClose: true })
  } else {
    ElMessage({ message: detailMsg, type: 'info', duration: 6000, showClose: true })
  }
  load()
}

function onImportError(err) {
  console.error('导入错误:', err)
  ElMessage.error('导入失败，请检查文件格式或联系管理员')
}

onMounted(() => {
  load()
  loadOptions()
})
</script>

<style scoped>
.teacher-list :deep(.card-header-actions) {
  flex-wrap: nowrap;
}
.filter-item {
  flex: 1 1 120px;
  min-width: 90px;
}
.filter-item :deep(.el-input),
.filter-item :deep(.el-select) {
  width: 100% !important;
}
.action-buttons {
  display: flex;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}
.tag-item {
  margin: 2px;
}
.text-muted {
  color: #999;
}
.form-tip {
  margin-left: 8px;
  color: #999;
  font-size: 12px;
}
</style>
