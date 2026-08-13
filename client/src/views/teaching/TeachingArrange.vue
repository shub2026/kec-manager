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

    <!-- 设置区：未选课程时卡片体内展示课程安排概览 -->
    <HourSettingsCard
      ref="settingsCardRef"
      v-model:selected-course-id="selectedCourseId"
      :current-semester-label="selectedSemester"
      :all-courses="allCourses"
      :exporting="exporting"
      @course-change="onCourseChange"
      @export="handleExportArrange"
    >
      <CourseOverviewGrid
        :courses="overviewList"
        :loading="overviewLoading"
        :error="overviewError"
        @select-course="onOverviewSelectCourse"
        @retry="loadOverview"
      >
        <!-- 学期级操作：批量排课/排课优化/重置全部科目（作用于所有课程，无需进入具体课程） -->
        <template #header-actions>
          <el-dropdown
            :disabled="batchArranging || historicalReadOnly"
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
          <el-button
            type="success"
            :loading="optimizing"
            :disabled="historicalReadOnly"
            @click="handleOptimize"
          >
            <el-icon><DataAnalysis /></el-icon>
            {{ optimizing && optimizeProgressMessage ? optimizeProgressMessage : '排课优化' }}
          </el-button>
          <el-button
            type="danger"
            :disabled="historicalReadOnly"
            @click="handleResetCommand('all')"
          >
            <el-icon><RefreshRight /></el-icon> 重置全部科目
          </el-button>
        </template>
      </CourseOverviewGrid>
    </HourSettingsCard>

    <!-- 预览区 -->
    <CoursePreviewCard
      v-if="selectedCourseId && courseInfo"
      :course-info="courseInfo"
      :teacher-count="teacherList.length"
      :summary="summary"
      show-back
      @back="backToOverview"
    />

    <!-- 内容区：矩阵表 -->
    <el-card v-if="selectedCourseId" class="matrix-card">
      <template #header>
        <div class="card-header">
          <span>教学安排</span>
          <ArrangeToolbar
            v-model:filters="filters"
            :class-list="classList"
            :arranging="arranging"
            :historical-read-only="historicalReadOnly"
            @auto-arrange="handleAutoArrange"
            @reset="handleResetCommand"
            @lock-all="handleBatchLockAll"
            @unlock-all="handleBatchUnlockAll"
          />
        </div>
      </template>

      <ListErrorState v-if="error" :message="error" @retry="loadData" />
      <ArrangeClassTable
        v-else
        :class-list="filteredClassList"
        :loading="tableLoading"
        :historical-read-only="historicalReadOnly"
        @select-teacher="openTeacherSelect"
        @remove-assignment="handleRemoveAssignment"
        @toggle-lock="handleToggleLock"
      />
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
    />

    <!-- 批量排课结果弹窗 -->
    <BatchResultDialog v-model="batchResultVisible" :result="batchResult" />

    <!-- 排课优化确认弹窗 -->
    <OptimizeConfirmDialog
      v-model="optimizeConfirmVisible"
      :loading="optimizing"
      @confirm="doOptimize"
    />

    <!-- 排课优化结果弹窗 -->
    <OptimizeResultDialog
      v-model="optimizeResultVisible"
      :result="optimizeResult"
      :applying="optimizing"
      @apply="applyOptimizeResult"
      @close="closeOptimizeResult"
    />

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
      @cancel="handleProgressCancel"
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
    <el-dialog
      v-model="resetConfirmVisible"
      title="确认重置"
      width="var(--dialog-width-lg)"
      :fullscreen="isMobile"
      align-center
    >
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
import { ref, computed, onMounted, defineAsyncComponent } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useSettingsStore } from '../../stores/settings';
import { getCourses } from '../../api/course';
import { exportTeachingArrange } from '../../api/export';
import { downloadBlob } from '../../utils/download';
import {
  getCourseClasses,
  getCourseTeachers,
  getCourseOverview,
  assignTeacher,
  deleteAssignment,
  resetAutoAssignments,
  toggleAssignmentLock,
  batchLockAssignments,
} from '../../api/teachingArrange';
import { useAutoArrange } from './composables/useAutoArrange';
import { useBatchArrange } from './composables/useBatchArrange';
import { useOptimize } from './composables/useOptimize';
import { useArrangeProgress } from './composables/useArrangeProgress';

import HourSettingsCard from './components/HourSettingsCard.vue';
import CoursePreviewCard from './components/CoursePreviewCard.vue';
import CourseOverviewGrid from './components/CourseOverviewGrid.vue';
import ArrangeToolbar from './components/ArrangeToolbar.vue';
import ArrangeClassTable from './components/ArrangeClassTable.vue';
import PageHeader from '../../components/PageHeader.vue';
import BaseConfirmBody from '../../components/BaseConfirmBody.vue';
import SemesterSelect from '../../components/SemesterSelect.vue';
import ListErrorState from '../../components/ListErrorState.vue';
import { useResponsive } from '../../composables/useResponsive';

defineOptions({ name: 'TeachingArrange' });

const { isMobile } = useResponsive();

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
const OptimizeConfirmDialog = defineAsyncComponent(
  () => import('./components/OptimizeConfirmDialog.vue')
);
const OptimizeResultDialog = defineAsyncComponent(
  () => import('./components/OptimizeResultDialog.vue')
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
// 列表加载错误状态，供 ListErrorState 占位
const error = ref(null);
const summary = ref({
  totalClasses: 0,
  assignedCount: 0,
  unassignedCount: 0,
  lockedCount: 0,
  totalCourseHours: 0,
  assignedHours: 0,
  remainingHours: 0,
});

// 筛选器（选项计算与联动逻辑已下沉至 ArrangeToolbar）
const filters = ref({
  className: '',
  college: '',
  major: '',
  trainingLevel: '',
  grade: '',
  textbook: '',
});

const filteredClassList = computed(() => {
  const f = filters.value;
  const nameKw = f.className?.trim().toLowerCase();
  return classList.value.filter((c) => {
    if (nameKw && !(c.className || '').toLowerCase().includes(nameKw)) return false;
    if (f.college && c.collegeName !== f.college) return false;
    if (f.major && c.majorName !== f.major) return false;
    if (f.grade && c.grade !== f.grade) return false;
    if (f.trainingLevel && c.trainingLevelName !== f.trainingLevel) return false;
    if (f.textbook) {
      const titles = (c.textbooks || []).map((tb) => tb.title);
      if (!titles.includes(f.textbook)) return false;
    }
    return true;
  });
});

// 自动排课状态
const exporting = ref(false);

// 教师选择弹窗
const teacherDialogRef = ref(null);

// 重置排课状态
const resetConfirmVisible = ref(false);
const resetting = ref(false);
const resetScope = ref('current');

// 使用自动排课 composable（进度状态整体交给 useArrangeProgress 合并代理）
const autoArrange = useAutoArrange({
  selectedCourseId,
  selectedSemester,
  courseInfo,
  hourSettingsRef,
  loadData: refreshArrangeData,
  confirmHistoricalEdit,
});
const {
  arranging,
  arrangeConfirmVisible,
  arrangeConfirmData,
  arrangeResultVisible,
  arrangeResult,
  arrangeResultMode,
  handleAutoArrange,
  doAutoArrange,
} = autoArrange;

// 使用批量排课 composable
const batchArrange = useBatchArrange({
  selectedSemester,
  hourSettingsRef,
  loadData: refreshArrangeData,
  confirmHistoricalEdit,
});
const {
  batchArranging,
  batchConfirmVisible,
  batchConfirmData,
  batchResultVisible,
  batchResult,
  handleBatchAutoArrange,
  doBatchAutoArrange,
} = batchArrange;

// 使用排课优化 composable
const {
  optimizing,
  optimizeConfirmVisible,
  optimizeResultVisible,
  optimizeResult,
  progressMessage: optimizeProgressMessage,
  handleOptimize,
  doOptimize,
  applyOptimizeResult,
  closeOptimizeResult,
} = useOptimize({
  selectedSemester,
  loadData: refreshArrangeData,
  confirmHistoricalEdit,
});

// 统一的进度弹窗状态（合并 auto/batch 两组进度，见 useArrangeProgress）
const {
  progressVisible,
  progressType,
  progressModeLabel,
  progressFinished,
  progressCurrentPhase,
  progressProcessed,
  progressTotal,
  progressCurrentCourseName,
  progressCumulativeAssigned,
  progressCumulativeUnassigned,
  progressMessage,
  handleProgressClose,
  handleProgressCancel,
} = useArrangeProgress({
  auto: autoArrange,
  batch: batchArrange,
  arrangeResultVisible,
  batchResultVisible,
});

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

// 学期切换：重载当前课程的班级与教师数据；未选科目时重载课程概览
function onSemesterChange() {
  if (selectedCourseId.value) {
    loadData();
  } else {
    loadOverview();
  }
}

// --- 课程概览 ---
const overviewList = ref([]);
const overviewLoading = ref(false);
const overviewError = ref(null);
// 请求序号守卫：快速连续切换学期时，丢弃过期响应
let overviewSeq = 0;

async function loadOverview() {
  if (!selectedSemester.value) return;
  const seq = ++overviewSeq;
  overviewLoading.value = true;
  overviewError.value = null;
  try {
    const res = await getCourseOverview({ semester: selectedSemester.value });
    if (seq !== overviewSeq) return;
    overviewList.value = res.data || [];
  } catch (e) {
    if (seq !== overviewSeq) return;
    overviewError.value = '加载课程概览失败，请稍后重试';
    if (import.meta.env.DEV) {
      console.error('加载课程概览失败:', e);
    }
  } finally {
    if (seq === overviewSeq) {
      overviewLoading.value = false;
    }
  }
}

// 概览卡片点选：选中课程并进入矩阵表（复用现有 course-change 链路）
async function onOverviewSelectCourse(courseId) {
  selectedCourseId.value = courseId;
  await onCourseChange(courseId);
}

// 返回概览：清空课程选择（等同下拉 clear）并重载概览数据
function backToOverview() {
  filters.value = {
    className: '',
    college: '',
    major: '',
    trainingLevel: '',
    grade: '',
    textbook: '',
  };
  selectedCourseId.value = null;
  classList.value = [];
  teacherList.value = [];
  courseInfo.value = null;
  loadOverview();
}

/**
 * 排课写操作（自动排课/批量排课/优化/重置）完成后的统一刷新。
 * 学期级操作可在概览视图（未选课程）触发，此时 loadData 会因无课程而空转，
 * 需改为刷新概览卡片，保证统计数据与实际操作结果一致。
 */
async function refreshArrangeData() {
  if (selectedCourseId.value) {
    await loadData();
  } else {
    await loadOverview();
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
  filters.value = {
    className: '',
    college: '',
    major: '',
    trainingLevel: '',
    grade: '',
    textbook: '',
  };
  if (!courseId) {
    classList.value = [];
    teacherList.value = [];
    courseInfo.value = null;
    loadOverview();
    return;
  }
  courseInfo.value = allCourses.value.find((c) => c.id === courseId) || null;
  await loadData();
}

// 请求序号守卫：快速连续切换课程时，丢弃过期响应，避免旧课程数据覆盖最新选择
let loadDataSeq = 0;

async function loadData() {
  if (!selectedCourseId.value || !selectedSemester.value) return;
  const seq = ++loadDataSeq;
  tableLoading.value = true;
  error.value = null;
  try {
    const [classesRes, teachersRes] = await Promise.all([
      getCourseClasses({ courseId: selectedCourseId.value, semester: selectedSemester.value }),
      getCourseTeachers({
        courseId: selectedCourseId.value,
        semester: selectedSemester.value,
      }),
    ]);
    // 期间又发起了新的加载，当前响应已过期，直接丢弃
    if (seq !== loadDataSeq) return;
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
    if (seq !== loadDataSeq) return;
    error.value = '加载数据失败，请稍后重试';
    if (import.meta.env.DEV) {
      console.error('加载数据失败:', e);
    }
  } finally {
    // 仅由最新一次加载关闭 loading，避免旧请求提前结束加载态
    if (seq === loadDataSeq) {
      tableLoading.value = false;
    }
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

// 进度弹窗关闭处理已移至 useArrangeProgress

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
    await refreshArrangeData();
  } catch (e) {
    ElMessage.error('重置失败');
  } finally {
    resetting.value = false;
  }
}

// --- 导出 ---
// scope: 'current' 导出当前科目（携带筛选条件）；'all' 导出全部科目（全量）
async function handleExportArrange(scope = 'current') {
  if (!selectedSemester.value) return;
  if (scope === 'current' && !selectedCourseId.value) return;
  exporting.value = true;
  try {
    const params = { semester: selectedSemester.value };
    let filename = `教学安排_全部科目_${selectedSemester.value}.xlsx`;

    if (scope === 'current') {
      params.courseId = selectedCourseId.value;
      const f = filters.value;
      if (f.className?.trim()) params.className = f.className.trim();
      if (f.college) params.college = f.college;
      if (f.major) params.major = f.major;
      if (f.trainingLevel) params.trainingLevel = f.trainingLevel;
      if (f.grade) params.grade = f.grade;
      if (f.textbook) params.textbook = f.textbook;
      filename = `教学安排_${courseInfo.value?.name || ''}_${selectedSemester.value}.xlsx`;
    }

    const response = await exportTeachingArrange(params);
    downloadBlob(response, filename);
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

// H-6 修复：串行加载，确保学期数据就绪后再加载课程列表，避免竞态导致空表格
onMounted(async () => {
  await loadSemester();
  await loadCourses();
  await loadOverview();
});
</script>

<style scoped>
.matrix-card {
  margin-bottom: var(--space-4);
}
/* 筛选器左对齐：紧随标题“教学安排”横向排列，不再被 space-between 推到行尾 */
.matrix-card .card-header {
  justify-content: flex-start;
}
/* 工具栏填满标题后的剩余宽度，操作按钮组 margin-left:auto 靠右：
   筛选器（学院/专业/层次/年级/教材）紧跟标题，排课按钮留在行尾 */
.matrix-card .card-header-actions {
  flex: 1;
}
.matrix-card :deep(.action-buttons) {
  margin-left: auto;
}
.historical-alert {
  max-width: 560px;
  width: 100%;
  margin: 0 0 var(--space-4) 0;
}
.reset-text {
  margin: 0;
}
.reset-warning {
  margin: 8px 0 0;
  color: var(--brand-danger-text);
  font-size: var(--font-size-body-sm);
}
</style>
