import { prisma } from '../../lib/prisma.js';
import { success } from '../../utils/response.js';
import { readWorkbook } from '../../utils/excel.js';
import { createAuditLog } from '../../services/audit.service.js';
import { ValidationError } from '../../utils/error.js';
import { log } from '../../utils/logger.js';
import {
  cleanupFile,
  sanitizeInput,
  normalizePlaceholder,
  verifyExcelMagicNumber,
} from '../import-shared.js';

/**
 * POST /api/import/courses - 批量导入课程
 */
export async function importCourses(req, res, next) {
  if (!req.file) throw new ValidationError('请上传文件');

  let rows;
  try {
    await verifyExcelMagicNumber(req.file.path);
    rows = await readWorkbook(req.file.path);
    cleanupFile(req.file.path);
  } catch (e) {
    cleanupFile(req.file.path);
    log.error('[课程导入] Excel文件读取失败', { error: e.message, stack: e.stack });
    throw new ValidationError('Excel文件读取失败，请检查文件格式');
  }

  const validationErrors = [];
  const validRows = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const sanitizedRow = {};
    for (const [key, value] of Object.entries(row)) {
      sanitizedRow[key] = sanitizeInput(value);
    }

    const name = sanitizedRow['课程名称'];
    const code = normalizePlaceholder(sanitizedRow['课程编码']);
    const typeValue = sanitizedRow['课程类型'];
    // 审计修复：读取"描述"列，与导出列对称，确保往返导入不丢失描述数据
    const description = normalizePlaceholder(sanitizedRow['描述']);
    // S-08 修复：标记类型是否为 Excel 显式指定（非空值），避免默认值覆盖已有类型
    const typeExplicit = !!typeValue;
    const type = typeValue === '专业课' || typeValue === 'professional' ? 'professional' : 'public';

    if (!name) {
      validationErrors.push(`第${i + 2}行：缺少课程名称`);
      continue;
    }

    validRows.push({
      name: String(name).trim(),
      code: code ? String(code).trim() : null,
      type,
      typeExplicit,
      description: description ? String(description).trim() : null,
    });
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
            // S-08 修复：已有课程仅在 Excel 显式指定类型时才更新 type，防止默认值覆盖
            const { typeExplicit, ...updateFields } = r;
            if (!typeExplicit) delete updateFields.type;
            await tx.courses.update({ where: { id: existing.id }, data: updateFields });
            updated++;
          } else {
            // 新课程：移除 typeExplicit 标记后创建
            const { typeExplicit, ...createData } = r;
            await tx.courses.create({ data: createData });
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
