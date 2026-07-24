import multer from 'multer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Buffer } from 'buffer';
import xss from 'xss';

// Excel 文件的 MIME 类型白名单
const EXCEL_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
];

// 文件大小上限：支持通过 MAX_FILE_SIZE 环境变量配置（单位 MB，默认 10MB）
const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE) || 10) * 1024 * 1024;

// Excel 文件头魔数签名（前 4 字节）
const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 — ZIP 签名（.xlsx）
const XLS_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // \xD0\xCF\x11\xE0 — OLE2 签名（.xls）

/**
 * 读取文件前 8 字节验证魔数，确保是真实的 Excel 文件
 * 在 controller 中 readWorkbook 之前调用（multer fileFilter 阶段无法读取文件内容）
 * @param {string} filePath - multer 落盘后的临时文件路径
 * @returns {Promise<void>} 校验通过返回 void，否则抛出 Error
 */
export async function verifyExcelMagicNumber(filePath) {
  const buf = Buffer.alloc(8);
  let fd;
  try {
    fd = await fs.promises.open(filePath, 'r');
    const { bytesRead } = await fd.read(buf, 0, 8, 0);
    if (bytesRead < 4) {
      throw new Error('文件过小，不是有效的 Excel 文件');
    }
    const matchesXlsx = XLSX_MAGIC.every((b, i) => buf[i] === b);
    const matchesXls = XLS_MAGIC.every((b, i) => buf[i] === b);
    if (!matchesXlsx && !matchesXls) {
      throw new Error('文件头魔数不匹配，不是有效的 Excel 文件');
    }
  } finally {
    if (fd) {
      try {
        await fd.close();
      } catch {
        /* 忽略关闭错误 */
      }
    }
  }
}

export const upload = multer({
  dest: path.join(os.tmpdir(), 'kec-uploads'),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    // 检查文件扩展名
    if (!file.originalname.match(/\.(xlsx|xls)$/i)) {
      return cb(new Error('仅支持 .xlsx 或 .xls 文件'));
    }
    // 检查 MIME 类型（仅初步筛选，真实文件头魔数在 controller 中校验）
    if (!EXCEL_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('文件格式无效：不是有效的 Excel 文件'));
    }
    cb(null, true);
  },
});

export function cleanupFile(path) {
  if (path) fs.unlink(path, () => {});
}

export function sanitizeInput(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  // M-7修复：防止 Excel 公式注入（=+-@\t 开头），转义前缀字符
  const sanitized = /^[=+\-@\t]/.test(str) ? "'" + str : str;
  return xss(sanitized);
}

// 导出空值占位符集合（半角短横、全角破折号、全角短横）
// 导出时空字段以这些占位符呈现，再导入时须视为空，避免占位符被当作真实数据写库
const PLACEHOLDER_VALUES = new Set(['-', '—', '－']);

/**
 * 归一化导出占位符：将 sanitizeInput 后等于占位符（-/—/－）或空白的值视为空。
 * 修复「导出→再导入」往返污染：占位符 '-' 不再被写入字段或触发基础数据自动创建。
 *
 * 注意：本函数接收的是 sanitizeInput 处理后的值。sanitizeInput 会给以 =+-@\t 开头的值
 * 加前导单引号防公式注入，故半角短横 '-' 会被转义成 "'-"，比对前需先剥离前导单引号。
 * @param {*} value - sanitizeInput 处理后的单元格值
 * @returns {*|null} 原值（非占位符）或 null（占位符/空）
 */
export function normalizePlaceholder(value) {
  if (value === null || value === undefined) return null;
  let str = String(value).trim();
  if (!str) return null;
  if (str.startsWith("'")) str = str.slice(1);
  if (!str || PLACEHOLDER_VALUES.has(str)) return null;
  return value;
}

/**
 * @deprecated M-7修复：公式注入防护已统一由 sanitizeInput 承担（在 XSS 过滤前先转义前缀字符）。
 * 请勿再使用此函数，直接调用 sanitizeInput 即可。
 */
export function sanitizeFormulaInjection(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  if (/^[=+\-@]/.test(str)) {
    return "'" + str;
  }
  return str;
}
