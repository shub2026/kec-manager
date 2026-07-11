<template>
  <div v-loading="loading" class="matrix-scroll">
    <table v-if="rawCourses.length > 0" class="matrix-table">
      <thead>
        <tr>
          <th class="matrix-fixed-col matrix-course-header">课程名称</th>
          <th v-for="s in maxSemester" :key="s" class="matrix-semester-header">第{{ s }}学期</th>
          <th class="matrix-total-header">总课时</th>
          <th v-if="!readonly" class="matrix-action-header">操作</th>
        </tr>
      </thead>
      <tbody v-for="group in groups" :key="group.type + '-' + group.label">
        <!-- 分组标题行 -->
        <tr class="matrix-group-row">
          <td
            :colspan="readonly ? maxSemester + 2 : maxSemester + 3"
            class="matrix-group-cell"
            :class="group.type"
          >
            <span class="group-label">{{ group.label }}</span>
            <span class="group-count">{{ group.courses.length }} 门</span>
          </td>
        </tr>
        <!-- 课程行 -->
        <tr v-for="course in group.courses" :key="course.id" class="matrix-course-row">
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
              <template v-if="getTextbooks(course, s).length > 0">
                <el-tooltip
                  v-for="textbook in getTextbooks(course, s)"
                  :key="textbook.id"
                  placement="right"
                  :show-after="300"
                  :hide-after="0"
                  popper-class="textbook-tooltip"
                >
                  <template #content>
                    <div class="tooltip-title">{{ textbook.title }}</div>
                    <div v-if="textbook.isbn" class="tooltip-row">
                      <span class="tooltip-label">ISBN</span>
                      <span>{{ textbook.isbn }}</span>
                    </div>
                    <div v-if="textbook.publisher" class="tooltip-row">
                      <span class="tooltip-label">出版社</span>
                      <span>{{ textbook.publisher }}</span>
                    </div>
                    <div class="tooltip-row">
                      <span class="tooltip-label">状态</span>
                      <span v-if="!textbook.isActive" class="tooltip-status disabled">已停用</span>
                      <span v-else-if="textbook.isRequired" class="tooltip-status required">必订</span>
                      <span v-else class="tooltip-status elective">选修</span>
                    </div>
                  </template>
                  <div
                    class="cell-textbook"
                    :class="{ 'textbook-disabled': !textbook.isActive }"
                  >
                    <span v-if="!textbook.isActive" class="disabled-dot"></span>
                    {{ textbook.title }}
                  </div>
                </el-tooltip>
              </template>
              <div v-else class="cell-no-textbook">未指定</div>
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
                circle
                title="上移"
                @click="$emit('move-up', course, group)"
              />
              <el-button
                size="small"
                :icon="ArrowDown"
                :disabled="isLastInGroup(course, group)"
                circle
                title="下移"
                @click="$emit('move-down', course, group)"
              />
              <el-button size="small" title="设置学期" @click="$emit('set-semester', course)">
                <el-icon><Setting /></el-icon>
              </el-button>
              <el-button
                size="small"
                type="danger"
                title="删除课程"
                @click="$emit('delete-course', course)"
              >
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </td>
        </tr>
        <!-- 分组小计 -->
        <tr class="matrix-subtotal-row">
          <td class="matrix-fixed-col matrix-subtotal-label">小计</td>
          <td v-for="s in maxSemester" :key="s" class="matrix-cell matrix-subtotal-cell">
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
        :min="1"
        :max="30"
        size="small"
        controls-position="right"
        @update:model-value="$emit('update-global-weeks', $event)"
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
import { computed } from 'vue';
import { ArrowUp, ArrowDown } from '@element-plus/icons-vue';
import { useMatrixCalculations } from '../composables/useMatrixCalculations';

const props = defineProps({
  rawCourses: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  globalWeeks: { type: Number, default: 18 },
  totalAllHours: { type: Number, default: 0 },
  readonly: { type: Boolean, default: false },
});

defineEmits([
  'edit',
  'delete-course',
  'move-up',
  'move-down',
  'set-semester',
  'apply-weeks',
  'update-global-weeks',
]);

// 计算最大学期数
const maxSemester = computed(() => {
  if (!props.rawCourses.length) return 8;
  const max = Math.max(...props.rawCourses.map((c) => c.endSemester), 0);
  return Math.max(max, 8);
});

// 将 prop 包装为 computed ref 供 composable 使用
const rawCoursesRef = computed(() => props.rawCourses);

// 使用共享计算逻辑
const {
  groups,
  isInRange,
  getHours,
  calcTotalHours,
  calcGroupTotal,
  isFirstInGroup,
  isLastInGroup,
} = useMatrixCalculations(rawCoursesRef);

// 获取某学期教材信息（返回数组，包含状态）
function getTextbooks(course, semester) {
  const sem = course.semesters.find((s) => s.semester === semester);
  if (!sem || !sem.planTextbooks?.length) return [];
  return sem.planTextbooks.map((t) => ({
    id: t.textbooks?.id,
    title: t.textbooks?.title,
    isbn: t.textbooks?.isbn,
    publisher: t.textbooks?.publisher,
    isActive: t.textbooks?.isActive ?? true,
    isRequired: t.is_required ?? true,
  }));
}

// 单元格样式
function cellClass(course, semester) {
  if (!isInRange(course, semester)) return 'cell-out-of-range';
  const hours = getHours(course, semester) || 0;
  if (hours === 0) return 'cell-zero';
  if (hours <= 2) return 'cell-low';
  if (hours <= 4) return 'cell-mid';
  return 'cell-high';
}

// 分组学期小计
function calcSemesterSubtotal(group, semester) {
  let total = 0;
  group.courses.forEach((c) => {
    if (isInRange(c, semester)) {
      const hours = getHours(c, semester);
      if (hours !== null) {
        total += hours;
      }
    }
  });
  return total;
}
</script>

<style scoped>
/* 矩阵滚动区 */
.matrix-scroll {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border-light);
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
  background: var(--bg-subtle);
  border: 1px solid var(--border-light);
  padding: 8px 6px;
  text-align: center;
  font-weight: 600;
  color: var(--text-primary);
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
  background: var(--brand-primary-soft) !important;
  color: var(--brand-primary) !important;
}

.matrix-action-header {
  min-width: 140px;
  text-align: center;
  background: var(--bg-subtle) !important;
}

/* 固定列 */
.matrix-fixed-col {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--bg-card);
}

.matrix-course-name {
  padding: 8px 12px;
  border: 1px solid var(--border-light);
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
  border: 1px solid var(--border-light);
}

.matrix-group-cell.public {
  background: var(--brand-success-soft);
  color: var(--brand-success-text);
}

.matrix-group-cell.professional {
  background: var(--brand-warning-soft);
  color: var(--brand-warning-text);
}

.group-label {
  margin-right: 8px;
}

.group-count {
  font-weight: 400;
  font-size: 12px;
  color: var(--text-secondary);
}

/* 单元格 */
.matrix-cell {
  border: 1px solid var(--border-light);
  padding: 4px 6px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 80px;
  vertical-align: middle;
}

.matrix-cell:hover {
  box-shadow: inset 0 0 0 2px var(--brand-primary);
}

.cell-out-of-range {
  background: var(--bg-subtle);
  cursor: default;
}

.cell-zero {
  background: var(--bg-card);
}

/* 课时热力：品牌蓝 #1C82F5 由浅到深（light-9 → light-7 → light-5） */
.cell-low {
  background: var(--brand-primary-soft, #E8F3FE);
}

.cell-mid {
  background: var(--brand-primary-lighter, #B5D6FC);
}

.cell-high {
  background: #79B7FC;
}

.cell-hours {
  font-weight: 700;
  font-size: 15px;
  color: var(--text-primary);
  line-height: 1.2;
}

.cell-textbook {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 6px;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
  display: flex;
  align-items: center;
  gap: 3px;
}

/* 无教材占位提示 */
.cell-no-textbook {
  margin-top: 6px;
  font-size: 10px;
  color: var(--text-placeholder);
  font-style: italic;
}

/* 禁用教材 — 红色圆点 + 淡化文字 */
.textbook-disabled {
  color: var(--text-placeholder) !important;
  text-decoration: line-through;
}

.disabled-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-danger);
  flex-shrink: 0;
}

/* 教材 Tooltip 样式见下方非 scoped style 块（el-popper 渲染在 body 层） */

/* 总课时列 */
.matrix-total-cell {
  background: var(--brand-primary-soft) !important;
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
  background: var(--bg-subtle);
  border-top: 2px solid var(--border-base);
}

.matrix-subtotal-label {
  padding: 6px 12px;
  font-weight: 600;
  color: var(--text-regular);
  text-align: left;
  border: 1px solid var(--border-light);
}

.matrix-subtotal-cell {
  font-weight: 500;
  color: var(--text-regular);
  cursor: default !important;
}

/* 底部控制栏 */
.matrix-footer {
  margin-top: 16px;
  padding: 12px 16px;
  background: var(--bg-subtle);
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
  color: var(--text-primary);
}

.footer-hint {
  font-size: 12px;
  color: var(--text-secondary);
}

.footer-summary {
  flex-shrink: 0;
  padding-top: 20px;
}
</style>

<!-- el-tooltip popper 渲染在 body 层，需要全局样式 -->
<style>
.textbook-tooltip {
  max-width: 280px;
  padding: 10px 14px !important;
  line-height: 1.6;
}

.textbook-tooltip .tooltip-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 6px;
  color: #fff;
  word-break: break-all;
}

.textbook-tooltip .tooltip-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}

.textbook-tooltip .tooltip-label {
  color: rgba(255, 255, 255, 0.5);
  flex-shrink: 0;
  min-width: 36px;
}

.textbook-tooltip .tooltip-status {
  font-weight: 600;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 11px;
}

.textbook-tooltip .tooltip-status.required {
  background: rgba(52, 211, 153, 0.25);
  color: #6ee7b7;
}

.textbook-tooltip .tooltip-status.elective {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

.textbook-tooltip .tooltip-status.disabled {
  background: rgba(248, 113, 113, 0.25);
  color: #fca5a5;
}
</style>
