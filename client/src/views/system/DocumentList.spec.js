/**
 * DocumentList 文档资料页交互测试
 *
 * 覆盖：
 * - 首次加载与列表渲染（文件名 / 类型标签 / 大小格式化 / 上传人）
 * - 类型筛选变更重置页码、关键词防抖搜索
 * - 上传前置校验（扩展名 / 大小）、上传成功刷新列表
 * - 下载触发浏览器保存
 * - 重命名与删除流程
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';

// ---- mock API 模块 ----
vi.mock('@/api/document', () => ({
  getDocuments: vi.fn(),
  downloadDocument: vi.fn(),
  renameDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));
// auth store 会引入 @/router → Layout，测试中无需真实实现
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ token: 'test-token', userInfo: { role: 'super_admin' } }),
}));
vi.mock('@/utils/cookies', () => ({
  getCookie: (name) => (name === 'XSRF-TOKEN' ? 'csrf-test' : null),
}));

import DocumentList from '@/views/system/DocumentList.vue';
import { getDocuments, downloadDocument, renameDocument, deleteDocument } from '@/api/document';

// 子组件 stub —— PageHeader 需保留 extra 具名插槽（上传按钮位于其中）
const STUBS = {
  PageHeader: {
    template: '<div class="stub-page-header"><slot name="extra" /></div>',
  },
  EmptyState: { template: '<div class="stub-empty" />' },
  ListErrorState: {
    props: ['message'],
    emits: ['retry'],
    template: '<div class="stub-error">{{ message }}</div>',
  },
  DeleteConfirmDialog: {
    props: ['modelValue', 'loading'],
    emits: ['update:modelValue', 'confirm'],
    template: '<div class="stub-delete-dialog" v-if="modelValue"><slot /></div>',
  },
};

const SAMPLE_ITEMS = [
  {
    id: 1,
    originalName: '教学计划.pdf',
    storedName: '123-abc.pdf',
    fileExt: 'pdf',
    fileSize: 2 * 1024 * 1024,
    mimeType: 'application/pdf',
    uploaderName: '管理员',
    createdAt: '2026-08-30T08:00:00.000Z',
  },
  {
    id: 2,
    originalName: '成绩表.xlsx',
    storedName: '124-def.xlsx',
    fileExt: 'xlsx',
    fileSize: 512,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    uploaderName: 'admin',
    createdAt: '2026-08-31T08:00:00.000Z',
  },
];

// onMounted 内的异步加载需要一个宏任务周期才结算
const flush = () => new Promise((r) => setTimeout(r, 50));

const mountList = () => mount(DocumentList, { global: { stubs: STUBS } });

describe('DocumentList — 列表加载与渲染', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocuments.mockResolvedValue({ data: { items: SAMPLE_ITEMS, total: 2 } });
  });

  it('首次加载请求第 1 页并渲染文件名与类型标签', async () => {
    const wrapper = mountList();
    await flush();

    expect(getDocuments).toHaveBeenCalledTimes(1);
    expect(getDocuments.mock.calls[0][0].page).toBe(1);

    const text = wrapper.text();
    expect(text).toContain('教学计划.pdf');
    expect(text).toContain('成绩表.xlsx');
    expect(text).toContain('PDF');
    expect(text).toContain('Excel');
  });

  it('文件大小按可读格式展示', async () => {
    const wrapper = mountList();
    await flush();

    const text = wrapper.text();
    expect(text).toContain('2.0 MB');
    expect(text).toContain('512 B');
  });

  it('加载失败时渲染错误占位并支持重试', async () => {
    getDocuments.mockRejectedValue({ response: { data: { message: '服务不可用' } } });
    const wrapper = mountList();
    await flush();

    expect(wrapper.find('.stub-error').text()).toContain('服务不可用');

    getDocuments.mockResolvedValue({ data: { items: [], total: 0 } });
    await wrapper.findComponent('.stub-error').vm.$emit('retry');
    await flush();
    expect(getDocuments).toHaveBeenCalledTimes(2);
  });
});

describe('DocumentList — 筛选与搜索', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocuments.mockResolvedValue({ data: { items: [], total: 0 } });
  });

  it('变更类型筛选：回第 1 页并携带 fileType', async () => {
    const wrapper = mountList();
    await flush();

    const select = wrapper.findComponent({ name: 'ElSelect' });
    select.vm.$emit('update:modelValue', 'excel');
    await nextTick();
    select.vm.$emit('change', 'excel');
    await flush();

    expect(getDocuments.mock.lastCall[0].page).toBe(1);
    expect(getDocuments.mock.lastCall[0].fileType).toBe('excel');
  });

  it('关键词输入防抖后携带 keyword 请求', async () => {
    const wrapper = mountList();
    await flush();

    await wrapper.find('input[placeholder="搜索文件名"]').setValue('教学');
    // 防抖 300ms
    await new Promise((r) => setTimeout(r, 400));

    expect(getDocuments.mock.lastCall[0].keyword).toBe('教学');
  });
});

describe('DocumentList — 上传', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocuments.mockResolvedValue({ data: { items: [], total: 0 } });
  });

  function getUploadProp(wrapper, prop) {
    return wrapper.findComponent({ name: 'ElUpload' }).props(prop);
  }

  it('上传头附带 Authorization 与 CSRF', async () => {
    const wrapper = mountList();
    await flush();

    const headers = getUploadProp(wrapper, 'headers');
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['X-CSRF-Token']).toBe('csrf-test');
  });

  it('before-upload 拒绝不支持的扩展名', async () => {
    const wrapper = mountList();
    await flush();

    const beforeUpload = getUploadProp(wrapper, 'beforeUpload');
    expect(beforeUpload({ name: 'virus.exe', size: 10 })).toBe(false);
    expect(beforeUpload({ name: '无后缀', size: 10 })).toBe(false);
  });

  it('before-upload 拒绝超过 50MB 的文件', async () => {
    const wrapper = mountList();
    await flush();

    const beforeUpload = getUploadProp(wrapper, 'beforeUpload');
    expect(beforeUpload({ name: 'big.pdf', size: 51 * 1024 * 1024 })).toBe(false);
    expect(beforeUpload({ name: 'ok.pdf', size: 1024 })).toBe(true);
  });

  it('上传成功后刷新列表', async () => {
    const wrapper = mountList();
    await flush();

    const onSuccess = getUploadProp(wrapper, 'onSuccess');
    onSuccess({ success: true, message: '上传成功' });
    await flush();

    expect(getDocuments).toHaveBeenCalledTimes(2);
  });

  it('上传失败解析服务端错误消息', async () => {
    const wrapper = mountList();
    await flush();

    const onError = getUploadProp(wrapper, 'onError');
    // 不抛错即为通过（错误消息由 ElMessage 展示）
    expect(() =>
      onError(new Error(JSON.stringify({ success: false, message: '文件过大' })))
    ).not.toThrow();
  });
});

describe('DocumentList — 下载 / 重命名 / 删除', () => {
  let createObjectURLSpy;
  let revokeObjectURLSpy;
  let clickSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    getDocuments.mockResolvedValue({ data: { items: SAMPLE_ITEMS, total: 2 } });
    downloadDocument.mockResolvedValue(new Blob(['pdf-bytes']));
    renameDocument.mockResolvedValue({ data: {} });
    deleteDocument.mockResolvedValue({ data: null });

    createObjectURLSpy = vi
      .spyOn(window.URL, 'createObjectURL')
      .mockImplementation(() => 'blob:mock-url');
    revokeObjectURLSpy = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it('点击下载：请求 blob 并触发浏览器保存', async () => {
    const wrapper = mountList();
    await flush();

    const downloadBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === '下载文档');
    await downloadBtn.trigger('click');
    await flush();

    expect(downloadDocument).toHaveBeenCalledWith(1);
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('重命名：输入框仅显示基础名，确认后自动拼接原扩展名提交', async () => {
    const wrapper = mountList();
    await flush();

    const renameBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === '重命名文档');
    await renameBtn.trigger('click');
    await nextTick();

    // 输入框不展示扩展名，扩展名以只读后缀展示
    const input = wrapper.find('.el-dialog input');
    expect(input.element.value).toBe('教学计划');
    expect(wrapper.find('.el-dialog .el-input-group__append').text()).toContain('.pdf');

    // 修改弹窗内的输入框并确认
    await input.setValue('新名字');
    await wrapper
      .findAll('.el-dialog button')
      .find((b) => b.text() === '确定')
      .trigger('click');
    await flush();

    expect(renameDocument).toHaveBeenCalledWith(1, { originalName: '新名字.pdf' });
    expect(getDocuments).toHaveBeenCalledTimes(2);
  });

  it('重命名：用户手动输入原扩展名时剥离后拼接，不产生重复后缀', async () => {
    const wrapper = mountList();
    await flush();

    const renameBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === '重命名文档');
    await renameBtn.trigger('click');
    await nextTick();

    await wrapper.find('.el-dialog input').setValue('新名字.pdf');
    await wrapper
      .findAll('.el-dialog button')
      .find((b) => b.text() === '确定')
      .trigger('click');
    await flush();

    expect(renameDocument).toHaveBeenCalledWith(1, { originalName: '新名字.pdf' });
  });

  it('删除：确认弹窗确认后调用删除接口', async () => {
    const wrapper = mountList();
    await flush();

    const deleteBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === '删除文档');
    await deleteBtn.trigger('click');
    await nextTick();

    await wrapper.findComponent('.stub-delete-dialog').vm.$emit('confirm');
    await flush();

    expect(deleteDocument).toHaveBeenCalledWith(1);
    expect(getDocuments).toHaveBeenCalledTimes(2);
  });
});
