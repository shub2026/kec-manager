<template>
  <div class="teaching-arrange">
    <PageHeader
      title="教学安排"
      subtitle="智能排课"
      description="为课程自动分配教师课时，支持排课偏好和学院/层次匹配"
    >
      <template #extra>
        <SemesterSelect v-model="selectedSemester" @change="onSemesterChange" />
      </template>
    </PageHeader>

    <!-- 学期状态提示 -->
    <el-alert
      v-if="historicalReadOnly"
      type="warning"
      :closable="false"
      show-icon
      class="historical-alert"
      title="当前为历史学期只读模式，禁止编辑"
      description="如需编辑，请在 系统设置 → 排课优化 开启「允许编辑历史学期」开关"
    />
    <el-alert
      v-else-if="historicalGuarded"
      type="warning"
      :closable="false"
      show-icon
      class="historical-alert"
      title="正在编辑历史学期，保存前需二次确认"
    />

    <!-- 设置区 -->
    <HourSettingsCard
      ref="settingsCardRef"
      v-model:selected-course-id="selectedCourseId"
      :current-semester-label="selectedSemester"
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
              class="header-filter filter-md"
              @change="handleCollegeFilterChange"
            >
              <el-option v-for="v in collegeOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-select
              v-model="filterMajor"
              placeholder="专业"
              clearable
              filterable
              class="header-filter filter-lg"
              @change="handleMajorFilterChange"
            >
              <el-option v-for="v in majorOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-select
              v-model="filterTrainingLevel"
              placeholder="层次"
              clearable
              class="header-filter filter-sm"
              @change="handleTrainingLevelFilterChange"
            >
              <el-option v-for="v in trainingLevelOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-select
              v-model="filterGrade"
              placeholder="年级"
              clearable
              class="header-filter filter-xs"
            >
              <el-option v-for="v in gradeOptions" :key="v" :label="v + '年级'" :value="v" />
            </el-select>
            <el-select
              v-model="filterTextbook"
              placeholder="教材"
              clearable
              filterable
              class="header-filter filter-xl"
            >
              <el-option v-for="v in textbookOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-checkbox v-model="previewMode" class="preview-checkbox">预览模式</el-checkbox>
            <el-button
              type="warning"
              :loading="arranging"
              :disabled="historicalReadOnly"
              @click="handleAutoArrange('full')"
            >
              <el-icon><MagicStick /></el-icon> 全量模式
            </el-button>
            <el-button
              type="success"
              :loading="arranging"
              :disabled="historicalReadOnly"
              @click="handleAutoArrange('standard')"
            >
              <el-icon><SetUp /></el-icon> 标准模式
            </el-button>
            <el-dropdown
              :disabled="batchArranging || historicalReadOnly"
              class="dropdown-gap"
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
            <el-dropdown class="dropdown-gap" @command="handleResetCommand">
              <el-button type="danger" :disabled="historicalReadOnly">
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
            <el-button
              type="success"
              plain
              :disabled="historicalReadOnly"
              class="lock-btn"
              @click="handleBatchLockAll"
            >
              <el-icon><Lock /></el-icon> 锁定
            </el-button>
            <el-button
              type="warning"
              plain
              :disabled="historicalReadOnly"
              class="lock-btn"
              @click="handleBatchUnlockAll"
            >
              <el-icon><Unlock /></el-icon> 解锁
            </el-button>
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
        <el-table-column label="任课教师" min-width="160">
          <template #default="{ row }">
            <div
              class="teacher-cell"
              :class="{
                'has-teacher': row.assignment,
                'no-teacher': !row.assignment,
                'is-readonly': historicalReadOnly,
              }"
              @click="openTeacherSelect(row)"
            >
              <template v-if="row.assignment">
                <el-tag
                  :type="
                    row.assignment.isLocked ? 'success' : row.assignment.isAuto ? 'info' : 'primary'
                  "
                  size="small"
                  :closable="!historicalReadOnly"
                  @close.stop="handleRemoveAssignment(row)"
                >
                  <el-icon v-if="row.assignment.isLocked" class="locked-icon" :size="12"
                    ><Lock
                  /></el-icon>
                  {{ row.assignment.teacherName }}
                </el-tag>
                <!-- 锁定/解锁按钮：仅自动安排显示 -->
                <el-tooltip
                  v-if="row.assignment.isAuto && !historicalReadOnly"
                  :content="
                    row.assignment.isLocked
                      ? '点击解锁（解锁后重新排课可覆盖）'
                      : '点击锁定（锁定后重新排课不受影响）'
                  "
                  placement="top"
                  effect="light"
                >
                  <el-icon
                    class="lock-toggle-icon"
                    :class="{ 'is-locked': row.assignment.isLocked }"
                    :size="14"
                    @click.stop="handleToggleLock(row)"
                  >
                    <Lock v-if="row.assignment.isLocked" />
                    <Unlock v-else />
                  </el-icon>
                </el-tooltip>
                <span v-if="!historicalReadOnly && !row.assignment.isLocked" class="replace-hint">
                  <el-icon :size="12"><EditPen /></el-icon>
                  更换
                </span>
                <span
                  v-else-if="!historicalReadOnly && row.assignment.isLocked"
                  class="locked-hint"
                >
                  已锁定
                </span>
                <span v-else class="readonly-hint">
                  <el-icon :size="12"><Lock /></el-icon>
                  只读
                </span>
              </template>
              <template v-else>
                <template v-if="historicalReadOnly">
                  <el-icon :size="14" class="cell-hint-icon"><Lock /></el-icon>
                  <span class="text-muted">只读</span>
                </template>
                <template v-else>
                  <el-icon :size="14" class="cell-hint-icon"><Plus /></el-icon>
                  <span class="text-placeholder">点击安排</span>
                </template>
              </template>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-container">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[20, 50, 100]"
          :total="filteredClassList.length"
          layout="total, sizes, prev, pager, next"
          background
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
    <el-dialog v-model="resetConfirmVisible" title="确认重置" width="var(--dialog-width-lg)" align-center>
      <BaseConfirmBody icon-color="var(--brand-danger)">
        <p v-if="resetScope === 'current'" class="reset-text">
          确定要重置「{{ courseInfo?.name || '当前课程' }}」的所有自动排课安排吗？此操作不可撤销。
        </p>
        <p v-else class="reset-text">
          确定要重置本学期<strong>全部科目</strong>的自动排课安排吗？此操作不可撤销。
        </p>
        <p class="reset-warning">
          将清除{{
            resetScope === 'current' ? '该课程' : '所有课程'
          }}在本学期的所有自动分配记录，手动安排和已锁定的安排不受影响。
        </p>
      </BaseConfirmBody>
      <template #footer>
        <el-button @click="resetConfirmVisible = false">取消</el-button>
        <el-button type="danger" :loading="resetting" @click="handleReset"> 确定重置 </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, defineAsyncComponent } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Connection, Lock, Unlock } from '@element-plus/icons-vue';
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
  resetAutoAssignments,
  toggleAssignmentLock,
  batchLockAssignments,
} from '../../api/teachingArrange';
import { useAutoArrange } from './composables/useAutoArrange';
import { useBatchArrange } from './composables/useBatchArrange';

import HourSettingsCard from './components/HourSettingsCard.vue';
import CoursePreviewCard from './components/CoursePreviewCard.vue';
import PageHeader from '../../components/PageHeader.vue';
import BaseConfirmBody from '../../components/BaseConfirmBody.vue';
import SemesterSelect from '../../components/SemesterSelect.vue';

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

// 学期相关：页面局部学期（默认全局当前学期），支持切换查看历史学期
const selectedSemester = ref('');
// 全局「当前学期」，用于判断是否正在查看历史学期（写操作需二次确认）
const globalCurrentSemester = ref('');
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
  lockedCount: 0,
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
const exporting = ref(false);

// 教师选择弹窗
const teacherDialogRef = ref(null);

// 重置排课状态
const resetConfirmVisible = ref(false);
const resetting = ref(false);
const resetScope = ref('current');

// 使用自动排课 composable
const {
  arranging,
  arrangeConfirmVisible,
  arrangeConfirmData,
  arrangeResultVisible,
  arrangeResult,
  arrangeResultMode,
  previewMode,
  progressVisible: autoProgressVisible,
  progressType: autoProgressType,
  progressModeLabel: autoProgressModeLabel,
  progressFinished: autoProgressFinished,
  progressCurrentPhase: autoProgressCurrentPhase,
  progressMessage: autoProgressMessage,
  handleAutoArrange,
  doAutoArrange,
  handleExecutePreview,
} = useAutoArrange({
  selectedCourseId,
  selectedSemester,
  courseInfo,
  hourSettingsRef,
  loadData,
  confirmHistoricalEdit,
});

// 使用批量排课 composable
const {
  batchArranging,
  batchConfirmVisible,
  batchConfirmData,
  batchResultVisible,
  batchResult,
  progressVisible: batchProgressVisible,
  progressType: batchProgressType,
  progressModeLabel: batchProgressModeLabel,
  progressFinished: batchProgressFinished,
  progressProcessed: batchProgressProcessed,
  progressTotal: batchProgressTotal,
  progressCurrentCourseName: batchProgressCurrentCourseName,
  progressCumulativeAssigned: batchProgressCumulativeAssigned,
  progressCumulativeUnassigned: batchProgressCumulativeUnassigned,
  progressMessage: batchProgressMessage,
  handleBatchAutoArrange,
  doBatchAutoArrange,
} = useBatchArrange({
  selectedSemester,
  hourSettingsRef,
  loadData,
  confirmHistoricalEdit,
});

// 统一的进度弹窗状态（委托给当前活动的 composable）
const progressVisible = computed({
  get: () => autoProgressVisible.value || batchProgressVisible.value,
  set: (val) => {
    if (autoProgressVisible.value) autoProgressVisible.value = val;
    if (batchProgressVisible.value) batchProgressVisible.value = val;
  },
});

const progressType = computed(() => autoProgressType.value || batchProgressType.value);
const progressModeLabel = computed(() => autoProgressModeLabel.value || batchProgressModeLabel.value);
const progressFinished = computed(() => autoProgressFinished.value || batchProgressFinished.value);
const progressCurrentPhase = computed(() => autoProgressCurrentPhase.value);
const progressProcessed = computed(() => batchProgressProcessed.value);
const progressTotal = computed(() => batchProgressTotal.value);
const progressCurrentCourseName = computed(() => batchProgressCurrentCourseName.value);
const progressCumulativeAssigned = computed(() => batchProgressCumulativeAssigned.value);
const progressCumulativeUnassigned = computed(() => batchProgressCumulativeUnassigned.value);
const progressMessage = computed(() => autoProgressMessage.value || batchProgressMessage.value);

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
    const current = settingsStore.currentSemesterValue();
    globalCurrentSemester.value = current;
    selectedSemester.value = current;
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('获取学期失败:', e);
    }
  }
}

// 是否正在查看历史学期（非全局当前学期）
const isHistoricalSemester = computed(
  () => !!selectedSemester.value && selectedSemester.value !== globalCurrentSemester.value
);

// 历史学期是否处于只读模式（系统设置开关关闭时：禁止编辑）
const historicalReadOnly = computed(
  () => isHistoricalSemester.value && settingsStore.settings?.allowHistoricalEdit?.value !== 'true'
);

// 历史学期是否处于「编辑前二次确认」模式（系统设置开关开启时：可编辑但需确认）
const historicalGuarded = computed(
  () => isHistoricalSemester.value && settingsStore.settings?.allowHistoricalEdit?.value === 'true'
);

// 学期切换：重载当前课程的班级与教师数据
function onSemesterChange() {
  if (selectedCourseId.value) {
    loadData();
  }
}

/**
 * 历史学期写操作权限控制。
 * - 非历史学期：直接放行。
 * - 历史学期且开关关闭（只读模式）：拦截，禁止编辑并提示用户去系统设置开启。
 * - 历史学期且开关开启：弹出二次确认，用户确认后放行，取消则返回 false。
 * @returns {Promise<boolean>}
 */
async function confirmHistoricalEdit() {
  if (!isHistoricalSemester.value) return true;
  // 开关关闭：历史学期为只读模式，禁止任何写操作
  if (historicalReadOnly.value) {
    ElMessage.warning(
      '当前历史学期为只读模式，禁止编辑。如需编辑请在系统设置 → 排课优化 开启「允许编辑历史学期」。'
    );
    return false;
  }
  // 开关开启：编辑前二次确认
  try {
    await ElMessageBox.confirm(
      `您正在修改历史学期「${selectedSemester.value}」的排课数据，此操作可能影响已结课记录，确认继续吗？`,
      '编辑历史学期确认',
      {
        type: 'warning',
        confirmButtonText: '确认修改',
        cancelButtonText: '取消',
      }
    );
    return true;
  } catch {
    return false;
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
  if (!selectedCourseId.value || !selectedSemester.value) return;
  tableLoading.value = true;
  try {
    const [classesRes, teachersRes] = await Promise.all([
      getCourseClasses({ courseId: selectedCourseId.value, semester: selectedSemester.value }),
      getCourseTeachers({
        courseId: selectedCourseId.value,
        semester: selectedSemester.value,
      }),
    ]);
    const classData = classesRes.data || {};
    classList.value = classData.classes || [];
    summary.value = classData.summary || {
      totalClasses: 0,
      assignedCount: 0,
      unassignedCount: 0,
      lockedCount: 0,
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
  if (historicalReadOnly.value) {
    ElMessage.warning(
      '当前历史学期为只读模式，禁止编辑。如需编辑请在系统设置 → 排课优化 开启「允许编辑历史学期」。'
    );
    return;
  }
  teacherDialogRef.value?.open(row);
}

async function onTeacherConfirm({ classId, teacherId, weeklyHours }) {
  if (!(await confirmHistoricalEdit())) return;
  try {
    await assignTeacher({
      classId,
      courseId: selectedCourseId.value,
      semester: selectedSemester.value,
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
  if (!(await confirmHistoricalEdit())) return;
  try {
    await deleteAssignment(row.assignment.id);
    ElMessage.success('已移除安排');
    await loadData();
  } catch (e) {
    ElMessage.error('操作失败');
  }
}

// --- 锁定/解锁 ---
async function handleToggleLock(row) {
  if (!row.assignment?.id) return;
  if (!(await confirmHistoricalEdit())) return;
  const newLocked = !row.assignment.isLocked;
  try {
    await toggleAssignmentLock(row.assignment.id, newLocked);
    ElMessage.success(newLocked ? '已锁定' : '已解锁');
    await loadData();
  } catch (e) {
    ElMessage.error('操作失败');
  }
}

async function handleBatchLockAll() {
  if (!(await confirmHistoricalEdit())) return;
  try {
    const res = await batchLockAssignments({
      semester: selectedSemester.value,
      courseId: selectedCourseId.value,
      locked: true,
    });
    ElMessage.success(res.message || '已锁定');
    await loadData();
  } catch (e) {
    ElMessage.error('操作失败');
  }
}

async function handleBatchUnlockAll() {
  if (!(await confirmHistoricalEdit())) return;
  try {
    const res = await batchLockAssignments({
      semester: selectedSemester.value,
      courseId: selectedCourseId.value,
      locked: false,
    });
    ElMessage.success(res.message || '已解锁');
    await loadData();
  } catch (e) {
    ElMessage.error('操作失败');
  }
}

// 进度弹窗关闭处理
function handleProgressClose() {
  autoProgressVisible.value = false;
  batchProgressVisible.value = false;
  
  if (autoProgressType.value === 'single' && autoProgressFinished.value) {
    arrangeResultVisible.value = true;
  } else if (batchProgressType.value === 'batch' && batchProgressFinished.value) {
    batchResultVisible.value = true;
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
    if (!(await confirmHistoricalEdit())) return;
    const payload = { semester: selectedSemester.value };
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
  if (!selectedCourseId.value || !selectedSemester.value) return;
  exporting.value = true;
  try {
    const params = {
      courseId: selectedCourseId.value,
      semester: selectedSemester.value,
    };

    if (filterCollege.value) params.college = filterCollege.value;
    if (filterMajor.value) params.major = filterMajor.value;
    if (filterTrainingLevel.value) params.trainingLevel = filterTrainingLevel.value;
    if (filterGrade.value) params.grade = filterGrade.value;
    if (filterTextbook.value) params.textbook = filterTextbook.value;

    const response = await exportTeachingArrange(params);
    downloadBlob(
      response,
      `教学安排_${courseInfo.value?.name || ''}_${selectedSemester.value}.xlsx`
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
  margin-bottom: var(--space-4);
}
.historical-alert {
  max-width: 560px;
  width: 100%;
  margin: 0 0 var(--space-4) 0;
}
:deep(.semester-select) {
  flex-wrap: nowrap;
  white-space: nowrap;
}
.combined-icon {
  margin-left: var(--space-1);
  vertical-align: middle;
  color: var(--brand-indigo);
  cursor: help;
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
  padding: var(--space-1) 10px;
  border-radius: 4px;
  transition: background-color 0.15s ease;
}
.teacher-cell:hover {
  background-color: var(--el-color-primary-light-9, #e8f3fe);
}
.teacher-cell.no-teacher:hover .text-placeholder {
  color: var(--el-color-primary);
}
.teacher-cell.is-readonly {
  cursor: not-allowed;
}
.teacher-cell.is-readonly:hover {
  background-color: transparent;
}
.readonly-hint {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
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
/* 卡片头部筛选器宽度 */
.header-filter.filter-xs {
  width: 80px;
}
.header-filter.filter-sm {
  width: 100px;
}
.header-filter.filter-md {
  width: 120px;
}
.header-filter.filter-lg {
  width: 130px;
}
.header-filter.filter-xl {
  width: 140px;
}
.preview-checkbox {
  margin-left: var(--space-2);
}
.dropdown-gap {
  margin-left: var(--space-1);
}
.cell-hint-icon {
  margin-right: 4px;
  opacity: 0.5;
}
.reset-text {
  margin: 0;
}
.reset-warning {
  margin: 8px 0 0;
  color: var(--brand-danger-text);
  font-size: 13px;
}
.lock-toggle-icon {
  cursor: pointer;
  color: var(--text-placeholder);
  transition: color 0.15s ease;
  flex-shrink: 0;
}
.lock-toggle-icon:hover {
  color: var(--el-color-primary);
}
.lock-toggle-icon.is-locked {
  color: var(--el-color-success);
}
.lock-toggle-icon.is-locked:hover {
  color: var(--el-color-warning);
}
.locked-icon {
  margin-right: 2px;
  vertical-align: -1px;
}
.locked-hint {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: var(--el-color-success);
  white-space: nowrap;
}
.lock-btn {
  margin-left: var(--space-1);
}
</style>
