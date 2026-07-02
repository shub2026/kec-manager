import { prisma } from '../../lib/prisma.js';
import { success, fail } from '../../utils/response.js';
import { readWorkbook } from '../../utils/excel.js';
import { createAuditLog } from '../../services/audit.service.js';
import { ValidationError } from '../../utils/error.js';
import { log } from '../../utils/logger.js';
import { cleanupFile, sanitizeInput, verifyExcelMagicNumber } from '../import-shared.js';

/**
 * POST /api/import/teachers - 批量导入教师
 * 支持列：教师姓名、性别、出生年月、人员类别、状态、教师资格类型、特定周课时、学科、任课学院、任课层次、归属学院
 * 所有操作包裹在事务中，失败时自动回滚
 */
export async function importTeachers(req, res, next) {
  if (!req.file) throw new ValidationError('请上传文件');

  let rows;
  try {
    await verifyExcelMagicNumber(req.file.path);
    rows = await readWorkbook(req.file.path);
    cleanupFile(req.file.path);
  } catch (e) {
    cleanupFile(req.file.path);
    log.error('[教师导入] Excel文件读取失败', { error: e.message, stack: e.stack });
    throw new ValidationError('Excel文件读取失败，请检查文件格式');
  }

  const errors = [];
  let imported = 0;
  let overwritten = 0;

  // 预加载课程、学院、培养层次数据
  let courses = await prisma.courses.findMany();
  const courseMap = {};
  courses.forEach((c) => {
    courseMap[c.name] = c.id;
  });

  let colleges = await prisma.colleges.findMany();
  const collegeMap = {};
  colleges.forEach((c) => {
    collegeMap[c.name] = c.id;
  });

  let levels = await prisma.training_levels.findMany();
  const levelMap = {};
  levels.forEach((l) => {
    levelMap[l.name] = l.id;
  });

  let autoCreatedCourses = 0;
  let autoCreatedColleges = 0;
  let autoCreatedLevels = 0;
  const pendingCollegeNames = new Set();
  const pendingLevelNames = new Set();

  // 人员类别映射
  const personnelTypeMap = {
    专职: 'full_time',
    兼职: 'part_time',
    外聘: 'external',
    full_time: 'full_time',
    part_time: 'part_time',
    external: 'external',
  };

  // 性别映射
  const genderMap = {
    男: 'male',
    女: 'female',
    male: 'male',
    female: 'female',
  };

  // 收集所有待执行的教师操作（在事务中统一执行）
  const teacherOps = [];

  // H-8: 预加载教师数据，避免循环内 N+1 查询
  const importNames = new Set();
  for (const row of rows) {
    const n = sanitizeInput(row['教师姓名']);
    if (n) importNames.add(String(n).trim());
  }
  const existingTeachersByName = new Map();
  if (importNames.size > 0) {
    const existingTeachers = await prisma.teachers.findMany({
      where: { name: { in: [...importNames] } },
      select: { id: true, name: true },
    });
    for (const t of existingTeachers) {
      if (!existingTeachersByName.has(t.name)) {
        existingTeachersByName.set(t.name, []);
      }
      existingTeachersByName.get(t.name).push(t);
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const sanitizedRow = {};
    for (const [key, value] of Object.entries(row)) {
      sanitizedRow[key] = sanitizeInput(value);
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

    // S-07 修复：检测任课学院/任课层次列是否有实际内容，空列时保留现有关联
    const hasCollegeCol = !!String(sanitizedRow['任课学院'] || '').trim();
    const hasLevelCol = !!String(sanitizedRow['任课层次'] || '').trim();
    const hasCourseCol = !!String(sanitizedRow['学科'] || '').trim();

    // 解析状态
    const statusStr = String(statusRaw).trim();
    const status = statusStr === '禁用' || statusStr === 'disabled' ? 'disabled' : 'active';

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
        birthDateStr = raw.substring(0, 7); // "1990-01-15" → "1990-01"
      } else if (/^\d{4}-\d{2}$/.test(raw)) {
        birthDateStr = raw; // "1990-01" → "1990-01"
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
    if (
      defaultWeeklyHours !== null &&
      defaultWeeklyHours !== undefined &&
      defaultWeeklyHours !== ''
    ) {
      const parsed = Number(defaultWeeklyHours);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 40) {
        defHours = parsed;
      }
    }

    // 解析归属学院
    let affiliatedCollegeId = null;
    if (affiliatedCollegeName) {
      const cName = String(affiliatedCollegeName).trim();
      if (collegeMap[cName]) {
        affiliatedCollegeId = collegeMap[cName];
      } else {
        pendingCollegeNames.add(cName);
      }
    }

    // 解析学科（逗号分隔）
    const courseNames = String(courseNamesStr)
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean);
    // 收集课程名（已知课程的 ID 已在 courseMap，未知课程名待事务内创建）
    const resolvedCourseIds = [];
    const pendingNewCourseNames = [];
    for (const cName of courseNames) {
      if (courseMap[cName]) {
        resolvedCourseIds.push(courseMap[cName]);
      } else {
        pendingNewCourseNames.push(cName);
      }
    }

    // 解析任课学院（逗号分隔），未知学院名收集到 pendingCollegeNames 待事务内自动创建
    const collegeNames = String(collegeNamesStr)
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const cName of collegeNames) {
      if (!collegeMap[cName]) pendingCollegeNames.add(cName);
    }

    // 解析任课层次（逗号分隔），未知层次名收集到 pendingLevelNames 待事务内自动创建
    const levelNames = String(levelNamesStr)
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const lName of levelNames) {
      if (!levelMap[lName]) pendingLevelNames.add(lName);
    }

    // H-8: 使用预加载的教师索引替代逐行 DB 查询
    const sameNameTeachers = existingTeachersByName.get(String(name).trim()) || [];

    if (sameNameTeachers.length > 1) {
      // 同名教师多条，跳过避免张冠李戴（M-8 修复）
      errors.push(
        `第${i + 2}行：存在${sameNameTeachers.length}个同名教师"${name}"，请先合并或区分后导入`
      );
      continue;
    }

    if (sameNameTeachers.length === 1) {
      const existing = sameNameTeachers[0];
      // 收集更新操作（在事务中统一执行）
      teacherOps.push({
        type: 'update',
        teacherId: existing.id,
        name: String(name).trim(),
        data: {
          gender,
          birth_date: birthDateStr,
          personnel_type: personnelType,
          qualification_type: qualificationType,
          default_weekly_hours: defHours,
          affiliated_college_id: affiliatedCollegeId,
          status,
        },
        resolvedCourseIds,
        pendingNewCourseNames,
        collegeNames,
        levelNames,
        affiliatedCollegeName: affiliatedCollegeName ? String(affiliatedCollegeName).trim() : null,
        hasCollegeCol,
        hasLevelCol,
        hasCourseCol,
      });
      overwritten++;
    } else {
      // 收集创建操作（课程/学院/层次关联在事务内解析，确保待建实体 ID 可用）
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
        },
        resolvedCourseIds,
        pendingNewCourseNames,
        collegeNames,
        levelNames,
        affiliatedCollegeName: affiliatedCollegeName ? String(affiliatedCollegeName).trim() : null,
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
        autoCreated: {
          courses: autoCreatedCourses,
          colleges: autoCreatedColleges,
          levels: autoCreatedLevels,
        },
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

    // 事务执行所有教师操作（含课程/学院/层次 auto-create，确保回滚一致，H-13 修复）
    if (teacherOps.length > 0) {
      await prisma.$transaction(async (tx) => {
        // 1. 在事务内创建所有待建基础数据，更新 Map
        const allPendingCourseNames = [
          ...new Set(teacherOps.flatMap((op) => op.pendingNewCourseNames || [])),
        ];
        const allPendingCollegeNames = [...pendingCollegeNames];
        const allPendingLevelNames = [...pendingLevelNames];

        for (const cName of allPendingCourseNames) {
          const existing = await tx.courses.findFirst({ where: { name: cName } });
          if (existing) {
            courseMap[cName] = existing.id;
          } else {
            const newCourse = await tx.courses.create({ data: { name: cName, sort_order: 0 } });
            courseMap[cName] = newCourse.id;
            autoCreatedCourses++;
          }
        }

        for (const cName of allPendingCollegeNames) {
          const existing = await tx.colleges.findUnique({ where: { name: cName } });
          if (existing) {
            collegeMap[cName] = existing.id;
          } else {
            const created = await tx.colleges.create({
              data: {
                name: cName,
                code: null,
                description: `由教师导入自动创建 (${new Date().toLocaleString()})`,
                sort_order: 0,
              },
            });
            collegeMap[cName] = created.id;
            autoCreatedColleges++;
          }
        }

        for (const lName of allPendingLevelNames) {
          const existing = await tx.training_levels.findFirst({ where: { name: lName } });
          if (existing) {
            levelMap[lName] = existing.id;
          } else {
            const created = await tx.training_levels.create({
              data: {
                name: lName,
                description: `由教师导入自动创建 (${new Date().toLocaleString()})`,
                sort_order: 0,
              },
            });
            levelMap[lName] = created.id;
            autoCreatedLevels++;
          }
        }

        // 1c 修复：事务内重新校验同名教师，避免预加载与事务执行之间的竞态
        const recheckNames = [
          ...new Set(
            teacherOps.map((op) => (op.type === 'create' ? op.data.name : op.name)).filter(Boolean)
          ),
        ];
        const freshTeachersByName = new Map();
        if (recheckNames.length > 0) {
          const freshTeachers = await tx.teachers.findMany({
            where: { name: { in: recheckNames } },
            select: { id: true, name: true },
          });
          for (const t of freshTeachers) {
            if (!freshTeachersByName.has(t.name)) freshTeachersByName.set(t.name, []);
            freshTeachersByName.get(t.name).push(t);
          }
        }

        // 2. 处理教师操作
        for (const op of teacherOps) {
          // 1c 修复：事务内重新校验同名教师
          const opName = op.type === 'create' ? op.data.name : op.name;
          const freshSameName = freshTeachersByName.get(opName) || [];
          if (op.type === 'update') {
            if (freshSameName.length > 1) {
              errors.push(
                `教师"${opName}"：存在${freshSameName.length}个同名教师，请先合并或区分后导入`
              );
              overwritten--;
              continue;
            }
            if (freshSameName.length === 0 || freshSameName[0].id !== op.teacherId) {
              errors.push(`教师"${opName}"：原记录已变更，已跳过`);
              overwritten--;
              continue;
            }
          } else {
            if (freshSameName.length > 0) {
              errors.push(`教师"${opName}"：同名教师已存在，已跳过`);
              imported--;
              continue;
            }
          }
          // 合并已知课程 ID 与新建课程 ID
          const allCourseIds = [
            ...(op.resolvedCourseIds || []),
            ...(op.pendingNewCourseNames || []).map((n) => courseMap[n]).filter(Boolean),
          ];

          // 重新解析归属学院 ID（可能刚被自动创建）
          if (op.affiliatedCollegeName && !op.data.affiliated_college_id) {
            op.data.affiliated_college_id = collegeMap[op.affiliatedCollegeName] || null;
          }

          // 重新解析任课学院 ID
          const collegeIds = (op.collegeNames || []).map((n) => collegeMap[n]).filter(Boolean);

          // 重新解析任课层次 ID
          const levelIds = (op.levelNames || []).map((n) => levelMap[n]).filter(Boolean);

          if (op.type === 'update') {
            // 更新基本信息
            await tx.teachers.update({
              where: { id: op.teacherId },
              data: op.data,
            });
            // 重建课程关联（H3 修复：仅当 Excel 学科列有内容时才覆盖，与任课学院/层次守卫一致）
            if (op.hasCourseCol) {
              // 重建 teacher_courses 前级联清理 teaching_assignments（与 updateTeacher 逻辑对齐）
              const newCourseIdSet = new Set(allCourseIds.map((cid) => Number(cid)));
              const existingTeacherCourses = await tx.teacher_courses.findMany({
                where: { teacher_id: op.teacherId },
                select: { course_id: true },
              });
              const removedCourseIds = existingTeacherCourses
                .map((tc) => tc.course_id)
                .filter((cid) => !newCourseIdSet.has(cid));
              if (removedCourseIds.length > 0) {
                await tx.teaching_assignments.deleteMany({
                  where: { teacher_id: op.teacherId, course_id: { in: removedCourseIds } },
                });
              }
              await tx.teacher_courses.deleteMany({ where: { teacher_id: op.teacherId } });
              if (allCourseIds.length > 0) {
                await tx.teacher_courses.createMany({
                  data: allCourseIds.map((cid) => ({ teacher_id: op.teacherId, course_id: cid })),
                });
              }
            }
            // 重建任课学院关联（S-07 修复：仅当 Excel 列有内容时才覆盖）
            if (op.hasCollegeCol) {
              await tx.teacher_scheduling_colleges.deleteMany({
                where: { teacher_id: op.teacherId },
              });
              if (collegeIds.length > 0) {
                await tx.teacher_scheduling_colleges.createMany({
                  data: collegeIds.map((cid) => ({ teacher_id: op.teacherId, college_id: cid })),
                });
              }
            }
            // 重建任课层次关联（S-07 修复：仅当 Excel 列有内容时才覆盖）
            if (op.hasLevelCol) {
              await tx.teacher_training_levels.deleteMany({ where: { teacher_id: op.teacherId } });
              if (levelIds.length > 0) {
                await tx.teacher_training_levels.createMany({
                  data: levelIds.map((lid) => ({
                    teacher_id: op.teacherId,
                    training_level_id: lid,
                  })),
                });
              }
            }
          } else {
            // 创建新教师（含课程/学院/层次关联）
            const createData = { ...op.data };
            if (allCourseIds.length > 0) {
              createData.courses = { create: allCourseIds.map((cid) => ({ course_id: cid })) };
            }
            if (collegeIds.length > 0) {
              createData.scheduling_colleges = {
                create: collegeIds.map((cid) => ({ college_id: cid })),
              };
            }
            if (levelIds.length > 0) {
              createData.scheduling_levels = {
                create: levelIds.map((lid) => ({ training_level_id: lid })),
              };
            }
            await tx.teachers.create({ data: createData });
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
      autoCreated: {
        courses: autoCreatedCourses,
        colleges: autoCreatedColleges,
        levels: autoCreatedLevels,
      },
    };
    let message = `导入完成：新增${imported}条`;
    if (overwritten > 0) message += `，覆盖${overwritten}条`;
    if (errors.length > 0) message += `，失败${errors.length}条`;
    const autoCreatedParts = [];
    if (autoCreatedCourses > 0) autoCreatedParts.push(`${autoCreatedCourses}门课程`);
    if (autoCreatedColleges > 0) autoCreatedParts.push(`${autoCreatedColleges}个学院`);
    if (autoCreatedLevels > 0) autoCreatedParts.push(`${autoCreatedLevels}个培养层次`);
    if (autoCreatedParts.length > 0) message += `（自动创建${autoCreatedParts.join('、')}）`;

    await createAuditLog({
      action: 'import',
      module: 'teacher',
      userId: req.user?.id,
      details: result,
      result: imported + overwritten > 0 ? 'success' : 'failed',
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
