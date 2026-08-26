<template>
  <!-- 宽度例外：此弹窗需全览多列教师信息，桌面端保持 80% / max 1400px，不使用 --dialog-width-* token -->
  <el-dialog
    v-model="visible"
    title="选择任课教师"
    :width="isMobile ? '95%' : '80%'"
    :style="{ maxWidth: isMobile ? 'none' : '1400px' }"
    align-center
    destroy-on-close
    class="teacher-dialog"
  >
    <!-- M-10：搜索过滤栏 -->
    <div class="filter-bar">
      <el-input
        v-model="searchKey"
        placeholder="搜索教师姓名"
        clearable
        size="small"
        :prefix-icon="Search"
        class="search-input"
      />
      <!-- 人员类别筛选：与姓名搜索叠加过滤，选项与 utils/personnel.js 枚举一致 -->
      <el-select
        v-model="personnelFilter"
        placeholder="人员类别"
        clearable
        size="small"
        class="personnel-select"
      >
        <el-option label="专职" value="full_time" />
        <el-option label="兼职" value="part_time" />
        <el-option label="外聘" value="external" />
      </el-select>
      <!-- 教材筛选：按教师已用教材过滤，选项从当前教师列表聚合去重，与表格「已用教材」列口径一致 -->
      <el-select
        v-model="textbookFilter"
        placeholder="教材"
        clearable
        filterable
        size="small"
        class="textbook-select"
      >
        <el-option
          v-for="tb in textbookOptions"
          :key="tb.id"
          :label="tb.title"
          :value="tb.id"
        />
      </el-select>
      <span class="filter-count">共 {{ filteredList.length }} 位教师</span>
    </div>

    <el-table
      :data="pagedList"
      row-key="id"
      stripe
      highlight-current-row
      size="small"
      class="nested-table"
      @current-change="onTeacherSelect"
    >
      <!-- 手机端无弹性列，姓名改用 min-width 吸收剩余宽度，避免右侧留白 -->
      <el-table-column
        prop="name"
        label="姓名"
        :width="isMobile ? undefined : 80"
        :min-width="isMobile ? 65 : undefined"
      >
        <template #default="{ row }">
          <span>{{ row.name }}</span>
          <!-- 只带一本教材开关标记：图标展示节省列宽；不做前置禁用，由服务端拦截消息硬保证 -->
          <el-tooltip
            v-if="row.singleTextbookOnly"
            content="只带一本教材：本学期最多只能持有一本教材"
            placement="top"
          >
            <el-icon class="single-tb-icon"><Reading /></el-icon>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="人员类别" :width="isMobile ? 72 : 88" align="center">
        <template #default="{ row }">{{ personnelLabel(row.personnelType) }}</template>
      </el-table-column>
      <el-table-column label="总课时" :width="isMobile ? 78 : 92" align="center">
        <template #default="{ row }">
          <span
            :class="{
              'text-warning':
                row.totalWeeklyHours >
                (row.defaultWeeklyHours ??
                  hourSettings[row.personnelType || 'full_time']?.standard ??
                  16),
            }"
          >
            {{ row.totalWeeklyHours }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="班级数" :width="isMobile ? 55 : 68" align="center">
        <template #default="{ row }">{{ row.totalClassCount }}</template>
      </el-table-column>
      <el-table-column v-if="!isMobile" label="自定义课时" width="92" align="center">
        <template #default="{ row }">{{ row.defaultWeeklyHours ?? '-' }}</template>
      </el-table-column>
      <!-- 学科列手机端宽度不足以展示 TAG，直接隐藏 -->
      <el-table-column v-if="!isMobile" label="学科" min-width="3">
        <template #default="{ row }">
          <el-tag
            v-for="c in row.courseList"
            :key="c.id"
            size="small"
            effect="plain"
            class="tag-item"
            disable-transitions
            >{{ c.name }}</el-tag
          >
        </template>
      </el-table-column>
      <el-table-column v-if="!isMobile" label="任课学院" min-width="5">
        <template #default="{ row }">
          <el-tag
            v-for="c in row.collegeList"
            :key="c.id"
            size="small"
            type="info"
            effect="plain"
            class="tag-item"
            disable-transitions
            >{{ c.name }}</el-tag
          >
        </template>
      </el-table-column>
      <el-table-column v-if="!isMobile" label="任课层次" min-width="3">
        <template #default="{ row }">
          <el-tag
            v-for="l in row.trainingLevelList"
            :key="l.id"
            size="small"
            class="tag-item tag-indigo"
            disable-transitions
            >{{ l.name }}</el-tag
          >
        </template>
      </el-table-column>
      <!-- 已用教材仅桌面端显示（isTablet 仅覆盖 768~991px，需叠加 isMobile 才能排除手机端） -->
      <el-table-column v-if="!isMobile && !isTablet" label="已用教材" min-width="7">
        <template #default="{ row }">
          <template v-if="uniqueTextbooks(row.assignedTextbooks).length">
            <el-tag
              v-for="tb in uniqueTextbooks(row.assignedTextbooks)"
              :key="tb.id"
              size="small"
              type="info"
              effect="plain"
              class="tag-item"
              disable-transitions
              >{{ tb.title }}</el-tag
            >
          </template>
          <span v-else class="text-placeholder">-</span>
        </template>
      </el-table-column>
      <!-- 备注列：宽度仅容 4 个中文字符，超出截断；悬停 tooltip 查看全文 -->
      <el-table-column label="备注" :width="isMobile ? 62 : 78">
        <template #default="{ row }">
          <el-tooltip
            v-if="row.remark && Array.from(row.remark).length > 4"
            :content="row.remark"
            placement="top"
          >
            <span>{{ truncateText(row.remark, 4) }}</span>
          </el-tooltip>
          <span v-else class="text-placeholder">{{ row.remark || '-' }}</span>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <!-- 分页居中、操作按钮居右：两侧 1fr 等宽列保证分页始终相对弹窗真正居中 -->
      <div class="dialog-footer">
        <div class="footer-pagination">
          <el-pagination
            v-if="filteredList.length > pageSize"
            v-model:current-page="currentPage"
            :page-size="pageSize"
            :total="filteredList.length"
            layout="prev, pager, next"
            size="small"
            background
          />
        </div>
        <div class="footer-actions">
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" :disabled="!selectedTeacher" @click="handleConfirm"
            >确定</el-button
          >
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { Search, Reading } from '@element-plus/icons-vue';
import { normalizePersonnelType, personnelLabel } from '../../../utils/personnel';
import { truncateText } from '../../../utils/string';
import { useResponsive } from '../../../composables/useResponsive';

/* 响应式断点：复用全局共享实例，避免重复监听 + 内存泄漏 */
const { isMobile, isTablet } = useResponsive();

const props = defineProps({
  teacherList: { type: Array, default: () => [] },
  hourSettings: { type: Object, default: () => ({}) },
});

const emit = defineEmits(['confirm']);

const visible = ref(false);
const currentClass = ref(null);
const selectedTeacher = ref(null);

// M-10：搜索与分页状态
const searchKey = ref('');
const personnelFilter = ref('');
const textbookFilter = ref('');
const currentPage = ref(1);
const pageSize = 15;

// 教材筛选选项：从教师列表的已用教材聚合去重，按标题排序
const textbookOptions = computed(() => {
  const map = new Map();
  for (const t of props.teacherList) {
    for (const tb of t.assignedTextbooks || []) {
      if (!map.has(tb.id)) map.set(tb.id, tb);
    }
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
});

// M-10：按姓名 + 人员类别 + 教材过滤（normalizePersonnelType 兼容后端驼峰变体）
const filteredList = computed(() => {
  const key = searchKey.value.trim().toLowerCase();
  const type = personnelFilter.value;
  const tbId = textbookFilter.value;
  return props.teacherList.filter((t) => {
    if (key && !t.name?.toLowerCase().includes(key)) return false;
    if (type && normalizePersonnelType(t.personnelType) !== type) return false;
    if (tbId && !(t.assignedTextbooks || []).some((tb) => tb.id === tbId)) return false;
    return true;
  });
});

// M-10：分页切片
const pagedList = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return filteredList.value.slice(start, start + pageSize);
});

// M-10：搜索词或筛选器变化时重置到第一页
watch([searchKey, personnelFilter, textbookFilter], () => {
  currentPage.value = 1;
});

function uniqueTextbooks(textbooks) {
  if (!textbooks) return [];
  const seen = new Set();
  return textbooks.filter((tb) => {
    if (seen.has(tb.id)) return false;
    seen.add(tb.id);
    return true;
  });
}

function onTeacherSelect(teacher) {
  selectedTeacher.value = teacher;
}

/**
 * 审计修复：确认安排前检查课时是否超限，超限时弹出二次确认警告
 */
async function handleConfirm() {
  if (!selectedTeacher.value || !currentClass.value) return;
  const teacher = selectedTeacher.value;
  const newHours = currentClass.value.weeklyHours;
  const standardLimit =
    teacher.defaultWeeklyHours ??
    props.hourSettings[teacher.personnelType || 'full_time']?.standard ??
    16;
  const projectedTotal = teacher.totalWeeklyHours + newHours;

  if (projectedTotal > standardLimit) {
    try {
      await ElMessageBox.confirm(
        `教师「${teacher.name}」当前总课时 ${teacher.totalWeeklyHours}，安排后将达到 ${projectedTotal}，超过标准课时上限 ${standardLimit}。确认继续安排吗？`,
        '课时超限警告',
        {
          type: 'warning',
          confirmButtonText: '确认安排',
          cancelButtonText: '取消',
          confirmButtonClass: 'el-button--warning',
        }
      );
    } catch {
      // 用户取消
      return;
    }
  }

  emit('confirm', {
    classId: currentClass.value.classId,
    teacherId: teacher.id,
    weeklyHours: newHours,
  });
}

function open(row) {
  currentClass.value = row;
  selectedTeacher.value = null;
  searchKey.value = '';
  personnelFilter.value = '';
  textbookFilter.value = '';
  currentPage.value = 1;
  visible.value = true;
}

function close() {
  visible.value = false;
}

defineExpose({ open, close });
</script>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.search-input {
  width: 220px;
}
.personnel-select {
  width: 120px;
}
.textbook-select {
  width: 200px;
}
.filter-count {
  font-size: var(--font-size-body-sm);
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
/* 底部一行：三列布局，分页居中、操作按钮居右；无分页时占位列保持居中结构不塌陷 */
.dialog-footer {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}
.footer-pagination {
  grid-column: 2;
  justify-self: center;
}
.footer-actions {
  grid-column: 3;
  justify-self: end;
}
.text-warning {
  color: var(--brand-warning-text);
  font-weight: bold;
}
.text-placeholder {
  color: var(--text-placeholder);
  font-size: var(--font-size-caption);
}
/* 只带一本教材图标：警示色弱提示，紧跟姓名不独占列宽 */
.single-tb-icon {
  margin-left: 4px;
  font-size: 14px;
  color: var(--el-color-warning);
  vertical-align: -2px;
  cursor: help;
}
.tag-item {
  margin: 2px;
  /* 单个长书名超出列宽时省略显示 */
  max-width: 100%;
  overflow: hidden;
}
.tag-item :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── 响应式 ─── */
@media (max-width: 768px) {
  .filter-bar {
    flex-wrap: wrap;
  }
  .search-input {
    width: 100%;
  }
}

@media (max-width: 992px) and (min-width: 769px) {
  .search-input {
    width: 180px;
  }
}
</style>

<!-- 非 scoped：el-dialog 根节点是 Teleport，scope 属性无法附着到弹窗 DOM，
     scoped 下的 :deep(.teacher-dialog) 永远不命中；用专属类名限定作用范围防泄漏 -->
<style>
/* 弹窗垂直居中（align-center），高度按内容自然撑开，上限留 32px 安全边距；
   常规视口下 15 行/页可完整展示无内部滚动，
   仅小视口内容超高时才回退为 body 内部滚动，遮罩层永不出整页滚动条 */
.el-dialog.teacher-dialog {
  max-height: calc(100vh - 32px);
  /* dvh 双写：iOS Safari 动态工具栏下 100vh 大于可视区，防 footer 被底栏遮挡 */
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
}
/* 标题与底部按钮固定，仅教师列表区域滚动 */
.el-dialog.teacher-dialog .el-dialog__body {
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
</style>
