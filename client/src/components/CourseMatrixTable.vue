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
            <div class="course-name-inner">
              <span class="course-name-text">{{ course.courseName }}</span>
              <el-tag
                size="small"
                :type="group.type === 'public' ? 'success' : 'warning'"
                class="course-type-tag"
                disable-transitions
              >
                {{ group.type === 'public' ? '公共' : '专业' }}
              </el-tag>
            </div>
          </td>
          <!-- 学期单元格（可编辑时支持键盘聚焦 + Enter 触发编辑） -->
          <td
            v-for="s in maxSemester"
            :key="s"
            class="matrix-cell"
            :class="cellClass(course, s)"
            :tabindex="isEditableCell(course, s) ? 0 : undefined"
            :role="isEditableCell(course, s) ? 'button' : undefined"
            :aria-label="isEditableCell(course, s) ? cellAriaLabel(course, s) : undefined"
            @click="isEditableCell(course, s) && $emit('edit', course, s)"
            @keyup.enter="isEditableCell(course, s) && $emit('edit', course, s)"
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
                      <span v-else-if="textbook.isRequired" class="tooltip-status required"
                        >必订</span
                      >
                      <span v-else class="tooltip-status elective">选修</span>
                    </div>
                  </template>
                  <div class="cell-textbook" :class="{ 'textbook-disabled': !textbook.isActive }">
                    <span v-if="!textbook.isActive" class="disabled-dot"></span>
                    <span v-else class="active-dot"></span>
                    <span class="textbook-name">{{ textbook.title }}</span>
                  </div>
                </el-tooltip>
              </template>
              <div v-else class="cell-no-textbook"><span class="no-textbook-dot"></span>未指定</div>
            </template>
          </td>
          <!-- 总课时 -->
          <td class="matrix-cell matrix-total-cell">
            <strong>{{ course.totalHours }}</strong>
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
                :aria-label="'上移 ' + course.courseName"
                @click="$emit('move-up', course, group)"
              />
              <el-button
                size="small"
                :icon="ArrowDown"
                :disabled="isLastInGroup(course, group)"
                circle
                title="下移"
                :aria-label="'下移 ' + course.courseName"
                @click="$emit('move-down', course, group)"
              />
              <el-button
                size="small"
                :icon="Setting"
                circle
                title="设置学期"
                :aria-label="'设置学期 ' + course.courseName"
                @click="$emit('set-semester', course)"
              />
              <el-button
                size="small"
                type="danger"
                :icon="Delete"
                circle
                title="删除课程"
                :aria-label="'删除课程 ' + course.courseName"
                @click="$emit('delete-course', course)"
              />
            </div>
          </td>
        </tr>
        <!-- 分组小计 -->
        <tr class="matrix-subtotal-row">
          <td class="matrix-fixed-col matrix-subtotal-label">小计</td>
          <td v-for="s in maxSemester" :key="s" class="matrix-cell matrix-subtotal-cell">
            {{ subtotals[group.type]?.[s - 1] || 0 }}
          </td>
          <td class="matrix-cell matrix-subtotal-cell">
            <strong>{{ calcGroupTotal(group) }}</strong>
          </td>
          <td v-if="!readonly"></td>
        </tr>
      </tbody>
      <!-- 总计行（仅 showGrandTotal 模式，与上方列共享宽度，天然对齐） -->
      <tfoot v-if="showGrandTotal" class="matrix-grand-total-row">
        <tr>
          <td class="matrix-fixed-col matrix-grand-total-label">总计</td>
          <td v-for="s in maxSemester" :key="s" class="matrix-cell matrix-grand-total-cell">
            {{ grandTotals[s - 1] }}
          </td>
          <td class="matrix-cell matrix-grand-total-cell">
            <strong>{{ totalAllHours }}</strong>
          </td>
          <td v-if="!readonly"></td>
        </tr>
      </tfoot>
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
      <el-tag type="info" size="large" disable-transitions>
        方案总课时：<strong>{{ totalAllHours }}</strong>
      </el-tag>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { ArrowUp, ArrowDown, Setting, Delete } from '@element-plus/icons-vue';
import { useMatrixCalculations } from '../composables/useMatrixCalculations';

const props = defineProps({
  rawCourses: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  globalWeeks: { type: Number, default: 18 },
  totalAllHours: { type: Number, default: 0 },
  readonly: { type: Boolean, default: false },
  showGrandTotal: { type: Boolean, default: false },
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

// 将 prop 包装为 computed ref 供 composable 使用
const rawCoursesRef = computed(() => props.rawCourses);

// 使用共享计算逻辑（maxSemester / subtotals / grandTotals 均为 computed，见 composable）
const {
  groups,
  maxSemester,
  isInRange,
  getHours,
  calcGroupTotal,
  isFirstInGroup,
  isLastInGroup,
  subtotals,
  grandTotals,
} = useMatrixCalculations(rawCoursesRef);

// FE-P2 优化：预计算教材网格 Map<courseId, Map<semester, textbookArray>>
// 返回稳定引用，避免原先 getTextbooks 每次 .map() 生成新对象导致 v-for 无法复用
const textbookGrid = computed(() => {
  const grid = new Map();
  groups.value.forEach((group) => {
    group.courses.forEach((course) => {
      const semMap = new Map();
      course.semesters.forEach((sem) => {
        if (sem.planTextbooks?.length) {
          semMap.set(
            sem.semester,
            sem.planTextbooks.map((t) => ({
              id: t.textbooks?.id,
              title: t.textbooks?.title,
              isbn: t.textbooks?.isbn,
              publisher: t.textbooks?.publisher,
              isActive: t.textbooks?.isActive ?? true,
              isRequired: t.isRequired ?? true,
            }))
          );
        }
      });
      grid.set(course.id, semMap);
    });
  });
  return grid;
});

// 获取某学期教材信息（从预计算网格读取，O(1)，返回稳定引用）
function getTextbooks(course, semester) {
  return textbookGrid.value.get(course.id)?.get(semester) || [];
}

// 单元格样式（getHours 已改为 O(1) Map 查找）
function cellClass(course, semester) {
  if (!isInRange(course, semester)) return 'cell-out-of-range';
  const hours = getHours(course, semester) || 0;
  if (hours === 0) return 'cell-zero';
  if (hours <= 2) return 'cell-low';
  if (hours <= 4) return 'cell-mid';
  return 'cell-high';
}

// 可编辑单元格判定（只读/超学期范围不可交互，不进入键盘序列）
function isEditableCell(course, semester) {
  return !props.readonly && isInRange(course, semester);
}

// 键盘/读屏可访问性描述：课程名 + 学期 + 课时
function cellAriaLabel(course, semester) {
  const hours = getHours(course, semester);
  const hoursText = hours !== null ? `每周${hours}课时` : '未设置课时';
  return `${course.courseName} 第${semester}学期 ${hoursText}，按回车编辑`;
}
</script>

<style scoped>
/* 矩阵滚动区 */
.matrix-scroll {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
}

/* 手机端:取消 flex:1,让矩阵表格按内容自然展开
   横向仍由 overflow:auto 滚动(表格 min-width 超出视口),纵向交给页面滚动 */
@media (max-width: 768px) {
  .matrix-scroll {
    flex: none;
    overflow-x: auto;
    overflow-y: visible;
  }
}

.matrix-table {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
  min-width: 100%;
  font-size: 13px;
}

.matrix-table thead {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky-header);
}

.matrix-table th {
  background: var(--bg-subtle);
  border: 1px solid var(--border-light);
  padding: var(--space-2) 6px;
  text-align: center;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

.matrix-semester-header {
  width: 100px;
}

.matrix-course-header {
  width: 160px;
  text-align: left;
  padding-left: var(--space-3);
}

.matrix-total-header {
  width: 70px;
  background: var(--brand-primary-soft);
  color: var(--brand-primary);
}

.matrix-action-header {
  width: 160px;
  text-align: center;
  background: var(--bg-subtle);
}

/* 固定列 */
.matrix-fixed-col {
  position: sticky;
  left: 0;
  z-index: var(--z-sticky-cell);
  background: var(--bg-card);
}

.matrix-course-name {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-light);
  vertical-align: middle;
}

.course-name-inner {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.course-name-text {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
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
  padding: 6px var(--space-4);
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
  margin-right: var(--space-2);
}

.group-count {
  font-weight: 400;
  font-size: 12px;
  color: var(--text-secondary);
}

/* 单元格 */
.matrix-cell {
  border: 1px solid var(--border-light);
  padding: var(--space-1) 6px;
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
  background: var(--brand-primary-soft, #e8f3fe);
}

.cell-mid {
  background: var(--brand-primary-lighter, #b5d6fc);
}

.cell-high {
  background: var(--el-color-primary-light-5);
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
  width: 100%;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  cursor: default;
  display: flex;
  align-items: center;
  gap: 3px;
}

/* 教材名：flex 内截断，超出列宽才省略 */
.textbook-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* 无教材占位提示：橙色圆点 + "未指定"，观感与已指定教材完全一致（同字号/同色/左对齐） */
.cell-no-textbook {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 400;
  display: flex;
  align-items: center;
  gap: 3px;
}

.no-textbook-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-warning);
  flex-shrink: 0;
}

/* 禁用教材 — 红色圆点 + 淡化文字 */
.textbook-disabled {
  color: var(--text-secondary);
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

/* 正常启用状态教材：绿色圆点 */
.active-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-success);
  flex-shrink: 0;
}

/* 教材 Tooltip 样式见下方非 scoped style 块（el-popper 渲染在 body 层） */

/* 总课时列 */
.matrix-total-cell {
  background: var(--brand-primary-soft);
  font-size: 14px;
}

/* 操作列（与 .matrix-cell 同特异性且定义在后，天然覆盖 cursor:pointer） */
.matrix-action-cell {
  text-align: center;
  cursor: default;
}

.action-buttons {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  /* 显式 nowrap：覆盖全局 .action-buttons { flex-wrap: wrap }（scoped 特异性更高），
     避免固定列宽下第 4 个按钮被挤换行形成断裂布局 */
  flex-wrap: nowrap;
}

.action-buttons .el-button.is-disabled {
  opacity: 0.4;
}

/* EP 相邻按钮默认 margin-left:12px 会与 flex gap 叠加，
   窄列换行时行宽计算溢出导致断裂布局，间距统一交给 gap 控制 */
.action-buttons .el-button + .el-button {
  margin-left: 0;
}

.matrix-action-cell .el-button {
  padding: var(--space-1) var(--space-2);
}

/* 小计行 */
.matrix-subtotal-row td {
  background: var(--bg-subtle);
  border-top: 2px solid var(--border-base);
}

.matrix-subtotal-label {
  padding: 6px var(--space-3);
  font-weight: 600;
  color: var(--text-regular);
  text-align: left;
  border: 1px solid var(--border-light);
}

.matrix-subtotal-cell {
  font-weight: 500;
  color: var(--text-regular);
  cursor: default;
}

/* 总计行（tfoot，与上方 tbody 共享列宽，天然对齐） */
.matrix-grand-total-row td {
  background: rgba(28, 130, 245, 0.04);
  border: 1px solid var(--border-light);
  border-top: 2px solid var(--el-color-primary-light-5);
  border-bottom: none;
  font-weight: 700;
  color: var(--text-primary);
  padding: 8px 6px 14px;
  text-align: center;
  cursor: default;
}

.matrix-grand-total-label {
  padding: var(--space-2) var(--space-3);
  font-size: 14px;
  text-align: left;
}

.matrix-grand-total-cell {
  font-size: 14px;
}

/* 底部控制栏：统一年级周数设置卡片 */
.matrix-footer {
  margin-top: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-4);
}

.footer-section {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
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
  margin-left: auto;
  display: flex;
  align-items: center;
}

/* 平板及窄屏（≤992px）：收缩矩阵列宽，减少水平滚动距离 */
@media (max-width: 992px) {
  .matrix-semester-header {
    width: 80px;
  }

  .matrix-course-header {
    width: 120px;
  }

  .matrix-total-header {
    width: 60px;
  }

  .matrix-action-header {
    width: 136px;
  }

  .matrix-cell {
    min-width: 65px;
  }

  .matrix-footer {
    flex-direction: column;
    align-items: flex-start;
  }

  .footer-summary {
    margin-left: 0;
  }
}

/* 手机（≤768px）：矩阵进一步紧凑，操作列收为图标按钮 */
@media (max-width: 768px) {
  .matrix-table {
    font-size: 12px;
  }

  .matrix-semester-header {
    width: 64px;
    font-size: 11px;
  }

  .matrix-course-header {
    width: 100px;
  }

  .matrix-total-header {
    width: 52px;
  }

  /* 操作列:收窄为 2×2 图标网格,减少横向滚动距离且避免按钮溢出断行 */
  .matrix-action-header {
    width: 72px;
  }

  .action-buttons {
    gap: 3px;
    flex-wrap: wrap;
    justify-content: center;
    /* 2 个按钮 + 间距的宽度,确保每行恰好 2 个 */
    max-width: 60px;
    margin: 0 auto;
  }

  .matrix-cell {
    min-width: 52px;
    padding: 3px var(--space-1);
  }

  /* 课时数字回调,避免在窄列里溢出 */
  .cell-hours {
    font-size: 13px;
  }

  /* 课程名+tag 在窄列内纵向堆叠,避免 tag 挤压课程名 */
  .course-name-inner {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .course-type-tag {
    transform: scale(0.85);
    transform-origin: left center;
  }

  /* 操作列按钮缩小内边距 */
  .matrix-action-cell .el-button {
    padding: 3px 6px;
  }

  /* 教材信息字号回调 */
  .cell-textbook,
  .cell-no-textbook {
    font-size: 10px;
    margin-top: var(--space-1);
  }

  /* 底部控制栏进一步紧凑 */
  .matrix-footer {
    padding: 10px var(--space-3);
    gap: var(--space-2) var(--space-3);
  }

  .footer-section {
    gap: var(--space-2);
  }

  .footer-hint {
    display: none;
  }

  /* 小计/总计标签收缩 */
  .matrix-subtotal-label,
  .matrix-grand-total-label {
    padding: var(--space-1) var(--space-2);
    font-size: 12px;
  }
}
</style>

<!--
  el-tooltip popper 渲染在 body 层，无法使用 scoped 样式。
  以下颜色用于深色 tooltip 背景（effect="dark"）上的白色文字/装饰，
  rgba(255,255,255,x) 是刻意保持的——深色 popper 上无对应 CSS 变量可用。
-->
<style>
.el-popper.textbook-tooltip {
  max-width: 280px;
  /* 叠加 .el-popper 提升特异性覆盖 EP 默认内边距，不依赖样式加载顺序，无需 !important */
  padding: 10px 14px;
  line-height: 1.6;
}

.textbook-tooltip .tooltip-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 6px;
  color: var(--bg-card);
  word-break: break-all;
}

.textbook-tooltip .tooltip-row {
  display: flex;
  gap: var(--space-2);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}

.textbook-tooltip .tooltip-label {
  color: rgba(255, 255, 255, 0.7);
  flex-shrink: 0;
  min-width: 36px;
}

.textbook-tooltip .tooltip-status {
  font-weight: 600;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  font-size: 11px;
}

.textbook-tooltip .tooltip-status.required {
  background: color-mix(in srgb, var(--brand-success) 25%, transparent);
  color: var(--brand-success-lighter);
}

.textbook-tooltip .tooltip-status.elective {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

.textbook-tooltip .tooltip-status.disabled {
  background: color-mix(in srgb, var(--brand-danger) 25%, transparent);
  color: var(--brand-danger-lighter);
}
</style>
