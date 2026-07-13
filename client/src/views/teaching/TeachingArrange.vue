<template>
  <div class="teaching-arrange">
    <PageHeader
      title="教学安排"
      subtitle="智能排课"
      description="为课程自动分配教师课时，支持排课偏好和学院/层次匹配"
    />
    <!-- 设置区 -->
    <HourSettingsCard
      ref="settingsCardRef"
      v-model:selected-course-id="selectedCourseId"
      :current-semester-label="currentSemesterLabel"
      :all-courses="allCourses"
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
            <el-button type="warning" :loading="arranging" @click="handleAutoArrange('full')">
              <el-icon><MagicStick /></el-icon> 全量模式
            </el-button>
            <el-button type="success" :loading="arranging" @click="handleAutoArrange('standard')">
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
            <el-dropdown style="margin-left: 4px" @command="handleResetCommand">
              <el-button type="danger">
                <el-icon><RefreshRight /></el-icon> 重置<el-icon class="el-icon--right"
                  ><ArrowDown
                /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="current">重置当前科目</el-dropdown-item>
                  <el-dropdown-item command="all">重置全部科目</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </template>

      <el-table
        v-loading="tableLoading"
        :data="paginatedClassList"
        stripe
        row-key="classId"
        :row-class-name="tableRowClassName"
        class="adaptive-table"
      >
        <el-table-column type="index" label="#" width="50" />
        <el-table-column prop="className" label="班级名称" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.className }}</span>
            <el-tooltip
              v-if="row.combinationId != null"
              :content="
                row.partnerClassNames ? `合班伙伴：${row.partnerClassNames}` : '已标记合班教学'
              "
              placement="top"
              effect="light"
            >
              <el-icon class="combined-icon" :size="16"><Connection /></el-icon>
            </el-tooltip>
          </template>
        </el-table-column>
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
                <span class="replace-hint">
                  <el-icon :size="12"><EditPen /></el-icon>
                  更换
                </span>
              </template>
              <template v-else>
                <el-icon :size="14" style="margin-right: 4px; opacity: 0.5"><Plus /></el-icon>
                <span class="text-placeholder">点击安排</span>
              </template>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div style="display: flex; justify-content: flex-end; margin-top: 16px">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="filteredClassList.length"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handlePageChange"
          @current-change="handlePageChange"
        />
      </div>
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

    <!-- 排课进度弹窗 -->
    <ArrangeProgressDialog
      v-model="progressVisible"
      :type="progressType"
      :mode-label="progressModeLabel"
      :finished="progressFinished"
      :current-phase="progressCurrentPhase"
      :processed="progressProcessed"
      :total="progressTotal"
      :current-course-name="progressCurrentCourseName"
      :cumulative-assigned="progressCumulativeAssigned"
      :cumulative-unassigned="progressCumulativeUnassigned"
      :message="progressMessage"
      :tabu-enabled="tabuSearchEnabled"
      @close="handleProgressClose"
    />

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

    <!-- 重置排课确认弹窗 -->
    <el-dialog v-model="resetConfirmVisible" title="确认重置" width="min(520px, 90vw)" align-center>
      <div style="display: flex; gap: 12px; align-items: flex-start">
        <el-icon :size="24" color="var(--brand-danger)" style="flex-shrink: 0; margin-top: 2px">
          <WarningFilled />
        </el-icon>
        <div style="flex: 1; line-height: 1.6; color: var(--text-regular)">
          <p v-if="resetScope === 'current'" style="margin: 0">
            确定要重置「{{ courseInfo?.name || '当前课程' }}」的所有自动排课安排吗？此操作不可撤销。
          </p>
          <p v-else style="margin: 0">
            确定要重置本学期<strong>全部科目</strong>的自动排课安排吗？此操作不可撤销。
          </p>
          <p style="margin: 8px 0 0; color: var(--brand-danger-text); font-size: 13px">
            将清除{{
              resetScope === 'current' ? '该课程' : '所有课程'
            }}在本学期的所有自动分配记录，手动安排不受影响。
          </p>
        </div>
      </div>
      <template #footer>
        <el-button @click="resetConfirmVisible = false">取消</el-button>
        <el-button type="danger" :loading="resetting" @click="handleReset"> 确定重置 </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, defineAsyncComponent } from 'vue';
import { ElMessage } from 'element-plus';
import { WarningFilled, Connection } from '@element-plus/icons-vue';
import { useFilterLinkage } from '@/components/filter/composables/useFilterLinkage';
import { useSettingsStore } from '../../stores/settings';
import { getCourses } from '../../api/course';
import { exportTeachingArrange } from '../../api/export';
import { downloadBlob } from '../../utils/download';
import {
  getCourseClasses,
  getCourseTeachers,
  assignTeacher,
  deleteAssignment,
  runAutoArrangeWithProgress,
  runBatchAutoArrangeWithProgress,
  resetAutoAssignments,
} from '../../api/teachingArrange';

import HourSettingsCard from './components/HourSettingsCard.vue';
import CoursePreviewCard from './components/CoursePreviewCard.vue';
import PageHeader from '../../components/PageHeader.vue';

defineOptions({ name: 'TeachingArrange' });

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
const ArrangeProgressDialog = defineAsyncComponent(
  () => import('./components/ArrangeProgressDialog.vue')
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

// P-04: 客户端分页
const currentPage = ref(1);
const pageSize = ref(20);

const paginatedClassList = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredClassList.value.slice(start, start + pageSize.value);
});

watch(filteredClassList, () => {
  currentPage.value = 1;
});

function handlePageChange() {
  // 分页变化时自动触发（el-pagination 事件）
}

// 自动排课状态
const arranging = ref(false);
const batchArranging = ref(false);
const exporting = ref(false);

// 排课进度弹窗
const progressVisible = ref(false);
const progressType = ref('single'); // 'single' | 'batch'
const progressModeLabel = ref('');
const progressFinished = ref(false);
const progressCurrentPhase = ref(0);
const progressProcessed = ref(0);
const progressTotal = ref(0);
const progressCurrentCourseName = ref('');
const progressCumulativeAssigned = ref(0);
const progressCumulativeUnassigned = ref(0);
const progressMessage = ref('');

function resetProgress() {
  progressFinished.value = false;
  progressCurrentPhase.value = 0;
  progressProcessed.value = 0;
  progressTotal.value = 0;
  progressCurrentCourseName.value = '';
  progressCumulativeAssigned.value = 0;
  progressCumulativeUnassigned.value = 0;
  progressMessage.value = '';
}

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
const resetConfirmVisible = ref(false);
const resetting = ref(false);
const resetScope = ref('current');

function tableRowClassName({ row }) {
  return row.assignment ? '' : 'unassigned-row';
}

// --- 学期与课程 ---
const settingsStore = useSettingsStore();

// 禁忌搜索开关状态（来自系统设置），用于排课进度弹窗直观提示是否启用
const tabuSearchEnabled = computed(
  () => settingsStore.settings?.tabuSearchEnabled?.value === 'true'
);

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
      getCourseClasses({ courseId: selectedCourseId.value, semester: currentSemesterLabel.value }),
      getCourseTeachers({
        courseId: selectedCourseId.value,
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
    teacherDialogRef.value?.close();
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
  // 初始化进度弹窗
  resetProgress();
  progressType.value = 'single';
  progressModeLabel.value = arrangeConfirmData.value.mode;
  progressVisible.value = true;

  try {
    const result = await runAutoArrangeWithProgress(
      {
        courseId: selectedCourseId.value,
        semester: currentSemesterLabel.value,
        mode,
        hourSettings: hourSettingsRef.value,
        preview: previewMode.value,
      },
      (progress) => {
        // 单课程进度：更新当前阶段
        if (progress.phase) {
          progressCurrentPhase.value = progress.phase;
        }
      }
    );
    const data = result.data || {};
    progressFinished.value = true;
    progressMessage.value = result.message;

    arrangeResult.value = data;
    arrangeResultMode.value = arrangeConfirmData.value.mode;

    if (!previewMode.value) {
      await loadData();
    }
    // 进度弹窗保持显示完成状态，用户点击"关闭"后展示结果弹窗
  } catch (e) {
    progressVisible.value = false;
    ElMessage.error('自动排课失败');
    if (import.meta.env.DEV) {
      console.error('自动排课失败:', e);
    }
  } finally {
    arranging.value = false;
  }
}

function handleProgressClose() {
  progressVisible.value = false;
  // 排课完成后，根据类型展示对应的结果弹窗
  if (progressType.value === 'batch') {
    if (batchResult.value && Object.keys(batchResult.value).length > 0) {
      batchResultVisible.value = true;
    }
  } else {
    if (arrangeResult.value && Object.keys(arrangeResult.value).length > 0) {
      arrangeResultVisible.value = true;
    }
  }
}

async function handleExecutePreview() {
  const wasPreview = previewMode.value;
  previewMode.value = false;

  const mode = arrangeResultMode.value === '全量模式' ? 'full' : 'standard';

  arranging.value = true;
  // 初始化进度弹窗
  resetProgress();
  progressType.value = 'single';
  progressModeLabel.value = arrangeResultMode.value;
  progressVisible.value = true;

  try {
    await runAutoArrangeWithProgress(
      {
        courseId: selectedCourseId.value,
        semester: currentSemesterLabel.value,
        mode,
        hourSettings: hourSettingsRef.value,
        preview: false,
      },
      (progress) => {
        if (progress.phase) {
          progressCurrentPhase.value = progress.phase;
        }
      }
    );

    await loadData();
    progressFinished.value = true;
    progressMessage.value = '排课已执行，可关闭此弹窗';
    arrangeResultVisible.value = false;
    // handleExecutePreview 场景：执行排课后不需要再弹出结果弹窗
    // 清空 arrangeResult 避免 handleProgressClose 重复展示
    arrangeResult.value = {};
  } catch (e) {
    progressVisible.value = false;
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
  // 初始化进度弹窗
  resetProgress();
  progressType.value = 'batch';
  progressModeLabel.value = batchConfirmData.value.mode;
  progressVisible.value = true;

  try {
    const result = await runBatchAutoArrangeWithProgress(
      {
        semester: currentSemesterLabel.value,
        mode,
        hourSettings: hourSettingsRef.value,
      },
      (progress) => {
        // 批量进度：更新已处理课程数和当前课程名
        if (progress.processed != null) {
          progressProcessed.value = progress.processed;
          progressTotal.value = progress.total;
          progressCurrentCourseName.value = progress.currentCourseName || '';
          progressCumulativeAssigned.value = progress.cumulativeAssigned || 0;
          progressCumulativeUnassigned.value = progress.cumulativeUnassigned || 0;
        }
      }
    );
    const data = result.data || {};
    progressFinished.value = true;
    progressMessage.value = result.message;

    batchResult.value = data;
    await loadData();
    // 进度弹窗保持显示完成状态，用户点击"关闭"后展示结果弹窗
  } catch (e) {
    progressVisible.value = false;
    ElMessage.error('批量排课失败');
    if (import.meta.env.DEV) {
      console.error('批量排课失败:', e);
    }
  } finally {
    batchArranging.value = false;
  }
}

// --- 重置 ---
function handleResetCommand(command) {
  resetScope.value = command;
  resetConfirmVisible.value = true;
}

async function handleReset() {
  resetting.value = true;
  try {
    const payload = { semester: currentSemesterLabel.value };
    if (resetScope.value === 'current') {
      payload.courseId = selectedCourseId.value;
    }
    const res = await resetAutoAssignments(payload);
    ElMessage.success(res.message || '已重置');
    resetConfirmVisible.value = false;
    await loadData();
  } catch (e) {
    ElMessage.error('重置失败');
  } finally {
    resetting.value = false;
  }
}

// --- 导出 ---
async function handleExportArrange() {
  if (!selectedCourseId.value || !currentSemesterLabel.value) return;
  exporting.value = true;
  try {
    const params = {
      courseId: selectedCourseId.value,
      semester: currentSemesterLabel.value,
    };

    if (filterCollege.value) params.college = filterCollege.value;
    if (filterMajor.value) params.major = filterMajor.value;
    if (filterTrainingLevel.value) params.trainingLevel = filterTrainingLevel.value;
    if (filterGrade.value) params.grade = filterGrade.value;
    if (filterTextbook.value) params.textbook = filterTextbook.value;

    const response = await exportTeachingArrange(params);
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

// H-6 修复：串行加载，确保学期数据就绪后再加载课程列表，避免竞态导致空表格
onMounted(async () => {
  await loadSemester();
  await loadCourses();
});
</script>

<style scoped>
.matrix-card {
  margin-bottom: 16px;
}
.combined-icon {
  margin-left: 4px;
  vertical-align: middle;
  color: var(--brand-indigo);
  cursor: help;
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
  gap: 6px;
  /* flex:1 撑满父级 .cell（flex容器），负边距消除父级 padding 点击死区 */
  flex: 1;
  margin: -4px -10px;
  padding: 4px 10px;
  border-radius: 4px;
  transition: background-color 0.15s ease;
}
.teacher-cell:hover {
  background-color: var(--el-color-primary-light-9, #e8f3fe);
}
.teacher-cell.no-teacher:hover .text-placeholder {
  color: var(--el-color-primary);
}
.replace-hint {
  display: none;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: var(--el-color-primary);
  white-space: nowrap;
}
.teacher-cell.has-teacher:hover .replace-hint {
  display: inline-flex;
}
.text-placeholder {
  color: var(--text-placeholder);
  font-size: 12px;
}
.tag-item {
  margin: 2px;
}
:deep(.unassigned-row) {
  background-color: var(--brand-danger-soft) !important;
}
.adaptive-table :deep(.el-table__header th .cell) {
  white-space: nowrap;
}
.adaptive-table :deep(.el-table__body td .cell) {
  white-space: nowrap;
}
</style>
