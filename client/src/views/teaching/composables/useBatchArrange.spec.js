import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

const mockRunBatchArrange = vi.fn();
vi.mock('@/api/teachingArrange', () => ({
  runBatchAutoArrangeWithProgress: (...a) => mockRunBatchArrange(...a),
}));

const mockElMessage = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('element-plus', () => ({
  ElMessage: mockElMessage,
}));

import { useBatchArrange } from '@/views/teaching/composables/useBatchArrange';

function makeComposable(overrides = {}) {
  const deps = {
    selectedSemester: ref('2025-2026-2'),
    hourSettingsRef: ref({ totalHours: 48 }),
    loadData: vi.fn().mockResolvedValue(),
    confirmHistoricalEdit: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return { deps, c: useBatchArrange(deps) };
}

describe('useBatchArrange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleBatchAutoArrange 填充确认弹窗数据', () => {
    const { c } = makeComposable();
    c.handleBatchAutoArrange('full');

    expect(c.batchConfirmVisible.value).toBe(true);
    expect(c.batchConfirmData.value.title).toBe('批量排课 - 全量模式');
    expect(c.batchConfirmData.value.mode).toBe('全量模式');
  });

  it('历史学期编辑未确认时中止批量排课', async () => {
    const { c } = makeComposable({
      confirmHistoricalEdit: vi.fn().mockResolvedValue(false),
    });
    c.handleBatchAutoArrange('standard');
    await c.doBatchAutoArrange();

    expect(mockRunBatchArrange).not.toHaveBeenCalled();
    expect(c.progressVisible.value).toBe(false);
  });

  it('成功流程：进度回调更新批量进度字段并写入结果', async () => {
    mockRunBatchArrange.mockImplementation(async (params, onProgress) => {
      onProgress({
        processed: 5,
        total: 12,
        currentCourseName: '线性代数',
        cumulativeAssigned: 40,
        cumulativeUnassigned: 3,
      });
      onProgress({ message: '无 processed 字段时不更新' });
      return { message: '批量排课完成', data: { summary: { assigned: 100 } } };
    });
    const { c, deps } = makeComposable();

    c.handleBatchAutoArrange('standard');
    await c.doBatchAutoArrange();

    expect(mockRunBatchArrange).toHaveBeenCalledWith(
      {
        semester: '2025-2026-2',
        mode: 'standard',
        hourSettings: { totalHours: 48 },
      },
      expect.any(Function)
    );
    expect(c.progressProcessed.value).toBe(5);
    expect(c.progressTotal.value).toBe(12);
    expect(c.progressCurrentCourseName.value).toBe('线性代数');
    expect(c.progressCumulativeAssigned.value).toBe(40);
    expect(c.progressCumulativeUnassigned.value).toBe(3);
    expect(c.progressFinished.value).toBe(true);
    expect(c.progressMessage.value).toBe('批量排课完成');
    expect(c.batchResult.value).toEqual({ summary: { assigned: 100 } });
    expect(deps.loadData).toHaveBeenCalledTimes(1);
    expect(c.batchArranging.value).toBe(false);
  });

  it('进度回调缺省字段回退默认值', async () => {
    mockRunBatchArrange.mockImplementation(async (params, onProgress) => {
      onProgress({ processed: 1, total: 2 });
      return { message: 'ok', data: {} };
    });
    const { c } = makeComposable();

    c.handleBatchAutoArrange('standard');
    await c.doBatchAutoArrange();

    expect(c.progressCurrentCourseName.value).toBe('');
    expect(c.progressCumulativeAssigned.value).toBe(0);
    expect(c.progressCumulativeUnassigned.value).toBe(0);
  });

  it('失败流程：关闭进度弹窗并提示错误', async () => {
    mockRunBatchArrange.mockRejectedValue(new Error('boom'));
    const { c, deps } = makeComposable();

    c.handleBatchAutoArrange('full');
    await c.doBatchAutoArrange();

    expect(c.progressVisible.value).toBe(false);
    expect(mockElMessage.error).toHaveBeenCalledWith('批量排课失败');
    expect(deps.loadData).not.toHaveBeenCalled();
    expect(c.batchArranging.value).toBe(false);
  });

  it('resetProgress 复位全部进度状态', async () => {
    mockRunBatchArrange.mockImplementation(async (params, onProgress) => {
      onProgress({ processed: 9, total: 9, currentCourseName: 'X' });
      return { message: 'done', data: {} };
    });
    const { c } = makeComposable();
    c.handleBatchAutoArrange('standard');
    await c.doBatchAutoArrange();

    c.resetProgress();

    expect(c.progressFinished.value).toBe(false);
    expect(c.progressProcessed.value).toBe(0);
    expect(c.progressTotal.value).toBe(0);
    expect(c.progressCurrentCourseName.value).toBe('');
    expect(c.progressMessage.value).toBe('');
  });
});
