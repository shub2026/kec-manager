/**
 * useCrudList 通用 CRUD composable 单元测试
 *
 * 覆盖：
 * - load / error 状态（P0：加载失败渲染错误占位而非静默空列表）
 * - openDialog / handleSave（创建/更新/表单校验/提交转换）
 * - handleDelete / confirmDelete / cancelDelete（删除确认弹窗与通知）
 * - silentReload 失败提示、listParams 透传、裸数组响应兜底
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useCrudList } from '@/composables/useCrudList';

const mockElMessage = vi.hoisted(() => {
  const fn = vi.fn();
  fn.success = vi.fn();
  fn.warning = vi.fn();
  fn.error = vi.fn();
  fn.info = vi.fn();
  return fn;
});
const mockElNotification = vi.hoisted(() => vi.fn());

vi.mock('element-plus', () => ({
  ElMessage: mockElMessage,
  ElNotification: mockElNotification,
}));

// useCrudList 内部调用 onMounted，需在组件实例内执行以正确触发生命周期
// plugins: [] 覆盖全局 ElementPlus 插件（element-plus 已被 mock，无需安装）
function makeWrapper(api, options) {
  return mount(
    defineComponent({
      setup() {
        const c = useCrudList(api, options);
        return { c };
      },
      render: () => h('div'),
    }),
    { global: { plugins: [] } }
  );
}

// 模块级 ElMessage/ElNotification mock 跨用例共享，逐个清理调用记录防串台
beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCrudList error state (P0)', () => {
  function mockApi(overrides = {}) {
    return {
      list: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      ...overrides,
    };
  }

  it('load 成功时清空 error 并写入列表数据', async () => {
    const api = mockApi({ list: vi.fn().mockResolvedValue({ data: [{ id: 1, name: 'a' }] }) });
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;

    c.error.value = '旧错误';
    await c.load();

    expect(c.error.value).toBeNull();
    expect(c.list.value).toEqual([{ id: 1, name: 'a' }]);
    expect(c.loading.value).toBe(false);
  });

  it('load 失败且有响应消息时写入该消息', async () => {
    const err = Object.assign(new Error('boom'), {
      response: { data: { message: '服务端错误：权限不足' } },
    });
    const api = mockApi({ list: vi.fn().mockRejectedValue(err) });
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;

    await c.load();

    expect(c.error.value).toBe('服务端错误：权限不足');
    expect(c.list.value).toEqual([]);
  });

  it('load 失败且无响应消息时回退默认文案', async () => {
    const api = mockApi({ list: vi.fn().mockRejectedValue(new Error('network down')) });
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;

    await c.load();

    expect(c.error.value).toContain('数据加载失败');
  });

  it('再次 load 成功会清除之前的错误状态', async () => {
    // 队列顺序需计入 onMounted 的隐式 load()：
    //   [0] mount 触发 -> 成功(空列表)
    //   [1] 显式 load #1 -> 失败，写入错误 'X'
    //   [2] 显式 load #2 -> 成功，清除错误并写入数据
    const api = mockApi({
      list: vi
        .fn()
        .mockResolvedValueOnce({ data: [] })
        .mockRejectedValueOnce(
          Object.assign(new Error('e'), { response: { data: { message: 'X' } } })
        )
        .mockResolvedValueOnce({ data: [{ id: 2 }] }),
    });
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;

    await c.load();
    expect(c.error.value).toBe('X');

    await c.load();
    expect(c.error.value).toBeNull();
    expect(c.list.value).toEqual([{ id: 2 }]);
  });

  it('listParams 为函数时透传给 api.list；裸数组响应直接作为列表', async () => {
    const api = {
      list: vi.fn().mockResolvedValue([{ id: 9, name: '裸数组' }]),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };
    const wrapper = makeWrapper(api, { listParams: () => ({ type: 'active' }) });
    const { c } = wrapper.vm;
    await c.load();

    expect(api.list).toHaveBeenCalledWith({ type: 'active' });
    expect(c.list.value).toEqual([{ id: 9, name: '裸数组' }]);
  });
});

describe('useCrudList 弹窗与保存', () => {
  function mockApi(overrides = {}) {
    return {
      list: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      remove: vi.fn().mockResolvedValue({}),
      ...overrides,
    };
  }

  it('openDialog(row) 复制行数据；无参时使用默认表单', () => {
    const api = mockApi();
    const wrapper = makeWrapper(api, { defaultForm: { id: null, name: '', code: '' } });
    const { c } = wrapper.vm;

    c.openDialog({ id: 5, name: '已有行' });
    expect(c.dialogVisible.value).toBe(true);
    expect(c.form.value).toEqual({ id: 5, name: '已有行' });

    c.openDialog();
    expect(c.form.value).toEqual({ id: null, name: '', code: '' });
  });

  it('handleSave：无 id 走创建，提示成功并静默刷新', async () => {
    const api = mockApi();
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;

    c.openDialog();
    c.form.value.name = '新学院';
    await c.handleSave();

    expect(api.create).toHaveBeenCalledWith(c.form.value);
    expect(api.update).not.toHaveBeenCalled();
    expect(mockElMessage.success).toHaveBeenCalledWith('创建成功');
    expect(c.dialogVisible.value).toBe(false);
    expect(api.list).toHaveBeenCalledTimes(2); // mount 初始 + 保存后静默刷新
    expect(c.saving.value).toBe(false);
  });

  it('handleSave：有 id 走更新', async () => {
    const api = mockApi();
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;

    c.openDialog({ id: 3, name: '旧名' });
    c.form.value.name = '新名';
    await c.handleSave();

    expect(api.update).toHaveBeenCalledWith(3, expect.objectContaining({ name: '新名' }));
    expect(api.create).not.toHaveBeenCalled();
    expect(mockElMessage.success).toHaveBeenCalledWith('更新成功');
  });

  it('handleSave：transformForm 转换后再提交', async () => {
    const api = mockApi();
    const wrapper = makeWrapper(api, {
      transformForm: (f) => ({ college_name: f.name }),
    });
    const { c } = wrapper.vm;

    c.openDialog();
    c.form.value.name = '计算机学院';
    await c.handleSave();

    expect(api.create).toHaveBeenCalledWith({ college_name: '计算机学院' });
  });

  it('handleSave：formRef 校验失败时不提交', async () => {
    const api = mockApi();
    const formRef = ref({ validate: vi.fn().mockRejectedValue(new Error('invalid')) });
    const wrapper = makeWrapper(api, { formRef });
    const { c } = wrapper.vm;

    c.openDialog();
    await c.handleSave();

    expect(formRef.value.validate).toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    expect(c.dialogVisible.value).toBe(true);
  });

  it('handleSave：接口失败时不弹成功提示、不关弹窗、重置 saving', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = mockApi({ create: vi.fn().mockRejectedValue(new Error('保存失败')) });
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;

    c.openDialog();
    await c.handleSave();

    expect(mockElMessage.success).not.toHaveBeenCalled();
    expect(c.dialogVisible.value).toBe(true);
    expect(c.saving.value).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe('useCrudList 删除确认流程', () => {
  function mockApi(overrides = {}) {
    return {
      list: vi.fn().mockResolvedValue({ data: [{ id: 1, name: 'A学院', hasRefs: true }] }),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn().mockResolvedValue({}),
      ...overrides,
    };
  }

  it('handleDelete 记录目标行并计算删除前置警告', async () => {
    const api = mockApi();
    const wrapper = makeWrapper(api, {
      getDeleteWarning: (row) => (row.hasRefs ? '该学院下仍有班级' : ''),
    });
    const { c } = wrapper.vm;
    await c.load(); // 确保列表已填充（覆盖 mount 初始加载）

    await c.handleDelete(1);
    expect(c.deleteConfirmVisible.value).toBe(true);
    expect(c.deletingRow.value).toMatchObject({ id: 1, name: 'A学院' });
    expect(c.deleteWarning.value).toBe('该学院下仍有班级');
  });

  it('confirmDelete 成功：静默删除 + 成功通知 + 静默刷新 + 状态重置', async () => {
    const api = mockApi();
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;
    await c.load();

    await c.handleDelete(1);
    await c.confirmDelete();

    expect(api.remove).toHaveBeenCalledWith(1, { silent: true });
    expect(mockElNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: '删除成功', message: '已删除：A学院', type: 'success' })
    );
    expect(c.deleteConfirmVisible.value).toBe(false);
    expect(c.deletingRow.value).toBeNull();
    expect(c.deleting.value).toBe(false);
  });

  it('confirmDelete 失败：错误通知包含后端原因', async () => {
    const err = Object.assign(new Error('fallback'), {
      response: { data: { message: '该学院已被专业引用' } },
    });
    const api = mockApi({ remove: vi.fn().mockRejectedValue(err) });
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;
    await c.load();

    await c.handleDelete(1);
    await c.confirmDelete();

    expect(mockElNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '删除失败',
        message: 'A学院：该学院已被专业引用',
        type: 'error',
      })
    );
    expect(c.deleteConfirmVisible.value).toBe(false);
  });

  it('cancelDelete 关闭弹窗并清空目标行状态', async () => {
    const api = mockApi();
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;
    await c.load();

    await c.handleDelete(1);
    c.cancelDelete();

    expect(c.deleteConfirmVisible.value).toBe(false);
    expect(c.deletingRow.value).toBeNull();
  });
});

describe('useCrudList silentReload', () => {
  it('静默刷新失败时提示手动刷新（保存成功但列表未更新的一致性兜底）', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = {
      list: vi
        .fn()
        .mockResolvedValueOnce({ data: [] }) // mount 初始加载成功
        .mockRejectedValueOnce(new Error('refresh down')), // 静默刷新失败
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn(),
      remove: vi.fn(),
    };
    const wrapper = makeWrapper(api);
    const { c } = wrapper.vm;

    await c.silentReload();

    expect(mockElMessage.warning).toHaveBeenCalledWith('数据已保存，列表刷新失败，请手动刷新页面');
    consoleSpy.mockRestore();
  });
});
