import multer from 'multer';
import fs from 'fs';
import xss from 'xss';

// Excel 文件的 MIME 类型白名单
const EXCEL_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
];

export const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // 检查文件扩展名
    if (!file.originalname.match(/\.(xlsx|xls)$/i)) {
      return cb(new Error('仅支持 .xlsx 或 .xls 文件'));
    }
    // 检查 MIME 类型（魔数检测）
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
  return xss(str);
}

export function sanitizeFormulaInjection(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  if (/^[=+\-@]/.test(str)) {
    return "'" + str;
  }
  return str;
}
