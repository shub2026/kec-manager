<template>
  <div>
    <el-card>
      <template #header>
        <div class="card-header">
          <span
            ><el-icon><User /></el-icon> 班级管理</span
          >
          <el-button type="primary" @click="openDialog()">
            <el-icon><Plus /></el-icon> 新增班级
          </el-button>
        </div>
      </template>

      <!-- 筛选器组件（移至卡片体内） -->
      <ClassFilterBar
        v-model:filters="filters"
        :colleges="colleges"
        :majors="majors"
        :training-levels="trainingLevels"
        :enrollment-years="enrollmentYears"
        :plans="plans"
        :college-major-relation="collegeMajorRelation"
        :college-level-relation="collegeLevelRelation"
        :major-level-relation="majorLevelRelation"
        :college-year-relation="collegeYearRelation"
        :major-year-relation="majorYearRelation"
        :level-year-relation="levelYearRelation"
        :plan-college-relation="planCollegeRelation"
        :plan-major-relation="planMajorRelation"
        :plan-level-relation="planLevelRelation"
        @change="resetPaginationAndLoad"
        @search="load"
        @export="handleExport"
        @download-template="downloadTemplate"
        @import-success="onImportSuccess"
        @import-error="onImportError"
        @before-upload="beforeImport"
        @add="openDialog"
      />

      <!-- 表格组件 -->
      <ClassTable
        :classes="list"
        :loading="loading"
        :selected-classes="selectedClasses"
        :pagination="pagination"
        :semester-info="currentSemesterInfo"
        @selection-change="handleSelectionChange"
        @edit="openDialog"
        @delete="handleDelete"
        @batch-delete="handleBatchDelete"
        @batch-set="openBatchSetDialog"
        @size-change="handleSizeChange"
        @page-change="handlePageChange"
      />
    </el-card>

    <!-- 表单对话框组件 -->
    <ClassFormDialog
      v-model:visible="dialogVisible"
      v-model:batch-visible="batchDialogVisible"
      v-model:form="form"
      v-model:batch-form="batchForm"
      :batch-form-type="batchFormType"
      :batch-dialog-title="batchDialogTitle"
      :saving="saving || batchSaving"
      :majors="majors"
      :colleges="colleges"
      :training-levels="trainingLevels"
      :plans="plans"
      @save="handleSave"
      @batch-save="handleBatchSet"
      @close="resetForm"
      @batch-close="resetBatchForm"
    />

    <!-- 导入进度对话框 -->
    <el-dialog
      v-model="progressDialogVisible"
      title="正在导入"
      width="min(500px, 90vw)"
      :close-on-click-modal="false"
      :show-close="false"
    >
      <div class="progress-container">
        <el-progress :percentage="progressPercent" :status="progressStatus" :stroke-width="20" />
        <div class="progress-info">
          <div class="progress-text">{{ progressText }}</div>
          <div v-if="progressDetail" class="progress-detail">
            {{ progressDetail }}
          </div>
        </div>
        <div class="progress-tip">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>请稍候，正在处理中...</span>
        </div>
      </div>
    </el-dialog>

    <!-- 单个删除确认弹窗 -->
    <el-dialog
      v-model="deleteConfirmVisible"
      title="确认删除"
      width="min(380px, 90vw)"
      align-center
    >
      <div style="display: flex; gap: 12px; align-items: flex-start">
        <el-icon :size="24" color="var(--brand-danger)" style="flex-shrink: 0; margin-top: 2px"
          ><WarningFilled
        /></el-icon>
        <p style="margin: 0; line-height: 1.6; color: var(--text-regular)">
          确定要删除此班级吗？此操作不可撤销。
        </p>
      </div>
      <template #footer>
        <el-button @click="deleteConfirmVisible = false">取消</el-button>
        <el-button type="danger" :loading="deleting" @click="confirmDelete">确定删除</el-button>
      </template>
    </el-dialog>

    <!-- 批量删除确认弹窗 -->
    <el-dialog
      v-model="batchDeleteConfirmVisible"
      title="批量删除"
      width="min(420px, 90vw)"
      align-center
    >
      <div style="display: flex; gap: 12px; align-items: flex-start">
        <el-icon :size="24" color="var(--brand-danger)" style="flex-shrink: 0; margin-top: 2px"
          ><WarningFilled
        /></el-icon>
        <p style="margin: 0; line-height: 1.6; color: var(--text-regular)">
          {{ batchDeleteConfirmMessage }}
        </p>
      </div>
      <template #footer>
        <el-button @click="batchDeleteConfirmVisible = false">取消</el-button>
        <el-button type="danger" :loading="batchDeleting" @click="confirmBatchDelete"
          >确定删除</el-button
        >
      </template>
    </el-dialog>

    <!-- 批量离校确认弹窗 -->
    <el-dialog
      v-model="leftSchoolConfirmVisible"
      title="确认批量离校"
      width="min(450px, 90vw)"
      align-center
    >
      <div style="display: flex; gap: 12px; align-items: flex-start">
        <el-icon :size="24" color="var(--brand-warning)" style="flex-shrink: 0; margin-top: 2px"
          ><WarningFilled
        /></el-icon>
        <p style="margin: 0; line-height: 1.6; color: var(--text-regular)">
          {{ leftSchoolConfirmMessage }}
        </p>
      </div>
      <template #footer>
        <el-button @click="cancelLeftSchoolConfirm">取消</el-button>
        <el-button type="warning" @click="confirmLeftSchool">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { ElMessage, ElNotification } from 'element-plus';
// 按需导入项目中 service 函数（ElNotification）的 CSS 不会自动注入，需手动导入样式
// 否则通知 DOM 渲染但不可见（无背景/定位/动画）
import 'element-plus/es/components/notification/style/css';
import { getClasses, createClass, updateClass, deleteClass } from '../../api/class';
import { getMajors } from '../../api/major';
import { getPlans } from '../../api/plan';
import { getTrainingLevels } from '../../api/trainingLevel';
import { getColleges } from '../../api/college';
import { useSettingsStore } from '../../stores/settings';
import { useExport } from '../../composables/useExport';
import { showImportResultCard } from '../../composables/useImport';
import ClassFilterBar from './components/ClassFilterBar.vue';
import ClassTable from './components/ClassTable.vue';
import ClassFormDialog from './components/ClassFormDialog.vue';

const list = ref([]);
const loading = ref(false);
const majors = ref([]);
const plans = ref([]);
const trainingLevels = ref([]);
const colleges = ref([]);
const allEnrollmentYears = ref([]);
const collegeMajorRelation = ref({}); // 学院-专业关联关系
const collegeLevelRelation = ref({}); // 学院-层次关联关系
const majorLevelRelation = ref({}); // 专业-层次关联关系
const collegeYearRelation = ref({}); // 学院-入学年份关联
const majorYearRelation = ref({}); // 专业-入学年份关联
const levelYearRelation = ref({}); // 层次-入学年份关联
const planCollegeRelation = ref({}); // 培养方案-学院关联
const planMajorRelation = ref({}); // 培养方案-专业关联
const planLevelRelation = ref({}); // 培养方案-层次关联
const selectedClasses = ref([]);
const currentSemesterInfo = ref(null); // 当前学期信息
let _relationsLoaded = false; // 关联数据是否已加载（结构性数据只加载一次）

const filters = ref({
  name: '',
  majorId: null,
  collegeId: null,
  trainingLevelId: null,
  enrollmentYear: null,
  status: null,
  planId: null,
});

const pagination = ref({
  page: 1,
  pageSize: 20,
  total: 0,
});

const dialogVisible = ref(false);
const batchDialogVisible = ref(false);
const progressDialogVisible = ref(false);
const saving = ref(false);
const batchSaving = ref(false);
const progressPercent = ref(0);
const progressStatus = ref('');
const progressText = ref('');
const progressDetail = ref('');

// 批量删除确认弹窗
const batchDeleteConfirmVisible = ref(false);
const batchDeleteConfirmMessage = ref('');
const batchDeleting = ref(false);

// 批量离校确认弹窗
const leftSchoolConfirmVisible = ref(false);
const leftSchoolConfirmMessage = ref('');
let _leftSchoolResolve = null;

const form = ref({
  id: null,
  name: '',
  majorId: null,
  collegeId: null,
  trainingLevelId: null,
  enrollmentYear: new Date().getFullYear(),
  durationYears: 3,
  studentCount: 0,
  isLeftSchool: false,
  customPlanId: null,
});

// 使用导出 composable
const { exportData, downloadTemplate } = useExport('classes', '班级数据');

const batchForm = ref({
  majorId: null,
  collegeId: null,
  trainingLevelId: null,
  enrollmentYear: new Date().getFullYear(),
  durationYears: 3,
  isLeftSchool: false,
});

const batchFormType = ref('');

const enrollmentYears = computed(() => {
  return allEnrollmentYears.value.filter((y) => y != null);
});

const batchDialogTitle = computed(() => {
  const titles = {
    major: '批量设置专业',
    college: '批量设置学院',
    level: '批量设置培养层次',
    year: '批量设置入学年份',
    duration: '批量设置学制',
    leftSchool: '批量设置离校状态',
  };
  return titles[batchFormType.value] || '批量设置';
});

async function load() {
  loading.value = true;
  try {
    const params = {
      ...filters.value,
      page: pagination.value.page,
      pageSize: pagination.value.pageSize,
    };

    const res = await getClasses(params);
    list.value = res?.data?.items || [];
    pagination.value.total = res?.data?.total || 0;

    // 关联数据（结构性参考数据）只在首次加载时更新，避免每次翻页触发响应式级联
    if (!_relationsLoaded) {
      if (res?.data?.allEnrollmentYears) {
        allEnrollmentYears.value = res.data.allEnrollmentYears;
      }
      if (res?.data?.collegeMajorRelation) {
        collegeMajorRelation.value = res.data.collegeMajorRelation;
      }
      if (res?.data?.collegeLevelRelation) {
        collegeLevelRelation.value = res.data.collegeLevelRelation;
      }
      if (res?.data?.majorLevelRelation) {
        majorLevelRelation.value = res.data.majorLevelRelation;
      }
      if (res?.data?.collegeYearRelation) {
        collegeYearRelation.value = res.data.collegeYearRelation;
      }
      if (res?.data?.majorYearRelation) {
        majorYearRelation.value = res.data.majorYearRelation;
      }
      if (res?.data?.levelYearRelation) {
        levelYearRelation.value = res.data.levelYearRelation;
      }
      if (res?.data?.planCollegeRelation) {
        planCollegeRelation.value = res.data.planCollegeRelation;
      }
      if (res?.data?.planMajorRelation) {
        planMajorRelation.value = res.data.planMajorRelation;
      }
      if (res?.data?.planLevelRelation) {
        planLevelRelation.value = res.data.planLevelRelation;
      }
      _relationsLoaded = true;
    }
  } catch (error) {
    ElMessage.error('加载失败：' + (error.message || '未知错误'));
  } finally {
    loading.value = false;
  }
}

async function loadBaseData() {
  try {
    const settingsStore = useSettingsStore();
    const [majorsRes, plansRes, levelsRes, collegesRes] = await Promise.all([
      getMajors(),
      getPlans(),
      getTrainingLevels(),
      getColleges(),
      settingsStore.load(),
    ]);
    majors.value = majorsRes?.data || [];
    plans.value = plansRes?.data || [];
    trainingLevels.value = levelsRes?.data || [];
    colleges.value = collegesRes?.data || [];

    // 解析当前学期信息（从 settingsStore 获取）
    const semesterValue = settingsStore.currentSemesterValue();
    if (semesterValue) {
      const parts = semesterValue.split('-');
      if (parts.length === 3) {
        currentSemesterInfo.value = {
          startYear: Number(parts[0]),
          endYear: Number(parts[1]),
          semesterIndex: Number(parts[2]),
        };
      }
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('加载基础数据失败:', error);
    }
    if (error.response?.status === 401) {
      ElMessage.warning('请先登录后再使用班级管理功能');
    } else {
      ElMessage.error('加载基础数据失败，请刷新页面重试');
    }
  }
}

function resetPaginationAndLoad() {
  pagination.value.page = 1;
  load();
}

function handlePageChange() {
  load();
}

function handleSizeChange() {
  pagination.value.page = 1;
  load();
}

function openDialog(row = null) {
  if (row) {
    form.value = { ...row };
  } else {
    resetForm();
  }
  dialogVisible.value = true;
}

function resetForm() {
  form.value = {
    id: null,
    name: '',
    majorId: null,
    collegeId: null,
    trainingLevelId: null,
    enrollmentYear: new Date().getFullYear(),
    durationYears: 3,
    studentCount: 0,
    isLeftSchool: false,
    customPlanId: null,
  };
}

async function handleSave() {
  if (
    !form.value.name ||
    !form.value.enrollmentYear ||
    !form.value.durationYears ||
    !form.value.trainingLevelId
  ) {
    ElMessage.error('请填写必填项');
    return;
  }

  saving.value = true;
  try {
    // 前端统一使用 camelCase，由 naming 中间件自动转换为 snake_case 给后端
    const classData = {
      name: form.value.name,
      enrollmentYear: form.value.enrollmentYear,
      durationYears: form.value.durationYears,
      majorId: form.value.majorId || undefined,
      collegeId: form.value.collegeId || undefined,
      trainingLevelId: form.value.trainingLevelId,
      studentCount:
        form.value.studentCount !== null && form.value.studentCount !== undefined
          ? Number(form.value.studentCount)
          : undefined,
      customPlanId: form.value.customPlanId ?? null,
      isLeftSchool: form.value.isLeftSchool,
    };

    if (form.value.id) {
      await updateClass(form.value.id, classData);
      ElMessage.success('更新成功');
    } else {
      await createClass(classData);
      ElMessage.success('创建成功');
    }
    dialogVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '操作失败');
  } finally {
    saving.value = false;
  }
}

const deleteConfirmVisible = ref(false);
const deleting = ref(false);
let pendingDeleteId = null;

function handleDelete(id) {
  pendingDeleteId = id;
  deleteConfirmVisible.value = true;
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  deleting.value = true;
  const target = list.value.find((c) => c.id === pendingDeleteId);
  const targetName = target?.name || '该班级';
  try {
    // silent:true 抑制拦截器 ElMessage，由本函数统一用 ElNotification 展示原因与结果
    await deleteClass(pendingDeleteId, { silent: true });
    ElNotification({
      title: '删除成功',
      message: `已删除班级：${targetName}`,
      type: 'success',
      duration: 4000,
    });
    load();
    deleteConfirmVisible.value = false;
  } catch (err) {
    const reason = err?.response?.data?.message || err?.message || '未知错误';
    ElNotification({
      title: '删除失败',
      message: `${targetName}：${reason}`,
      type: 'error',
      duration: 6000,
    });
    deleteConfirmVisible.value = false;
  } finally {
    pendingDeleteId = null;
    deleting.value = false;
  }
}

function handleSelectionChange(selection) {
  selectedClasses.value = selection;
}

function handleBatchDelete() {
  batchDeleteConfirmMessage.value = `确定要删除选中的 ${selectedClasses.value.length} 个班级吗？`;
  batchDeleteConfirmVisible.value = true;
}

async function confirmBatchDelete() {
  batchDeleteConfirmVisible.value = false;
  batchDeleting.value = true;

  const targets = selectedClasses.value.map((cls) => ({ id: cls.id, name: cls.name }));
  const succeeded = [];
  const failed = [];

  try {
    // 串行逐个删除，避免 SQLite 文件锁并行写冲突
    for (const { id, name } of targets) {
      try {
        await deleteClass(id, { silent: true });
        succeeded.push(name);
      } catch (err) {
        const reason = err?.response?.data?.message || err?.message || '未知错误';
        failed.push({ name, reason });
      }
    }
  } catch (e) {
    if (import.meta.env.DEV) console.error('[BatchDelete] 意外错误:', e);
  }

  // 结果提示——放在 try 外面，保证一定执行
  // deleteClass 已传 silent:true，拦截器不会弹错误 ElMessage；closeAll 兜底防止极端情况残留
  ElMessage.closeAll();

  if (succeeded.length === 0 && failed.length === 0) {
    ElNotification({ title: '批量删除', message: '未选择任何班级', type: 'info', duration: 3000 });
  } else if (succeeded.length > 0 && failed.length === 0) {
    ElNotification({
      title: '批量删除完成',
      message: `已成功删除 ${succeeded.length} 个班级`,
      type: 'success',
      duration: 4000,
    });
  } else if (succeeded.length === 0 && failed.length > 0) {
    const assignCount = failed.filter((f) => f.reason.includes('排课记录')).length;
    if (assignCount === failed.length) {
      ElNotification({
        title: '批量删除失败',
        message: `${assignCount} 个班级存在排课记录，无法删除`,
        type: 'warning',
        duration: 6000,
      });
    } else {
      ElNotification({
        title: '批量删除失败',
        message: `删除失败：${failed[0].reason}`,
        type: 'error',
        duration: 6000,
      });
    }
  } else if (succeeded.length > 0 && failed.length > 0) {
    const assignCount = failed.filter((f) => f.reason.includes('排课记录')).length;
    const otherCount = failed.length - assignCount;
    let msg = `成功删除 ${succeeded.length} 个`;
    if (assignCount > 0) msg += `，${assignCount} 个存在排课记录无法删除`;
    if (otherCount > 0) msg += `，${otherCount} 个删除失败`;
    ElNotification({
      title: '批量删除部分成功',
      message: msg,
      type: 'warning',
      duration: 6000,
    });
  }

  selectedClasses.value = [];
  batchDeleting.value = false;
  load();
}

function openBatchSetDialog(type) {
  batchFormType.value = type;
  resetBatchForm();
  batchDialogVisible.value = true;
}

function resetBatchForm() {
  batchForm.value = {
    majorId: null,
    collegeId: null,
    trainingLevelId: null,
    enrollmentYear: new Date().getFullYear(),
    durationYears: 3,
    isLeftSchool: false,
  };
}

async function handleBatchSet() {
  // 批量标记离校时确认级联删除排课
  if (batchFormType.value === 'leftSchool' && batchForm.value.isLeftSchool) {
    leftSchoolConfirmMessage.value = `标记为“离校”将自动删除所选 ${selectedClasses.value.length} 个班级在当前学期的所有排课记录，释放教师课时容量。确定继续？`;
    leftSchoolConfirmVisible.value = true;
    // 等待用户确认
    const confirmed = await new Promise((resolve) => {
      _leftSchoolResolve = resolve;
    });
    if (!confirmed) return;
  }

  doBatchSet();
}

function confirmLeftSchool() {
  leftSchoolConfirmVisible.value = false;
  if (_leftSchoolResolve) {
    _leftSchoolResolve(true);
    _leftSchoolResolve = null;
  }
}

function cancelLeftSchoolConfirm() {
  leftSchoolConfirmVisible.value = false;
  if (_leftSchoolResolve) {
    _leftSchoolResolve(false);
    _leftSchoolResolve = null;
  }
}

async function doBatchSet() {
  batchSaving.value = true;
  try {
    const updates = {};

    if (batchFormType.value === 'major') {
      if (!batchForm.value.majorId) {
        ElMessage.error('请选择专业');
        return;
      }
      updates.majorId = batchForm.value.majorId;
    } else if (batchFormType.value === 'college') {
      updates.collegeId = batchForm.value.collegeId;
    } else if (batchFormType.value === 'level') {
      if (!batchForm.value.trainingLevelId) {
        ElMessage.error('请选择培养层次');
        return;
      }
      updates.trainingLevelId = batchForm.value.trainingLevelId;
    } else if (batchFormType.value === 'year') {
      updates.enrollmentYear = batchForm.value.enrollmentYear;
    } else if (batchFormType.value === 'duration') {
      updates.durationYears = batchForm.value.durationYears;
    } else if (batchFormType.value === 'leftSchool') {
      updates.isLeftSchool = batchForm.value.isLeftSchool;
    }

    await Promise.all(
      selectedClasses.value.map((cls) => updateClass(cls.id, { ...cls, ...updates }))
    );

    ElMessage.success('批量设置成功');
    batchDialogVisible.value = false;
    selectedClasses.value = [];
    load();
  } catch (error) {
    ElMessage.error('批量设置失败');
  } finally {
    batchSaving.value = false;
  }
}

function beforeImport(file) {
  progressDialogVisible.value = true;
  progressPercent.value = 0;
  progressStatus.value = '';
  progressText.value = '正在上传文件...';
  progressDetail.value = '';
  return true;
}

function onImportSuccess(res) {
  progressPercent.value = 100;
  const data = res?.data || {};
  const total = Number(data.total) || 0;
  const imported = Number(data.imported) || 0;
  const overwritten = Number(data.overwritten) || 0;
  const failed = Number(data.failed) || 0;
  const errors = Array.isArray(data.errors) ? data.errors : [];
  const succeeded = imported + overwritten;

  // 判定结果类型
  let type = 'success';
  if (succeeded === 0 && failed > 0) type = 'error';
  else if (failed > 0) type = 'warning';

  const titleMap = {
    success: '导入成功',
    warning: '导入完成（部分失败）',
    error: '导入失败',
  };

  // 进度弹窗短暂展示成功状态后关闭，再用统一的通知卡片显示详细结果
  progressStatus.value =
    type === 'error' ? 'exception' : type === 'warning' ? 'warning' : 'success';
  progressText.value = titleMap[type];
  progressDetail.value = '';

  setTimeout(() => {
    progressDialogVisible.value = false;
    showImportResultCard({
      title: titleMap[type],
      type,
      total,
      imported,
      overwritten,
      failed,
      errors,
    });
    load();
  }, 800);
}

function onImportError(err) {
  progressPercent.value = 100;
  progressStatus.value = 'exception';
  progressText.value = '导入失败';
  progressDetail.value = err.message || '请检查文件格式';

  setTimeout(() => {
    progressDialogVisible.value = false;
    ElMessage.error('导入失败');
  }, 1500);
}

async function handleExport() {
  // 将filters转换为exportData需要的参数格式 to exportData需要的格式
  const customParams = {};
  if (filters.value.name) customParams.name = filters.value.name;
  if (filters.value.majorId) customParams.majorId = filters.value.majorId;
  if (filters.value.collegeId) customParams.collegeId = filters.value.collegeId;
  if (filters.value.trainingLevelId) customParams.trainingLevelId = filters.value.trainingLevelId;
  if (filters.value.enrollmentYear) customParams.enrollmentYear = filters.value.enrollmentYear;
  if (filters.value.status) customParams.status = filters.value.status;
  if (filters.value.planId) customParams.planId = filters.value.planId;

  await exportData(customParams);
}

onMounted(() => {
  load();
  loadBaseData();
});
</script>

<style scoped>
.progress-container {
  padding: 20px 0;
}

.progress-info {
  margin-top: 20px;
  text-align: center;
}

.progress-text {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.progress-detail {
  font-size: 14px;
  color: var(--text-secondary);
}

.progress-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border-light);
  color: var(--brand-primary);
  font-size: 14px;
}
</style>
