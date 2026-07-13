/**
 * export-template.controller.js 单元测试
 *
 * 覆盖：
 * - downloadTemplate：各类型模板下载（classes/courses/textbooks/teachers）
 * - 不支持的模板类型 → 400
 * - 审计日志记录
 * - 错误处理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ──────────────────────────────────────────────
// Hoisted mocks
// ──────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  createTemplateWorkbook: vi.fn().mockReturnValue({}),
  workbookToBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-template')),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// ──────────────────────────────────────────────
// Mock modules
// ──────────────────────────────────────────────
vi.mock('../../../utils/excel.js', () => ({
  createTemplateWorkbook: mocks.createTemplateWorkbook,
  workbookToBuffer: mocks.workbookToBuffer,
}));

vi.mock('../../../services/audit.service.js', () => ({
  createAuditLog: mocks.createAuditLog,
}));

const { downloadTemplate } = await import('../export-template.controller.js');

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn(),
  };
}

function makeReq(type) {
  return {
    params: { type },
    user: { id: 1 },
    ip: '127.0.0.1',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTemplateWorkbook.mockReturnValue({});
  mocks.workbookToBuffer.mockResolvedValue(Buffer.from('fake-template'));
  mocks.createAuditLog.mockResolvedValue(undefined);
});

// ══════════════════════════════════════════════
// downloadTemplate
// ══════════════════════════════════════════════
describe('downloadTemplate', () => {
  describe('支持的模板类型', () => {
    it('type=classes 应生成班级导入模板', async () => {
      const req = makeReq('classes');
      const res = makeRes();
      const next = vi.fn();

      await downloadTemplate(req, res, next);

      expect(mocks.createTemplateWorkbook).toHaveBeenCalled();
      const headers = mocks.createTemplateWorkbook.mock.calls[0][0];
      const sample = mocks.createTemplateWorkbook.mock.calls[0][1];

      // 验证表头
      expect(headers.length).toBe(8);
      expect(headers[0]).toEqual(
        expect.objectContaining({ label: '班级名称', key: 'name', required: true })
      );
      expect(headers.find((h) => h.key === 'year')).toEqual(
        expect.objectContaining({ label: '入学年份', required: true })
      );

      // 验证示例数据
      expect(sample).toHaveLength(1);
      expect(sample[0]).toEqual(expect.objectContaining({ 班级名称: '2024级学前1班' }));

      // 验证响应
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        expect.stringContaining('spreadsheetml')
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('attachment')
      );
      expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));

      // 验证审计日志
      expect(mocks.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'export',
          module: 'system',
          result: 'success',
          details: { type: 'classes' },
        })
      );
    });

    it('type=courses 应生成课程导入模板', async () => {
      const req = makeReq('courses');
      const res = makeRes();

      await downloadTemplate(req, res, vi.fn());

      expect(mocks.createTemplateWorkbook).toHaveBeenCalled();
      const headers = mocks.createTemplateWorkbook.mock.calls[0][0];

      expect(headers.length).toBe(4);
      expect(headers[0]).toEqual(expect.objectContaining({ label: '课程名称', required: true }));
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('attachment')
      );
    });

    it('type=textbooks 应生成教材导入模板', async () => {
      const req = makeReq('textbooks');
      const res = makeRes();

      await downloadTemplate(req, res, vi.fn());

      expect(mocks.createTemplateWorkbook).toHaveBeenCalled();
      const headers = mocks.createTemplateWorkbook.mock.calls[0][0];

      expect(headers.length).toBe(9);
      expect(headers[0]).toEqual(expect.objectContaining({ label: '书名', required: true }));
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('attachment')
      );
    });

    it('type=teachers 应生成教师导入模板', async () => {
      const req = makeReq('teachers');
      const res = makeRes();

      await downloadTemplate(req, res, vi.fn());

      expect(mocks.createTemplateWorkbook).toHaveBeenCalled();
      const headers = mocks.createTemplateWorkbook.mock.calls[0][0];

      expect(headers.length).toBe(11);
      expect(headers[0]).toEqual(expect.objectContaining({ label: '教师姓名', required: true }));
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('attachment')
      );
    });
  });

  describe('不支持的模板类型', () => {
    it('未知类型应返回 400', async () => {
      const req = makeReq('unknown');
      const res = makeRes();

      await downloadTemplate(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: '不支持的模板类型' })
      );
      expect(mocks.createTemplateWorkbook).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });

    it('空字符串类型应返回 400', async () => {
      const req = makeReq('');
      const res = makeRes();

      await downloadTemplate(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('错误处理', () => {
    it('workbookToBuffer 抛出错误时应调用 next(e) 并记录失败审计', async () => {
      mocks.workbookToBuffer.mockRejectedValue(new Error('Buffer error'));

      const req = makeReq('classes');
      const res = makeRes();
      const next = vi.fn();

      await downloadTemplate(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Buffer error' }));
      expect(mocks.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'failed',
          details: { type: 'classes' },
        })
      );
    });

    it('createTemplateWorkbook 抛出错误时应调用 next(e)', async () => {
      mocks.createTemplateWorkbook.mockImplementation(() => {
        throw new Error('Workbook creation failed');
      });

      const req = makeReq('courses');
      const res = makeRes();
      const next = vi.fn();

      await downloadTemplate(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Workbook creation failed' })
      );
      expect(mocks.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'failed',
          details: { type: 'courses' },
        })
      );
    });
  });

  describe('审计日志', () => {
    it('应记录用户 ID 和 IP', async () => {
      const req = {
        params: { type: 'courses' },
        user: { id: 42 },
        ip: '192.168.1.1',
      };
      const res = makeRes();

      await downloadTemplate(req, res, vi.fn());

      expect(mocks.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 42,
          ip: '192.168.1.1',
        })
      );
    });

    it('user 为 undefined 时不应抛出错误', async () => {
      const req = {
        params: { type: 'courses' },
        user: undefined,
        ip: '127.0.0.1',
      };
      const res = makeRes();

      await downloadTemplate(req, res, vi.fn());

      expect(mocks.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ userId: undefined })
      );
    });
  });
});
