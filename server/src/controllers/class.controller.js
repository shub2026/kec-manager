import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { NotFoundError, ValidationError } from '../utils/error.js';
import { getCurrentSemesterInfo, getSemesterStartMonth } from '../services/settings.service.js';
import { getActiveClassFilter, invalidateDurationCache } from '../services/class.service.js';
import { buildClassFilter } from '../services/class-filter.service.js';
import { findBestMatchPlan } from '../services/plan.service.js';

function calculateClassStatus(enrollmentYear, durationYears, semesterInfo = null, semesterStartMonth = 8) {
  let startYear;

  if (semesterInfo && semesterInfo.startYear) {
    startYear = semesterInfo.startYear;
  } else if (semesterInfo && semesterInfo.value) {
    startYear = Number(semesterInfo.value.split('-')[0]);
  } else {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    // B-04 修复：使用可配置的学期边界月份替代硬编码 8
    startYear = currentMonth >= semesterStartMonth ? currentYear : currentYear - 1;
  }

  const grade = startYear - enrollmentYear + 1;
  return grade <= durationYears ? 'active' : 'graduated';
}

export async function getClassStats(req, res, next) {
  try {
    const activeFilter = await getActiveClassFilter();
    const activeClasses = await prisma.classes.findMany({
      where: activeFilter,
      select: { student_count: true },
    });

    const totalClasses = activeClasses.length;
    const totalStudents = activeClasses.reduce((sum, c) => sum + (c.student_count || 0), 0);

    success(res, { totalClasses, totalStudents });
  } catch (e) {
    next(e);
  }
}

export async function listClasses(req, res, next) {
  try {
    const { page, page_size } = req.query;
    const pageNum = page ? Number(page) : 1;
    const pageSizeNum = page_size ? Number(page_size) : 20;

    const filterResult = await buildClassFilter(req.query);
    if (filterResult.planNotFound) {
      return success(res, { items: [], total: 0 });
    }
    const finalWhere = filterResult.where;

    const total = await prisma.classes.count({ where: finalWhere });

    const classes = await prisma.classes.findMany({
      where: finalWhere,
      include: {
        majors: { select: { id: true, name: true } },
        colleges: { select: { id: true, name: true } },
        training_levels: { select: { id: true, name: true } },
        training_plans: { select: { id: true, name: true } },
      },
      orderBy: { id: 'asc' },
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    });

    const semesterInfo = await getCurrentSemesterInfo();
    const semesterStartMonth = await getSemesterStartMonth();

    // 预加载所有培养方案，用于自动匹配
    // 注意：必须 select created_at，findBestMatchPlan 按 created_at 降序排序以保证多匹配时取最新方案的确定性
    const allPlans = await prisma.training_plans.findMany({
      select: {
        id: true,
        name: true,
        major_id: true,
        training_level_id: true,
        created_at: true,
      },
    });

    const classesWithDynamicStatus = classes.map((cls) => {
      let status;
      if (cls.is_left_school) {
        status = 'left_school';
      } else if (cls.enrollment_year && cls.duration_years) {
        status = calculateClassStatus(cls.enrollment_year, cls.duration_years, semesterInfo, semesterStartMonth);
      } else {
        // P2-5: enrollment_year/duration_years 缺失时兜底为 active，避免 status 为 undefined
        status = 'active';
      }

      // 计算匹配的培养方案名称
      let matchedPlanName = null;
      let matchedPlanType = null; // 实际匹配类型：custom / major / level
      let planMatchWarning = null; // 交叉匹配警告

      if (cls.custom_plan_id && cls.training_plans) {
        // 有自定义方案
        matchedPlanName = cls.training_plans.name;
        matchedPlanType = 'custom';
      } else {
        // C1 修复：使用 findBestMatchPlan 选定最佳方案（major > level 优先级，与排课算法一致）
        // 构建 classPlanMap 以与 queries.js / assignTeacher 口径一致（此处 classes 已含 custom_plan_id 但
        // 上面 custom 分支已处理，进入 else 分支的班级无 custom_plan_id，classPlanMap 为空 Map 等价于不传）
        const classPlanMap = new Map();
        const bestPlan = findBestMatchPlan(cls, allPlans, classPlanMap);

        if (bestPlan) {
          matchedPlanName = bestPlan.name;
          // 根据方案实际字段判断匹配类型，而非根据班级自身字段
          matchedPlanType = bestPlan.major_id ? 'major' : bestPlan.training_level_id ? 'level' : null;

          // 检测是否存在专业和层次同时匹配的情况（交叉匹配）
          const majorMatchedPlans = allPlans.filter(
            (p) => p.major_id && cls.major_id && p.major_id === cls.major_id
          );
          const levelMatchedPlans = allPlans.filter(
            (p) =>
              p.training_level_id &&
              cls.training_level_id &&
              p.training_level_id === cls.training_level_id
          );

          if (majorMatchedPlans.length > 0 && levelMatchedPlans.length > 0) {
            const majorNames = majorMatchedPlans.map((p) => p.name);
            const levelNames = levelMatchedPlans.map((p) => p.name);
            planMatchWarning = `专业层次交叉，请检查：按专业匹配(${majorNames.join('、')})，按层次匹配(${levelNames.join('、')})`;
          }
        }
      }

      return {
        ...cls,
        status,
        matchedPlanName, // 添加匹配的方案名称
        matchedPlanType, // 添加实际匹配类型（custom/major/level）
        planMatchWarning, // 添加交叉匹配警告
      };
    });

    // H-10: 合并 7 次班级查询为单次查询，从结果集推导所有关联映射
    // B-12 设计说明：关联映射（学院-专业、学院-层次等）从全量班级构建，而非当前筛选结果。
    // 这是有意为之——级联筛选下拉框的选项应保持稳定，不随当前页面/筛选条件变化，
    // 否则用户每切换一次筛选条件，下拉选项就会变动，体验极差。
    const allClassesForMappings = await prisma.classes.findMany({
      select: {
        college_id: true,
        major_id: true,
        training_level_id: true,
        enrollment_year: true,
      },
    });

    const enrollmentYearSet = new Set();
    const collegeMajorMap = new Map();
    const collegeLevelMap = new Map();
    const majorLevelMap = new Map();
    const collegeYearMap = new Map();
    const majorYearMap = new Map();
    const levelYearMap = new Map();

    for (const cls of allClassesForMappings) {
      if (cls.enrollment_year != null) enrollmentYearSet.add(cls.enrollment_year);

      if (cls.college_id != null && cls.major_id != null) {
        if (!collegeMajorMap.has(cls.college_id)) collegeMajorMap.set(cls.college_id, new Set());
        collegeMajorMap.get(cls.college_id).add(cls.major_id);
      }
      if (cls.college_id != null && cls.training_level_id != null) {
        if (!collegeLevelMap.has(cls.college_id)) collegeLevelMap.set(cls.college_id, new Set());
        collegeLevelMap.get(cls.college_id).add(cls.training_level_id);
      }
      if (cls.major_id != null && cls.training_level_id != null) {
        if (!majorLevelMap.has(cls.major_id)) majorLevelMap.set(cls.major_id, new Set());
        majorLevelMap.get(cls.major_id).add(cls.training_level_id);
      }
      if (cls.college_id != null && cls.enrollment_year != null) {
        if (!collegeYearMap.has(cls.college_id)) collegeYearMap.set(cls.college_id, new Set());
        collegeYearMap.get(cls.college_id).add(cls.enrollment_year);
      }
      if (cls.major_id != null && cls.enrollment_year != null) {
        if (!majorYearMap.has(cls.major_id)) majorYearMap.set(cls.major_id, new Set());
        majorYearMap.get(cls.major_id).add(cls.enrollment_year);
      }
      if (cls.training_level_id != null && cls.enrollment_year != null) {
        if (!levelYearMap.has(cls.training_level_id))
          levelYearMap.set(cls.training_level_id, new Set());
        levelYearMap.get(cls.training_level_id).add(cls.enrollment_year);
      }
    }

    const allEnrollmentYears = [...enrollmentYearSet].sort((a, b) => b - a);

    // 辅助：将 Map<K, Set<V>> 转为普通对象（年份降序，其他保持插入顺序）
    const mapToObj = (map, sortFn) => {
      const obj = {};
      for (const [k, s] of map) obj[k] = sortFn ? [...s].sort(sortFn) : [...s];
      return obj;
    };

    const collegeMajorRelation = mapToObj(collegeMajorMap);
    const collegeLevelRelation = mapToObj(collegeLevelMap);
    const majorLevelRelation = mapToObj(majorLevelMap);
    const collegeYearRelation = mapToObj(collegeYearMap, (a, b) => b - a);
    const majorYearRelation = mapToObj(majorYearMap, (a, b) => b - a);
    const levelYearRelation = mapToObj(levelYearMap, (a, b) => b - a);

    // 培养方案关联映射（独立查询，因为是不同表）
    const planCollegeMap = new Map();
    const planMajorMap = new Map();
    const planLevelMap = new Map();
    const allPlansForMapping = await prisma.training_plans.findMany({
      select: { id: true, college_id: true, major_id: true, training_level_id: true },
    });

    for (const plan of allPlansForMapping) {
      if (plan.college_id != null && (plan.major_id != null || plan.training_level_id != null)) {
        if (!planCollegeMap.has(plan.college_id)) {
          planCollegeMap.set(plan.college_id, new Set());
        }
        planCollegeMap.get(plan.college_id).add(plan.id);
      }
      if (plan.major_id) {
        if (!planMajorMap.has(plan.major_id)) {
          planMajorMap.set(plan.major_id, new Set());
        }
        planMajorMap.get(plan.major_id).add(plan.id);
      }
      if (plan.training_level_id) {
        if (!planLevelMap.has(plan.training_level_id)) {
          planLevelMap.set(plan.training_level_id, new Set());
        }
        planLevelMap.get(plan.training_level_id).add(plan.id);
      }
    }

    const planCollegeRelation = mapToObj(planCollegeMap);
    const planMajorRelation = mapToObj(planMajorMap);
    const planLevelRelation = mapToObj(planLevelMap);

    success(res, {
      items: classesWithDynamicStatus,
      total,
      allEnrollmentYears,
      collegeMajorRelation, // 学院-专业关联
      collegeLevelRelation, // 学院-层次关联
      majorLevelRelation, // 专业-层次关联
      collegeYearRelation, // 学院-入学年份关联
      majorYearRelation, // 专业-入学年份关联
      levelYearRelation, // 层次-入学年份关联
      planCollegeRelation, // 培养方案-学院关联
      planMajorRelation, // 培养方案-专业关联
      planLevelRelation, // 培养方案-层次关联
    });
  } catch (e) {
    next(e);
  }
}

export async function createClass(req, res, next) {
  try {
    const {
      name,
      enrollment_year,
      duration_years,
      major_id,
      college_id,
      training_level_id,
      student_count,
      custom_plan_id,
      is_left_school,
    } = req.body;
    if (!name || !enrollment_year || !duration_years || !training_level_id) {
      throw new ValidationError('班级名称、入学年份、学制、培养层次为必填项');
    }

    const leftSchool = !!is_left_school;
    let autoStatus;
    if (leftSchool) {
      autoStatus = 'left_school';
    } else {
      const [semesterInfo, semesterStartMonth] = await Promise.all([
        getCurrentSemesterInfo(),
        getSemesterStartMonth(),
      ]);
      autoStatus = calculateClassStatus(
        Number(enrollment_year),
        Number(duration_years),
        semesterInfo,
        semesterStartMonth
      );
    }

    const cls = await prisma.classes.create({
      data: {
        name,
        enrollment_year: Number(enrollment_year),
        duration_years: Number(duration_years),
        major_id: major_id ? Number(major_id) : null,
        college_id: college_id ? Number(college_id) : null,
        training_level_id: Number(training_level_id),
        student_count: Number(student_count) || 0,
        custom_plan_id: custom_plan_id ? Number(custom_plan_id) : null,
        status: autoStatus,
        is_left_school: leftSchool,
      },
      include: { majors: true, colleges: true, training_levels: true, training_plans: true },
    });

    await createAuditLog({
      action: 'create',
      module: 'class',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: cls.id, name },
      result: 'success',
      message: `创建班级：${name}`,
    });

    invalidateDurationCache();
    success(res, cls, '创建成功');
  } catch (e) {
    await createAuditLog({
      action: 'create',
      module: 'class',
      userId: req.user?.id,
      ip: req.ip,
      details: req.body,
      result: 'failed',
      message: `创建班级失败：${e.message}`,
    });
    next(e);
  }
}

export async function updateClass(req, res, next) {
  try {
    const { id } = req.params;
    const {
      name,
      enrollment_year,
      duration_years,
      major_id,
      college_id,
      training_level_id,
      student_count,
      custom_plan_id,
      is_left_school,
    } = req.body;

    const currentClass = await prisma.classes.findUnique({ where: { id: Number(id) } });
    if (!currentClass) throw new NotFoundError('班级');

    const leftSchool =
      is_left_school !== undefined ? !!is_left_school : currentClass.is_left_school;
    const [semesterInfo, semesterStartMonth] = await Promise.all([
      getCurrentSemesterInfo(),
      getSemesterStartMonth(),
    ]);
    let autoStatus;
    if (leftSchool) {
      autoStatus = 'left_school';
    } else {
      const calcEnrollmentYear = enrollment_year
        ? Number(enrollment_year)
        : currentClass.enrollment_year;
      const calcDurationYears = duration_years
        ? Number(duration_years)
        : currentClass.duration_years;
      autoStatus = calculateClassStatus(calcEnrollmentYear, calcDurationYears, semesterInfo, semesterStartMonth);
    }

    const updateData = {
      status: autoStatus,
      is_left_school: leftSchool,
    };

    if (name !== undefined) updateData.name = name;
    if (enrollment_year !== undefined) updateData.enrollment_year = Number(enrollment_year);
    if (duration_years !== undefined) updateData.duration_years = Number(duration_years);
    if (major_id !== undefined) updateData.major_id = major_id ? Number(major_id) : null;
    if (college_id !== undefined) updateData.college_id = college_id ? Number(college_id) : null;
    if (training_level_id !== undefined)
      updateData.training_level_id = training_level_id ? Number(training_level_id) : null;
    if (student_count !== undefined) updateData.student_count = Number(student_count);
    if (custom_plan_id !== undefined)
      updateData.custom_plan_id = custom_plan_id ? Number(custom_plan_id) : null;

    // M-2修复：班级更新与级联删除排课记录放入同一事务，保证原子性
    let cls;
    let deletedAssignmentCount = 0;
    await prisma.$transaction(async (tx) => {
      cls = await tx.classes.update({
        where: { id: Number(id) },
        data: updateData,
        include: { majors: true, colleges: true, training_levels: true, training_plans: true },
      });

      // 班级标记离校时，级联删除当前及未来学期排课记录，释放教师课时容量
      if (leftSchool && semesterInfo) {
        const result = await tx.teaching_assignments.deleteMany({
          where: { class_id: Number(id), semester: { gte: semesterInfo.raw } },
        });
        deletedAssignmentCount = result.count;
      }
    });

    await createAuditLog({
      action: 'update',
      module: 'class',
      userId: req.user?.id,
      ip: req.ip,
      details: {
        id: cls.id,
        name,
        is_left_school: leftSchool,
        deletedAssignments: deletedAssignmentCount,
      },
      result: 'success',
      message:
        `更新班级：${name}` +
        (deletedAssignmentCount > 0 ? `，级联删除 ${deletedAssignmentCount} 条排课记录` : ''),
    });

    success(res, cls, '更新成功');

    if (duration_years !== undefined) invalidateDurationCache();
  } catch (e) {
    await createAuditLog({
      action: 'update',
      module: 'class',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: req.params.id, ...req.body },
      result: 'failed',
      message: `更新班级失败：${e.message}`,
    });
    if (e.code === 'P2025') return next(new NotFoundError('班级'));
    next(e);
  }
}

export async function deleteClass(req, res, next) {
  try {
    const { id } = req.params;
    const classId = Number(id);
    // H-3: 删除前检查排课记录，为 schema Cascade→Restrict 做准备
    const assignmentCount = await prisma.teaching_assignments.count({
      where: { class_id: classId },
    });
    if (assignmentCount > 0) {
      // P2-8: 列出涉及的学期，帮助用户定位需清理的排课记录
      const semesters = await prisma.teaching_assignments.findMany({
        where: { class_id: classId },
        select: { semester: true },
        distinct: ['semester'],
      });
      const semesterList = semesters
        .map((s) => s.semester)
        .filter(Boolean)
        .join('、');
      return fail(
        res,
        `该班级存在 ${assignmentCount} 条排课记录${
          semesterList ? `（涉及学期：${semesterList}）` : ''
        }，请先删除排课后再删除班级`
      );
    }
    try {
      const cls = await prisma.classes.findUnique({ where: { id: classId } });
      await prisma.classes.delete({ where: { id: classId } });

      await createAuditLog({
        action: 'delete',
        module: 'class',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id), name: cls?.name },
        result: 'success',
        message: `删除班级：${cls?.name}`,
      });

      success(res, null, '删除成功');
      invalidateDurationCache();
    } catch (e) {
      await createAuditLog({
        action: 'delete',
        module: 'class',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id) },
        result: 'failed',
        message: `删除班级失败：${e.message}`,
      });
      if (e.code === 'P2025') throw new NotFoundError('班级');
      throw e;
    }
  } catch (e) {
    next(e);
  }
}

/**
 * POST /api/classes/batch-delete — 批量删除班级
 * Body: { ids: number[] }
 * 在单个事务中完成所有删除，避免逐个请求触发 429 限流和 SQLite 锁冲突
 */
export async function batchDeleteClasses(req, res, next) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return fail(res, 'ids 不能为空');
    }
    if (ids.length > 500) {
      return fail(res, '单次批量删除最多 500 个班级');
    }

    const classIds = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (classIds.length === 0) {
      return fail(res, 'ids 中没有有效的班级 ID');
    }

    // 1) 批量查询目标班级名称
    const classes = await prisma.classes.findMany({
      where: { id: { in: classIds } },
      select: { id: true, name: true },
    });
    const classMap = new Map(classes.map((c) => [c.id, c]));

    // 2) 批量查询哪些班级有排课记录（阻碍删除）
    const blockedAssignments = await prisma.teaching_assignments.groupBy({
      by: ['class_id'],
      where: { class_id: { in: classIds } },
      _count: true,
    });
    const blockedMap = new Map(
      blockedAssignments.map((a) => [a.class_id, a._count])
    );

    // 3) 对 blocked 班级查询涉及学期
    const blockedIds = [...blockedMap.keys()];
    let semesterMap = new Map();
    if (blockedIds.length > 0) {
      const semesters = await prisma.teaching_assignments.findMany({
        where: { class_id: { in: blockedIds } },
        select: { class_id: true, semester: true },
        distinct: ['class_id', 'semester'],
      });
      for (const s of semesters) {
        if (!s.semester) continue;
        if (!semesterMap.has(s.class_id)) semesterMap.set(s.class_id, []);
        semesterMap.get(s.class_id).push(s.semester);
      }
    }

    // 4) 可删除的 ID（不在 blocked 列表中且在数据库中存在）
    const deletableIds = classIds.filter((id) => !blockedMap.has(id) && classMap.has(id));

    // 5) 在单个事务中批量删除
    let deletedCount = 0;
    if (deletableIds.length > 0) {
      deletedCount = await prisma.$transaction(async (tx) => {
        const result = await tx.classes.deleteMany({
          where: { id: { in: deletableIds } },
        });
        return result.count;
      });
      invalidateDurationCache();
    }

    // 6) 构造逐项结果
    const succeeded = [];
    const failed = [];

    for (const id of classIds) {
      const cls = classMap.get(id);
      if (!cls) {
        failed.push({ id, name: `ID:${id}`, reason: '班级不存在' });
      } else if (blockedMap.has(id)) {
        const count = blockedMap.get(id);
        const semList = (semesterMap.get(id) || []).join('、');
        failed.push({
          id,
          name: cls.name,
          reason: `存在 ${count} 条排课记录${semList ? `（涉及学期：${semList}）` : ''}，请先删除排课后再删除班级`,
        });
      } else {
        succeeded.push({ id, name: cls.name });
      }
    }

    // 7) 审计日志
    await createAuditLog({
      action: 'batch_delete',
      module: 'class',
      userId: req.user?.id,
      ip: req.ip,
      details: {
        requested: classIds.length,
        deleted: deletedCount,
        blocked: failed.length,
      },
      result: deletedCount > 0 ? 'success' : 'failed',
      message: `批量删除班级：成功 ${deletedCount} 个，失败 ${failed.length} 个`,
    });

    success(res, {
      total: classIds.length,
      succeeded,
      failed,
      deletedCount,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /api/classes/batch-update — 批量更新班级
 * Body: { ids: number[], updates: object }
 * 在单个事务中完成所有更新，避免逐条请求触发 429 限流和 SQLite 锁冲突
 */
export async function batchUpdateClasses(req, res, next) {
  try {
    const { ids, updates } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return fail(res, 'ids 不能为空');
    }
    if (ids.length > 500) {
      return fail(res, '单次批量更新最多 500 个班级');
    }
    if (!updates || typeof updates !== 'object') {
      return fail(res, 'updates 不能为空');
    }

    const classIds = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (classIds.length === 0) {
      return fail(res, 'ids 中没有有效的班级 ID');
    }

    // 只允许更新安全字段，防止前端传入不允许修改的字段
    const safeFields = [
      'major_id',
      'training_level_id',
      'college_id',
      'status',
      'enrollment_year',
      'duration_years',
      'is_left_school',
    ];
    const updateData = {};
    for (const field of safeFields) {
      if (updates[field] !== undefined) {
        updateData[field] = updates[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return fail(res, '没有可更新的字段');
    }

    // 数值字段转换
    if (updateData.major_id !== undefined)
      updateData.major_id = updateData.major_id ? Number(updateData.major_id) : null;
    if (updateData.college_id !== undefined)
      updateData.college_id = updateData.college_id ? Number(updateData.college_id) : null;
    if (updateData.training_level_id !== undefined)
      updateData.training_level_id = updateData.training_level_id
        ? Number(updateData.training_level_id)
        : null;
    if (updateData.enrollment_year !== undefined)
      updateData.enrollment_year = Number(updateData.enrollment_year);
    if (updateData.duration_years !== undefined)
      updateData.duration_years = Number(updateData.duration_years);
    if (updateData.is_left_school !== undefined)
      updateData.is_left_school = !!updateData.is_left_school;

    // 批量查询目标班级（用于结果构造）
    const classes = await prisma.classes.findMany({
      where: { id: { in: classIds } },
      select: { id: true, name: true },
    });
    const classMap = new Map(classes.map((c) => [c.id, c]));

    // 在单个事务中执行所有更新
    const succeeded = [];
    const failed = [];

    await prisma.$transaction(async (tx) => {
      for (const id of classIds) {
        try {
          await tx.classes.update({
            where: { id },
            data: updateData,
          });
          const cls = classMap.get(id);
          succeeded.push({ id, name: cls?.name || `ID:${id}` });
        } catch (e) {
          const cls = classMap.get(id);
          failed.push({
            id,
            name: cls?.name || `ID:${id}`,
            reason: e.code === 'P2025' ? '班级不存在' : e.message,
          });
        }
      }
    });

    // 审计日志
    await createAuditLog({
      action: 'batch_update',
      module: 'class',
      userId: req.user?.id,
      ip: req.ip,
      details: {
        requested: classIds.length,
        succeeded: succeeded.length,
        failed: failed.length,
        fields: Object.keys(updateData),
      },
      result: succeeded.length > 0 ? 'success' : 'failed',
      message: `批量更新班级：成功 ${succeeded.length} 个，失败 ${failed.length} 个`,
    });

    if (updateData.duration_years !== undefined) invalidateDurationCache();

    success(res, {
      total: classIds.length,
      succeeded,
      failed,
    });
  } catch (e) {
    next(e);
  }
}
