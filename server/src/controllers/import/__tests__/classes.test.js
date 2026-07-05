/**
 * import/classes.js — importClasses 单元测试
 *
 * 覆盖：
 * 1. 有效行 → 创建班级
 * 2. 无效 enrollment_year → 行级错误
 * 3. 无效 duration_years → 行级错误
 * 4. 无效 student_count → 行级错误
 * 5. 同名班级检测（多个同名 → 跳过）
 * 6. 自动创建缺失的培养层次
 * 7. 自动创建缺失的专业
 * 8. 自动创建缺失的学院
 * 9. 空行数组 → no-op
 * 10. Upsert 模式（覆盖已有班级）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockTx = {
  classes: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 100 }),
    update: vi.fn().mockResolvedValue({ id: 100 }),
  },
  training_levels: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 200 }),
  },
  majors: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 300 }),
  },
  colleges: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 400 }),
  },
};

const mockPrisma = {
  majors: { findMany: vi.fn().mockResolvedValue([]) },
  training_levels: { findMany: vi.fn().mockResolvedValue([]) },
  colleges: { findMany: vi.fn().mockResolvedValue([]) },
  $transaction: vi.fn(async (fn) => fn(mockTx)),
};

vi.mock('../../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖服务
// ──────────────────────────────────────────────
vi.mock('../../../services/settings.service.js', () => ({
  getCurrentSemesterInfo: vi.fn().mockResolvedValue({ startYear: 2025 }),
}));

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
// 导入被测模块（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const { importClasses } = await import('../classes.js');
const { readWorkbook } = await import('../../../utils/excel.js');
const { createAuditLog } = await import('../../../services/audit.service.js');
const { getCurrentSemesterInfo } = await import('../../../services/settings.service.js');
const { verifyExcelMagicNumber, cleanupFile } = await import('../../import-shared.js');

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

function validRow(overrides = {}) {
  return {
    '班级名称': '2024级计科1班',
    '入学年份': '2024',
    '学制(年)': '4',
    '专业类别': '计算机科学',
    '二级学院': '信息学院',
    '培养层次': '本科',
    '班级人数': '40',
    '状态': '在读',
    ...overrides,
  };
}

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('importClasses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.majors.findMany.mockResolvedValue([]);
    mockPrisma.training_levels.findMany.mockResolvedValue([]);
    mockPrisma.colleges.findMany.mockResolvedValue([]);
    mockTx.classes.findMany.mockResolvedValue([]);
    mockTx.classes.create.mockResolvedValue({ id: 100 });
    mockTx.classes.update.mockResolvedValue({ id: 100 });
    mockTx.training_levels.findUnique.mockResolvedValue(null);
    mockTx.training_levels.create.mockResolvedValue({ id: 200 });
    mockTx.majors.findUnique.mockResolvedValue(null);
    mockTx.majors.create.mockResolvedValue({ id: 300 });
    mockTx.colleges.findUnique.mockResolvedValue(null);
    mockTx.colleges.create.mockResolvedValue({ id: 400 });
    getCurrentSemesterInfo.mockResolvedValue({ startYear: 2025 });
  });

  // ── 1. 有效行 → 创建班级 ──────────────────
  it('有效行应创建班级并返回 imported=1', async () => {
    readWorkbook.mockResolvedValue([validRow()]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importClasses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.classes.create).toHaveBeenCalledOnce();
    const createArg = mockTx.classes.create.mock.calls[0][0].data;
    expect(createArg.name).toBe('2024级计科1班');
    expect(createArg.enrollment_year).toBe(2024);
    expect(createArg.duration_years).toBe(4);
    expect(createArg.student_count).toBe(40);
    expect(createArg.status).toBe('active');

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ imported: 1, overwritten: 0 }),
      })
    );
  });

  // ── 2. 无效 enrollment_year → 行级错误 ──────
  it('入学年份超出范围（1999）应返回行错误', async () => {
    readWorkbook.mockResolvedValue([validRow({ '入学年份': '1999' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importClasses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          imported: 0,
          errors: expect.arrayContaining([
            expect.stringContaining('入学年份必须在2000-2100之间'),
          ]),
        }),
      })
    );
  });

  // ── 3. 无效 duration_years → 行级错误 ──────
  it('学制超出范围（15年）应返回行错误', async () => {
    readWorkbook.mockResolvedValue([validRow({ '学制(年)': '15' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importClasses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          imported: 0,
          errors: expect.arrayContaining([
            expect.stringContaining('学制必须在1-10年之间'),
          ]),
        }),
      })
    );
  });

  // ── 4. 无效 student_count → 行级错误 ──────
  it('班级人数为负数应返回行错误', async () => {
    readWorkbook.mockResolvedValue([validRow({ '班级人数': '-5' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importClasses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          imported: 0,
          errors: expect.arrayContaining([
            expect.stringContaining('班级人数必须在0-999之间'),
          ]),
        }),
      })
    );
  });

  // ── 5. 同名班级检测 ──────────────────────
  it('存在多个同名班级时应跳过并报错', async () => {
    // 事务内 findMany 返回 2 个同名班级
    mockTx.classes.findMany.mockResolvedValue([
      { id: 1, name: '2024级计科1班' },
      { id: 2, name: '2024级计科1班' },
    ]);
    readWorkbook.mockResolvedValue([validRow()]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importClasses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.classes.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errors: expect.arrayContaining([
            expect.stringContaining('存在2个同名班级'),
          ]),
        }),
      })
    );
  });

  // ── 6. 自动创建缺失的培养层次 ─────────────
  it('未知培养层次应在事务内自动创建', async () => {
    readWorkbook.mockResolvedValue([validRow({ '培养层次': '新层次' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importClasses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.training_levels.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: '新层次' }),
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoCreated: expect.objectContaining({ trainingLevels: 1 }),
        }),
      })
    );
  });

  // ── 7. 自动创建缺失的专业 ────────────────
  it('未知专业应在事务内自动创建', async () => {
    readWorkbook.mockResolvedValue([validRow({ '专业类别': '新专业' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importClasses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.majors.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: '新专业' }),
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoCreated: expect.objectContaining({ majors: 1 }),
        }),
      })
    );
  });

  // ── 8. 自动创建缺失的学院 ────────────────
  it('未知学院应在事务内自动创建', async () => {
    readWorkbook.mockResolvedValue([validRow({ '二级学院': '新学院' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importClasses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.colleges.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: '新学院' }),
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoCreated: expect.objectContaining({ colleges: 1 }),
        }),
      })
    );
  });

  // ── 9. 空行数组 → no-op ──────────────────
  it('空行数组应不调用事务并返回 imported=0', async () => {
    readWorkbook.mockResolvedValue([]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importClasses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ imported: 0, overwritten: 0, total: 0 }),
      })
    );
  });

  // ── 10. Upsert 模式（覆盖已有班级）───────
  it('已有同名班级应执行更新而非新建', async () => {
    // 事务内 findMany 返回 1 个同名班级
    mockTx.classes.findMany.mockResolvedValue([
      { id: 5, name: '2024级计科1班' },
    ]);
    readWorkbook.mockResolvedValue([validRow()]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importClasses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.classes.create).not.toHaveBeenCalled();
    expect(mockTx.classes.update).toHaveBeenCalledOnce();
    expect(mockTx.classes.update.mock.calls[0][0].where).toEqual({ id: 5 });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ imported: 0, overwritten: 1 }),
      })
    );
  });

  // ── 无文件 → ValidationError ─────────────
  it('无文件应抛出 ValidationError', async () => {
    const req = mockReq(null);
    const res = mockRes();
    const next = vi.fn();

    await expect(importClasses(req, res, next)).rejects.toThrow('请上传文件');
  });

  // ── 审计日志 ─────────────────────────────
  it('导入成功后应调用审计日志', async () => {
    readWorkbook.mockResolvedValue([validRow()]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importClasses(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'import',
        module: 'class',
        result: 'success',
      })
    );
  });

  // ── 已知专业/层次/学院 不自动创建 ──────
  it('已存在的专业不应重复创建', async () => {
    mockPrisma.majors.findMany.mockResolvedValue([{ id: 10, name: '计算机科学' }]);
    readWorkbook.mockResolvedValue([validRow()]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importClasses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.majors.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoCreated: expect.objectContaining({ majors: 0 }),
        }),
      })
    );
  });

  // ── 状态映射：已毕业 ────────────────────
  it('状态"已毕业"应映射为 graduated', async () => {
    readWorkbook.mockResolvedValue([validRow({ '状态': '已毕业' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importClasses(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const createArg = mockTx.classes.create.mock.calls[0][0].data;
    expect(createArg.status).toBe('graduated');
  });
});
