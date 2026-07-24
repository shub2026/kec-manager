import { prisma } from '../../lib/prisma.js';
import { success, fail } from '../../utils/response.js';
import { readWorkbook } from '../../utils/excel.js';
import { createAuditLog } from '../../services/audit.service.js';
import { ValidationError } from '../../utils/error.js';
import { log } from '../../utils/logger.js';
import { cleanupFile, sanitizeInput, normalizePlaceholder, verifyExcelMagicNumber } from '../import-shared.js';
import { DEFAULT_TEXTBOOK_CATEGORY } from '../../constants/index.js';

/**
 * POST /api/import/textbooks - 批量导入教材
 */
export async function importTextbooks(req, res, next) {
  if (!req.file) throw new ValidationError('请上传文件');

  let rows;
  try {
    await verifyExcelMagicNumber(req.file.path);
    rows = await readWorkbook(req.file.path);
    cleanupFile(req.file.path);
  } catch (e) {
    cleanupFile(req.file.path);
    log.error('[教材导入] Excel文件读取失败', { error: e.message, stack: e.stack });
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

    const title = sanitizedRow['书名'];
    const isbn = normalizePlaceholder(sanitizedRow['书号']);
    const publisher = normalizePlaceholder(sanitizedRow['出版社']);
    const author = normalizePlaceholder(sanitizedRow['作者']);
    const edition = normalizePlaceholder(sanitizedRow['版次']);
    const publish_date = normalizePlaceholder(sanitizedRow['出版日期']);
    const priceRaw = normalizePlaceholder(sanitizedRow['定价']);
    const price = priceRaw ? Number(priceRaw) : null;
    const category = normalizePlaceholder(sanitizedRow['类别']);
    // 审计修复：读取"状态"列，与导出列对称，确保往返导入不丢失 is_active 状态
    const statusValue = sanitizedRow['状态'];
    const is_active = statusValue ? String(statusValue).trim() !== '停用' : true;

    if (!title) {
      validationErrors.push(`第${i + 2}行：缺少书名`);
      continue;
    }

    validRows.push({
      title: String(title).trim(),
      isbn: isbn ? String(isbn).trim() : null,
      publisher: publisher ? String(publisher).trim() : null,
      author: author ? String(author).trim() : null,
      edition: edition ? String(edition).trim() : null,
      publish_date: publish_date ? String(publish_date).trim() : null,
      price: price && !isNaN(price) ? price : null,
      // 归一化后 category 可能为 null，需显式判空后回退默认类别（避免 String(null) 产生字面 'null'）
      category: category ? String(category).trim() : DEFAULT_TEXTBOOK_CATEGORY,
      is_active,
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
        module: 'textbook',
        userId: req.user?.id,
        details: result,
        result: 'failed',
        message: `教材导入验证失败: ${validationErrors.length}条错误`,
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
          const existing = await tx.textbooks.findFirst({ where: { title: r.title } });
          if (existing) {
            await tx.textbooks.update({ where: { id: existing.id }, data: r });
            updated++;
          } else {
            await tx.textbooks.create({ data: r });
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
      module: 'textbook',
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
    log.error('[教材导入] 事务执行失败，已回滚', { error: e.message, stack: e.stack });

    await createAuditLog({
      action: 'import',
      module: 'textbook',
      userId: req.user?.id,
      result: 'failed',
      message: `教材导入事务失败: ${e.message}`,
    });

    next(e);
  }
}
