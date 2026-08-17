import { ref, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  assignTeacher,
  deleteAssignment,
  resetAutoAssignments,
  toggleAssignmentLock,
  batchLockAssignments,
} from '../../../api/teachingArrange';

// 历史学期只读模式的统一提示文案（openTeacherSelect 与 confirmHistoricalEdit 共用）
const HISTORICAL_READONLY_MESSAGE =
  '当前历史学期为只读模式，禁止编辑。如需编辑请在系统设置 → 排课优化 开启「允许编辑历史学期」。';

/**
 * 教学安排写操作 composable（指派/移除/锁定/重置 + 历史学期权限控制）
 * 从 TeachingArrange.vue 抽取，函数行为与原页面实现一一对应。
 *
 * @param {object} deps
 * @param {import('vue').Ref} deps.selectedCourseId 当前选中课程 id
 * @param {import('vue').Ref} deps.selectedSemester 页面局部学期
 * @param {import('vue').Ref} deps.globalCurrentSemester 全局当前学期
 * @param {import('vue').ComputedRef} deps.settingsRef 系统设置对象（settingsStore.settings）
 * @param {import('vue').Ref} deps.teacherDialogRef 教师选择弹窗组件引用
 * @param {() => Promise<void>} deps.loadData 刷新当前课程班级/教师数据
 * @param {() => Promise<void>} deps.refreshArrangeData 写操作后的统一刷新（课程级或概览级）
 */
export function useArrangeAssign({
  selectedCourseId,
  selectedSemester,
  globalCurrentSemester,
  settingsRef,
  teacherDialogRef,
  loadData,
  refreshArrangeData,
}) {
  // 是否正在查看历史学期（非全局当前学期）
  const isHistoricalSemester = computed(
    () => !!selectedSemester.value && selectedSemester.value !== globalCurrentSemester.value
  );

  // 历史学期是否处于只读模式（系统设置开关关闭时：禁止编辑）
  const historicalReadOnly = computed(
    () => isHistoricalSemester.value && settingsRef.value?.allowHistoricalEdit?.value !== 'true'
  );

  // 历史学期是否处于「编辑前二次确认」模式（系统设置开关开启时：可编辑但需确认）
  const historicalGuarded = computed(
    () => isHistoricalSemester.value && settingsRef.value?.allowHistoricalEdit?.value === 'true'
  );

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
      ElMessage.warning(HISTORICAL_READONLY_MESSAGE);
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

  // --- 教师指派 ---
  function openTeacherSelect(row) {
    if (historicalReadOnly.value) {
      ElMessage.warning(HISTORICAL_READONLY_MESSAGE);
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

  // --- 重置 ---
  const resetConfirmVisible = ref(false);
  const resetting = ref(false);
  const resetScope = ref('current');

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

  return {
    isHistoricalSemester,
    historicalReadOnly,
    historicalGuarded,
    confirmHistoricalEdit,
    openTeacherSelect,
    onTeacherConfirm,
    handleRemoveAssignment,
    handleToggleLock,
    handleBatchLockAll,
    handleBatchUnlockAll,
    resetConfirmVisible,
    resetting,
    resetScope,
    handleResetCommand,
    handleReset,
  };
}
