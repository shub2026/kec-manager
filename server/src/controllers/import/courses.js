import { prisma } from '../../lib/prisma.js';
import { success, fail } from '../../utils/response.js';
import { readWorkbook } from '../../utils/excel.js';
import { createAuditLog } from '../../services/audit.service.js';
import { ValidationError } from '../../utils/error.js';
import { log } from '../../utils/logger.js';
import { cleanupFile, sanitizeInput, sanitizeFormulaInjection } from '../import-shared.js';

/**
 * POST /api/import/courses - 批量导入课程
 */
export async function importCourses(req, res, next) {
  if (!req.file) throw new ValidationError('请上传文件');

  let rows;
  try {
    rows = await readWorkbook(req.file.path);
    cleanupFile(req.file.path);
  } catch (e) {
    cleanupFile(req.file.path);
    throw new ValidationError('Excel文件读取失败: ' + e.message);
  }

  const validationErrors = [];
  const validRows = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const sanitizedRow = {};
    for (const [key, value] of Object.entries(row)) {
      sanitizedRow[key] = sanitizeFormulaInjection(sanitizeInput(value));
    }

    const name = sanitizedRow['课程名称'];
    const code = sanitizedRow['课程编码'] || null;
    const typeValue = sanitizedRow['课程类型'];
    const type = typeValue === '专业课' || typeValue === 'professional' ? 'professional' : 'public';

    if (!name) {
      validationErrors.push(`第${i + 2}行：缺少课程名称`);
      continue;
    }

    validRows.push({ name: String(name).trim(), code: code ? String(code).trim() : null, type });
  }

  try {
    if (validationErrors.length > 0 && validRows.length === 0) {
      const result = {
        imported: 0,
        overwritten: 0,
        failed: validationErrors.length,
        total: rows.length,
        errors: validationErrors,
      };

      await createAuditLog({
        action: 'import',
        module: 'course',
        userId: req.user?.id,
        details: result,
        result: 'failed',
        message: `课程导入验证失败: ${validationErrors.length}条错误`,
      });

      return success(res, result, `验证失败：${validationErrors.length}条错误`);
    }

    let imported = 0;
    let overwritten = 0;

    if (validRows.length > 0) {
      const counts = await prisma.$transaction(async (tx) => {
        let created = 0;
        let updated = 0;
        for (const r of validRows) {
          const existing = await tx.courses.findFirst({ where: { name: r.name } });
          if (existing) {
            await tx.courses.update({ where: { id: existing.id }, data: r });
            updated++;
          } else {
            await tx.courses.create({ data: r });
            created++;
          }
        }
        return { created, updated };
      });
      imported = counts.created;
      overwritten = counts.updated;
    }

    const result = {
      imported,
      overwritten,
      failed: validationErrors.length,
      total: rows.length,
      errors: validationErrors,
    };
    let message = `导入完成：新增${imported}条`;
    if (overwritten > 0) message += `，覆盖${overwritten}条`;
    if (validationErrors.length > 0) message += `，失败${validationErrors.length}条`;

    await createAuditLog({
      action: 'import',
      module: 'course',
      userId: req.user?.id,
      details: {
        total: rows.length,
        imported,
        overwritten,
        failed: validationErrors.length,
      },
      result: imported + overwritten > 0 ? 'success' : 'failed',
      message: `导入完成：新增${imported}条，覆盖${overwritten}条，失败${validationErrors.length}条`,
    });

    success(res, result, message);
  } catch (e) {
    log.error('[课程导入] 事务执行失败，已回滚', { error: e.message, stack: e.stack });

    await createAuditLog({
      action: 'import',
      module: 'course',
      userId: req.user?.id,
      result: 'failed',
      message: `课程导入事务失败: ${e.message}`,
    });

    next(e);
  }
}
