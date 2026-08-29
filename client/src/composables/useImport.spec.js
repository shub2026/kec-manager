/**
 * useImport 导入 composable 单元测试
 *
 * 覆盖：
 * - beforeImport：文件类型/大小校验（10MB 上限）、通过后挂起文件并弹确认框
 * - uploadHeaders：携带 Bearer token 与 CSRF 头（与请求拦截器同口径）
 * - confirmImport：构造 FormData 上传（silentError 防双弹窗）、成功走 onSuccess、失败走 onImportError
 * - onImportSuccess：结果类型判定（全部成功 / 部分失败 / 全部失败）
 *
 * 浮层/结果卡片的 DOM 细节不做脆弱断言，仅验证其可被调用不抛错。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  authStore: { token: 'tk' },
  cookie: null,
}));

const mockElMessage = vi.hoisted(() => {
  const fn = vi.fn();
  fn.success = vi.fn();
  fn.error = vi.fn();
  fn.warning = vi.fn();
  fn.info = vi.fn();
  return fn;
});

vi.mock('element-plus', () => ({ ElMessage: mockElMessage }));
vi.mock('../stores/auth', () => ({ useAuthStore: () => mocks.authStore }));
vi.mock('../utils/cookies', () => ({
  getCookie: (n) => (n === 'XSRF-TOKEN' ? mocks.cookie : null),
}));
vi.mock('../utils/request', () => ({ default: { post: vi.fn() } }));

import { useImport } from './useImport';
import request from '../utils/request';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authStore.token = 'tk';
  mocks.cookie = null;
});

function makeFile(name = 'data.xlsx', size = 1024) {
  return { name, size };
}

describe('beforeImport 文件校验', () => {
  it('非 Excel 文件被拒绝并提示', async () => {
    const { beforeImport, pendingFile, importConfirmVisible } = useImport(
      '/import/x',
      'msg',
      vi.fn()
    );
    const ok = await beforeImport(makeFile('a.txt'));
    expect(ok).toBe(false);
    expect(mockElMessage.error).toHaveBeenCalledWith('请上传Excel文件');
    expect(pendingFile.value).toBeNull();
    expect(importConfirmVisible.value).toBe(false);
  });

  it('超过 10MB 被拒绝并提示大小', async () => {
    const { beforeImport, pendingFile } = useImport('/import/x', 'msg', vi.fn());
    const ok = await beforeImport(makeFile('big.xlsx', 11 * 1024 * 1024));
    expect(ok).toBe(false);
    expect(mockElMessage.error).toHaveBeenCalledWith(expect.stringContaining('超过限制'));
    expect(pendingFile.value).toBeNull();
  });

  it('合法 Excel 挂起文件并弹出确认框', async () => {
    const { beforeImport, pendingFile, importConfirmVisible } = useImport(
      '/import/x',
      'msg',
      vi.fn()
    );
    const file = makeFile('a.xls');
    const ok = await beforeImport(file);
    expect(ok).toBe(false); // el-upload 需返回 false 阻止自动上传
    expect(pendingFile.value).toStrictEqual(file);
    expect(importConfirmVisible.value).toBe(true);
  });
});

describe('uploadHeaders', () => {
  it('有 token 和 CSRF cookie 时携带两个头', () => {
    mocks.authStore.token = 'tk-1';
    mocks.cookie = 'csrf-1';
    const { uploadHeaders } = useImport('/import/x', 'msg', vi.fn());
    expect(uploadHeaders.value).toEqual({
      Authorization: 'Bearer tk-1',
      'X-CSRF-Token': 'csrf-1',
    });
  });

  it('无 token 无 cookie 时返回空对象', () => {
    mocks.authStore.token = null;
    mocks.cookie = null;
    const { uploadHeaders } = useImport('/import/x', 'msg', vi.fn());
    expect(uploadHeaders.value).toEqual({});
  });
});

describe('confirmImport 上传流程', () => {
  async function primed(res) {
    const onSuccess = vi.fn();
    const imp = useImport('/import/teachers', 'msg', onSuccess);
    await imp.beforeImport(makeFile('a.xlsx'));
    request.post.mockResolvedValueOnce(res);
    await imp.confirmImport();
    return { imp, onSuccess };
  }

  it('以 FormData + multipart + silentError 上传，成功后回调 onSuccess', async () => {
    const res = {
      success: true,
      data: { total: 5, imported: 5, overwritten: 0, failed: 0, errors: [] },
    };
    const { imp, onSuccess } = await primed(res);

    expect(request.post).toHaveBeenCalledTimes(1);
    const [endpoint, formData, config] = request.post.mock.calls[0];
    expect(endpoint).toBe('/import/teachers');
    expect(formData).toBeInstanceOf(FormData);
    expect(config).toMatchObject({ silentError: true });
    expect(config.headers['Content-Type']).toContain('multipart/form-data');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(imp.importing.value).toBe(false);
    expect(imp.pendingFile.value).toBeNull();
  });

  it('上传失败走错误提示，不触发 onSuccess', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSuccess = vi.fn();
    const imp = useImport('/import/teachers', 'msg', onSuccess);
    await imp.beforeImport(makeFile('a.xlsx'));
    request.post.mockRejectedValueOnce(new Error('boom'));

    await imp.confirmImport();

    expect(onSuccess).not.toHaveBeenCalled();
    expect(mockElMessage.error).toHaveBeenCalledWith('导入失败，请检查文件格式或联系管理员');
    expect(imp.importing.value).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe('onImportSuccess 结果类型判定', () => {
  function runOnSuccess(data) {
    const onSuccess = vi.fn();
    const imp = useImport('/import/x', 'msg', onSuccess);
    expect(() => imp.onImportSuccess({ success: true, data })).not.toThrow();
    return onSuccess;
  }

  it('全部成功 → 触发成功回调', () => {
    const cb = runOnSuccess({ total: 3, imported: 3, overwritten: 0, failed: 0, errors: [] });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('部分失败仍触发成功回调（刷新列表）', () => {
    const cb = runOnSuccess({
      total: 3,
      imported: 2,
      overwritten: 0,
      failed: 1,
      errors: ['第3行错'],
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('全部失败仍触发回调且不抛错', () => {
    const cb = runOnSuccess({
      total: 2,
      imported: 0,
      overwritten: 0,
      failed: 2,
      errors: ['e1', 'e2'],
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('缺省 data 时不抛错', () => {
    const onSuccess = vi.fn();
    const imp = useImport('/import/x', 'msg', onSuccess);
    expect(() => imp.onImportSuccess({})).not.toThrow();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
