<template>
  <div class="teaching-arrange">
    <!-- 设置区 -->
    <HourSettingsCard
      v-model:selected-course-id="selectedCourseId"
      :current-semester-label="currentSemesterLabel"
      :all-courses="allCourses"
      ref="settingsCardRef"
      @course-change="onCourseChange"
    />

    <!-- 预览区 -->
    <CoursePreviewCard
      v-if="selectedCourseId && courseInfo"
      :course-info="courseInfo"
      :teacher-count="teacherList.length"
      :summary="summary"
      :exporting="exporting"
      @export="handleExportArrange"
    />

    <!-- 内容区：矩阵表 -->
    <el-card v-if="selectedCourseId" class="matrix-card">
      <template #header>
        <div class="card-header">
          <span>教学安排</span>
          <div class="card-header-actions">
            <el-select
              v-model="filterCollege"
              placeholder="学院"
              clearable
              style="width: 120px"
              @change="handleCollegeFilterChange"
            >
              <el-option v-for="v in collegeOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-select
              v-model="filterMajor"
              placeholder="专业"
              clearable
              filterable
              style="width: 130px"
              @change="handleMajorFilterChange"
            >
              <el-option v-for="v in majorOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-select
              v-model="filterTrainingLevel"
              placeholder="层次"
              clearable
              style="width: 100px"
              @change="handleTrainingLevelFilterChange"
            >
              <el-option v-for="v in trainingLevelOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-select v-model="filterGrade" placeholder="年级" clearable style="width: 90px">
              <el-option v-for="v in gradeOptions" :key="v" :label="v + '年级'" :value="v" />
            </el-select>
            <el-select
              v-model="filterTextbook"
              placeholder="教材"
              clearable
              filterable
              style="width: 140px"
            >
              <el-option v-for="v in textbookOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-checkbox v-model="previewMode" style="margin-left: 8px">预览模式</el-checkbox>
            <el-button type="success" :loading="arranging" @click="handleAutoArrange('full')">
              <el-icon><MagicStick /></el-icon> 全量模式
            </el-button>
            <el-button type="warning" :loading="arranging" @click="handleAutoArrange('standard')">
              <el-icon><SetUp /></el-icon> 标准模式
            </el-button>
            <el-dropdown
              :disabled="batchArranging"
              style="margin-left: 4px"
              @command="handleBatchAutoArrange"
            >
              <el-button type="primary" :loading="batchArranging">
                批量排课<el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="full">全量模式（所有课程）</el-dropdown-item>
                  <el-dropdown-item command="standard">标准模式（所有课程）</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-popconfirm title="确定重置所有自动安排？" @confirm="handleReset">
              <template #reference>
                <el-button type="danger">
                  <el-icon><RefreshRight /></el-icon> 重置
                </el-button>
              </template>
            </el-popconfirm>
          </div>
        </div>
      </template>

      <el-table
        v-loading="tableLoading"
        :data="filteredClassList"
        stripe
        row-key="classId"
        :row-class-name="tableRowClassName"
        class="adaptive-table"
      >
        <el-table-column type="index" label="#" width="50" />
        <el-table-column prop="className" label="班级名称" min-width="140" show-overflow-tooltip />
        <el-table-column prop="collegeName" label="学院" min-width="100" show-overflow-tooltip />
        <el-table-column prop="majorName" label="专业" min-width="100" show-overflow-tooltip />
        <el-table-column
          prop="trainingLevelName"
          label="培养层次"
          min-width="80"
          show-overflow-tooltip
        />
        <el-table-column label="入学年份" min-width="80" align="center">
          <template #default="{ row }">{{ row.enrollmentYear }}</template>
        </el-table-column>
        <el-table-column label="年级" min-width="60" align="center">
          <template #default="{ row }">{{ row.grade }}</template>
        </el-table-column>
        <el-table-column label="在读学期" min-width="80" align="center">
          <template #default="{ row }">第{{ row.currentSemester }}学期</template>
        </el-table-column>
        <el-table-column label="人数" min-width="60" align="center">
          <template #default="{ row }">{{ row.studentCount }}</template>
        </el-table-column>
        <el-table-column label="周课时" min-width="70" align="center">
          <template #default="{ row }">{{ row.weeklyHours }}</template>
        </el-table-column>
        <el-table-column label="教材" min-width="160">
          <template #default="{ row }">
            <div v-if="row.textbooks?.length" class="textbook-tags">
              <el-tag
                v-for="tb in row.textbooks"
                :key="tb.id"
                size="small"
                type="info"
                class="tag-item"
                >{{ tb.title }}</el-tag
              >
            </div>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="任课教师" min-width="140">
          <template #default="{ row }">
            <div
              class="teacher-cell"
              :class="{ 'has-teacher': row.assignment, 'no-teacher': !row.assignment }"
              @click="openTeacherSelect(row)"
            >
              <template v-if="row.assignment">
                <el-tag
                  :type="row.assignment.isAuto ? 'info' : 'primary'"
                  size="small"
                  closable
                  @close.stop="handleRemoveAssignment(row)"
                >
                  {{ row.assignment.teacherName }}
                </el-tag>
              </template>
              <span v-else class="text-placeholder">点击安排</span>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 教师选择弹窗 -->
    <TeacherSelectDialog
      ref="teacherDialogRef"
      :teacher-list="teacherList"
      :hour-settings="hourSettingsRef"
      @confirm="onTeacherConfirm"
    />

    <!-- 单课程排课结果弹窗 -->
    <ArrangeResultDialog
      v-model="arrangeResultVisible"
      :result="arrangeResult"
      :mode="arrangeResultMode"
      :preview-mode="previewMode"
      :arranging="arranging"
      @execute="handleExecutePreview"
    />

    <!-- 批量排课结果弹窗 -->
    <BatchResultDialog v-model="batchResultVisible" :result="batchResult" />

    <!-- 自动排课确认弹窗（单课程） -->
    <ArrangeConfirmDialog
      v-model="arrangeConfirmVisible"
      type="single"
      :data="arrangeConfirmData"
      :loading="arranging"
      @confirm="doAutoArrange"
    />

    <!-- 自动排课确认弹窗（批量） -->
    <ArrangeConfirmDialog
      v-model="batchConfirmVisible"
      type="batch"
      :data="batchConfirmData"
      :loading="batchArranging"
      @confirm="doBatchAutoArrange"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, defineAsyncComponent } from 'vue';
import { ElMessage } from 'element-plus';
import { useFilterLinkage } from '@/components/filter/composables/useFilterLinkage';
import { useSettingsStore } from '../../stores/settings';
import { getCourses } from '../../api/course';
import request from '../../utils/request';
import { downloadBlob } from '../../utils/download';
import {
  getCourseClasses,
  getCourseTeachers,
  assignTeacher,
  deleteAssignment,
  runAutoArrange,
  runBatchAutoArrange,
  resetAutoAssignments,
} from '../../api/teachingArrange';

import HourSettingsCard from './components/HourSettingsCard.vue';
import CoursePreviewCard from './components/CoursePreviewCard.vue';

const TeacherSelectDialog = defineAsyncComponent(
  () => import('./components/TeacherSelectDialog.vue')
);
const ArrangeResultDialog = defineAsyncComponent(
  () => import('./components/ArrangeResultDialog.vue')
);
const BatchResultDialog = defineAsyncComponent(() => import('./components/BatchResultDialog.vue'));
const ArrangeConfirmDialog = defineAsyncComponent(
  () => import('./components/ArrangeConfirmDialog.vue')
);

// 学期相关
const currentSemesterLabel = ref('');
const selectedCourseId = ref(null);
const allCourses = ref([]);
const courseInfo = ref(null);

// HourSettingsCard 的 hourSettings 引用
const settingsCardRef = ref(null);
const hourSettingsRef = computed(() => settingsCardRef.value?.hourSettings || {});

// 数据
const classList = ref([]);
const teacherList = ref([]);
const tableLoading = ref(false);
const summary = ref({
  totalClasses: 0,
  assignedCount: 0,
  unassignedCount: 0,
  totalCourseHours: 0,
  assignedHours: 0,
  remainingHours: 0,
});

// 筛选器
const filterCollege = ref('');
const filterMajor = ref('');
const filterGrade = ref('');
const filterTrainingLevel = ref('');
const filterTextbook = ref('');
const previewMode = ref(false);

// 使用通用联动Hook
const filters = computed(() => ({
  college: filterCollege.value,
  major: filterMajor.value,
  trainingLevel: filterTrainingLevel.value,
}));

const { handleParentChange } = useFilterLinkage({
  filters,
  relations: {},
});

// 合并 5 个筛选 computed 为单次遍历
const filterOptions = computed(() => {
  const colleges = new Set();
  const majors = new Set();
  const grades = new Set();
  const trainingLevels = new Set();
  const textbooks = new Set();

  const fCollege = filterCollege.value;
  const fMajor = filterMajor.value;

  for (const c of classList.value) {
    if (c.collegeName) colleges.add(c.collegeName);

    const matchCollege = !fCollege || c.collegeName === fCollege;
    const matchCollegeMajor = matchCollege && (!fMajor || c.majorName === fMajor);

    if (c.majorName && matchCollege) majors.add(c.majorName);
    if (c.grade && matchCollegeMajor) grades.add(c.grade);
    if (c.trainingLevelName && matchCollegeMajor) trainingLevels.add(c.trainingLevelName);
    if (c.textbooks) {
      for (const tb of c.textbooks) {
        if (tb.title) textbooks.add(tb.title);
      }
    }
  }

  return {
    colleges: [...colleges].sort(),
    majors: [...majors].sort(),
    grades: [...grades].sort((a, b) => a - b),
    trainingLevels: [...trainingLevels].sort(),
    textbooks: [...textbooks].sort(),
  };
});

const collegeOptions = computed(() => filterOptions.value.colleges);
const majorOptions = computed(() => filterOptions.value.majors);
const gradeOptions = computed(() => filterOptions.value.grades);
const trainingLevelOptions = computed(() => filterOptions.value.trainingLevels);
const textbookOptions = computed(() => filterOptions.value.textbooks);

const filteredClassList = computed(() => {
  return classList.value.filter((c) => {
    if (filterCollege.value && c.collegeName !== filterCollege.value) return false;
    if (filterMajor.value && c.majorName !== filterMajor.value) return false;
    if (filterGrade.value && c.grade !== filterGrade.value) return false;
    if (filterTrainingLevel.value && c.trainingLevelName !== filterTrainingLevel.value)
      return false;
    if (filterTextbook.value) {
      const titles = (c.textbooks || []).map((tb) => tb.title);
      if (!titles.includes(filterTextbook.value)) return false;
    }
    return true;
  });
});

// 自动排课状态
const arranging = ref(false);
const batchArranging = ref(false);
const exporting = ref(false);

// 教师选择弹窗
const teacherDialogRef = ref(null);

// 自动排课确认弹窗
const arrangeConfirmVisible = ref(false);
const arrangeConfirmData = ref({
  title: '',
  mode: '',
  message: '',
  confirmText: '',
  courseName: '',
});
let pendingArrangeMode = null;

// 批量排课确认弹窗
const batchConfirmVisible = ref(false);
const batchConfirmData = ref({ title: '', mode: '', message: '', confirmText: '确定批量排课' });
let pendingBatchMode = null;

// 批量排课结果弹窗
const batchResultVisible = ref(false);
const batchResult = ref({});

// 单课程排课结果弹窗
const arrangeResultVisible = ref(false);
const arrangeResult = ref({});
const arrangeResultMode = ref('');

function tableRowClassName({ row }) {
  return row.assignment ? '' : 'unassigned-row';
}

// --- 学期与课程 ---
const settingsStore = useSettingsStore();

async function loadSemester() {
  try {
    await settingsStore.load();
    currentSemesterLabel.value = settingsStore.currentSemesterValue();
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('获取学期失败:', e);
    }
  }
}

async function loadCourses() {
  try {
    const res = await getCourses();
    allCourses.value = res.data || [];
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('加载课程列表失败:', e);
    }
  }
}

async function onCourseChange(courseId) {
  filterCollege.value = '';
  filterMajor.value = '';
  filterGrade.value = '';
  filterTrainingLevel.value = '';
  filterTextbook.value = '';
  if (!courseId) {
    classList.value = [];
    teacherList.value = [];
    courseInfo.value = null;
    return;
  }
  courseInfo.value = allCourses.value.find((c) => c.id === courseId) || null;
  await loadData();
}

async function loadData() {
  if (!selectedCourseId.value || !currentSemesterLabel.value) return;
  tableLoading.value = true;
  try {
    const [classesRes, teachersRes] = await Promise.all([
      getCourseClasses({ course_id: selectedCourseId.value, semester: currentSemesterLabel.value }),
      getCourseTeachers({
        course_id: selectedCourseId.value,
        semester: currentSemesterLabel.value,
      }),
    ]);
    const classData = classesRes.data || {};
    classList.value = classData.classes || [];
    summary.value = classData.summary || {
      totalClasses: 0,
      assignedCount: 0,
      unassignedCount: 0,
      totalCourseHours: 0,
      assignedHours: 0,
      remainingHours: 0,
    };
    teacherList.value = teachersRes.data || [];
  } catch (e) {
    ElMessage.error('加载数据失败');
    if (import.meta.env.DEV) {
      console.error('加载数据失败:', e);
    }
  } finally {
    tableLoading.value = false;
  }
}

// --- 教师选择 ---
function openTeacherSelect(row) {
  teacherDialogRef.value?.open(row);
}

async function onTeacherConfirm({ classId, teacherId, weeklyHours }) {
  try {
    await assignTeacher({
      classId,
      courseId: selectedCourseId.value,
      semester: currentSemesterLabel.value,
      teacherId,
      weeklyHours,
    });
    ElMessage.success('安排成功');
    await loadData();
  } catch (e) {
    ElMessage.error('安排失败');
  }
}

async function handleRemoveAssignment(row) {
  if (!row.assignment?.id) return;
  try {
    await deleteAssignment(row.assignment.id);
    ElMessage.success('已移除安排');
    await loadData();
  } catch (e) {
    ElMessage.error('操作失败');
  }
}

// --- 自动排课 ---
function handleAutoArrange(mode) {
  const modeLabel = mode === 'full' ? '全量模式' : '标准模式';
  const isPreview = previewMode.value;

  arrangeConfirmData.value = {
    title: isPreview ? `预览排课 - ${modeLabel}` : `自动排课 - ${modeLabel}`,
    mode: modeLabel,
    courseName: courseInfo.value?.name || '当前课程',
    message: isPreview
      ? '将以预览模式运行，结果不会写入数据库。预览满意后可在结果弹窗中点击"执行排课"按钮应用结果。'
      : '将自动安排当前课程的所有班级（已有手动安排不会被覆盖）。',
    confirmText: isPreview ? '开始预览' : '确定排课',
  };
  pendingArrangeMode = mode;
  arrangeConfirmVisible.value = true;
}

async function doAutoArrange() {
  const mode = pendingArrangeMode;
  arrangeConfirmVisible.value = false;

  arranging.value = true;
  try {
    const res = await runAutoArrange({
      courseId: selectedCourseId.value,
      semester: currentSemesterLabel.value,
      mode,
      hourSettings: hourSettingsRef.value,
      preview: previewMode.value,
    });
    const data = res.data || {};
    arrangeResult.value = data;
    arrangeResultMode.value = arrangeConfirmData.value.mode;
    arrangeResultVisible.value = true;

    if (!previewMode.value) {
      await loadData();
    }
  } catch (e) {
    ElMessage.error('自动排课失败');
    if (import.meta.env.DEV) {
      console.error('自动排课失败:', e);
    }
  } finally {
    arranging.value = false;
  }
}

async function handleExecutePreview() {
  const wasPreview = previewMode.value;
  previewMode.value = false;

  const mode = arrangeResultMode.value === '全量模式' ? 'full' : 'standard';

  arranging.value = true;
  try {
    await runAutoArrange({
      courseId: selectedCourseId.value,
      semester: currentSemesterLabel.value,
      mode,
      hourSettings: hourSettingsRef.value,
      preview: false,
    });

    await loadData();
    ElMessage.success('排课已执行');
    arrangeResultVisible.value = false;
  } catch (e) {
    ElMessage.error('执行排课失败');
    if (import.meta.env.DEV) {
      console.error('执行排课失败:', e);
    }
  } finally {
    arranging.value = false;
    previewMode.value = wasPreview;
  }
}

// --- 批量排课 ---
function handleBatchAutoArrange(mode) {
  const modeLabel = mode === 'full' ? '全量模式' : '标准模式';
  batchConfirmData.value = {
    title: `批量排课 - ${modeLabel}`,
    mode: modeLabel,
    message: '这会覆盖所有课程的自动安排（手动安排不受影响）。确定继续？',
    confirmText: '确定批量排课',
  };
  pendingBatchMode = mode;
  batchConfirmVisible.value = true;
}

async function doBatchAutoArrange() {
  const mode = pendingBatchMode;
  batchConfirmVisible.value = false;

  batchArranging.value = true;
  try {
    const res = await runBatchAutoArrange({
      semester: currentSemesterLabel.value,
      mode,
      hourSettings: hourSettingsRef.value,
    });
    const data = res.data || {};
    const s = data.summary || {};

    batchResult.value = data;
    batchResultVisible.value = true;

    await loadData();
  } catch (e) {
    ElMessage.error('批量排课失败');
    if (import.meta.env.DEV) {
      console.error('批量排课失败:', e);
    }
  } finally {
    batchArranging.value = false;
  }
}

// --- 重置 ---
async function handleReset() {
  try {
    const res = await resetAutoAssignments({
      courseId: selectedCourseId.value,
      semester: currentSemesterLabel.value,
    });
    ElMessage.success(res.message || '已重置');
    await loadData();
  } catch (e) {
    ElMessage.error('重置失败');
  }
}

// --- 导出 ---
async function handleExportArrange() {
  if (!selectedCourseId.value || !currentSemesterLabel.value) return;
  exporting.value = true;
  try {
    const params = {
      course_id: selectedCourseId.value,
      semester: currentSemesterLabel.value,
    };

    if (filterCollege.value) params.college = filterCollege.value;
    if (filterMajor.value) params.major = filterMajor.value;
    if (filterTrainingLevel.value) params.training_level = filterTrainingLevel.value;
    if (filterGrade.value) params.grade = filterGrade.value;
    if (filterTextbook.value) params.textbook = filterTextbook.value;

    const response = await request.get('/export/teaching-arrange', {
      params,
      responseType: 'blob',
    });
    downloadBlob(
      response,
      `教学安排_${courseInfo.value?.name || ''}_${currentSemesterLabel.value}.xlsx`
    );
    ElMessage.success('导出成功');
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('导出失败:', e);
    }
    ElMessage.error('导出失败');
  } finally {
    exporting.value = false;
  }
}

// --- 筛选器处理 ---
function handleCollegeFilterChange() {
  handleParentChange('college', ['major', 'trainingLevel'], () => {
    filterGrade.value = '';
    filterTextbook.value = '';
  });
}

function handleMajorFilterChange() {
  handleParentChange('major', ['trainingLevel'], () => {
    filterGrade.value = '';
    filterTextbook.value = '';
  });
}

function handleTrainingLevelFilterChange() {
  filterGrade.value = '';
  filterTextbook.value = '';
}

onMounted(() => {
  loadSemester();
  loadCourses();
});
</script>

<style scoped>
.matrix-card {
  margin-bottom: 16px;
}
.card-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.card-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.teacher-cell {
  cursor: pointer;
  min-height: 32px;
  display: flex;
  align-items: center;
}
.text-placeholder {
  color: #c0c4cc;
  font-size: 12px;
}
.tag-item {
  margin: 2px;
}
:deep(.unassigned-row) {
  background-color: #fff5f5 !important;
}
.adaptive-table :deep(.el-table__header th .cell) {
  white-space: nowrap;
}
.adaptive-table :deep(.el-table__body td .cell) {
  white-space: nowrap;
}
</style>
