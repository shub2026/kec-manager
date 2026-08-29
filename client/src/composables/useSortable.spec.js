/**
 * useSortable 通用排序 composable 单元测试
 *
 * 覆盖：
 * - 上移/下移交换排序值并刷新、首尾边界不动作
 * - 排序值相同时改用基于位置的值（避免交换无效）
 * - 失败时回滚刷新并提示错误
 * - providedIndex / indexFinder / 自定义 sortField
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

const mockElMessage = vi.hoisted(() => {
  const fn = vi.fn();
  fn.success = vi.fn();
  fn.error = vi.fn();
  fn.warning = vi.fn();
  fn.info = vi.fn();
  return fn;
});

vi.mock('element-plus', () => ({ ElMessage: mockElMessage }));

import { useSortable } from './useSortable';

function makeList() {
  return ref([
    { id: 1, name: 'A', sortOrder: 0 },
    { id: 2, name: 'B', sortOrder: 1 },
    { id: 3, name: 'C', sortOrder: 2 },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleMoveUp', () => {
  it('中间项上移：与上一项交换排序值并刷新', async () => {
    const list = makeList();
    const updateFn = vi.fn().mockResolvedValue({});
    const reloadFn = vi.fn().mockResolvedValue();
    const { handleMoveUp } = useSortable(list, updateFn, reloadFn);

    await handleMoveUp(list.value[1]);

    expect(updateFn).toHaveBeenCalledWith(2, { sortOrder: 0 });
    expect(updateFn).toHaveBeenCalledWith(1, { sortOrder: 1 });
    expect(mockElMessage.success).toHaveBeenCalledWith('排序已更新');
    expect(reloadFn).toHaveBeenCalled();
  });

  it('首项上移不触发任何调用', async () => {
    const list = makeList();
    const updateFn = vi.fn();
    const reloadFn = vi.fn();
    const { handleMoveUp } = useSortable(list, updateFn, reloadFn);

    await handleMoveUp(list.value[0]);

    expect(updateFn).not.toHaveBeenCalled();
    expect(reloadFn).not.toHaveBeenCalled();
  });

  it('排序值相同（脏数据）时使用基于位置的值', async () => {
    const list = ref([
      { id: 1, sortOrder: 5 },
      { id: 2, sortOrder: 5 },
    ]);
    const updateFn = vi.fn().mockResolvedValue({});
    const reloadFn = vi.fn().mockResolvedValue();
    const { handleMoveUp } = useSortable(list, updateFn, reloadFn);

    await handleMoveUp(list.value[1]); // index 1

    expect(updateFn).toHaveBeenCalledWith(2, { sortOrder: 0 }); // index - 1
    expect(updateFn).toHaveBeenCalledWith(1, { sortOrder: 1 }); // index
  });

  it('更新失败：回滚刷新并提示错误', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const list = makeList();
    const updateFn = vi.fn().mockRejectedValue(new Error('boom'));
    const reloadFn = vi.fn().mockResolvedValue();
    const { handleMoveUp } = useSortable(list, updateFn, reloadFn);

    await handleMoveUp(list.value[1]);

    expect(reloadFn).toHaveBeenCalled(); // 回滚到服务端状态
    expect(mockElMessage.error).toHaveBeenCalledWith('排序更新失败');
    expect(mockElMessage.success).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('handleMoveDown', () => {
  it('中间项下移：与下一项交换排序值', async () => {
    const list = makeList();
    const updateFn = vi.fn().mockResolvedValue({});
    const reloadFn = vi.fn().mockResolvedValue();
    const { handleMoveDown } = useSortable(list, updateFn, reloadFn);

    await handleMoveDown(list.value[1]);

    expect(updateFn).toHaveBeenCalledWith(2, { sortOrder: 2 });
    expect(updateFn).toHaveBeenCalledWith(3, { sortOrder: 1 });
    expect(reloadFn).toHaveBeenCalled();
  });

  it('末项下移不触发任何调用', async () => {
    const list = makeList();
    const updateFn = vi.fn();
    const { handleMoveDown } = useSortable(list, updateFn, vi.fn());

    await handleMoveDown(list.value[2]);

    expect(updateFn).not.toHaveBeenCalled();
  });
});

describe('可选项', () => {
  it('providedIndex 优先于列表查找', async () => {
    const list = makeList();
    const updateFn = vi.fn().mockResolvedValue({});
    const { handleMoveUp } = useSortable(list, updateFn, vi.fn());

    await handleMoveUp(null, 2); // 显式索引，不依赖 item 查找

    expect(updateFn).toHaveBeenCalledWith(3, { sortOrder: 1 });
    expect(updateFn).toHaveBeenCalledWith(2, { sortOrder: 2 });
  });

  it('indexFinder 用于过滤列表场景的索引定位', async () => {
    const list = makeList();
    const updateFn = vi.fn().mockResolvedValue({});
    const indexFinder = vi.fn().mockReturnValue(1);
    const { handleMoveDown } = useSortable(list, updateFn, vi.fn(), { indexFinder });

    await handleMoveDown({ id: 2 });

    expect(indexFinder).toHaveBeenCalledWith({ id: 2 });
    expect(updateFn).toHaveBeenCalledWith(2, { sortOrder: 2 });
  });

  it('sortField 可自定义', async () => {
    const list = ref([
      { id: 1, seq: 0 },
      { id: 2, seq: 1 },
    ]);
    const updateFn = vi.fn().mockResolvedValue({});
    const { handleMoveDown } = useSortable(list, updateFn, vi.fn(), { sortField: 'seq' });

    await handleMoveDown(list.value[0]);

    expect(updateFn).toHaveBeenCalledWith(1, { seq: 1 });
    expect(updateFn).toHaveBeenCalledWith(2, { seq: 0 });
  });

  it('列表中找不到项目时不动作', async () => {
    const list = makeList();
    const updateFn = vi.fn();
    const { handleMoveUp } = useSortable(list, updateFn, vi.fn());

    await handleMoveUp({ id: 999 });

    expect(updateFn).not.toHaveBeenCalled();
  });
});
