<template>
  <el-dialog
    v-model="visible"
    title="选择任课教师"
    width="80%"
    destroy-on-close
    class="teacher-dialog"
  >
    <el-table
      :data="teacherList"
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
      <el-table-column label="已用教材" min-width="5">
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
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!selectedTeacher" @click="handleConfirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue';
import { personnelLabel } from '../../../utils/personnel';

defineProps({
  teacherList: { type: Array, default: () => [] },
  hourSettings: { type: Object, default: () => ({}) },
});

const emit = defineEmits(['confirm']);

const visible = ref(false);
const currentClass = ref(null);
const selectedTeacher = ref(null);

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
.text-warning {
  color: var(--brand-warning);
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
