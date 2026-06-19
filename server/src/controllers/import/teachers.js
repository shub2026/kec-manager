import { prisma } from '../../lib/prisma.js';
import { success, fail } from '../../utils/response.js';
import { readWorkbook } from '../../utils/excel.js';
import { createAuditLog } from '../../services/audit.service.js';
import { ValidationError } from '../../utils/error.js';
import { log } from '../../utils/logger.js';
import { cleanupFile, sanitizeInput, sanitizeFormulaInjection } from '../import-shared.js';

/**
 * POST /api/import/teachers - 批量导入教师
 * 支持列：教师姓名、性别、出生年月、人员类别、状态、教师资格类型、特定周课时、学科、任课学院、任课层次、归属学院
 * 所有操作包裹在事务中，失败时自动回滚
 */
export async function importTeachers(req, res, next) {
  if (!req.file) throw new ValidationError('请上传文件');

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

  // 预加载课程、学院、培养层次数据
  let courses = await prisma.courses.findMany();
  const courseMap = {};
  courses.forEach((c) => { courseMap[c.name] = c.id; });

  let colleges = await prisma.colleges.findMany();
  const collegeMap = {};
  colleges.forEach((c) => { collegeMap[c.name] = c.id; });

  let levels = await prisma.training_levels.findMany();
  const levelMap = {};
  levels.forEach((l) => { levelMap[l.name] = l.id; });

  let autoCreatedCourses = 0;

  // 人员类别映射
  const personnelTypeMap = {
    '专职': 'full_time',
    '兼职': 'part_time',
    '外聘': 'external',
    'full_time': 'full_time',
    'part_time': 'part_time',
    'external': 'external',
  };

  // 性别映射
  const genderMap = {
    '男': 'male',
    '女': 'female',
    'male': 'male',
    'female': 'female',
  };

  // 收集所有待执行的教师操作（在事务中统一执行）
  const teacherOps = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const sanitizedRow = {};
    for (const [key, value] of Object.entries(row)) {
      sanitizedRow[key] = sanitizeFormulaInjection(sanitizeInput(value));
    }

    const name = sanitizedRow['教师姓名'];
    const genderRaw = sanitizedRow['性别'];
    const birthDate = sanitizedRow['出生年月'];
    const personnelTypeRaw = sanitizedRow['人员类别'];
    const qualificationType = sanitizedRow['教师资格类型'] || null;
    const defaultWeeklyHours = sanitizedRow['特定周课时'];
    const courseNamesStr = sanitizedRow['学科'] || '';
    const collegeNamesStr = sanitizedRow['任课学院'] || '';
    const levelNamesStr = sanitizedRow['任课层次'] || '';
    const affiliatedCollegeName = sanitizedRow['归属学院'] || '';
    const statusRaw = sanitizedRow['状态'] || '';

    // 解析状态
    const statusStr = String(statusRaw).trim();
    const status = (statusStr === '禁用' || statusStr === 'disabled') ? 'disabled' : 'active';

    if (!name) {
      errors.push(`第${i + 2}行：缺少教师姓名`);
      continue;
    }

    const personnelType = personnelTypeMap[String(personnelTypeRaw || '').trim()] || 'full_time';
    const gender = genderMap[String(genderRaw || '').trim()] || null;

    // 解析出生年月（存储为 YYYY-MM 格式）
    let birthDateStr = null;
    if (birthDate) {
      const raw = String(birthDate).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        birthDateStr = raw.substring(0, 7);          // "1990-01-15" → "1990-01"
      } else if (/^\d{4}-\d{2}$/.test(raw)) {
        birthDateStr = raw;                           // "1990-01" → "1990-01"
      } else if (/^\d{6}$/.test(raw)) {
        // 纯数字 YYYYMM 格式，如 199001 → "1990-01"
        const y = raw.substring(0, 4);
        const m = raw.substring(4, 6);
        const year = parseInt(y, 10);
        const month = parseInt(m, 10);
        if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12) {
          birthDateStr = `${y}-${m}`;
        }
      } else if (typeof birthDate === 'number' && birthDate > 1000 && birthDate < 100000) {
        // Excel 日期序列号（如 32874 = 1990-01-01），用 UTC 避免时区偏移
        const excelEpochUTC = Date.UTC(1899, 11, 30);
        const date = new Date(excelEpochUTC + birthDate * 86400000);
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        if (y >= 1900 && y <= 2100) {
          birthDateStr = `${y}-${m}`;
        }
      }
    }

    // 解析特定周课时
    let defHours = null;
    if (defaultWeeklyHours !== null && defaultWeeklyHours !== undefined && defaultWeeklyHours !== '') {
      const parsed = Number(defaultWeeklyHours);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 40) {
        defHours = parsed;
      }
    }

    // 解析归属学院
    let affiliatedCollegeId = null;
    if (affiliatedCollegeName) {
      const cName = String(affiliatedCollegeName).trim();
      affiliatedCollegeId = collegeMap[cName] || null;
    }

    // 解析学科（逗号分隔）
    const courseNames = String(courseNamesStr).split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    const courseIds = [];
    for (const cName of courseNames) {
      if (!courseMap[cName]) {
        const alreadyKnown = await prisma.courses.findFirst({ where: { name: cName } });
        if (!alreadyKnown) {
          const newCourse = await prisma.courses.create({
            data: { name: cName, sort_order: 0 },
          });
          courseMap[cName] = newCourse.id;
          autoCreatedCourses++;
        } else {
          courseMap[cName] = alreadyKnown.id;
        }
      }
      courseIds.push(courseMap[cName]);
    }

    // 解析任课学院（逗号分隔）
    const collegeNames = String(collegeNamesStr).split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    const collegeIds = [];
    for (const cName of collegeNames) {
      if (collegeMap[cName]) {
        collegeIds.push(collegeMap[cName]);
      }
    }

    // 解析任课层次（逗号分隔）
    const levelNames = String(levelNamesStr).split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    const levelIds = [];
    for (const lName of levelNames) {
      if (levelMap[lName]) {
        levelIds.push(levelMap[lName]);
      }
    }

    // 查找是否已存在同名教师
    const existing = await prisma.teachers.findFirst({
      where: { name: String(name).trim() },
    });

    if (existing) {
      // 收集更新操作（在事务中统一执行）
      teacherOps.push({
        type: 'update',
        teacherId: existing.id,
        data: {
          gender,
          birth_date: birthDateStr,
          personnel_type: personnelType,
          qualification_type: qualificationType,
          default_weekly_hours: defHours,
          affiliated_college_id: affiliatedCollegeId,
          status,
        },
        courseIds,
        collegeIds,
        levelIds,
      });
      overwritten++;
    } else {
      // 收集创建操作
      teacherOps.push({
        type: 'create',
        data: {
          name: String(name).trim(),
          gender,
          birth_date: birthDateStr,
          personnel_type: personnelType,
          qualification_type: qualificationType,
          default_weekly_hours: defHours,
          affiliated_college_id: affiliatedCollegeId,
          status,
          sort_order: 0,
          courses: courseIds.length > 0
            ? { create: courseIds.map(cid => ({ course_id: cid })) }
            : undefined,
          scheduling_colleges: collegeIds.length > 0
            ? { create: collegeIds.map(cid => ({ college_id: cid })) }
            : undefined,
          scheduling_levels: levelIds.length > 0
            ? { create: levelIds.map(lid => ({ training_level_id: lid })) }
            : undefined,
        },
      });
      imported++;
    }
  }

  try {
    if (errors.length > 0 && teacherOps.length === 0) {
      const result = {
        imported: 0,
        overwritten: 0,
        failed: errors.length,
        total: rows.length,
        errors,
        autoCreated: { courses: autoCreatedCourses },
      };

      await createAuditLog({
        action: 'import',
        module: 'teacher',
        userId: req.user?.id,
        details: result,
        result: 'failed',
        message: `教师导入验证失败: ${errors.length}条错误`,
      });

      return success(res, result, `验证失败：${errors.length}条错误`);
    }

    // 事务执行所有教师操作
    if (teacherOps.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const op of teacherOps) {
          if (op.type === 'update') {
            // 更新基本信息
            await tx.teachers.update({
              where: { id: op.teacherId },
              data: op.data,
            });
            // 重建课程关联
            await tx.teacher_courses.deleteMany({ where: { teacher_id: op.teacherId } });
            if (op.courseIds.length > 0) {
              await tx.teacher_courses.createMany({
                data: op.courseIds.map(cid => ({ teacher_id: op.teacherId, course_id: cid })),
              });
            }
            // 重建任课学院关联
            await tx.teacher_scheduling_colleges.deleteMany({ where: { teacher_id: op.teacherId } });
            if (op.collegeIds.length > 0) {
              await tx.teacher_scheduling_colleges.createMany({
                data: op.collegeIds.map(cid => ({ teacher_id: op.teacherId, college_id: cid })),
              });
            }
            // 重建任课层次关联
            await tx.teacher_training_levels.deleteMany({ where: { teacher_id: op.teacherId } });
            if (op.levelIds.length > 0) {
              await tx.teacher_training_levels.createMany({
                data: op.levelIds.map(lid => ({ teacher_id: op.teacherId, training_level_id: lid })),
              });
            }
          } else {
            // 创建新教师（含关联）
            await tx.teachers.create({ data: op.data });
          }
        }
      });
    }

    const result = {
      imported,
      overwritten,
      failed: errors.length,
      total: rows.length,
      errors,
      autoCreated: { courses: autoCreatedCourses },
    };
    let message = `导入完成：新增${imported}条`;
    if (overwritten > 0) message += `，覆盖${overwritten}条`;
    if (errors.length > 0) message += `，失败${errors.length}条`;
    if (autoCreatedCourses > 0) message += `（自动创建${autoCreatedCourses}门课程）`;

    await createAuditLog({
      action: 'import',
      module: 'teacher',
      userId: req.user?.id,
      details: result,
      result: (imported + overwritten) > 0 ? 'success' : 'failed',
      message,
    });

    success(res, result, message);
  } catch (e) {
    log.error('[教师导入] 事务执行失败，已回滚', { error: e.message, stack: e.stack });
    await createAuditLog({
      action: 'import',
      module: 'teacher',
      userId: req.user?.id,
      result: 'failed',
      message: `教师导入事务失败: ${e.message}`,
    });
    next(e);
  }
}
