/**
 * audit.controller 单元测试
 *
 * 覆盖：
 * - listAuditLogs: 查询参数透传、page/page_size 数字转换与默认值、错误传递 next
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockGetAuditLogs = vi.fn();
vi.mock('../../services/audit.service.js', () => ({
  getAuditLogs: (...a) => mockGetAuditLogs(...a),
}));

const { listAuditLogs } = await import('../audit.controller.js');

function makeRes() {
  return { json: vi.fn() };
}

describe('listAuditLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('查询参数透传给 service 并返回统一 success 结构', async () => {
    const logsData = { list: [{ id: 1 }], total: 1 };
    mockGetAuditLogs.mockResolvedValue(logsData);
    const req = {
      query: { action: 'delete', module: 'classes', result: 'success', page: '2', page_size: '50' },
    };
    const res = makeRes();
    const next = vi.fn();

    await listAuditLogs(req, res, next);

    expect(mockGetAuditLogs).toHaveBeenCalledWith({
      action: 'delete',
      module: 'classes',
      result: 'success',
      page: 2,
      pageSize: 50,
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: '操作成功',
      data: logsData,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('缺省分页参数回退 page=1 / pageSize=20', async () => {
    mockGetAuditLogs.mockResolvedValue({ list: [], total: 0 });
    const req = { query: {} };

    await listAuditLogs(req, makeRes(), vi.fn());

    expect(mockGetAuditLogs).toHaveBeenCalledWith({
      action: undefined,
      module: undefined,
      result: undefined,
      page: 1,
      pageSize: 20,
    });
  });

  it('非数字分页参数回退默认值', async () => {
    mockGetAuditLogs.mockResolvedValue({ list: [], total: 0 });
    const req = { query: { page: 'abc', page_size: 'xyz' } };

    await listAuditLogs(req, makeRes(), vi.fn());

    expect(mockGetAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 })
    );
  });

  it('service 抛错时传递给 next', async () => {
    const err = new Error('db down');
    mockGetAuditLogs.mockRejectedValue(err);
    const res = makeRes();
    const next = vi.fn();

    await listAuditLogs({ query: {} }, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.json).not.toHaveBeenCalled();
  });
});
