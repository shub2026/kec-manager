import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import {
  createSemester,
  updateSemester,
  updatePlanCourse,
  setSemesterTextbook,
  removeSemesterTextbook,
  batchUpdateSemesterWeeks,
  batchUpdateCourseSortOrder,
} from '../api/plan';

/**
 * 课程矩阵编辑操作 composable
 * 负责：单元格编辑、教材关联、学期设置、全局周数应用、排序
 *
 * @param {Object} options
 * @param {() => number} options.getPlanId - 获取当前培养方案ID
 * @param {import('vue').Ref} options.rawCourses - 课程原始数据
 * @param {import('vue').Ref} options.globalWeeks - 全局周数
 * @param {Function} options.isInRange - 判断学期是否在范围内
 * @param {Function} options.loadData - 重新加载数据
 */
export function useCourseMatrixEditing({
  getPlanId,
  rawCourses,
  globalWeeks,
  isInRange,
  loadData,
}) {
  // ==================== 编辑状态 ====================
  const popoverVisible = ref(false);
  const saving = ref(false);
  const editingCourse = ref(null);
  const editingSemester = ref(null);
  const editingTextbookId = ref(null);

  // ==================== 开课学期设置状态 ====================
  const semesterDialogVisible = ref(false);
  const editingCourseForSemester = ref(null);
  const semesterForm = ref({ startSemester: 1, endSemester: 2 });

  // ==================== 单元格编辑 ====================

  /** 打开编辑弹窗（如学期记录不存在则自动创建） */
  async function openEdit(course, semester) {
    if (!isInRange(course, semester)) {
      ElMessage.warning('该学期不在课程开课范围内');
      return;
    }

    let sem = course.semesters.find((s) => s.semester === semester);

    // 如果学期记录不存在，自动创建
    if (!sem) {
      try {
        const defaultWeeklyHours = course.weeklyHours || 4;
        const defaultWeeksCount = course.weeksPerSemester || globalWeeks.value || 18;

        await createSemester(getPlanId(), course.id, {
          semester,
          weeklyHours: defaultWeeklyHours,
          weeksCount: defaultWeeksCount,
        });

        await loadData();

        const updatedCourse = rawCourses.value.find((c) => c.id === course.id);
        sem = updatedCourse?.planCourseSemesters?.find((s) => s.semester === semester);
        if (!sem) {
          ElMessage.error('创建学期记录失败');
          return;
        }
      } catch (e) {
        if (import.meta.env.DEV) console.error(e);
        ElMessage.error('创建学期记录失败');
        return;
      }
    }

    editingCourse.value = course;
    editingSemester.value = { ...sem };
    editingTextbookId.value = sem.planTextbooks?.[0]?.textbookId || null;
    popoverVisible.value = true;
  }

  /** 保存编辑（课时 + 教材关联） */
  async function saveEdit() {
    if (!editingSemester.value) return;

    if (editingSemester.value.weeklyHours === 0 && editingTextbookId.value) {
      ElMessage.warning('周课时为0时不能选择教材');
      return;
    }

    saving.value = true;
    try {
      await updateSemester(editingSemester.value.id, {
        weeklyHours: editingSemester.value.weeklyHours,
      });

      if (editingTextbookId.value) {
        await setSemesterTextbook(editingSemester.value.id, {
          textbookId: editingTextbookId.value,
          isRequired: true,
        });
      } else {
        await removeSemesterTextbook(editingSemester.value.id);
      }

      ElMessage.success('保存成功');
      popoverVisible.value = false;
      await loadData();
    } catch (e) {
      if (import.meta.env.DEV) console.error(e);
      ElMessage.error('保存失败');
    } finally {
      saving.value = false;
    }
  }

  // ==================== 全局周数 ====================

  /** 批量应用全局周数到所有学期记录 */
  async function applyGlobalWeeks() {
    const weeks = globalWeeks.value;

    const semesterIds = [];
    rawCourses.value.forEach((course) => {
      (course.planCourseSemesters || []).forEach((sem) => {
        semesterIds.push(sem.id);
      });
    });

    if (semesterIds.length > 0) {
      try {
        await batchUpdateSemesterWeeks(semesterIds, weeks, getPlanId());
        await loadData();
        ElMessage.success('已应用周数');
      } catch (e) {
        if (import.meta.env.DEV) {
          console.error('批量更新学期周数失败', e);
        }
        ElMessage.error('应用失败');
      }
    } else {
      ElMessage.info('暂无学期记录可更新');
    }
  }

  // ==================== 开课学期设置 ====================

  /** 打开开课学期设置对话框 */
  function openSemesterSettings(course) {
    editingCourseForSemester.value = course;
    semesterForm.value = {
      startSemester: course.startSemester,
      endSemester: course.endSemester,
    };
    semesterDialogVisible.value = true;
  }

  /** 保存开课学期设置 */
  async function saveSemesterSettings() {
    if (!editingCourseForSemester.value) return;

    const { startSemester, endSemester } = semesterForm.value;
    if (startSemester > endSemester) {
      return ElMessage.warning('起始学期不能大于结束学期');
    }

    saving.value = true;
    try {
      await updatePlanCourse(editingCourseForSemester.value.id, {
        startSemester,
        endSemester,
      });

      ElMessage.success('保存成功');
      semesterDialogVisible.value = false;
      await loadData();
    } catch (e) {
      if (import.meta.env.DEV) console.error(e);
      ElMessage.error('保存失败');
    } finally {
      saving.value = false;
    }
  }

  // ==================== 排序 ====================

  // 快修4：排序防连点守卫——快速连击会并发多个批量排序请求，串行化处理
  const sorting = ref(false);

  /** 通用排序交换（批量接口，单事务原子更新） */
  async function swapSortOrder(group, indexA, indexB) {
    const courses = [...group.courses];
    const tmp = courses[indexA];
    courses[indexA] = courses[indexB];
    courses[indexB] = tmp;

    const items = courses.map((c, i) => ({ id: c.id, sortOrder: i }));
    await batchUpdateCourseSortOrder(items, getPlanId());
  }

  /** 上移课程 */
  async function handleMoveUp(course, group) {
    const index = group.courses.findIndex((c) => c.id === course.id);
    if (index <= 0 || sorting.value) return;

    sorting.value = true;
    try {
      await swapSortOrder(group, index, index - 1);
      ElMessage.success('排序已更新');
      await loadData();
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('排序更新失败:', e);
      }
      ElMessage.error('排序更新失败');
    } finally {
      sorting.value = false;
    }
  }

  /** 下移课程 */
  async function handleMoveDown(course, group) {
    const index = group.courses.findIndex((c) => c.id === course.id);
    if (index >= group.courses.length - 1 || sorting.value) return;

    sorting.value = true;
    try {
      await swapSortOrder(group, index, index + 1);
      ElMessage.success('排序已更新');
      await loadData();
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('排序更新失败:', e);
      }
      ElMessage.error('排序更新失败');
    } finally {
      sorting.value = false;
    }
  }

  // ==================== Watchers ====================

  // 周课时为0时自动清除教材选择
  watch(
    () => editingSemester.value?.weeklyHours,
    (newHours) => {
      if (newHours === 0 && editingTextbookId.value) {
        editingTextbookId.value = null;
      }
    }
  );

  return {
    // 编辑状态
    popoverVisible,
    saving,
    editingCourse,
    editingSemester,
    editingTextbookId,
    // 学期设置状态
    semesterDialogVisible,
    editingCourseForSemester,
    semesterForm,
    // 方法
    openEdit,
    saveEdit,
    applyGlobalWeeks,
    openSemesterSettings,
    saveSemesterSettings,
    handleMoveUp,
    handleMoveDown,
    // 状态
    sorting,
  };
}
