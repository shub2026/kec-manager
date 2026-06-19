import { prisma } from '../../lib/prisma.js';
import { success, fail } from '../../utils/response.js';
import { readWorkbook } from '../../utils/excel.js';
import { getCurrentSemesterInfo } from '../../services/settings.service.js';
import { createAuditLog } from '../../services/audit.service.js';
import { ValidationError } from '../../utils/error.js';
import { log } from '../../utils/logger.js';
import { cleanupFile, sanitizeInput, sanitizeFormulaInjection } from '../import-shared.js';

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
    const trainingLevelName = sanitizedRow['培养层次'];
    const studentCount = sanitizedRow['班级人数'];
    const statusValue = sanitizedRow['状态'];

    if (!name || !enrollmentYear || !durationYears || !trainingLevelName) {
      validationErrors.push(`第${i + 2}行：缺少必填字段（班级名称、入学年份、学制、培养层次）`);
      continue;
    }

    let trainingLevelId = levelMap[trainingLevelName];
    if (!trainingLevelId && trainingLevelName) {
      const levelName = String(trainingLevelName).trim();
      const upsertedLevel = await prisma.training_levels.upsert({
        where: { name: levelName },
        update: {},
        create: {
          name: levelName,
          code: null,
          description: `由班级导入自动创建 (${new Date().toLocaleString()})`,
          sort_order: 0,
        },
      });
      trainingLevelId = upsertedLevel.id;
      if (!levelMap[levelName]) {
        levelMap[levelName] = trainingLevelId;
        autoCreatedLevels++;
      }
    }
    if (!trainingLevelId) {
      validationErrors.push(`第${i + 2}行：培养层次不能为空`);
      continue;
    }

    let majorId = majorMap[majorName];
    if (!majorId && majorName) {
      const mName = String(majorName).trim();
      const upsertedMajor = await prisma.majors.upsert({
        where: { name: mName },
        update: {},
        create: {
          name: mName,
          code: null,
          description: `由班级导入自动创建 (${new Date().toLocaleString()})`,
          sort_order: 0,
        },
      });
      majorId = upsertedMajor.id;
      if (!majorMap[mName]) {
        majorMap[mName] = majorId;
        autoCreatedMajors++;
      }
    }

    let collegeId = collegeMap[collegeName];
    if (!collegeId && collegeName) {
      const cName = String(collegeName).trim();
      const upsertedCollege = await prisma.colleges.upsert({
        where: { name: cName },
        update: {},
        create: {
          name: cName,
          code: null,
          description: `由班级导入自动创建 (${new Date().toLocaleString()})`,
          sort_order: 0,
        },
      });
      collegeId = upsertedCollege.id;
      if (!collegeMap[cName]) {
        collegeMap[cName] = collegeId;
        autoCreatedColleges++;
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
    if (validationErrors.length > 0 && transactionOperations.length === 0) {
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
