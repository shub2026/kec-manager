/**
 * import/textbooks.js — importTextbooks 单元测试
 *
 * 覆盖：
 * 1. 无文件 → ValidationError
 * 2. Excel 读取失败 → ValidationError + cleanupFile
 * 3. 有效行 → 创建教材（新教材）
 * 4. 有效行 → 覆盖教材（已存在同名教材）
 * 5. 行数据字段解析（书名、书号、出版社、作者、版次、出版日期、定价、类别、状态）
 * 6. 缺少书名 → 行验证错误
 * 7. 全部行无效 → 返回验证错误、不执行事务
 * 8. 部分有效 + 部分无效 → 混合结果
 * 9. 事务失败 → 审计日志 + next(e)
 * 10. sanitizeInput 调用
 * 11. 默认类别（DEFAULT_TEXTBOOK_CATEGORY）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockTx = {
  textbooks: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 1 }),
    update: vi.fn().mockResolvedValue({ id: 1 }),
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
    if (typeof v === 'number') return v;
    const s = String(v).trim();
    return s || null;
  }),
  normalizePlaceholder: vi.fn((v) => {
    if (v === null || v === undefined) return null;
    let s = String(v).trim();
    if (!s) return null;
    if (s.startsWith("'")) s = s.slice(1);
    if (!s || ['-', '—', '－'].includes(s)) return null;
    return v;
  }),
  verifyExcelMagicNumber: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../constants/index.js', () => ({
  DEFAULT_TEXTBOOK_CATEGORY: '技工',
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { importTextbooks } = await import('../textbooks.js');
const { readWorkbook } = await import('../../../utils/excel.js');
const { createAuditLog } = await import('../../../services/audit.service.js');
const { cleanupFile, verifyExcelMagicNumber } = await import('../../import-shared.js');

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

function textbookRow(overrides = {}) {
  return {
    书名: '高等数学',
    书号: '978-7-04-039663-8',
    出版社: '高等教育出版社',
    作者: '同济大学',
    版次: '第7版',
    出版日期: '2023-06-01',
    定价: '45.80',
    类别: '理工',
    状态: '启用',
    ...overrides,
  };
}

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('importTextbooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.textbooks.findFirst.mockResolvedValue(null);
    mockTx.textbooks.create.mockResolvedValue({ id: 1 });
    mockTx.textbooks.update.mockResolvedValue({ id: 1 });
  });

  // ── 1. 无文件 → ValidationError ─────────────
  it('无文件应抛出 ValidationError', async () => {
    const req = mockReq(null);
    const res = mockRes();
    const next = vi.fn();

    await expect(importTextbooks(req, res, next)).rejects.toThrow('请上传文件');
  });

  // ── 2. Excel 读取失败 ───────────────────────
  it('Excel 读取失败应抛出 ValidationError 并清理文件', async () => {
    readWorkbook.mockRejectedValue(new Error('Bad format'));
    const req = mockReq({ path: '/tmp/bad.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await expect(importTextbooks(req, res, next)).rejects.toThrow(
      'Excel文件读取失败，请检查文件格式'
    );
    expect(cleanupFile).toHaveBeenCalledWith('/tmp/bad.xlsx');
  });

  it('verifyExcelMagicNumber 失败应清理文件并抛出', async () => {
    verifyExcelMagicNumber.mockRejectedValueOnce(new Error('Invalid magic'));
    const req = mockReq({ path: '/tmp/bad.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await expect(importTextbooks(req, res, next)).rejects.toThrow(
      'Excel文件读取失败，请检查文件格式'
    );
    expect(cleanupFile).toHaveBeenCalledWith('/tmp/bad.xlsx');
  });

  // ── 3. 有效行 → 创建教材 ────────────────────
  it('有效行应创建教材并返回 imported=1', async () => {
    readWorkbook.mockResolvedValue([textbookRow()]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTextbooks(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.textbooks.create).toHaveBeenCalledOnce();
    const createData = mockTx.textbooks.create.mock.calls[0][0].data;
    expect(createData.title).toBe('高等数学');
    expect(createData.isbn).toBe('978-7-04-039663-8');
    expect(createData.publisher).toBe('高等教育出版社');
    expect(createData.author).toBe('同济大学');
    expect(createData.edition).toBe('第7版');
    expect(createData.publish_date).toBe('2023-06-01');
    expect(createData.price).toBe(45.8);
    expect(createData.category).toBe('理工');
    expect(createData.is_active).toBe(true);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ imported: 1, overwritten: 0 }),
        message: expect.stringContaining('新增1条'),
      })
    );
  });

  // ── 4. 有效行 → 覆盖教材 ────────────────────
  it('已存在同名教材应覆盖更新并返回 overwritten=1', async () => {
    readWorkbook.mockResolvedValue([textbookRow()]);
    mockTx.textbooks.findFirst.mockResolvedValue({ id: 99, title: '高等数学' });
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTextbooks(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.textbooks.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: expect.objectContaining({ title: '高等数学' }),
    });
    expect(mockTx.textbooks.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ imported: 0, overwritten: 1 }),
        message: expect.stringContaining('覆盖1条'),
      })
    );
  });

  // ── 5. 字段解析 ─────────────────────────────
  describe('字段解析', () => {
    it('定价为非数字字符串时 price 应为 null', async () => {
      readWorkbook.mockResolvedValue([textbookRow({ 定价: '免费' })]);
      const req = mockReq({ path: '/tmp/test.xlsx' });
      const res = mockRes();
      const next = vi.fn();

      await importTextbooks(req, res, next);

      const createData = mockTx.textbooks.create.mock.calls[0][0].data;
      expect(createData.price).toBeNull();
    });

    it('定价为空字符串时 price 应为 null', async () => {
      readWorkbook.mockResolvedValue([textbookRow({ 定价: '' })]);
      const req = mockReq({ path: '/tmp/test.xlsx' });
      const res = mockRes();
      const next = vi.fn();

      await importTextbooks(req, res, next);

      const createData = mockTx.textbooks.create.mock.calls[0][0].data;
      expect(createData.price).toBeNull();
    });

    it('状态为"停用"时 is_active 应为 false', async () => {
      readWorkbook.mockResolvedValue([textbookRow({ 状态: '停用' })]);
      const req = mockReq({ path: '/tmp/test.xlsx' });
      const res = mockRes();
      const next = vi.fn();

      await importTextbooks(req, res, next);

      const createData = mockTx.textbooks.create.mock.calls[0][0].data;
      expect(createData.is_active).toBe(false);
    });

    it('状态为"启用"时 is_active 应为 true', async () => {
      readWorkbook.mockResolvedValue([textbookRow({ 状态: '启用' })]);
      const req = mockReq({ path: '/tmp/test.xlsx' });
      const res = mockRes();
      const next = vi.fn();

      await importTextbooks(req, res, next);

      const createData = mockTx.textbooks.create.mock.calls[0][0].data;
      expect(createData.is_active).toBe(true);
    });

    it('状态列为空时 is_active 应为 true（默认）', async () => {
      readWorkbook.mockResolvedValue([textbookRow({ 状态: '' })]);
      const req = mockReq({ path: '/tmp/test.xlsx' });
      const res = mockRes();
      const next = vi.fn();

      await importTextbooks(req, res, next);

      const createData = mockTx.textbooks.create.mock.calls[0][0].data;
      expect(createData.is_active).toBe(true);
    });

    it('类别为空时应回退到 DEFAULT_TEXTBOOK_CATEGORY（修复 String(null)="null" 隐性 bug）', async () => {
      // 修复前：sanitizeInput('') 返回 null，String(null).trim()==="null"（truthy）会写入字面 'null'。
      // 修复后：归一化后 category 为 null，显式判空回退到默认类别。
      readWorkbook.mockResolvedValue([textbookRow({ 类别: '' })]);
      const req = mockReq({ path: '/tmp/test.xlsx' });
      const res = mockRes();
      const next = vi.fn();

      await importTextbooks(req, res, next);

      const createData = mockTx.textbooks.create.mock.calls[0][0].data;
      expect(createData.category).toBe('技工');
    });

    it("类别为占位符 '-' 时应视为空并回退到默认类别（往返污染防御）", async () => {
      readWorkbook.mockResolvedValue([textbookRow({ 类别: '-' })]);
      const req = mockReq({ path: '/tmp/test.xlsx' });
      const res = mockRes();
      const next = vi.fn();

      await importTextbooks(req, res, next);

      const createData = mockTx.textbooks.create.mock.calls[0][0].data;
      expect(createData.category).toBe('技工');
    });

    it('类别有正常值时应使用该值', async () => {
      readWorkbook.mockResolvedValue([textbookRow({ 类别: '理工' })]);
      const req = mockReq({ path: '/tmp/test.xlsx' });
      const res = mockRes();
      const next = vi.fn();

      await importTextbooks(req, res, next);

      const createData = mockTx.textbooks.create.mock.calls[0][0].data;
      expect(createData.category).toBe('理工');
    });

    it('可选字段（isbn/publisher/author/edition/publish_date）为空时应为 null', async () => {
      readWorkbook.mockResolvedValue([
        textbookRow({
          书号: '',
          出版社: '',
          作者: '',
          版次: '',
          出版日期: '',
        }),
      ]);
      const req = mockReq({ path: '/tmp/test.xlsx' });
      const res = mockRes();
      const next = vi.fn();

      await importTextbooks(req, res, next);

      const createData = mockTx.textbooks.create.mock.calls[0][0].data;
      expect(createData.isbn).toBeNull();
      expect(createData.publisher).toBeNull();
      expect(createData.author).toBeNull();
      expect(createData.edition).toBeNull();
      expect(createData.publish_date).toBeNull();
    });
  });

  // ── 6. 缺少书名 → 行验证错误 ────────────────
  it('缺少书名应返回行验证错误', async () => {
    readWorkbook.mockResolvedValue([textbookRow({ 书名: '' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTextbooks(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          imported: 0,
          overwritten: 0,
          failed: 1,
          errors: expect.arrayContaining([expect.stringContaining('缺少书名')]),
        }),
      })
    );
  });

  it('行号应从第2行开始（含表头）', async () => {
    readWorkbook.mockResolvedValue([textbookRow({ 书名: '' }), textbookRow({ 书名: '' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTextbooks(req, res, next);

    const responseCall = res.json.mock.calls[0][0];
    expect(responseCall.data.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('第2行'), expect.stringContaining('第3行')])
    );
  });

  // ── 7. 全部行无效 → 不执行事务 ──────────────
  it('全部行无效应返回验证错误且不执行事务', async () => {
    readWorkbook.mockResolvedValue([textbookRow({ 书名: '' }), textbookRow({ 书名: '' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTextbooks(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          imported: 0,
          overwritten: 0,
          failed: 2,
          total: 2,
        }),
        message: expect.stringContaining('验证失败'),
      })
    );
  });

  it('全部行无效应记录失败审计日志', async () => {
    readWorkbook.mockResolvedValue([textbookRow({ 书名: '' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTextbooks(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'import',
        module: 'textbook',
        result: 'failed',
      })
    );
  });

  // ── 8. 部分有效 + 部分无效 → 混合结果 ───────
  it('部分有效部分无效应返回混合结果', async () => {
    readWorkbook.mockResolvedValue([textbookRow({ 书名: '有效教材' }), textbookRow({ 书名: '' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTextbooks(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          imported: 1,
          overwritten: 0,
          failed: 1,
          total: 2,
          errors: expect.arrayContaining([expect.stringContaining('缺少书名')]),
        }),
        message: expect.stringContaining('新增1条'),
      })
    );
  });

  it('混合结果 message 应包含失败数', async () => {
    readWorkbook.mockResolvedValue([textbookRow({ 书名: '有效教材' }), textbookRow({ 书名: '' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTextbooks(req, res, next);

    const responseCall = res.json.mock.calls[0][0];
    expect(responseCall.message).toContain('失败1条');
  });

  // ── 9. 事务失败 → 审计日志 + next(e) ────────
  it('事务执行失败应记录审计日志并通过 next(e) 传递', async () => {
    readWorkbook.mockResolvedValue([textbookRow()]);
    const dbError = new Error('Transaction failed');
    mockPrisma.$transaction.mockRejectedValueOnce(dbError);

    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTextbooks(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'import',
        module: 'textbook',
        result: 'failed',
        message: expect.stringContaining('事务失败'),
      })
    );
    expect(next).toHaveBeenCalledWith(dbError);
  });

  // ── 10. 多行创建/覆盖混合 ──────────────────
  it('多行中部分已存在应同时创建和覆盖', async () => {
    readWorkbook.mockResolvedValue([
      textbookRow({ 书名: '新教材' }),
      textbookRow({ 书名: '已有教材' }),
    ]);
    mockTx.textbooks.findFirst
      .mockResolvedValueOnce(null) // 第一本不存在
      .mockResolvedValueOnce({ id: 50, title: '已有教材' }); // 第二本存在

    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTextbooks(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.textbooks.create).toHaveBeenCalledOnce();
    expect(mockTx.textbooks.update).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ imported: 1, overwritten: 1 }),
      })
    );
  });

  // ── 11. 空 Excel（0行） ────────────────────
  it('空 Excel 应返回 imported=0, overwritten=0, failed=0', async () => {
    readWorkbook.mockResolvedValue([]);
    const req = mockReq({ path: '/tmp/empty.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTextbooks(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          imported: 0,
          overwritten: 0,
          failed: 0,
          total: 0,
        }),
      })
    );
  });

  // ── 12. 成功后审计日志 ──────────────────────
  it('导入成功后应记录成功审计日志', async () => {
    readWorkbook.mockResolvedValue([textbookRow()]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTextbooks(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'import',
        module: 'textbook',
        result: 'success',
        details: expect.objectContaining({
          total: 1,
          imported: 1,
          overwritten: 0,
          failed: 0,
        }),
      })
    );
  });

  // ── 13. 文件读取成功后清理文件 ─────────────
  it('成功读取后应调用 cleanupFile', async () => {
    readWorkbook.mockResolvedValue([textbookRow()]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTextbooks(req, res, next);

    expect(cleanupFile).toHaveBeenCalledWith('/tmp/test.xlsx');
  });
});
