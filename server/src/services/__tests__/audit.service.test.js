/**
 * audit.service 单元测试
 *
 * 覆盖：
 * - createAuditLog: 正确数据写入、details 超长截断、错误被吞没
 * - getAuditLogs: 动态 where 条件、pageSize 上下限、分页 skip/take
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  audit_logs: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock logger
// ──────────────────────────────────────────────
const mockLoggerError = vi.fn();
vi.mock('../../utils/logger.js', () => ({
  default: { error: mockLoggerError },
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { createAuditLog, getAuditLogs } = await import('../audit.service.js');

// ════════════════════════════════════════════════
// createAuditLog
// ════════════════════════════════════════════════
describe('createAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.audit_logs.create.mockResolvedValue({});
  });

  it('正确写入审计记录', async () => {
    await createAuditLog({
      action: 'create',
      module: 'college',
      userId: 42,
      ip: '192.168.1.1',
      details: { id: 1, name: 'test' },
      result: 'success',
      message: '创建学院',
    });

    expect(mockPrisma.audit_logs.create).toHaveBeenCalledWith({
      data: {
        action: 'create',
        module: 'college',
        operator_id: 42,
        ip: '192.168.1.1',
        details: JSON.stringify({ id: 1, name: 'test' }),
        result: 'success',
        message: '创建学院',
      },
    });
  });

  it('userId 为空时 operator_id 为 null', async () => {
    await createAuditLog({
      action: 'delete',
      module: 'course',
      result: 'success',
    });

    const callData = mockPrisma.audit_logs.create.mock.calls[0][0].data;
    expect(callData.operator_id).toBeNull();
    expect(callData.ip).toBeNull();
    expect(callData.message).toBeNull();
  });

  it('对象 details 序列化为 JSON 字符串', async () => {
    await createAuditLog({
      action: 'update',
      module: 'teacher',
      details: { foo: 'bar' },
      result: 'success',
    });

    const callData = mockPrisma.audit_logs.create.mock.calls[0][0].data;
    expect(callData.details).toBe('{"foo":"bar"}');
  });

  it('字符串 details 保持原样', async () => {
    await createAuditLog({
      action: 'update',
      module: 'teacher',
      details: 'plain text detail',
      result: 'success',
    });

    const callData = mockPrisma.audit_logs.create.mock.calls[0][0].data;
    expect(callData.details).toBe('plain text detail');
  });

  it('details 超过 2000 字符时截断为合法 JSON 截断对象', async () => {
    const longDetail = 'A'.repeat(2500);

    await createAuditLog({
      action: 'import',
      module: 'system',
      details: longDetail,
      result: 'success',
    });

    const callData = mockPrisma.audit_logs.create.mock.calls[0][0].data;
    // BIZ-8-3修复：截断为合法 JSON 对象 { truncated, preview, original_length }
    const parsed = JSON.parse(callData.details);
    expect(parsed.truncated).toBe(true);
    expect(parsed.preview).toBe('A'.repeat(1900));
    expect(parsed.original_length).toBe(2500);
  });

  it('大对象 details 序列化后超过 2000 字符时截断为合法 JSON 截断对象', async () => {
    const bigObject = { data: 'X'.repeat(3000) };

    await createAuditLog({
      action: 'create',
      module: 'system',
      details: bigObject,
      result: 'success',
    });

    const callData = mockPrisma.audit_logs.create.mock.calls[0][0].data;
    const parsed = JSON.parse(callData.details);
    expect(parsed.truncated).toBe(true);
    expect(parsed.preview).toHaveLength(1900);
    expect(parsed.original_length).toBe(JSON.stringify(bigObject).length);
  });

  it('details 恰好 2000 字符时不截断', async () => {
    const exactDetail = 'B'.repeat(2000);

    await createAuditLog({
      action: 'create',
      module: 'system',
      details: exactDetail,
      result: 'success',
    });

    const callData = mockPrisma.audit_logs.create.mock.calls[0][0].data;
    expect(callData.details).toHaveLength(2000);
    expect(callData.details).toBe(exactDetail);
  });

  it('数据库写入失败 → 错误被吞没，不抛出异常', async () => {
    mockPrisma.audit_logs.create.mockRejectedValue(new Error('DB write failed'));

    // 不应抛出
    await expect(
      createAuditLog({
        action: 'create',
        module: 'college',
        userId: 1,
        result: 'success',
      })
    ).resolves.toBeUndefined();

    // logger 被调用记录错误
    expect(mockLoggerError).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════
// getAuditLogs
// ════════════════════════════════════════════════
describe('getAuditLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.audit_logs.findMany.mockResolvedValue([
      {
        id: 1,
        action: 'create',
        module: 'college',
        operator_id: 1,
        ip: '127.0.0.1',
        details: '{}',
        result: 'success',
        message: 'test',
        created_at: new Date('2025-01-01'),
      },
    ]);
    mockPrisma.audit_logs.count.mockResolvedValue(1);
  });

  it('无筛选条件 → where 为空对象', async () => {
    await getAuditLogs({});

    const callArgs = mockPrisma.audit_logs.findMany.mock.calls[0][0];
    expect(callArgs.where).toEqual({});
  });

  it('传入 action 筛选', async () => {
    await getAuditLogs({ action: 'create' });

    const callArgs = mockPrisma.audit_logs.findMany.mock.calls[0][0];
    expect(callArgs.where).toEqual({ action: 'create' });
  });

  it('传入 module 筛选', async () => {
    await getAuditLogs({ module: 'college' });

    const callArgs = mockPrisma.audit_logs.findMany.mock.calls[0][0];
    expect(callArgs.where).toEqual({ module: 'college' });
  });

  it('传入 result 筛选', async () => {
    await getAuditLogs({ result: 'failed' });

    const callArgs = mockPrisma.audit_logs.findMany.mock.calls[0][0];
    expect(callArgs.where).toEqual({ result: 'failed' });
  });

  it('多条件组合', async () => {
    await getAuditLogs({ action: 'delete', module: 'teacher', result: 'success' });

    const callArgs = mockPrisma.audit_logs.findMany.mock.calls[0][0];
    expect(callArgs.where).toEqual({
      action: 'delete',
      module: 'teacher',
      result: 'success',
    });
  });

  it('默认分页: page=1, pageSize=20 → skip=0, take=20', async () => {
    await getAuditLogs({});

    const callArgs = mockPrisma.audit_logs.findMany.mock.calls[0][0];
    expect(callArgs.skip).toBe(0);
    expect(callArgs.take).toBe(20);
  });

  it('page=3, pageSize=10 → skip=20, take=10', async () => {
    await getAuditLogs({ page: 3, pageSize: 10 });

    const callArgs = mockPrisma.audit_logs.findMany.mock.calls[0][0];
    expect(callArgs.skip).toBe(20);
    expect(callArgs.take).toBe(10);
  });

  it('pageSize 上限 100', async () => {
    await getAuditLogs({ pageSize: 500 });

    const callArgs = mockPrisma.audit_logs.findMany.mock.calls[0][0];
    expect(callArgs.take).toBe(100);
  });

  it('pageSize 下限 1', async () => {
    await getAuditLogs({ pageSize: 0 });

    const callArgs = mockPrisma.audit_logs.findMany.mock.calls[0][0];
    expect(callArgs.take).toBeGreaterThanOrEqual(1);
  });

  it('pageSize 为 NaN 时回退默认值 20', async () => {
    await getAuditLogs({ pageSize: 'abc' });

    const callArgs = mockPrisma.audit_logs.findMany.mock.calls[0][0];
    expect(callArgs.take).toBe(20);
  });

  it('返回正确结构', async () => {
    mockPrisma.audit_logs.count.mockResolvedValue(50);

    const result = await getAuditLogs({ page: 2, pageSize: 10 });

    expect(result).toHaveProperty('logs');
    expect(result).toHaveProperty('total', 50);
    expect(result).toHaveProperty('page', 2);
    expect(result).toHaveProperty('pageSize', 10);
    expect(Array.isArray(result.logs)).toBe(true);
  });

  it('结果按 created_at 降序排列', async () => {
    await getAuditLogs({});

    const callArgs = mockPrisma.audit_logs.findMany.mock.calls[0][0];
    expect(callArgs.orderBy).toEqual({ created_at: 'desc' });
  });
});
