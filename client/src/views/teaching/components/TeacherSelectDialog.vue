<template>
  <el-dialog
    v-model="visible"
    title="选择任课教师"
    width="80%"
    :style="{ maxWidth: '1400px' }"
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
      <el-table-column prop="name" label="姓名" width="80" />
      <el-table-column label="人员类别" width="88" align="center">
        <template #default="{ row }">{{ personnelLabel(row.personnelType) }}</template>
      </el-table-column>
      <el-table-column label="当前总课时" width="92" align="center">
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
      <el-table-column label="班级数" width="68" align="center">
        <template #default="{ row }">{{ row.totalClassCount }}</template>
      </el-table-column>
      <el-table-column label="自定义课时" width="92" align="center">
        <template #default="{ row }">{{ row.defaultWeeklyHours ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="学科" min-width="3">
        <template #default="{ row }">
          <el-tag v-for="c in row.courseList" :key="c.id" size="small" class="tag-item">{{
            c.name
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="任课学院" min-width="4">
        <template #default="{ row }">
          <el-tag
            v-for="c in row.collegeList"
            :key="c.id"
            size="small"
            type="info"
            class="tag-item"
            >{{ c.name }}</el-tag
          >
        </template>
      </el-table-column>
      <el-table-column label="任课层次" min-width="3">
        <template #default="{ row }">
          <el-tag
            v-for="l in row.trainingLevelList"
            :key="l.id"
            size="small"
            type="warning"
            class="tag-item"
            >{{ l.name }}</el-tag
          >
        </template>
      </el-table-column>
      <el-table-column label="已用教材" min-width="8">
        <template #default="{ row }">
          <template v-if="uniqueTextbooks(row.assignedTextbooks).length">
            <el-tag
              v-for="tb in uniqueTextbooks(row.assignedTextbooks)"
              :key="tb.id"
              size="small"
              type="info"
              class="tag-item"
              >{{ tb.title }}</el-tag
            >
          </template>
          <span v-else class="text-placeholder">-</span>
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
import { Search } from '@element-plus/icons-vue';
import { personnelLabel } from '../../../utils/personnel';

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

function handleConfirm() {
  if (!selectedTeacher.value || !currentClass.value) return;
  emit('confirm', {
    classId: currentClass.value.classId,
    teacherId: selectedTeacher.value.id,
    weeklyHours: currentClass.value.weeklyHours,
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
:deep(.teacher-dialog) .el-dialog__body {
  overflow-x: hidden;
}
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
}
</style>
