import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { downloadBlob } from '@/utils/download';

describe('downloadBlob', () => {
  let createObjectURL;
  let revokeObjectURL;

  beforeEach(() => {
    // jsdom 未实现 createObjectURL/revokeObjectURL，手动打桩
    createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    revokeObjectURL = vi.fn();
    window.URL.createObjectURL = createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('创建 Excel MIME 类型的 Blob 并触发下载', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadBlob(new ArrayBuffer(8), 'report.xlsx');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURL.mock.calls[0][0];
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('下载完成后释放 URL 并移除临时节点', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadBlob(new ArrayBuffer(8), 'report.xlsx');

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('click 抛出异常时仍清理资源', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('click failed');
    });

    expect(() => downloadBlob(new ArrayBuffer(8), 'x.xlsx')).toThrow('click failed');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
