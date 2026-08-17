import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

const mockAssignTeacher = vi.fn();
const mockDeleteAssignment = vi.fn();
const mockResetAutoAssignments = vi.fn();
const mockToggleAssignmentLock = vi.fn();
const mockBatchLockAssignments = vi.fn();
vi.mock('@/api/teachingArrange', () => ({
  assignTeacher: (...a) => mockAssignTeacher(...a),
  deleteAssignment: (...a) => mockDeleteAssignment(...a),
  resetAutoAssignments: (...a) => mockResetAutoAssignments(...a),
  toggleAssignmentLock: (...a) => mockToggleAssignmentLock(...a),
  batchLockAssignments: (...a) => mockBatchLockAssignments(...a),
}));

const mockElMessage = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));
const mockConfirm = vi.hoisted(() => vi.fn());
vi.mock('element-plus', () => ({
  ElMessage: mockElMessage,
  ElMessageBox: { confirm: (...a) => mockConfirm(...a) },
}));

import { useArrangeAssign } from '@/views/teaching/composables/useArrangeAssign';

function makeComposable(overrides = {}) {
  const deps = {
    selectedCourseId: ref(101),
    selectedSemester: ref('2025-2026-2'),
    globalCurrentSemester: ref('2025-2026-2'),
    settingsRef: ref({}),
    teacherDialogRef: ref({ open: vi.fn(), close: vi.fn() }),
    loadData: vi.fn().mockResolvedValue(),
    refreshArrangeData: vi.fn().mockResolvedValue(),
    ...overrides,
  };
  return { deps, c: useArrangeAssign(deps) };
}

describe('useArrangeAssign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('历史学期状态 computed', () => {
    it('当前学期：非历史、非只读、非二次确认', () => {
      const { c } = makeComposable();
      expect(c.isHistoricalSemester.value).toBe(false);
      expect(c.historicalReadOnly.value).toBe(false);
      expect(c.historicalGuarded.value).toBe(false);
    });

    it('历史学期且开关关闭：进入只读模式', () => {
      const { c } = makeComposable({ selectedSemester: ref('2024-2025-1') });
      expect(c.isHistoricalSemester.value).toBe(true);
      expect(c.historicalReadOnly.value).toBe(true);
      expect(c.historicalGuarded.value).toBe(false);
    });

    it('历史学期且开关开启：进入编辑前二次确认模式', () => {
      const { c } = makeComposable({
        selectedSemester: ref('2024-2025-1'),
        settingsRef: ref({ allowHistoricalEdit: { value: 'true' } }),
      });
      expect(c.historicalReadOnly.value).toBe(false);
      expect(c.historicalGuarded.value).toBe(true);
    });
  });

  describe('confirmHistoricalEdit', () => {
    it('非历史学期直接放行，不弹窗', async () => {
      const { c } = makeComposable();
      await expect(c.confirmHistoricalEdit()).resolves.toBe(true);
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockElMessage.warning).not.toHaveBeenCalled();
    });

    it('只读模式拦截并提示', async () => {
      const { c } = makeComposable({ selectedSemester: ref('2024-2025-1') });
      await expect(c.confirmHistoricalEdit()).resolves.toBe(false);
      expect(mockElMessage.warning).toHaveBeenCalled();
      expect(mockConfirm).not.toHaveBeenCalled();
    });

    it('二次确认模式：用户确认后放行', async () => {
      mockConfirm.mockResolvedValue('confirm');
      const { c } = makeComposable({
        selectedSemester: ref('2024-2025-1'),
        settingsRef: ref({ allowHistoricalEdit: { value: 'true' } }),
      });
      await expect(c.confirmHistoricalEdit()).resolves.toBe(true);
      expect(mockConfirm).toHaveBeenCalledTimes(1);
    });

    it('二次确认模式：用户取消后拦截', async () => {
      mockConfirm.mockRejectedValue(new Error('cancel'));
      const { c } = makeComposable({
        selectedSemester: ref('2024-2025-1'),
        settingsRef: ref({ allowHistoricalEdit: { value: 'true' } }),
      });
      await expect(c.confirmHistoricalEdit()).resolves.toBe(false);
    });
  });

  describe('openTeacherSelect', () => {
    it('只读模式拦截，不打开弹窗', () => {
      const { c, deps } = makeComposable({ selectedSemester: ref('2024-2025-1') });
      c.openTeacherSelect({ id: 1 });
      expect(deps.teacherDialogRef.value.open).not.toHaveBeenCalled();
      expect(mockElMessage.warning).toHaveBeenCalled();
    });

    it('正常模式打开弹窗并传入选中行', () => {
      const { c, deps } = makeComposable();
      const row = { id: 7 };
      c.openTeacherSelect(row);
      expect(deps.teacherDialogRef.value.open).toHaveBeenCalledWith(row);
    });
  });

  describe('onTeacherConfirm', () => {
    it('成功：传参正确、关闭弹窗并刷新数据', async () => {
      mockAssignTeacher.mockResolvedValue({});
      const { c, deps } = makeComposable();

      await c.onTeacherConfirm({ classId: 11, teacherId: 22, weeklyHours: 4 });

      expect(mockAssignTeacher).toHaveBeenCalledWith({
        classId: 11,
        courseId: 101,
        semester: '2025-2026-2',
        teacherId: 22,
        weeklyHours: 4,
      });
      expect(deps.teacherDialogRef.value.close).toHaveBeenCalled();
      expect(mockElMessage.success).toHaveBeenCalledWith('安排成功');
      expect(deps.loadData).toHaveBeenCalledTimes(1);
    });

    it('历史学期确认未通过：不调用 API', async () => {
      const { c } = makeComposable({ selectedSemester: ref('2024-2025-1') });
      await c.onTeacherConfirm({ classId: 11, teacherId: 22, weeklyHours: 4 });
      expect(mockAssignTeacher).not.toHaveBeenCalled();
    });

    it('API 失败：提示错误且不刷新', async () => {
      mockAssignTeacher.mockRejectedValue(new Error('boom'));
      const { c, deps } = makeComposable();

      await c.onTeacherConfirm({ classId: 11, teacherId: 22, weeklyHours: 4 });

      expect(mockElMessage.error).toHaveBeenCalledWith('安排失败');
      expect(deps.loadData).not.toHaveBeenCalled();
    });
  });

  describe('handleRemoveAssignment', () => {
    it('无安排记录时直接返回', async () => {
      const { c, deps } = makeComposable();
      await c.handleRemoveAssignment({ assignment: null });
      expect(mockDeleteAssignment).not.toHaveBeenCalled();
      expect(deps.loadData).not.toHaveBeenCalled();
    });

    it('成功移除并刷新', async () => {
      mockDeleteAssignment.mockResolvedValue({});
      const { c, deps } = makeComposable();

      await c.handleRemoveAssignment({ assignment: { id: 55 } });

      expect(mockDeleteAssignment).toHaveBeenCalledWith(55);
      expect(mockElMessage.success).toHaveBeenCalledWith('已移除安排');
      expect(deps.loadData).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleToggleLock', () => {
    it('未锁定 → 锁定', async () => {
      mockToggleAssignmentLock.mockResolvedValue({});
      const { c } = makeComposable();

      await c.handleToggleLock({ assignment: { id: 66, isLocked: false } });

      expect(mockToggleAssignmentLock).toHaveBeenCalledWith(66, true);
      expect(mockElMessage.success).toHaveBeenCalledWith('已锁定');
    });

    it('已锁定 → 解锁', async () => {
      mockToggleAssignmentLock.mockResolvedValue({});
      const { c } = makeComposable();

      await c.handleToggleLock({ assignment: { id: 66, isLocked: true } });

      expect(mockToggleAssignmentLock).toHaveBeenCalledWith(66, false);
      expect(mockElMessage.success).toHaveBeenCalledWith('已解锁');
    });

    it('无安排记录时直接返回', async () => {
      const { c } = makeComposable();
      await c.handleToggleLock({ assignment: null });
      expect(mockToggleAssignmentLock).not.toHaveBeenCalled();
    });
  });

  describe('handleBatchLockAll / handleBatchUnlockAll', () => {
    it('全部锁定：locked=true，后端消息优先展示', async () => {
      mockBatchLockAssignments.mockResolvedValue({ message: '已锁定 8 条' });
      const { c } = makeComposable();

      await c.handleBatchLockAll();

      expect(mockBatchLockAssignments).toHaveBeenCalledWith({
        semester: '2025-2026-2',
        courseId: 101,
        locked: true,
      });
      expect(mockElMessage.success).toHaveBeenCalledWith('已锁定 8 条');
    });

    it('全部解锁：locked=false，无后端消息时回退默认文案', async () => {
      mockBatchLockAssignments.mockResolvedValue({});
      const { c } = makeComposable();

      await c.handleBatchUnlockAll();

      expect(mockBatchLockAssignments).toHaveBeenCalledWith({
        semester: '2025-2026-2',
        courseId: 101,
        locked: false,
      });
      expect(mockElMessage.success).toHaveBeenCalledWith('已解锁');
    });
  });

  describe('重置', () => {
    it('handleResetCommand 记录范围并打开确认弹窗', () => {
      const { c } = makeComposable();
      c.handleResetCommand('all');
      expect(c.resetScope.value).toBe('all');
      expect(c.resetConfirmVisible.value).toBe(true);
    });

    it('current 范围：payload 携带 courseId，成功后关闭弹窗并统一刷新', async () => {
      mockResetAutoAssignments.mockResolvedValue({ message: '已重置' });
      const { c, deps } = makeComposable();
      c.handleResetCommand('current');

      await c.handleReset();

      expect(mockResetAutoAssignments).toHaveBeenCalledWith({
        semester: '2025-2026-2',
        courseId: 101,
      });
      expect(c.resetConfirmVisible.value).toBe(false);
      expect(deps.refreshArrangeData).toHaveBeenCalledTimes(1);
      expect(c.resetting.value).toBe(false);
    });

    it('all 范围：payload 不携带 courseId', async () => {
      mockResetAutoAssignments.mockResolvedValue({});
      const { c } = makeComposable();
      c.handleResetCommand('all');

      await c.handleReset();

      expect(mockResetAutoAssignments).toHaveBeenCalledWith({ semester: '2025-2026-2' });
    });

    it('历史学期确认未通过：不调用 API，resetting 恢复', async () => {
      const { c, deps } = makeComposable({ selectedSemester: ref('2024-2025-1') });
      c.handleResetCommand('current');

      await c.handleReset();

      expect(mockResetAutoAssignments).not.toHaveBeenCalled();
      expect(deps.refreshArrangeData).not.toHaveBeenCalled();
      expect(c.resetting.value).toBe(false);
    });

    it('API 失败：提示错误，resetting 恢复', async () => {
      mockResetAutoAssignments.mockRejectedValue(new Error('boom'));
      const { c } = makeComposable();
      c.handleResetCommand('current');

      await c.handleReset();

      expect(mockElMessage.error).toHaveBeenCalledWith('重置失败');
      expect(c.resetting.value).toBe(false);
    });
  });
});
