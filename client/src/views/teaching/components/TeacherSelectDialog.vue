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
      <span class="filter-count">共 {{ filteredList.length }} 位教师</span>
    </div>

    <el-table
      :data="pagedList"
      row-key="id"
      stripe
      highlight-current-row
      size="small"
      @current-change="onTeacherSelect"
    >
      <!-- 手机端无弹性列，姓名改用 min-width 吸收剩余宽度，避免右侧留白 -->
      <el-table-column
        prop="name"
        label="姓名"
        :width="isMobile ? undefined : 80"
        :min-width="isMobile ? 65 : undefined"
      />
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

    <!-- M-10：分页组件 -->
    <div v-if="filteredList.length > pageSize" class="pagination-bar">
      <el-pagination
        v-model:current-page="currentPage"
        :page-size="pageSize"
        :total="filteredList.length"
        layout="prev, pager, next"
        size="small"
        background
      />
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!selectedTeacher" @click="handleConfirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { Search } from '@element-plus/icons-vue';
import { personnelLabel } from '../../../utils/personnel';
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
const currentPage = ref(1);
const pageSize = 15;

// M-10：按姓名过滤
const filteredList = computed(() => {
  const key = searchKey.value.trim().toLowerCase();
  if (!key) return props.teacherList;
  return props.teacherList.filter((t) => t.name?.toLowerCase().includes(key));
});

// M-10：分页切片
const pagedList = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return filteredList.value.slice(start, start + pageSize);
});

// M-10：搜索词变化时重置到第一页
watch(searchKey, () => {
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
.filter-count {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.pagination-bar {
  display: flex;
  justify-content: center;
  margin-top: var(--space-3);
}
.text-warning {
  color: var(--brand-warning-text);
  font-weight: bold;
}
.text-placeholder {
  color: var(--text-placeholder);
  font-size: 12px;
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
