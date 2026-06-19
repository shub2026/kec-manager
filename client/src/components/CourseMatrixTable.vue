<template>
  <div class="matrix-scroll" v-loading="loading">
    <table class="matrix-table" v-if="rawCourses.length > 0">
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
          <th v-if="!readonly" class="matrix-action-header">操作</th>
        </tr>
      </thead>
      <tbody v-for="group in groups" :key="group.type + '-' + group.label">
        <!-- 分组标题行 -->
        <tr class="matrix-group-row">
          <td :colspan="readonly ? maxSemester + 2 : maxSemester + 3" class="matrix-group-cell" :class="group.type">
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
            @click="!readonly && $emit('edit', course, s)"
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
          <!-- 操作按钮 -->
          <td v-if="!readonly" class="matrix-cell matrix-action-cell">
            <div class="action-buttons">
              <el-button 
                size="small" 
                :icon="ArrowUp" 
                :disabled="isFirstInGroup(course, group)"
                @click="$emit('move-up', course, group)"
                circle
                title="上移"
              />
              <el-button 
                size="small" 
                :icon="ArrowDown" 
                :disabled="isLastInGroup(course, group)"
                @click="$emit('move-down', course, group)"
                circle
                title="下移"
              />
              <el-button size="small" @click="$emit('set-semester', course)" title="设置学期">
                <el-icon><Setting /></el-icon>
              </el-button>
              <el-popconfirm title="确定删除该课程？" @confirm="$emit('delete-course', course)">
                <template #reference>
                  <el-button size="small" type="danger" title="删除课程">
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </template>
              </el-popconfirm>
            </div>
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
          <td v-if="!readonly"></td>
        </tr>
      </tbody>
    </table>
    <el-empty v-else description="暂无课程，请添加课程到方案" />
  </div>

  <!-- 底部控制栏：统一学期周数 -->
  <div v-if="!readonly" class="matrix-footer">
    <div class="footer-section">
      <span class="footer-label">学期周数：</span>
      <el-input-number
        :model-value="globalWeeks"
        @update:model-value="$emit('update-global-weeks', $event)"
        :min="1"
        :max="30"
        size="small"
        controls-position="right"
      />
      <el-button type="primary" size="small" @click="$emit('apply-weeks')">
        <el-icon><Check /></el-icon> 应用
      </el-button>
      <span class="footer-hint">统一应用于所有学期</span>
    </div>
    <div class="footer-summary">
      <el-tag type="info" size="large">
        方案总课时：<strong>{{ totalAllHours }}</strong>
      </el-tag>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ArrowUp, ArrowDown, Setting, Delete, Check, Warning } from '@element-plus/icons-vue'
import { useMatrixCalculations } from '../composables/useMatrixCalculations'

const props = defineProps({
  rawCourses: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  globalWeeks: { type: Number, default: 18 },
  totalAllHours: { type: Number, default: 0 },
  readonly: { type: Boolean, default: false },
})

defineEmits(['edit', 'delete-course', 'move-up', 'move-down', 'set-semester', 'apply-weeks', 'update-global-weeks'])

// 计算最大学期数
const maxSemester = computed(() => {
  if (!props.rawCourses.length) return 8
  const max = Math.max(...props.rawCourses.map(c => c.endSemester), 0)
  return Math.max(max, 8)
})

// 将 prop 包装为 computed ref 供 composable 使用
const rawCoursesRef = computed(() => props.rawCourses)

// 使用共享计算逻辑
const {
  groups,
  isInRange,
  getHours,
  calcTotalHours,
  calcGroupTotal,
  isFirstInGroup,
  isLastInGroup,
} = useMatrixCalculations(rawCoursesRef)

// 获取某学期教材信息（返回数组，包含状态）
function getTextbooks(course, semester) {
  const sem = course.semesters.find(s => s.semester === semester)
  if (!sem || !sem.planTextbooks?.length) return []
  return sem.planTextbooks.map(t => ({
    id: t.textbooks?.id,
    title: t.textbooks?.title,
    isbn: t.textbooks?.isbn,
    publisher: t.textbooks?.publisher,
    isActive: t.textbooks?.isActive ?? true,
  }))
}

// 获取某学期教材名（用于向后兼容）
function getTextbookName(course, semester) {
  const textbooks = getTextbooks(course, semester)
  if (textbooks.length === 0) return ''
  return textbooks.map(t => t.title).join(', ')
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

// 分组学期小计
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
</script>

<style scoped>
/* 矩阵滚动区 */
.matrix-scroll {
  flex: 1;
  overflow: auto;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
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
  min-width: 80px;
}

.matrix-course-header {
  min-width: 160px;
  text-align: left !important;
  padding-left: 12px !important;
}

.matrix-total-header {
  min-width: 70px;
  background: #ecf5ff !important;
  color: #409eff !important;
}

.matrix-action-header {
  min-width: 140px;
  text-align: center;
  background: #f5f7fa !important;
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
  cursor: pointer;
  transition: all 0.2s;
  min-width: 80px;
  vertical-align: middle;
}

.matrix-cell:hover {
  box-shadow: inset 0 0 0 2px #409eff;
}

.cell-out-of-range {
  background: #fafafa;
  cursor: default;
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

/* 操作列 */
.matrix-action-cell {
  text-align: center;
  cursor: default !important;
}

.action-buttons {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
}

.action-buttons .el-button.is-disabled {
  opacity: 0.4;
}

.matrix-action-cell .el-button {
  padding: 4px 8px;
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
  cursor: default !important;
}

/* 底部控制栏 */
.matrix-footer {
  margin-top: 16px;
  padding: 12px 16px;
  background: #f5f7fa;
  border-radius: 4px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.footer-section {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
}

.footer-label {
  font-weight: 600;
  font-size: 13px;
  color: #303133;
}

.footer-hint {
  font-size: 12px;
  color: #909399;
}

.footer-summary {
  flex-shrink: 0;
  padding-top: 20px;
}
</style>
