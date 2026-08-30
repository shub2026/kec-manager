import { ref, computed, onMounted, onActivated, onUnmounted, watch } from 'vue';
import { ElMessage, ElNotification } from 'element-plus';
import {
  getClasses,
  getClassOptions,
  createClass,
  updateClass,
  deleteClass,
  batchDeleteClasses,
  batchUpdateClasses,
} from '../../../api/class';
import { useSettingsStore } from '../../../stores/settings';
import { useClassDataStore } from '../../../stores/classData';
import { useExport } from '../../../composables/useExport';
import { showImportResultCard, validateExcelFile } from '../../../composables/useImport';
import { useDebounceFn } from '../../../composables/useDebounce';

/**
 * 班级列表页业务逻辑：查询/分页/表单弹窗/删除/批量操作/导入导出。
 * 须在组件 setup 上下文中调用（内部注册生命周期钩子与 watch）。
 */
export function useClassList() {
  const list = ref([]);
  const loading = ref(false);
  // P0 修复：列表加载错误状态，供 ListErrorState 占位
  const error = ref(null);
  const selectedClasses = ref([]);
  const currentSemesterInfo = ref(null);
  // 合班伙伴候选班级（轻量列表：id/name/collegeId/combinationId/matchedPlanId），在打开编辑弹窗时按需加载
  const allClassOptions = ref([]);
  let _allClassOptionsLoaded = false;
  // 班级数据变更（增删改/导入/合班调整）后失效候选缓存，下次打开弹窗重新拉取
  function invalidateClassOptions() {
    _allClassOptionsLoaded = false;
  }

  // 使用 classDataStore 管理共享参考数据（消除向 ClassFilterBar / ClassFormDialog 传递 15+ props）
  const classDataStore = useClassDataStore();

  const filters = ref({
    name: '',
    majorId: null,
    collegeId: null,
    trainingLevelId: null,
    enrollmentYear: null,
    status: null,
    planId: null,
    isCombined: null,
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

  const batchDeleteConfirmVisible = ref(false);
  const batchDeleteConfirmMessage = ref('');
  const batchDeleting = ref(false);

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
    isCombinedClass: false,
    combinationClassIds: [],
  });

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
    error.value = null;
    try {
      const params = {
        ...filters.value,
        page: pagination.value.page,
        pageSize: pagination.value.pageSize,
      };

      const res = await getClasses(params);
      list.value = res?.data?.items || [];
      pagination.value.total = res?.data?.total || 0;

      // 关联关系数据由 store 统一管理（首次加载后不再重复赋值）
      classDataStore.ingestRelations(res?.data);
    } catch (err) {
      error.value = err?.response?.data?.message || '班级数据加载失败，请稍后重试';
      if (import.meta.env.DEV) console.error('加载失败:', err);
    } finally {
      loading.value = false;
    }
  }

  async function loadBaseData() {
    try {
      const settingsStore = useSettingsStore();
      await Promise.all([classDataStore.loadBaseData(), settingsStore.load()]);

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

  // 名称输入防抖搜索：输入停顿 300ms 后自动触发查询，无需按回车
  // 使用项目通用 useDebounceFn，组件卸载时自动清理定时器
  const debouncedSearch = useDebounceFn(() => {
    pagination.value.page = 1;
    load();
  }, 300);
  watch(() => filters.value.name, debouncedSearch);

  function handlePageChange(page) {
    pagination.value.page = page;
    load();
  }

  function handleSizeChange(size) {
    pagination.value.pageSize = size;
    pagination.value.page = 1;
    load();
  }

  async function openDialog(row = null) {
    if (row) {
      form.value = {
        ...row,
        isCombinedClass: row.isCombinedClass ?? false,
        combinationClassIds: Array.isArray(row.partnerClassIds) ? [...row.partnerClassIds] : [],
      };
    } else {
      resetForm();
    }
    // 先开弹窗：让用户立即看到表单，options 异步加载后再回填，避免点击后明显延迟
    dialogVisible.value = true;
    if (!_allClassOptionsLoaded) {
      try {
        // 全量轻量接口，不受 listClasses 分页上限（100）截断
        const res = await getClassOptions();
        allClassOptions.value = (res?.data?.items || []).map((c) => ({
          id: c.id,
          name: c.name,
          collegeId: c.collegeId,
          combinationId: c.combinationId ?? null,
          matchedPlanId: c.matchedPlanId ?? null,
        }));
        _allClassOptionsLoaded = true;
      } catch {
        allClassOptions.value = [];
      }
    }
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
      isCombinedClass: false,
      combinationClassIds: [],
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
        combinationClassIds: form.value.isCombinedClass
          ? (form.value.combinationClassIds || []).map(Number).filter((id) => id > 0)
          : [],
      };

      if (form.value.id) {
        await updateClass(form.value.id, classData);
        ElMessage.success('更新成功');
      } else {
        await createClass(classData);
        ElMessage.success('创建成功');
      }
      invalidateClassOptions();
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
      await deleteClass(pendingDeleteId, { silent: true });
      invalidateClassOptions();
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

    try {
      const ids = targets.map((t) => t.id);
      const { data } = await batchDeleteClasses(ids, { silent: true });
      const { succeeded = [], failed = [] } = data || {};
      if (succeeded.length > 0) invalidateClassOptions();

      ElMessage.closeAll();

      if (succeeded.length > 0 && failed.length === 0) {
        ElNotification({
          title: '批量删除完成',
          message: `已成功删除 ${succeeded.length} 个班级`,
          type: 'success',
          duration: 4000,
        });
      } else if (succeeded.length === 0 && failed.length > 0) {
        const assignCount = failed.filter((f) => f.reason?.includes('排课记录')).length;
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
            message: `删除失败：${failed[0]?.reason || '未知错误'}`,
            type: 'error',
            duration: 6000,
          });
        }
      } else if (succeeded.length > 0 && failed.length > 0) {
        const assignCount = failed.filter((f) => f.reason?.includes('排课记录')).length;
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
      } else {
        ElNotification({
          title: '批量删除',
          message: '未选择任何班级',
          type: 'info',
          duration: 3000,
        });
      }
    } catch (e) {
      if (import.meta.env.DEV) console.error('[BatchDelete] 批量删除请求失败:', e);
      ElMessage.closeAll();
      const reason = e?.response?.data?.message || e?.message || '未知错误';
      ElNotification({
        title: '批量删除失败',
        message: reason,
        type: 'error',
        duration: 6000,
      });
    } finally {
      selectedClasses.value = [];
      batchDeleting.value = false;
      load();
    }
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
    if (batchFormType.value === 'leftSchool' && batchForm.value.isLeftSchool) {
      leftSchoolConfirmMessage.value = `标记为"离校"将自动删除所选 ${selectedClasses.value.length} 个班级在当前学期的所有排课记录，释放教师课时容量。确定继续？`;
      leftSchoolConfirmVisible.value = true;
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

      const ids = selectedClasses.value.map((cls) => cls.id);
      const { data } = await batchUpdateClasses(ids, updates);
      const { succeeded = [], failed = [], deletedAssignmentCount = 0 } = data || {};
      if (succeeded.length > 0) invalidateClassOptions();

      // 批量离校会级联删除当前及未来学期排课，提示删除数量形成闭环
      const cascadeNote =
        deletedAssignmentCount > 0 ? `，已同步删除 ${deletedAssignmentCount} 条排课记录` : '';
      if (failed.length === 0) {
        ElMessage.success(`批量设置成功，已更新 ${succeeded.length} 个班级${cascadeNote}`);
      } else if (succeeded.length === 0) {
        ElMessage.error(`批量设置失败：${failed[0]?.reason || '未知错误'}`);
      } else {
        ElMessage.warning(
          `批量设置部分成功：成功 ${succeeded.length} 个，失败 ${failed.length} 个${cascadeNote}`
        );
      }

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
    if (!validateExcelFile(file)) return false;
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
    if (succeeded > 0) invalidateClassOptions();

    let type = 'success';
    if (succeeded === 0 && failed > 0) type = 'error';
    else if (failed > 0) type = 'warning';

    const titleMap = {
      success: '导入成功',
      warning: '导入完成（部分失败）',
      error: '导入失败',
    };

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

  onActivated(() => {
    if (sessionStorage.getItem('classListNeedsRefresh') === 'true') {
      sessionStorage.removeItem('classListNeedsRefresh');
      loadBaseData();
    }
  });

  onUnmounted(() => {
    if (_leftSchoolResolve) {
      _leftSchoolResolve(false);
      _leftSchoolResolve = null;
    }
  });

  return {
    // 列表与查询
    list,
    loading,
    error,
    filters,
    pagination,
    currentSemesterInfo,
    selectedClasses,
    load,
    resetPaginationAndLoad,
    handlePageChange,
    handleSizeChange,
    handleSelectionChange,
    // 表单弹窗
    dialogVisible,
    form,
    allClassOptions,
    saving,
    openDialog,
    resetForm,
    handleSave,
    // 单个删除
    deleteConfirmVisible,
    deleting,
    handleDelete,
    confirmDelete,
    // 批量删除
    batchDeleteConfirmVisible,
    batchDeleteConfirmMessage,
    batchDeleting,
    handleBatchDelete,
    confirmBatchDelete,
    // 批量设置
    batchDialogVisible,
    batchForm,
    batchFormType,
    batchDialogTitle,
    batchSaving,
    openBatchSetDialog,
    resetBatchForm,
    handleBatchSet,
    confirmLeftSchool,
    cancelLeftSchoolConfirm,
    leftSchoolConfirmVisible,
    leftSchoolConfirmMessage,
    // 导入导出
    progressDialogVisible,
    progressPercent,
    progressStatus,
    progressText,
    progressDetail,
    beforeImport,
    onImportSuccess,
    onImportError,
    handleExport,
    downloadTemplate,
  };
}
