/**
 * import/courses.js — importCourses 单元测试
 *
 * 覆盖：
 * 1. 有效行 → 创建课程
 * 2. S-08 typeExplicit: Excel 无类型列时不覆盖已有课程类型
 * 3. S-08 typeExplicit: Excel 显式指定类型时覆盖已有课程类型
 * 4. 同名课程（重复 code）→ 更新而非新建
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockTx = {
  courses: {
    findFirst: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 100 }),
    update: vi.fn().mockResolvedValue({ id: 100 }),
  },
};

const mockPrisma = {
  $transaction: vi.fn(async (fn) => fn(mockTx)),
};

vi.mock('../../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖服务
// ──────────────────────────────────────────────
vi.mock('../../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../utils/excel.js', () => ({
  readWorkbook: vi.fn(),
}));

vi.mock('../../import-shared.js', () => ({
  cleanupFile: vi.fn(),
  sanitizeInput: vi.fn((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s || null;
  }),
  verifyExcelMagicNumber: vi.fn().mockResolvedValue(undefined),
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { importCourses } = await import('../courses.js');
const { readWorkbook } = await import('../../../utils/excel.js');
const { createAuditLog } = await import('../../../services/audit.service.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(file, user) {
  return { file, user: user || { id: 1 } };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

function courseRow(overrides = {}) {
  return {
    课程名称: '高等数学',
    课程编码: 'MATH101',
    课程类型: '专业课',
    ...overrides,
  };
}

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('importCourses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.courses.findFirst.mockResolvedValue(null);
    mockTx.courses.create.mockResolvedValue({ id: 100 });
    mockTx.courses.update.mockResolvedValue({ id: 100 });
  });

  // ── 1. 有效行 → 创建课程 ──────────────────
  it('有效行应创建课程并返回 imported=1', async () => {
    readWorkbook.mockResolvedValue([courseRow()]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importCourses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.courses.create).toHaveBeenCalledOnce();
    const createArg = mockTx.courses.create.mock.calls[0][0].data;
    expect(createArg.name).toBe('高等数学');
    expect(createArg.code).toBe('MATH101');
    expect(createArg.type).toBe('professional');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ imported: 1, overwritten: 0 }),
      })
    );
  });

  // ── 2. S-08: Excel 无类型列 → 不覆盖已有类型 ──
  it('Excel 缺少课程类型列时，已有课程的 type 不应被覆盖', async () => {
    // 已存在课程，type = 'professional'
    mockTx.courses.findFirst.mockResolvedValue({ id: 10, name: '高等数学', type: 'professional' });
    // Excel 行中无课程类型列（sanitizeInput 返回 null）
    readWorkbook.mockResolvedValue([courseRow({ 课程类型: undefined })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importCourses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.courses.update).toHaveBeenCalledOnce();
    const updateData = mockTx.courses.update.mock.calls[0][0].data;
    // type 不应出现在 updateData 中（S-08 守卫）
    expect(updateData).not.toHaveProperty('type');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ overwritten: 1 }),
      })
    );
  });

  // ── 3. S-08: Excel 显式指定类型 → 覆盖已有类型 ──
  it('Excel 显式指定课程类型时，已有课程的 type 应被覆盖', async () => {
    mockTx.courses.findFirst.mockResolvedValue({ id: 10, name: '高等数学', type: 'professional' });
    readWorkbook.mockResolvedValue([courseRow({ 课程类型: '公共课' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importCourses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.courses.update).toHaveBeenCalledOnce();
    const updateData = mockTx.courses.update.mock.calls[0][0].data;
    // type 应出现并设为 public（非专业课 = public）
    expect(updateData).toHaveProperty('type', 'public');
  });

  // ── 4. 同名课程 → 更新而非新建 ────────────
  it('已存在同名课程应执行更新而非新建', async () => {
    mockTx.courses.findFirst.mockResolvedValue({ id: 10, name: '高等数学' });
    readWorkbook.mockResolvedValue([courseRow()]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importCourses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.courses.create).not.toHaveBeenCalled();
    expect(mockTx.courses.update).toHaveBeenCalledOnce();
    expect(mockTx.courses.update.mock.calls[0][0].where).toEqual({ id: 10 });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ imported: 0, overwritten: 1 }),
      })
    );
  });

  // ── 缺少课程名称 → 行错误 ───────────────
  it('缺少课程名称应返回行错误', async () => {
    readWorkbook.mockResolvedValue([courseRow({ 课程名称: '' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importCourses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          imported: 0,
          errors: expect.arrayContaining([expect.stringContaining('缺少课程名称')]),
        }),
      })
    );
  });

  // ── 无文件 → ValidationError ─────────────
  it('无文件应抛出 ValidationError', async () => {
    const req = mockReq(null);
    const res = mockRes();
    const next = vi.fn();

    await expect(importCourses(req, res, next)).rejects.toThrow('请上传文件');
  });

  // ── 空行数组 → no-op ────────────────────
  it('空行数组应不调用事务并返回 imported=0', async () => {
    readWorkbook.mockResolvedValue([]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importCourses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ imported: 0, overwritten: 0, total: 0 }),
      })
    );
  });

  // ── 审计日志 ─────────────────────────────
  it('导入成功后应调用审计日志', async () => {
    readWorkbook.mockResolvedValue([courseRow()]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importCourses(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'import',
        module: 'course',
        result: 'success',
      })
    );
  });

  // ── 课程类型映射：专业课 ─────────────────
  it('课程类型"专业课"应映射为 professional', async () => {
    readWorkbook.mockResolvedValue([courseRow({ 课程类型: '专业课' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importCourses(req, res, next);

    const createData = mockTx.courses.create.mock.calls[0][0].data;
    expect(createData.type).toBe('professional');
  });

  // ── 课程类型映射：其他值 → public ────────
  it('非专业课类型应映射为 public', async () => {
    readWorkbook.mockResolvedValue([courseRow({ 课程类型: '通识课' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importCourses(req, res, next);

    const createData = mockTx.courses.create.mock.calls[0][0].data;
    expect(createData.type).toBe('public');
  });
});
