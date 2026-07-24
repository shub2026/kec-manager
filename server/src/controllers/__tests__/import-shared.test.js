/**
 * import-shared.js 单元测试
 *
 * 覆盖：
 * 1. verifyExcelMagicNumber — XLSX / XLS 魔数校验、无效字节、文件过小
 * 2. sanitizeInput — 去空、null 处理、XSS 过滤
 * 3. sanitizeFormulaInjection — 公式注入防护
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Buffer } from 'buffer';

// ──────────────────────────────────────────────
// Mock fs（verifyExcelMagicNumber 依赖）
// ──────────────────────────────────────────────
const mockFdRead = vi.fn();
const mockFdClose = vi.fn().mockResolvedValue(undefined);

const mockUnlink = vi.fn();

vi.mock('fs', () => ({
  default: {
    promises: {
      open: vi.fn(),
    },
    unlink: mockUnlink,
  },
  unlink: mockUnlink,
}));

vi.mock('xss', () => ({
  default: (str) => str.replace(/<[^>]*>/g, ''),
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { verifyExcelMagicNumber, sanitizeInput, sanitizeFormulaInjection, normalizePlaceholder, cleanupFile } =
  await import('../import-shared.js');
const fs = await import('fs');

// ──────────────────────────────────────────────
// 工具：构造 mock fd，read 时往 buffer 写入指定字节
// ──────────────────────────────────────────────
function setupMockFd(bytes) {
  const fd = {
    read: vi.fn(async (buf, offset, length, position) => {
      for (let i = 0; i < Math.min(bytes.length, length); i++) {
        buf[offset + i] = bytes[i];
      }
      return { bytesRead: Math.min(bytes.length, length) };
    }),
    close: mockFdClose,
  };
  fs.default.promises.open.mockResolvedValue(fd);
  return fd;
}

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('verifyExcelMagicNumber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('XLSX 魔数 (PK\\x03\\x04) 应通过校验', async () => {
    setupMockFd([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);

    await expect(verifyExcelMagicNumber('/tmp/test.xlsx')).resolves.toBeUndefined();
  });

  it('XLS 魔数 (\\xD0\\xCF\\x11\\xE0) 应通过校验', async () => {
    setupMockFd([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x00, 0x00, 0x00]);

    await expect(verifyExcelMagicNumber('/tmp/test.xls')).resolves.toBeUndefined();
  });

  it('无效魔数应抛出错误', async () => {
    setupMockFd([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

    await expect(verifyExcelMagicNumber('/tmp/bad.txt')).rejects.toThrow('文件头魔数不匹配');
  });

  it('文件过小（不足4字节）应抛出错误', async () => {
    const fd = {
      read: vi.fn(async (buf, offset, length) => {
        buf[offset] = 0x50;
        buf[offset + 1] = 0x4b;
        return { bytesRead: 2 };
      }),
      close: mockFdClose,
    };
    fs.default.promises.open.mockResolvedValue(fd);

    await expect(verifyExcelMagicNumber('/tmp/short.xlsx')).rejects.toThrow('文件过小');
  });
});

describe('sanitizeInput', () => {
  it('null 输入应返回 null', () => {
    expect(sanitizeInput(null)).toBeNull();
  });

  it('undefined 输入应返回 null', () => {
    expect(sanitizeInput(undefined)).toBeNull();
  });

  it('空字符串应返回 null', () => {
    expect(sanitizeInput('')).toBeNull();
  });

  it('纯空白字符串应返回 null', () => {
    expect(sanitizeInput('   ')).toBeNull();
  });

  it('正常字符串应去除两端空白', () => {
    expect(sanitizeInput('  hello  ')).toBe('hello');
  });

  it('XSS 标签应被过滤', () => {
    const result = sanitizeInput('<script>alert(1)</script>hello');
    expect(result).not.toContain('<script>');
    expect(result).toContain('hello');
  });

  it('数字应转为字符串', () => {
    expect(sanitizeInput(42)).toBe('42');
  });
});

describe('sanitizeFormulaInjection', () => {
  it('null 输入应返回 null', () => {
    expect(sanitizeFormulaInjection(null)).toBeNull();
  });

  it('undefined 输入应返回 null', () => {
    expect(sanitizeFormulaInjection(undefined)).toBeNull();
  });

  it('空字符串应返回 null', () => {
    expect(sanitizeFormulaInjection('')).toBeNull();
  });

  it("=CMD 应加 ' 前缀", () => {
    expect(sanitizeFormulaInjection('=CMD')).toBe("'=CMD");
  });

  it("+CMD 应加 ' 前缀", () => {
    expect(sanitizeFormulaInjection('+CMD')).toBe("'+CMD");
  });

  it("-CMD 应加 ' 前缀", () => {
    expect(sanitizeFormulaInjection('-CMD')).toBe("'-CMD");
  });

  it("@CMD 应加 ' 前缀", () => {
    expect(sanitizeFormulaInjection('@CMD')).toBe("'@CMD");
  });

  it('正常字符串不加前缀', () => {
    expect(sanitizeFormulaInjection('hello')).toBe('hello');
  });

  it('纯空白字符串应返回 null', () => {
    expect(sanitizeFormulaInjection('   ')).toBeNull();
  });
});

describe('normalizePlaceholder', () => {
  it('null 输入应返回 null', () => {
    expect(normalizePlaceholder(null)).toBeNull();
  });

  it('undefined 输入应返回 null', () => {
    expect(normalizePlaceholder(undefined)).toBeNull();
  });

  it('空字符串应返回 null', () => {
    expect(normalizePlaceholder('')).toBeNull();
  });

  it('纯空白字符串应返回 null', () => {
    expect(normalizePlaceholder('   ')).toBeNull();
  });

  it("半角短横 '-' 应返回 null", () => {
    expect(normalizePlaceholder('-')).toBeNull();
  });

  it('全角破折号 — 应返回 null', () => {
    expect(normalizePlaceholder('—')).toBeNull();
  });

  it('全角短横 － 应返回 null', () => {
    expect(normalizePlaceholder('－')).toBeNull();
  });

  it("sanitizeInput 转义后的 \"'-\" 应返回 null（往返污染主场景）", () => {
    // 导出空字段以 '-' 呈现，再导入时先经 sanitizeInput 转义成 "'-"
    const sanitized = sanitizeInput('-');
    expect(sanitized).toBe("'-");
    expect(normalizePlaceholder(sanitized)).toBeNull();
  });

  it('正常值应原样返回', () => {
    expect(normalizePlaceholder('CS101')).toBe('CS101');
  });

  it("含短横的正常值（如 'A-1'）不应被归一化", () => {
    expect(normalizePlaceholder('A-1')).toBe('A-1');
  });
});

describe('cleanupFile', () => {
  it('传入路径时应调用 fs.unlink', () => {
    mockUnlink.mockClear();
    cleanupFile('/tmp/some-file.xlsx');
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/some-file.xlsx', expect.any(Function));
  });

  it('传入 null 时不应调用 fs.unlink', () => {
    mockUnlink.mockClear();
    cleanupFile(null);
    expect(mockUnlink).not.toHaveBeenCalled();
  });
});
