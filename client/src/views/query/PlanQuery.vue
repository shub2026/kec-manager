<template>
  <div>
    <el-card>
      <template #header>
        <div class="card-header">
          <span>培养方案查询</span>
          <div class="card-header-actions">
            <el-select
              v-model="selectedPlanId"
              placeholder="请选择培养方案"
              @change="handlePlanChange"
              clearable
              class="filter-select"
            >
              <el-option
                v-for="plan in plans"
                :key="plan.id"
                :label="getPlanLabel(plan)"
                :value="plan.id"
              />
            </el-select>
          </div>
        </div>
      </template>

      <!-- 矩阵表展示 -->
      <div v-if="selectedPlanId && planCourses.length > 0" class="matrix-container">
        <div class="matrix-scroll" v-loading="loading">
          <table class="matrix-table">
            <thead>
              <tr>
                <th class="matrix-fixed-col matrix-course-header">课程名称</th>
                <th
                  v-for="s in maxSemester"
                  :key="s"
                  class="matrix-semester-header"
                >
                  第{{ s }}学期
                </th>
                <th class="matrix-total-header">总课时</th>
              </tr>
            </thead>
            <tbody v-for="group in groups" :key="group.type">
              <!-- 分组标题行 -->
              <tr class="matrix-group-row">
                <td :colspan="maxSemester + 2" class="matrix-group-cell" :class="group.type">
                  <span class="group-label">{{ group.label }}</span>
                  <span class="group-count">{{ group.courses.length }} 门</span>
                </td>
              </tr>
              <!-- 课程行 -->
              <tr
                v-for="course in group.courses"
                :key="course.id"
                class="matrix-course-row"
              >
                <td class="matrix-fixed-col matrix-course-name">
                  <span class="course-name-text">{{ course.courseName }}</span>
                  <el-tag
                    size="small"
                    :type="group.type === 'public' ? 'success' : 'warning'"
                    class="course-type-tag"
                  >
                    {{ group.type === 'public' ? '公共' : '专业' }}
                  </el-tag>
                </td>
                <!-- 学期单元格 -->
                <td
                  v-for="s in maxSemester"
                  :key="s"
                  class="matrix-cell"
                  :class="cellClass(course, s)"
                >
                  <template v-if="isInRange(course, s)">
                    <div class="cell-hours">
                      {{ getHours(course, s) !== null ? getHours(course, s) : '-' }}
                    </div>
                    <div 
                      v-for="textbook in getTextbooks(course, s)" 
                      :key="textbook.id"
                      class="cell-textbook"
                      :class="{ 'textbook-disabled': !textbook.isActive }"
                      :title="!textbook.isActive ? '该教材已禁用，建议更换' : textbook.title"
                    >
                      <el-icon v-if="!textbook.isActive" class="warning-icon"><Warning /></el-icon>
                      {{ textbook.title }}
                    </div>
                  </template>
                </td>
                <!-- 总课时 -->
                <td class="matrix-cell matrix-total-cell">
                  <strong>{{ calcTotalHours(course) }}</strong>
                </td>
              </tr>
              <!-- 分组小计 -->
              <tr class="matrix-subtotal-row">
                <td class="matrix-fixed-col matrix-subtotal-label">小计</td>
                <td
                  v-for="s in maxSemester"
                  :key="s"
                  class="matrix-cell matrix-subtotal-cell"
                >
                  {{ calcSemesterSubtotal(group, s) }}
                </td>
                <td class="matrix-cell matrix-subtotal-cell">
                  <strong>{{ calcGroupTotal(group) }}</strong>
                </td>
              </tr>
            </tbody>
            <!-- 总计行 -->
            <tr class="matrix-total-final-row">
              <td class="matrix-fixed-col matrix-total-final-label">总计</td>
              <td
                v-for="s in maxSemester"
                :key="s"
                class="matrix-cell matrix-total-final-cell"
              >
                {{ calcFinalSemesterTotal(s) }}
              </td>
              <td class="matrix-cell matrix-total-final-cell">
                <strong>{{ totalAllHours }}</strong>
              </td>
            </tr>
          </table>
        </div>
      </div>

      <el-empty v-else-if="selectedPlanId" description="该方案暂无课程数据" />
      <el-empty v-else description="请选择培养方案查看明细" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Warning } from '@element-plus/icons-vue'
import { getPlans, getPlanCourses } from '../../api/plan'

// 状态
const plans = ref([])
const selectedPlanId = ref(null)
const loading = ref(false)
const planCourses = ref([])

// 计算最大学期数
const maxSemester = computed(() => {
  if (!planCourses.value.length) return 8
  const max = Math.max(...planCourses.value.map(c => c.endSemester), 0)
  return Math.max(max, 8)
})

// 按类型分组
const groups = computed(() => {
  const map = { public: [], professional: [] }
  planCourses.value.forEach(c => {
    const type = c.courses?.type || 'public'
    map[type].push({
      id: c.id,
      courseName: c.courses?.name || '未知课程',
      courseCode: c.courses?.code || '',
      startSemester: c.startSemester,
      endSemester: c.endSemester,
      weeklyHours: c.weeklyHours,
      weeksPerSemester: c.weeksPerSemester,
      semesters: c.planCourseSemesters || [],
      sortOrder: c.sortOrder ?? 0,
    })
  })

  // 在每个分组内按 sortOrder 排序
  map.public.sort((a, b) => a.sortOrder - b.sortOrder)
  map.professional.sort((a, b) => a.sortOrder - b.sortOrder)

  return [
    { type: 'public', label: '公共基础课', courses: map.public },
    { type: 'professional', label: '专业课', courses: map.professional },
  ]
})

// 获取方案显示标签
function getPlanLabel(plan) {
  const parts = []
  if (plan.majors?.name) parts.push(plan.majors.name)
  if (plan.colleges?.name) parts.push(plan.colleges.name)
  if (plan.trainingLevels?.name) parts.push(plan.trainingLevels.name)
  if (plan.version) parts.push(`(${plan.version})`)
  return `${plan.name} ${parts.join(' - ')}`
}

// 判断学期是否在课程范围内
function isInRange(course, semester) {
  return semester >= course.startSemester && semester <= course.endSemester
}

// 获取某学期周课时
function getHours(course, semester) {
  const sem = course.semesters.find(s => s.semester === semester)
  return sem ? sem.weeklyHours : null
}

// 获取某学期教材信息（返回数组，包含状态）
function getTextbooks(course, semester) {
  const sem = course.semesters.find(s => s.semester === semester)
  if (!sem || !sem.planTextbooks?.length) return []
  return sem.planTextbooks.map(t => ({
    id: t.textbooks?.id,
    title: t.textbooks?.title,
    isbn: t.textbooks?.isbn,
    publisher: t.textbooks?.publisher,
    isActive: t.textbooks?.isActive ?? true, // 默认为激活状态
  }))
}

// 单元格样式
function cellClass(course, semester) {
  if (!isInRange(course, semester)) return 'cell-out-of-range'
  const hours = getHours(course, semester) || 0
  if (hours === 0) return 'cell-zero'
  if (hours <= 2) return 'cell-low'
  if (hours <= 4) return 'cell-mid'
  return 'cell-high'
}

// 计算总课时
function calcTotalHours(course) {
  let total = 0
  for (let s = course.startSemester; s <= course.endSemester; s++) {
    const sem = course.semesters.find(x => x.semester === s)
    if (sem) {
      const hours = sem.weeklyHours || 0
      const weeks = sem.weeksCount || 18
      total += hours * weeks
    } else {
      const hours = course.weeklyHours || 0
      const weeks = course.weeksPerSemester || 18
      total += hours * weeks
    }
  }
  return Math.round(total)
}

// 分组小计
function calcSemesterSubtotal(group, semester) {
  let total = 0
  group.courses.forEach(c => {
    if (isInRange(c, semester)) {
      const hours = getHours(c, semester)
      if (hours !== null) {
        total += hours
      }
    }
  })
  return total
}

function calcGroupTotal(group) {
  return group.courses.reduce((sum, c) => sum + calcTotalHours(c), 0)
}

// 最终总计（所有分组的合计）
function calcFinalSemesterTotal(semester) {
  let total = 0
  groups.value.forEach(group => {
    const subtotal = calcSemesterSubtotal(group, semester)
    if (subtotal) total += subtotal
  })
  return total
}

// 总课时
const totalAllHours = computed(() => {
  return groups.value.reduce((sum, g) => sum + calcGroupTotal(g), 0)
})

// 加载方案列表
async function loadPlans() {
  try {
    const res = await getPlans()
    plans.value = res.data || []
  } catch (e) {
    console.error(e)
    ElMessage.error('加载培养方案失败')
  }
}

// 处理方案选择变化
async function handlePlanChange() {
  if (!selectedPlanId.value) {
    planCourses.value = []
    return
  }

  loading.value = true
  try {
    const res = await getPlanCourses(selectedPlanId.value)
    planCourses.value = res.data || []
  } catch (e) {
    console.error(e)
    ElMessage.error('加载方案课程失败')
    planCourses.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadPlans()
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
  width: 400px;
}

/* 矩阵容器 */
.matrix-container {
  margin-top: 20px;
}

/* 矩阵滚动区 */
.matrix-scroll {
  overflow: auto;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  max-height: calc(100vh - 350px);
  min-height: 400px;
}

.matrix-table {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  font-size: 13px;
}

.matrix-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
}

.matrix-table th {
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  padding: 8px 6px;
  text-align: center;
  font-weight: 600;
  color: #303133;
  white-space: nowrap;
}

.matrix-semester-header {
  min-width: 100px;
}

.matrix-course-header {
  min-width: 180px;
  text-align: left !important;
  padding-left: 12px !important;
}

.matrix-total-header {
  min-width: 80px;
  background: #ecf5ff !important;
  color: #409eff !important;
}

/* 固定列 */
.matrix-fixed-col {
  position: sticky;
  left: 0;
  z-index: 1;
  background: #fff;
}

.matrix-course-name {
  padding: 8px 12px;
  border: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  gap: 6px;
}

.course-name-text {
  font-weight: 500;
  white-space: nowrap;
}

.course-type-tag {
  flex-shrink: 0;
}

/* 分组行 */
.matrix-group-row td {
  position: sticky;
  left: 0;
}

.matrix-group-cell {
  padding: 6px 16px !important;
  font-weight: 600;
  font-size: 14px;
  border: 1px solid #e4e7ed;
}

.matrix-group-cell.public {
  background: #f0f9eb;
  color: #67c23a;
}

.matrix-group-cell.professional {
  background: #fdf6ec;
  color: #e6a23c;
}

.group-label {
  margin-right: 8px;
}

.group-count {
  font-weight: 400;
  font-size: 12px;
  color: #909399;
}

/* 单元格 */
.matrix-cell {
  border: 1px solid #e4e7ed;
  padding: 4px 6px;
  text-align: center;
  cursor: default;
  transition: all 0.2s;
  min-width: 100px;
  vertical-align: middle;
}

.cell-out-of-range {
  background: #fafafa;
}

.cell-zero {
  background: #fff;
}

.cell-low {
  background: #ecf5ff;
}

.cell-mid {
  background: #d9ecff;
}

.cell-high {
  background: #b3d8ff;
}

.cell-hours {
  font-weight: 600;
  font-size: 14px;
  color: #303133;
}

.cell-textbook {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 禁用教材样式 */
.textbook-disabled {
  color: #c0c4cc !important;
  text-decoration: line-through;
  display: flex;
  align-items: center;
  gap: 2px;
}

.warning-icon {
  color: #e6a23c;
  font-size: 12px;
  flex-shrink: 0;
}

/* 总课时列 */
.matrix-total-cell {
  background: #ecf5ff !important;
  font-size: 14px;
}

/* 小计行 */
.matrix-subtotal-row td {
  background: #f5f7fa;
  border-top: 2px solid #c0c4cc;
}

.matrix-subtotal-label {
  padding: 6px 12px;
  font-weight: 600;
  color: #606266;
  text-align: left;
  border: 1px solid #e4e7ed;
}

.matrix-subtotal-cell {
  font-weight: 500;
  color: #606266;
}

/* 总计行 */
.matrix-total-final-row td {
  background: #e6e6e6;
  border-top: 3px solid #909399;
  font-weight: 600;
}

.matrix-total-final-label {
  padding: 8px 12px;
  font-weight: 700;
  color: #303133;
  text-align: left;
  border: 1px solid #c0c4cc;
}

.matrix-total-final-cell {
  font-weight: 700;
  color: #303133;
  font-size: 14px;
}
</style>
