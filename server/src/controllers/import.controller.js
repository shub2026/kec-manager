import multer from 'multer';
import fs from 'fs';
import xss from 'xss';
import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { readWorkbook } from '../utils/excel.js';
import { getCurrentSemesterInfo } from '../services/settings.service.js';
import { createAuditLog } from '../services/audit.service.js';
import { ValidationError } from '../utils/error.js';
import { log } from '../utils/logger.js';

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.(xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .xlsx 或 .xls 文件'));
    }
  },
});

function cleanupFile(path) {
  if (path) fs.unlink(path, () => {});
}

function sanitizeInput(value) {
  if (value === null || value === undefined) return value;
  const str = String(value).trim();
  return xss(str);
}

function sanitizeFormulaInjection(value) {
  if (value === null || value === undefined) return value;
  const str = String(value);
  if (/^[=+\-@]/.test(str)) {
    return "'" + str;
  }
  return str;
}

/**
 * POST /api/import/classes - 批量导入班级
 */
export async function importClasses(req, res, next) {
  if (!req.file) {
    throw new ValidationError('请上传文件');
  }
  
  let rows;
  try {
    rows = await readWorkbook(req.file.path);
    cleanupFile(req.file.path);
  } catch (e) {
    cleanupFile(req.file.path);
    throw new ValidationError('Excel文件读取失败: ' + e.message);
  }

  const errors = [];
  let imported = 0;
  let overwritten = 0;

  let majors = await prisma.majors.findMany();
  const majorMap = {};
  majors.forEach((m) => { majorMap[m.name] = m.id; });

  let levels = await prisma.training_levels.findMany();
  const levelMap = {};
  levels.forEach((l) => { levelMap[l.name] = l.id; });

  let colleges = await prisma.colleges.findMany();
  const collegeMap = {};
  colleges.forEach((c) => { collegeMap[c.name] = c.id; });

  let autoCreatedLevels = 0;
  let autoCreatedMajors = 0;
  let autoCreatedColleges = 0;

  const transactionOperations = [];
  const validationErrors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    const sanitizedRow = {};
    for (const [key, value] of Object.entries(row)) {
      sanitizedRow[key] = sanitizeFormulaInjection(sanitizeInput(value));
    }
    
    const name = sanitizedRow['班级名称'];
    const enrollmentYear = sanitizedRow['入学年份'];
    const durationYears = sanitizedRow['学制(年)'];
    const majorName = sanitizedRow['专业类别'];
    const collegeName = sanitizedRow['二级学院'];
    const trainingLevelName = row['培养层次'];
    const studentCount = row['班级人数'];
    const statusValue = row['状态'];

    if (!name || !enrollmentYear || !durationYears || !trainingLevelName) {
      validationErrors.push(`第${i + 2}行：缺少必填字段（班级名称、入学年份、学制、培养层次）`);
      continue;
    }

    let trainingLevelId = levelMap[trainingLevelName];
    if (!trainingLevelId && trainingLevelName) {
      try {
        const newLevel = await prisma.training_levels.create({
          data: {
            name: String(trainingLevelName).trim(),
            code: null,
            description: `由班级导入自动创建 (${new Date().toLocaleString()})`,
            sort_order: 0,
          },
        });
        trainingLevelId = newLevel.id;
        levelMap[trainingLevelName] = trainingLevelId;
        autoCreatedLevels++;
      } catch (e) {
        const existingLevel = await prisma.training_levels.findUnique({
          where: { name: String(trainingLevelName).trim() },
        });
        if (existingLevel) {
          trainingLevelId = existingLevel.id;
          levelMap[trainingLevelName] = trainingLevelId;
        } else {
          validationErrors.push(`第${i + 2}行：创建培养层次"${trainingLevelName}"失败`);
          continue;
        }
      }
    }
    if (!trainingLevelId) {
      validationErrors.push(`第${i + 2}行：培养层次不能为空`);
      continue;
    }

    let majorId = majorMap[majorName];
    if (!majorId && majorName) {
      try {
        const newMajor = await prisma.majors.create({
          data: {
            name: String(majorName).trim(),
            code: null,
            description: `由班级导入自动创建 (${new Date().toLocaleString()})`,
            sort_order: 0,
          },
        });
        majorId = newMajor.id;
        majorMap[majorName] = majorId;
        autoCreatedMajors++;
      } catch (e) {
        const existingMajor = await prisma.majors.findFirst({
          where: { name: String(majorName).trim() },
        });
        if (existingMajor) {
          majorId = existingMajor.id;
          majorMap[majorName] = majorId;
        }
      }
    }

    let collegeId = collegeMap[collegeName];
    if (!collegeId && collegeName) {
      try {
        const newCollege = await prisma.colleges.create({
          data: {
            name: String(collegeName).trim(),
            code: null,
            description: `由班级导入自动创建 (${new Date().toLocaleString()})`,
            sort_order: 0,
          },
        });
        collegeId = newCollege.id;
        collegeMap[collegeName] = collegeId;
        autoCreatedColleges++;
      } catch (e) {
        const existingCollege = await prisma.colleges.findUnique({
          where: { name: String(collegeName).trim() },
        });
        if (existingCollege) {
          collegeId = existingCollege.id;
          collegeMap[collegeName] = collegeId;
        }
      }
    }

    let status = 'active';
    if (statusValue) {
      const statusStr = String(statusValue).trim();
      if (statusStr === '已毕业' || statusStr === 'graduated') {
        status = 'graduated';
      } else if (statusStr === '在读' || statusStr === 'active') {
        status = 'active';
      }
    } else {
      const semesterInfo = await getCurrentSemesterInfo();
      const grade = semesterInfo ? (semesterInfo.startYear - Number(enrollmentYear) + 1) : null;
      status = grade !== null && grade <= Number(durationYears) ? 'active' : 'graduated';
    }

    const existingClass = await prisma.classes.findFirst({
      where: { name: String(name).trim() }
    });

    if (existingClass) {
      const updateData = {
        name: String(name).trim(),
        enrollment_year: Number(enrollmentYear),
        duration_years: Number(durationYears),
        student_count: studentCount ? Number(studentCount) : 0,
        status,
      };
      
      if (majorId) updateData.majors = { connect: { id: majorId } };
      if (collegeId) updateData.colleges = { connect: { id: collegeId } };
      if (trainingLevelId) updateData.training_levels = { connect: { id: trainingLevelId } };
      
      transactionOperations.push(
        prisma.classes.update({
          where: { id: existingClass.id },
          data: updateData,
        })
      );
      overwritten++;
    } else {
      const classData = {
        name: String(name).trim(),
        enrollment_year: Number(enrollmentYear),
        duration_years: Number(durationYears),
        student_count: studentCount ? Number(studentCount) : 0,
        status,
      };
      
      if (majorId) classData.majors = { connect: { id: majorId } };
      if (collegeId) classData.colleges = { connect: { id: collegeId } };
      if (trainingLevelId) classData.training_levels = { connect: { id: trainingLevelId } };
      
      transactionOperations.push(
        prisma.classes.create({
          data: classData,
        })
      );
      imported++;
    }
  }

  try {
    if (validationErrors.length > 0) {
      const result = {
        imported: 0,
        overwritten: 0,
        failed: validationErrors.length,
        total: rows.length,
        errors: validationErrors,
        autoCreated: {
          trainingLevels: autoCreatedLevels,
          majors: autoCreatedMajors,
          colleges: autoCreatedColleges,
        },
      };

      await createAuditLog({
        action: 'import',
        module: 'class',
        userId: req.user?.id,
        details: result,
        result: 'failed',
        message: `班级导入验证失败: ${validationErrors.length}条错误`,
      });

      return success(res, result, `验证失败：${validationErrors.length}条错误`);
    }

    if (transactionOperations.length > 0) {
      await prisma.$transaction(transactionOperations);
    }

    const result = {
      imported,
      overwritten,
      failed: validationErrors.length,
      total: rows.length,
      errors: validationErrors,
      autoCreated: {
        trainingLevels: autoCreatedLevels,
        majors: autoCreatedMajors,
        colleges: autoCreatedColleges,
      },
    };
    let message = `导入完成：新增${imported}条`;
    if (overwritten > 0) message += `，覆盖${overwritten}条`;
    if (validationErrors.length > 0) message += `，失败${validationErrors.length}条`;
    if (autoCreatedLevels > 0 || autoCreatedMajors > 0 || autoCreatedColleges > 0) {
      message += `（自动创建：${autoCreatedLevels}个层次、${autoCreatedMajors}个专业、${autoCreatedColleges}个学院）`;
    }

    await createAuditLog({
      action: 'import',
      module: 'class',
      userId: req.user?.id,
      details: {
        total: rows.length,
        imported,
        overwritten,
        failed: validationErrors.length,
        autoCreated: {
          trainingLevels: autoCreatedLevels,
          majors: autoCreatedMajors,
          colleges: autoCreatedColleges,
        },
      },
      result: (imported + overwritten) > 0 ? 'success' : 'failed',
      message: `导入完成：新增${imported}条，覆盖${overwritten}条，失败${validationErrors.length}条`,
    });

    success(res, result, message);
  } catch (e) {
    log.error('[班级导入] 事务执行失败，已回滚', { error: e.message, stack: e.stack });
    
    await createAuditLog({
      action: 'import',
      module: 'class',
      userId: req.user?.id,
      result: 'failed',
      message: `班级导入事务失败: ${e.message}`,
    });
    
    next(e);
  }
}

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
  let imported = 0;
  let overwritten = 0;

  const transactionOperations = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    const sanitizedRow = {};
    for (const [key, value] of Object.entries(row)) {
      sanitizedRow[key] = sanitizeFormulaInjection(sanitizeInput(value));
    }
    
    const name = sanitizedRow['课程名称'];
    const code = sanitizedRow['课程编码'] || null;
    const typeValue = sanitizedRow['课程类型'];
    const type = typeValue === '专业课' ? 'professional' : 'public';

    if (!name) {
      validationErrors.push(`第${i + 2}行：缺少课程名称`);
      continue;
    }

    const existingCourse = await prisma.courses.findFirst({
      where: { name: String(name).trim() }
    });

    if (existingCourse) {
      transactionOperations.push(
        prisma.courses.update({
          where: { id: existingCourse.id },
          data: {
            name: String(name).trim(),
            code: code ? String(code).trim() : null,
            type,
          },
        })
      );
      overwritten++;
    } else {
      transactionOperations.push(
        prisma.courses.create({
          data: {
            name: String(name).trim(),
            code: code ? String(code).trim() : null,
            type,
          },
        })
      );
      imported++;
    }
  }

  try {
    if (validationErrors.length > 0) {
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

    if (transactionOperations.length > 0) {
      await prisma.$transaction(transactionOperations);
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
      result: (imported + overwritten) > 0 ? 'success' : 'failed',
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

/**
 * POST /api/import/textbooks - 批量导入教材
 */
export async function importTextbooks(req, res, next) {
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
  let imported = 0;
  let overwritten = 0;

  const transactionOperations = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    const sanitizedRow = {};
    for (const [key, value] of Object.entries(row)) {
      sanitizedRow[key] = sanitizeFormulaInjection(sanitizeInput(value));
    }
    
    const title = sanitizedRow['书名'];
    const isbn = sanitizedRow['书号'] || null;
    const publisher = sanitizedRow['出版社'] || null;
    const author = sanitizedRow['作者'] || null;
    const edition = sanitizedRow['版次'] || null;
    const publish_date = sanitizedRow['出版日期'] || null;
    const price = sanitizedRow['定价'] ? Number(sanitizedRow['定价']) : null;
    const category = sanitizedRow['类别'] || null;

    if (!title) {
      validationErrors.push(`第${i + 2}行：缺少书名`);
      continue;
    }

    const existingTextbook = await prisma.textbooks.findFirst({
      where: { title: String(title).trim() }
    });

    if (existingTextbook) {
      transactionOperations.push(
        prisma.textbooks.update({
          where: { id: existingTextbook.id },
          data: {
            title: String(title).trim(),
            isbn: isbn ? String(isbn).trim() : null,
            publisher: publisher ? String(publisher).trim() : null,
            author: author ? String(author).trim() : null,
            edition: edition ? String(edition).trim() : null,
            publish_date: publish_date ? String(publish_date).trim() : null,
            price: price && !isNaN(price) ? price : null,
            category: String(category).trim() || '技工',
          },
        })
      );
      overwritten++;
    } else {
      transactionOperations.push(
        prisma.textbooks.create({
          data: {
            title: String(title).trim(),
            isbn: isbn ? String(isbn).trim() : null,
            publisher: publisher ? String(publisher).trim() : null,
            author: author ? String(author).trim() : null,
            edition: edition ? String(edition).trim() : null,
            publish_date: publish_date ? String(publish_date).trim() : null,
            price: price && !isNaN(price) ? price : null,
            category: String(category).trim() || '技工',
          },
        })
      );
      imported++;
    }
  }

  try {
    if (validationErrors.length > 0) {
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

    if (transactionOperations.length > 0) {
      await prisma.$transaction(transactionOperations);
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
      result: (imported + overwritten) > 0 ? 'success' : 'failed',
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

// 导出multer中间件供路由使用
export { upload };
