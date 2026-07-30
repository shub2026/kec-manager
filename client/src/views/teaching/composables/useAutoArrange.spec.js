import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

const mockRunAutoArrange = vi.fn();
vi.mock('@/api/teachingArrange', () => ({
  runAutoArrangeWithProgress: (...a) => mockRunAutoArrange(...a),
}));

const mockElMessage = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('element-plus', () => ({
  ElMessage: mockElMessage,
}));

import { useAutoArrange } from '@/views/teaching/composables/useAutoArrange';

function makeComposable(overrides = {}) {
  const deps = {
    selectedCourseId: ref(101),
    selectedSemester: ref('2025-2026-2'),
    courseInfo: ref({ name: '大学英语' }),
    hourSettingsRef: ref({ totalHours: 64 }),
    loadData: vi.fn().mockResolvedValue(),
    confirmHistoricalEdit: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return { deps, c: useAutoArrange(deps) };
}

describe('useAutoArrange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleAutoArrange', () => {
    it('full 模式填充确认弹窗数据并显示', () => {
      const { c } = makeComposable();
      c.handleAutoArrange('full');

      expect(c.arrangeConfirmVisible.value).toBe(true);
      expect(c.arrangeConfirmData.value.title).toBe('自动排课 - 全量模式');
      expect(c.arrangeConfirmData.value.mode).toBe('全量模式');
      expect(c.arrangeConfirmData.value.courseName).toBe('大学英语');
    });

    it('standard 模式显示标准模式标签，课程缺失时回退默认名', () => {
      const { c } = makeComposable({ courseInfo: ref(null) });
      c.handleAutoArrange('standard');

      expect(c.arrangeConfirmData.value.mode).toBe('标准模式');
      expect(c.arrangeConfirmData.value.courseName).toBe('当前课程');
    });
  });

  describe('doAutoArrange', () => {
    it('历史学期编辑未确认时直接中止', async () => {
      const { c } = makeComposable({
        confirmHistoricalEdit: vi.fn().mockResolvedValue(false),
      });
      c.handleAutoArrange('standard');
      await c.doAutoArrange();

      expect(mockRunAutoArrange).not.toHaveBeenCalled();
      expect(c.progressVisible.value).toBe(false);
    });

    it('成功流程：传参正确、进度回调更新阶段、完成后写入结果并刷新数据', async () => {
      mockRunAutoArrange.mockImplementation(async (params, onProgress) => {
        onProgress({ phase: 2 });
        onProgress({}); // 无 phase 字段时不更新
        return { message: '排课完成', data: { assigned: 8, unassigned: 1 } };
      });
      const { c, deps } = makeComposable();

      c.handleAutoArrange('full');
      await c.doAutoArrange();

      expect(mockRunAutoArrange).toHaveBeenCalledWith(
        {
          courseId: 101,
          semester: '2025-2026-2',
          mode: 'full',
          hourSettings: { totalHours: 64 },
        },
        expect.any(Function)
      );
      expect(c.arrangeConfirmVisible.value).toBe(false);
      expect(c.progressVisible.value).toBe(true);
      expect(c.progressCurrentPhase.value).toBe(2);
      expect(c.progressFinished.value).toBe(true);
      expect(c.progressMessage.value).toBe('排课完成');
      expect(c.arrangeResult.value).toEqual({ assigned: 8, unassigned: 1 });
      expect(c.arrangeResultMode.value).toBe('全量模式');
      expect(deps.loadData).toHaveBeenCalledTimes(1);
      expect(c.arranging.value).toBe(false);
    });

    it('失败流程：关闭进度弹窗并提示错误', async () => {
      mockRunAutoArrange.mockRejectedValue(new Error('server down'));
      const { c, deps } = makeComposable();

      c.handleAutoArrange('standard');
      await c.doAutoArrange();

      expect(c.progressVisible.value).toBe(false);
      expect(mockElMessage.error).toHaveBeenCalledWith('自动排课失败');
      expect(deps.loadData).not.toHaveBeenCalled();
      expect(c.arranging.value).toBe(false);
    });

    it('重新排课前复位上一轮进度状态', async () => {
      mockRunAutoArrange.mockResolvedValue({ message: 'ok', data: {} });
      const { c } = makeComposable();

      c.handleAutoArrange('standard');
      await c.doAutoArrange();
      expect(c.progressFinished.value).toBe(true);

      // 第二轮开始时 resetProgress 应清空 finished/phase/message
      mockRunAutoArrange.mockImplementation(async () => {
        expect(c.progressFinished.value).toBe(false);
        expect(c.progressCurrentPhase.value).toBe(0);
        expect(c.progressMessage.value).toBe('');
        return { message: 'ok2', data: {} };
      });
      c.handleAutoArrange('standard');
      await c.doAutoArrange();
    });
  });
});
