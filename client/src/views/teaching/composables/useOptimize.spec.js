import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

const mockRunOptimize = vi.fn();
const mockApplyOptimize = vi.fn();
vi.mock('@/api/teachingArrange', () => ({
  runOptimizeScheduleWithProgress: (...a) => mockRunOptimize(...a),
  applyOptimizeResult: (...a) => mockApplyOptimize(...a),
}));

const mockElMessage = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('element-plus', () => ({
  ElMessage: mockElMessage,
}));

import { useOptimize } from '@/views/teaching/composables/useOptimize';

function makeComposable(overrides = {}) {
  const deps = {
    selectedSemester: ref('2025-2026-2'),
    loadData: vi.fn().mockResolvedValue(),
    confirmHistoricalEdit: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return { deps, c: useOptimize(deps) };
}

describe('useOptimize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleOptimize 打开确认弹窗', () => {
    const { c } = makeComposable();
    c.handleOptimize();
    expect(c.optimizeConfirmVisible.value).toBe(true);
  });

  describe('doOptimize', () => {
    it('历史学期编辑未确认时中止', async () => {
      const { c } = makeComposable({
        confirmHistoricalEdit: vi.fn().mockResolvedValue(false),
      });
      await c.doOptimize();
      expect(mockRunOptimize).not.toHaveBeenCalled();
    });

    it('成功流程：进度消息更新、结果弹窗打开、结束后清空消息', async () => {
      mockRunOptimize.mockImplementation(async (params, onProgress) => {
        onProgress({ message: '正在分析…' });
        return { success: true, data: { changes: [{ id: 1 }], summary: {} } };
      });
      const { c } = makeComposable();

      const promise = c.doOptimize();
      await promise;

      expect(mockRunOptimize).toHaveBeenCalledWith(
        { semester: '2025-2026-2', mode: 'standard' },
        expect.any(Function)
      );
      expect(c.optimizeResult.value).toEqual({ changes: [{ id: 1 }], summary: {} });
      expect(c.optimizeResultVisible.value).toBe(true);
      expect(c.optimizing.value).toBe(false);
      // finally 中清空进度消息
      expect(c.progressMessage.value).toBe('');
    });

    it('无可用结果时提示 warning', async () => {
      mockRunOptimize.mockResolvedValue({ success: true, data: null, message: '无需优化' });
      const { c } = makeComposable();

      await c.doOptimize();

      expect(mockElMessage.warning).toHaveBeenCalledWith('无需优化');
      expect(c.optimizeResultVisible.value).toBe(false);
    });

    it('接口异常时提示错误', async () => {
      mockRunOptimize.mockRejectedValue(new Error('SSE 断开'));
      const { c } = makeComposable();

      await c.doOptimize();

      expect(mockElMessage.error).toHaveBeenCalledWith('排课优化失败：SSE 断开');
      expect(c.optimizing.value).toBe(false);
    });
  });

  describe('applyOptimizeResult', () => {
    it('没有可应用变更时提示 warning', async () => {
      const { c } = makeComposable();
      c.optimizeResult.value = null;

      await c.applyOptimizeResult();

      expect(mockElMessage.warning).toHaveBeenCalledWith('没有可应用的变更');
      expect(mockApplyOptimize).not.toHaveBeenCalled();
    });

    it('全部应用成功时提示 success 并刷新数据', async () => {
      mockApplyOptimize.mockResolvedValue({
        success: true,
        data: { requestedChanges: 3, appliedChanges: 3 },
      });
      const { c, deps } = makeComposable();
      c.optimizeResult.value = { changes: [{}, {}, {}] };
      c.optimizeResultVisible.value = true;

      await c.applyOptimizeResult();

      expect(mockApplyOptimize).toHaveBeenCalledWith({
        semester: '2025-2026-2',
        changes: [{}, {}, {}],
      });
      expect(mockElMessage.success).toHaveBeenCalledWith('优化已应用：变更3个班级');
      expect(c.optimizeResultVisible.value).toBe(false);
      // 结果保留到弹窗关闭动画结束后由 closeOptimizeResult 清理
      expect(c.optimizeResult.value).not.toBeNull();
      expect(deps.loadData).toHaveBeenCalledTimes(1);
    });

    it('部分变更被跳过时提示 warning（基于后端实际返回数）', async () => {
      mockApplyOptimize.mockResolvedValue({
        success: true,
        data: { requestedChanges: 5, appliedChanges: 3 },
      });
      const { c } = makeComposable();
      c.optimizeResult.value = { changes: [{}, {}, {}, {}, {}] };

      await c.applyOptimizeResult();

      expect(mockElMessage.warning).toHaveBeenCalledWith(
        '优化已应用：实际变更3个班级（2项因数据变动被跳过）'
      );
    });

    it('后端返回失败时提示错误消息', async () => {
      mockApplyOptimize.mockResolvedValue({ success: false, message: '数据已被修改' });
      const { c, deps } = makeComposable();
      c.optimizeResult.value = { changes: [{}] };

      await c.applyOptimizeResult();

      expect(mockElMessage.error).toHaveBeenCalledWith('数据已被修改');
      expect(deps.loadData).not.toHaveBeenCalled();
    });

    it('接口异常时提示错误', async () => {
      mockApplyOptimize.mockRejectedValue(new Error('超时'));
      const { c } = makeComposable();
      c.optimizeResult.value = { changes: [{}] };

      await c.applyOptimizeResult();

      expect(mockElMessage.error).toHaveBeenCalledWith('应用优化结果失败：超时');
      expect(c.optimizing.value).toBe(false);
    });

    it('历史学期编辑未确认时中止应用', async () => {
      const { c } = makeComposable({
        confirmHistoricalEdit: vi.fn().mockResolvedValue(false),
      });
      c.optimizeResult.value = { changes: [{}] };

      await c.applyOptimizeResult();

      expect(mockApplyOptimize).not.toHaveBeenCalled();
    });
  });

  it('closeOptimizeResult 关闭弹窗并清空结果', () => {
    const { c } = makeComposable();
    c.optimizeResult.value = { changes: [] };
    c.optimizeResultVisible.value = true;

    c.closeOptimizeResult();

    expect(c.optimizeResultVisible.value).toBe(false);
    expect(c.optimizeResult.value).toBeNull();
  });
});
