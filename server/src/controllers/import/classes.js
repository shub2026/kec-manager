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

  // 待建基础数据名（事务内统一创建）与班级操作描述
  const pendingLevelNames = new Set();
  const pendingMajorNames = new Set();
  const pendingCollegeNames = new Set();
  const classOps = [];
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

    // 行级数值范围校验，与单条 API 一致（H-2 修复）
    const ey = Number(enrollmentYear);
    const dy = Number(durationYears);
    const sc = studentCount ? Number(studentCount) : 0;
    if (!Number.isFinite(ey) || ey < 2000 || ey > 2100) {
      validationErrors.push(`第${i + 2}行：入学年份必须在2000-2100之间`);
      continue;
    }
    if (!Number.isFinite(dy) || dy < 1 || dy > 10) {
      validationErrors.push(`第${i + 2}行：学制必须在1-10年之间`);
      continue;
    }
    if (!Number.isFinite(sc) || sc < 0 || sc > 999) {
      validationErrors.push(`第${i + 2}行：班级人数必须在0-999之间`);
      continue;
    }

    // 记录待建基础数据名（事务内统一创建，避免回滚后残留孤儿，H-13 修复）
    if (trainingLevelName && !levelMap[trainingLevelName] && !pendingLevelNames.has(trainingLevelName)) {
      pendingLevelNames.add(trainingLevelName);
    }
    if (majorName && !majorMap[majorName] && !pendingMajorNames.has(majorName)) {
      pendingMajorNames.add(majorName);
    }
    if (collegeName && !collegeMap[collegeName] && !pendingCollegeNames.has(collegeName)) {
      pendingCollegeNames.add(collegeName);
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

    // 收集班级操作描述（含原始名，事务内解析 ID）
    classOps.push({
      name: String(name).trim(),
      enrollmentYear: ey,
      durationYears: dy,
      studentCount: sc,
      status,
      majorName: majorName || null,
      collegeName: collegeName || null,
      trainingLevelName: trainingLevelName || null,
    });
  }

  try {
    if (validationErrors.length > 0 && classOps.length === 0) {
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

    // 交互式事务：先创建基础数据，再处理班级，确保回滚一致（H-13 修复）
    if (classOps.length > 0) {
      await prisma.$transaction(async (tx) => {
        // 1. 事务内创建待建基础数据
        for (const levelName of pendingLevelNames) {
          const existing = await tx.training_levels.findUnique({ where: { name: levelName } });
          if (existing) {
            levelMap[levelName] = existing.id;
          } else {
            const created = await tx.training_levels.create({
              data: { name: levelName, code: null, description: `由班级导入自动创建 (${new Date().toLocaleString()})`, sort_order: 0 },
            });
            levelMap[levelName] = created.id;
            autoCreatedLevels++;
          }
        }
        for (const majorName of pendingMajorNames) {
          const existing = await tx.majors.findUnique({ where: { name: majorName } });
          if (existing) {
            majorMap[majorName] = existing.id;
          } else {
            const created = await tx.majors.create({
              data: { name: majorName, code: null, description: `由班级导入自动创建 (${new Date().toLocaleString()})`, sort_order: 0 },
            });
            majorMap[majorName] = created.id;
            autoCreatedMajors++;
          }
        }
        for (const collegeName of pendingCollegeNames) {
          const existing = await tx.colleges.findUnique({ where: { name: collegeName } });
          if (existing) {
            collegeMap[collegeName] = existing.id;
          } else {
            const created = await tx.colleges.create({
              data: { name: collegeName, code: null, description: `由班级导入自动创建 (${new Date().toLocaleString()})`, sort_order: 0 },
            });
            collegeMap[collegeName] = created.id;
            autoCreatedColleges++;
          }
        }

        // 2. 处理班级操作
        for (const op of classOps) {
          const existingClass = await tx.classes.findFirst({ where: { name: op.name } });
          const majorId = op.majorName ? majorMap[op.majorName] : null;
          const collegeId = op.collegeName ? collegeMap[op.collegeName] : null;
          const trainingLevelId = op.trainingLevelName ? levelMap[op.trainingLevelName] : null;

          if (existingClass) {
            const updateData = {
              name: op.name,
              enrollment_year: op.enrollmentYear,
              duration_years: op.durationYears,
              student_count: op.studentCount,
              status: op.status,
            };
            if (majorId) updateData.majors = { connect: { id: majorId } };
            if (collegeId) updateData.colleges = { connect: { id: collegeId } };
            if (trainingLevelId) updateData.training_levels = { connect: { id: trainingLevelId } };
            await tx.classes.update({ where: { id: existingClass.id }, data: updateData });
            overwritten++;
          } else {
            const classData = {
              name: op.name,
              enrollment_year: op.enrollmentYear,
              duration_years: op.durationYears,
              student_count: op.studentCount,
              status: op.status,
            };
            if (majorId) classData.majors = { connect: { id: majorId } };
            if (collegeId) classData.colleges = { connect: { id: collegeId } };
            if (trainingLevelId) classData.training_levels = { connect: { id: trainingLevelId } };
            await tx.classes.create({ data: classData });
            imported++;
          }
        }
      });
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
