/**
 * useExport 导出/模板下载 composable 单元测试
 *
 * 覆盖：
 * - exportData：默认/自定义 URL、自定义参数拼接、成功下载与提示、失败提示
 * - downloadTemplate：模板 URL 与固定文件名、成功/失败提示
 * - loading 遮罩无论成败均关闭
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadingClose: vi.fn(),
}));

const mockElMessage = vi.hoisted(() => {
  const fn = vi.fn();
  fn.success = vi.fn();
  fn.error = vi.fn();
  fn.warning = vi.fn();
  fn.info = vi.fn();
  return fn;
});

vi.mock('element-plus', () => ({
  ElMessage: mockElMessage,
  ElLoading: { service: vi.fn(() => ({ close: mocks.loadingClose })) },
}));

vi.mock('../utils/request', () => ({
  default: { get: vi.fn() },
}));

vi.mock('../utils/download', () => ({
  downloadBlob: vi.fn(),
}));

import { useExport } from './useExport';
import request from '../utils/request';
import { downloadBlob } from '../utils/download';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('exportData', () => {
  it('默认 URL 请求 blob 并以 显示名_时间戳 命名下载', async () => {
    const blob = new Blob(['data']);
    request.get.mockResolvedValue(blob);
    const { exportData } = useExport('courses', '课程数据');

    await exportData();

    expect(request.get).toHaveBeenCalledWith('/export/courses', { responseType: 'blob' });
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [argBlob, filename] = downloadBlob.mock.calls[0];
    expect(argBlob).toBe(blob);
    expect(filename).toMatch(/^课程数据_\d+\.xlsx$/);
    expect(mockElMessage.success).toHaveBeenCalledWith('导出成功');
    expect(mocks.loadingClose).toHaveBeenCalled();
  });

  it('自定义参数拼接为查询串', async () => {
    request.get.mockResolvedValue(new Blob());
    const { exportData } = useExport('classes', '班级数据');

    await exportData({ type: 'active', college_id: '3' });

    const url = request.get.mock.calls[0][0];
    expect(url).toContain('/export/classes?');
    expect(url).toContain('type=active');
    expect(url).toContain('college_id=3');
  });

  it('无参数时不追加查询串', async () => {
    request.get.mockResolvedValue(new Blob());
    const { exportData } = useExport('courses', '课程数据');
    await exportData();
    expect(request.get.mock.calls[0][0]).toBe('/export/courses');
  });

  it('失败时提示导出失败并关闭遮罩', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    request.get.mockRejectedValue(new Error('down'));
    const { exportData } = useExport('courses', '课程数据');

    await exportData();

    expect(mockElMessage.error).toHaveBeenCalledWith('导出失败');
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(mocks.loadingClose).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('options.exportUrl 覆盖默认地址', async () => {
    request.get.mockResolvedValue(new Blob());
    const { exportData } = useExport('x', 'X', { exportUrl: '/custom/export' });
    await exportData();
    expect(request.get.mock.calls[0][0]).toBe('/custom/export');
  });
});

describe('downloadTemplate', () => {
  it('下载模板使用固定文件名并提示成功', async () => {
    request.get.mockResolvedValue(new Blob());
    const { downloadTemplate } = useExport('teachers', '教师数据');

    await downloadTemplate();

    expect(request.get).toHaveBeenCalledWith('/export/template/teachers', {
      responseType: 'blob',
    });
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), '教师数据导入模板.xlsx');
    expect(mockElMessage.success).toHaveBeenCalledWith('模板下载成功');
  });

  it('失败时提示下载模板失败', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    request.get.mockRejectedValue(new Error('down'));
    const { downloadTemplate } = useExport('teachers', '教师数据');

    await downloadTemplate();

    expect(mockElMessage.error).toHaveBeenCalledWith('下载模板失败');
    expect(mocks.loadingClose).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('options.templateUrl 覆盖默认地址', async () => {
    request.get.mockResolvedValue(new Blob());
    const { downloadTemplate } = useExport('x', 'X', { templateUrl: '/custom/tpl' });
    await downloadTemplate();
    expect(request.get.mock.calls[0][0]).toBe('/custom/tpl');
  });
});
