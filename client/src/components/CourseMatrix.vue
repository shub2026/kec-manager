<template>
  <div class="matrix-container">
    <!-- 顶部工具栏 -->
    <CourseMatrixToolbar
      :all-courses="allCourses"
      @add-course="$emit('add-course')"
    />

    <!-- 矩阵表格 -->
    <CourseMatrixTable
      :raw-courses="rawCourses"
      :loading="loading"
      :global-weeks="globalWeeks"
      :total-all-hours="totalAllHours"
      @edit="openEdit"
      @delete-course="(course) => $emit('delete-course', course)"
      @move-up="handleMoveUp"
      @move-down="handleMoveDown"
      @set-semester="openSemesterSettings"
      @apply-weeks="applyGlobalWeeks"
      @update-global-weeks="globalWeeks = $event"
    />

    <!-- 编辑对话框 -->
    <CourseEditPopover
      :popover-visible="popoverVisible"
      :semester-dialog-visible="semesterDialogVisible"
      :editing-course="editingCourse"
      :editing-semester="editingSemester"
      :editing-course-for-semester="editingCourseForSemester"
      :semester-form="semesterForm"
      :editing-textbook-id="editingTextbookId"
      :saving="saving"
      :all-textbooks="allTextbooks"
      @close-popover="popoverVisible = false"
      @save-edit="saveEdit"
      @close-semester="semesterDialogVisible = false"
      @save-semester="saveSemesterSettings"
      @update-editing-semester="editingSemester = $event"
      @update-editing-textbook-id="editingTextbookId = $event"
      @update-semester-dialog-visible="semesterDialogVisible = $event"
      @update-semester-form="semesterForm = $event"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import CourseMatrixToolbar from './CourseMatrixToolbar.vue'
import CourseMatrixTable from './CourseMatrixTable.vue'
import CourseEditPopover from './CourseEditPopover.vue'
import {
  getPlanCourses,
  createSemester,
  updateSemester,
  updatePlanCourse,
  setSemesterTextbook,
  removeSemesterTextbook,
  getPlanSemesters,
} from '../api/plan'

const props = defineProps({
  planId: { type: Number, required: true },
  allCourses: { type: Array, default: () => [] },
  allTextbooks: { type: Array, default: () => [] },
})

defineEmits(['add-course', 'delete-course'])

// 状态
const loading = ref(false)
const rawCourses = ref([])
const semesterWeeks = ref([])
const globalWeeks = ref(18)
const popoverVisible = ref(false)
const saving = ref(false)

// 编辑状态
const editingCourse = ref(null)
const editingSemester = ref(null)
const editingTextbookId = ref(null)

// 开课学期设置状态
const semesterDialogVisible = ref(false)
const editingCourseForSemester = ref(null)
const semesterForm = ref({ startSemester: 1, endSemester: 2 })

// 计算最大学期数
const maxSemester = computed(() => {
  if (!rawCourses.value.length) return 8
  const max = Math.max(...rawCourses.value.map(c => c.endSemester), 0)
  return Math.max(max, 8)
})

// 构建学期周数数组（统一值）
function buildSemesterWeeks(planSemesters, courses) {
  let defaultWeeks = 18
  // 优先取第一个课程的 weeksPerSemester
  if (courses.length > 0 && courses[0].weeksPerSemester) {
    defaultWeeks = courses[0].weeksPerSemester
  }
  // 或取学期记录中第一个值
  if (planSemesters.length > 0) {
    defaultWeeks = planSemesters[0].weeksCount || defaultWeeks
  }
  globalWeeks.value = defaultWeeks
  return Array(maxSemester.value).fill(defaultWeeks)
}

// 按类型分组（用于计算总课时）
const groups = computed(() => {
  const map = { public: [], professional: [] }
  rawCourses.value.forEach(c => {
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

// 判断学期是否在课程范围内
function isInRange(course, semester) {
  return semester >= course.startSemester && semester <= course.endSemester
}

// 获取某学期周课时
function getHours(course, semester) {
  const sem = course.semesters.find(s => s.semester === semester)
  return sem ? sem.weeklyHours : null
}

// 计算总课时
function calcTotalHours(course) {
  let total = 0
  for (let s = course.startSemester; s <= course.endSemester; s++) {
    const sem = course.semesters.find(x => x.semester === s)
    // 如果学期记录存在，使用记录的周课时和周数
    if (sem) {
      const hours = sem.weeklyHours || 0
      const weeks = sem.weeksCount || semesterWeeks.value[s - 1] || 18
      total += hours * weeks
    } else {
      // 如果学期记录不存在，使用课程默认的周课时
      const hours = course.weeklyHours || 0
      const weeks = course.weeksPerSemester || semesterWeeks.value[s - 1] || 18
      total += hours * weeks
    }
  }
  return Math.round(total)
}

function calcGroupTotal(group) {
  return group.courses.reduce((sum, c) => sum + calcTotalHours(c), 0)
}

// 总课时
const totalAllHours = computed(() => {
  return groups.value.reduce((sum, g) => sum + calcGroupTotal(g), 0)
})

// 打开编辑
async function openEdit(course, semester) {
  if (!isInRange(course, semester)) {
    ElMessage.warning('该学期不在课程开课范围内')
    return
  }

  let sem = course.semesters.find(s => s.semester === semester)

  // 如果学期记录不存在，自动创建
  if (!sem) {
    try {
      // 使用课程的默认周课时和周数
      const defaultWeeklyHours = course.weeklyHours || 4
      const defaultWeeksCount = course.weeksPerSemester || globalWeeks.value || 18

      await createSemester(props.planId, course.id, {
        semester,
        weekly_hours: defaultWeeklyHours,
        weeks_count: defaultWeeksCount,
      })

      // 重新加载数据以获取最新的学期记录
      await loadData()

      // 找到新创建的学期记录
      const updatedCourse = rawCourses.value.find(c => c.id === course.id)
      sem = updatedCourse?.planCourseSemesters?.find(s => s.semester === semester)
      if (!sem) {
        ElMessage.error('创建学期记录失败')
        return
      }
    } catch (e) {
      console.error(e)
      ElMessage.error('创建学期记录失败')
      return
    }
  }

  editingCourse.value = course
  editingSemester.value = { ...sem }
  editingTextbookId.value = sem.planTextbooks?.[0]?.textbookId || null
  popoverVisible.value = true
}

// 保存编辑
async function saveEdit() {
  if (!editingSemester.value) return
  
  // 验证：周课时为0时不允许选择教材
  if (editingSemester.value.weeklyHours === 0 && editingTextbookId.value) {
    ElMessage.warning('周课时为0时不能选择教材')
    return
  }
  
  saving.value = true
  try {
    await updateSemester(editingSemester.value.id, {
      weekly_hours: editingSemester.value.weeklyHours,
    })

    // 教材关联
    if (editingTextbookId.value) {
      await setSemesterTextbook(editingSemester.value.id, {
        textbook_id: editingTextbookId.value,
        is_required: true,
      })
    } else {
      await removeSemesterTextbook(editingSemester.value.id)
    }

    ElMessage.success('保存成功')
    popoverVisible.value = false
    await loadData()
  } catch (e) {
    console.error(e)
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

// 应用全局周数 — 批量更新所有学期记录
async function applyGlobalWeeks() {
  const weeks = globalWeeks.value

  // 收集所有需要更新的学期记录ID
  const semesterIds = []
  rawCourses.value.forEach(course => {
    (course.planCourseSemesters || []).forEach(sem => {
      semesterIds.push(sem.id)
    })
  })

  // 并行发送所有更新请求
  if (semesterIds.length > 0) {
    try {
      await Promise.all(
        semesterIds.map(id =>
          updateSemester(id, { weeks_count: weeks }).catch(() => {})
        )
      )
      // 重新加载数据以反映最新状态
      await loadData()
      ElMessage.success('已应用学期周数设置')
    } catch (e) {
      console.error('批量更新学期周数失败', e)
      ElMessage.error('应用失败')
    }
  } else {
    ElMessage.info('暂无学期记录可更新')
  }
}

// 打开开课学期设置对话框
function openSemesterSettings(course) {
  editingCourseForSemester.value = course
  semesterForm.value = {
    startSemester: course.startSemester,
    endSemester: course.endSemester,
  }
  semesterDialogVisible.value = true
}

// 保存开课学期设置
async function saveSemesterSettings() {
  if (!editingCourseForSemester.value) return
  
  const { startSemester, endSemester } = semesterForm.value
  if (startSemester > endSemester) {
    return ElMessage.warning('起始学期不能大于结束学期')
  }
  
  saving.value = true
  try {
    await updatePlanCourse(editingCourseForSemester.value.id, {
      start_semester: startSemester,
      end_semester: endSemester,
    })
    
    ElMessage.success('保存成功')
    semesterDialogVisible.value = false
    await loadData()
  } catch (e) {
    console.error(e)
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

// ==================== 排序功能 ====================

// 判断是否是分组中的第一项
function isFirstInGroup(course, group) {
  return group.courses[0]?.id === course.id
}

// 判断是否是分组中的最后一项
function isLastInGroup(course, group) {
  return group.courses[group.courses.length - 1]?.id === course.id
}

// 通用排序交换：按目标顺序逐个更新 sort_order，避免 SQLite 并发写锁和重复值问题
async function swapSortOrder(group, indexA, indexB) {
  // 先交换位置
  const courses = [...group.courses]
  const tmp = courses[indexA]
  courses[indexA] = courses[indexB]
  courses[indexB] = tmp

  // 按新顺序重新分配 sort_order（基于索引，保证唯一递增）
  const updates = courses.map((c, i) => ({ id: c.id, sortOrder: i }))

  // 串行逐个更新，避免 SQLite 文件锁冲突
  for (const { id, sortOrder } of updates) {
    await updatePlanCourse(id, { sort_order: sortOrder })
  }
}

// 上移
async function handleMoveUp(course, group) {
  const index = group.courses.findIndex(c => c.id === course.id)
  if (index <= 0) return

  try {
    await swapSortOrder(group, index, index - 1)
    ElMessage.success('排序已更新')
    await loadData()
  } catch (e) {
    console.error('排序更新失败:', e)
    ElMessage.error('排序更新失败')
  }
}

// 下移
async function handleMoveDown(course, group) {
  const index = group.courses.findIndex(c => c.id === course.id)
  if (index >= group.courses.length - 1) return

  try {
    await swapSortOrder(group, index, index + 1)
    ElMessage.success('排序已更新')
    await loadData()
  } catch (e) {
    console.error('排序更新失败:', e)
    ElMessage.error('排序更新失败')
  }
}

// 加载数据
async function loadData() {
  if (!props.planId) {
    return
  }
  
  loading.value = true
  try {
    const [coursesRes, semestersRes] = await Promise.all([
      getPlanCourses(props.planId),
      getPlanSemesters(props.planId),
    ])
    rawCourses.value = coursesRes.data || []
    semesterWeeks.value = buildSemesterWeeks(semestersRes.data || [], rawCourses.value)
  } catch (e) {
    console.error('CourseMatrix load error:', e)
  } finally {
    loading.value = false
  }
}

// 暴露刷新方法
defineExpose({
  refresh: loadData,
})

onMounted(loadData)

// 当 planId 变化时重新加载
watch(() => props.planId, loadData)

// 监听周课时变化，当为0时自动清除教材选择
watch(
  () => editingSemester.value?.weeklyHours,
  (newHours) => {
    if (newHours === 0 && editingTextbookId.value) {
      editingTextbookId.value = null
    }
  }
)
</script>

<style scoped>
.matrix-container {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 260px);
  min-height: 500px;
}
</style>
