<template>
  <div class="teaching-statistics">
    <el-card>
      <template #header>
        <div class="card-header">
          <span><el-icon><DataAnalysis /></el-icon> 课时统计</span>
          <div class="card-header-actions">
            <el-tag type="info">{{ semester }}</el-tag>
            <el-select v-model="filterType" placeholder="类别" clearable style="width: 100px">
              <el-option label="专职" value="full_time" />
              <el-option label="兼职" value="part_time" />
              <el-option label="外聘" value="external" />
            </el-select>
            <el-select v-model="filterSubject" placeholder="科目" clearable filterable style="width: 140px">
              <el-option v-for="v in subjectOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-select v-model="filterAffiliatedCollege" placeholder="归属学院" clearable filterable style="width: 130px">
              <el-option v-for="v in affiliatedCollegeOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-select v-model="filterLevel" placeholder="任课层次" clearable filterable style="width: 110px">
              <el-option v-for="v in levelOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-select v-model="filterCollege" placeholder="任课学院" clearable filterable style="width: 120px">
              <el-option v-for="v in collegeOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-button @click="handleExport" :loading="exporting" :disabled="!statsData">数据导出</el-button>
          </div>
        </div>
      </template>

      <!-- 汇总统计 -->
      <div v-if="statsData" class="summary-section">
        <el-row :gutter="20">
          <el-col :span="8">
            <el-statistic title="参与教师" :value="filteredSummary.totalTeachers" suffix="人" />
          </el-col>
          <el-col :span="8">
            <el-statistic title="总周课时" :value="filteredSummary.totalWeeklyHours" suffix="课时" />
          </el-col>
          <el-col :span="8">
            <el-statistic title="总安排班级数" :value="filteredSummary.totalClasses" suffix="个" />
          </el-col>
        </el-row>
        <el-divider />
      </div>

      <!-- 空状态 -->
      <el-empty v-if="!loading && !statsData" description="暂无课时统计数据" />
      <el-empty v-else-if="!loading && statsData && filteredTeachers.length === 0" description="没有符合条件的教师" />

      <!-- 教师课时统计表 -->
      <div v-if="filteredTeachers.length > 0">
        <el-table :data="filteredTeachers" stripe v-loading="loading" row-key="teacherId" style="width: 100%">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="expand-content">
              <div v-for="detail in row.details" :key="detail.course.id" class="course-detail">
                <h4>{{ detail.course.name }}（周课时：{{ detail.weeklyHours }}）</h4>
                <el-table :data="detail.classes" size="small" border style="margin: 8px 0">
                  <el-table-column prop="className" label="班级" min-width="150" />
                  <el-table-column prop="weeklyHours" label="周课时" width="80" align="center" />
                  <el-table-column label="安排方式" width="100" align="center">
                    <template #default="{ row: cls }">
                      <el-tag :type="cls.isAuto ? 'info' : 'primary'" size="small">
                        {{ cls.isAuto ? '自动' : '手动' }}
                      </el-tag>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column type="index" label="#" width="50" />
        <el-table-column prop="teacherName" label="姓名" width="80" />
        <el-table-column label="人员类别" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="personnelTagType(row.personnelType)" size="small">
              {{ personnelLabel(row.personnelType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="任教科目" min-width="115">
          <template #default="{ row }">
            <el-tag v-for="d in row.details" :key="d.course.id" size="small" class="tag-item">{{ d.course.name }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="归属学院" min-width="80">
          <template #default="{ row }">
            <span>{{ row.affiliatedCollege?.name || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="任课层次" min-width="90">
          <template #default="{ row }">
            <el-tag v-for="l in row.trainingLevelList" :key="l.id" size="small" type="warning" class="tag-item">{{ l.name }}</el-tag>
            <span v-if="!row.trainingLevelList?.length" class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="任课学院" min-width="180">
          <template #default="{ row }">
            <el-tag v-for="c in row.collegeList" :key="c.id" size="small" type="info" class="tag-item">{{ c.name }}</el-tag>
            <span v-if="!row.collegeList?.length" class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="班级数" width="70" align="center">
          <template #default="{ row }">{{ row.totalClassCount }}</template>
        </el-table-column>
        <el-table-column label="总周课时" width="120" align="center" sortable :sort-method="(a, b) => a.totalWeeklyHours - b.totalWeeklyHours">
          <template #default="{ row }">
            <span class="hours-value">{{ row.totalWeeklyHours }}</span>
          </template>
        </el-table-column>
      </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getTeachingStatistics } from '../../api/teachingArrange'
import request from '../../utils/request'
import { downloadBlob } from '../../utils/download'
import { personnelLabel, personnelTagType } from '../../utils/personnel'

const semester = ref('')
const statsData = ref(null)
const loading = ref(false)
const exporting = ref(false)

// 筛选器
const filterType = ref('')
const filterSubject = ref('')
const filterCollege = ref('')
const filterLevel = ref('')
const filterAffiliatedCollege = ref('')

const teacherList = computed(() => statsData.value?.teachers || [])

const subjectOptions = computed(() => {
  const set = new Set()
  for (const t of teacherList.value) {
    for (const d of (t.details || [])) {
      if (d.course?.name) set.add(d.course.name)
    }
  }
  return [...set].sort()
})

const collegeOptions = computed(() => {
  const set = new Set()
  for (const t of teacherList.value) {
    for (const c of (t.collegeList || [])) {
      if (c.name) set.add(c.name)
    }
  }
  return [...set].sort()
})

const levelOptions = computed(() => {
  const set = new Set()
  for (const t of teacherList.value) {
    for (const l of (t.trainingLevelList || [])) {
      if (l.name) set.add(l.name)
    }
  }
  return [...set].sort()
})

const affiliatedCollegeOptions = computed(() => {
  const set = new Set()
  for (const t of teacherList.value) {
    if (t.affiliatedCollege?.name) set.add(t.affiliatedCollege.name)
  }
  return [...set].sort()
})

const filteredTeachers = computed(() => {
  return teacherList.value.filter(t => {
    if (filterType.value && t.personnelType !== filterType.value) return false
    if (filterSubject.value) {
      const hasSubject = (t.details || []).some(d => d.course?.name === filterSubject.value)
      if (!hasSubject) return false
    }
    if (filterCollege.value) {
      const hasCollege = (t.collegeList || []).some(c => c.name === filterCollege.value)
      if (!hasCollege) return false
    }
    if (filterLevel.value) {
      const hasLevel = (t.trainingLevelList || []).some(l => l.name === filterLevel.value)
      if (!hasLevel) return false
    }
    if (filterAffiliatedCollege.value) {
      if (t.affiliatedCollege?.name !== filterAffiliatedCollege.value) return false
    }
    return true
  })
})

const filteredSummary = computed(() => {
  const list = filteredTeachers.value
  return {
    totalTeachers: list.length,
    totalWeeklyHours: list.reduce((sum, t) => sum + t.totalWeeklyHours, 0),
    totalClasses: list.reduce((sum, t) => sum + t.totalClassCount, 0),
  }
})

async function loadSemester() {
  try {
    const res = await request.get('/settings')
    const settings = res.data || {}
    if (settings.currentSemester) {
      semester.value = settings.currentSemester.value
    }
  } catch (e) {
    if (import.meta.env.DEV) { console.error('获取学期失败:', e) }
  }
}

async function loadStats() {
  if (!semester.value) return
  loading.value = true
  try {
    const res = await getTeachingStatistics({ semester: semester.value })
    statsData.value = res.data || null
  } catch (e) {
    ElMessage.error('加载统计数据失败')
    if (import.meta.env.DEV) { console.error('加载统计数据失败:', e) }
  } finally {
    loading.value = false
  }
}

async function handleExport() {
  if (!semester.value) return ElMessage.warning('请先设置当前学期')
  exporting.value = true
  try {
    const response = await request.get('/export/statistics', {
      params: { semester: semester.value },
      responseType: 'blob',
    })
    downloadBlob(response, `课时统计_${semester.value}.xlsx`)
    ElMessage.success('导出成功')
  } catch (error) {
    if (import.meta.env.DEV) { console.error('导出失败:', error) }
    ElMessage.error('导出失败')
  } finally {
    exporting.value = false
  }
}

onMounted(async () => {
  await loadSemester()
  await loadStats()
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
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.summary-section {
  margin-bottom: 8px;
}
.expand-content {
  padding: 12px 24px;
}
.course-detail h4 {
  margin: 8px 0 4px;
  font-size: 14px;
  color: #303133;
}
.tag-item {
  margin: 2px;
}
.text-muted {
  color: #999;
}
.hours-value {
  font-weight: bold;
  font-size: 16px;
}
</style>
