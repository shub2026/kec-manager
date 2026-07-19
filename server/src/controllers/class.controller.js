import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { NotFoundError, ValidationError } from '../utils/error.js';
import { getCurrentSemesterInfo, getSemesterStartMonth } from '../services/settings.service.js';
import { getActiveClassFilter, invalidateDurationCache } from '../services/class.service.js';
import { buildClassFilter } from '../services/class-filter.service.js';
import { findBestMatchPlan } from '../services/plan.service.js';
import {
  applyCombination,
  buildCombinationMemberMap,
  formatPartnerNames,
  getPartnersOfClass,
  dissolveAfterClassDeletion,
} from '../services/class-combination.service.js';
import { invalidateQueryFilterCache } from './query.controller.js';

// ── 班级筛选器关联映射缓存（优化1）──
// 关联映射从全量班级/方案构建，数据变更频率低（仅增删改班级/方案时变化），
// 但每次分页请求都需要，缓存后避免重复全量查询。
const FILTER_RELATIONS_TTL = 5 * 60 * 1000; // 5 分钟
let filterRelationsCache = null;
let filterRelationsCacheAt = 0;

export function invalidateFilterRelationsCache() {
  filterRelationsCache = null;
  filterRelationsCacheAt = 0;
}

async function getClassFilterRelations() {
  if (filterRelationsCache && Date.now() - filterRelationsCacheAt < FILTER_RELATIONS_TTL) {
    return filterRelationsCache;
  }

  const [allClassesForMappings, allPlansForMapping] = await Promise.all([
    prisma.classes.findMany({
      select: {
        college_id: true,
        major_id: true,
        training_level_id: true,
        enrollment_year: true,
      },
    }),
    prisma.training_plans.findMany({
      select: { id: true, college_id: true, major_id: true, training_level_id: true },
    }),
  ]);

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

  const mapToObj = (map, sortFn) => {
    const obj = {};
    for (const [k, s] of map) obj[k] = sortFn ? [...s].sort(sortFn) : [...s];
    return obj;
  };

  const planCollegeMap = new Map();
  const planMajorMap = new Map();
  const planLevelMap = new Map();

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

  filterRelationsCache = {
    allEnrollmentYears,
    collegeMajorRelation: mapToObj(collegeMajorMap),
    collegeLevelRelation: mapToObj(collegeLevelMap),
    majorLevelRelation: mapToObj(majorLevelMap),
    collegeYearRelation: mapToObj(collegeYearMap, (a, b) => b - a),
    majorYearRelation: mapToObj(majorYearMap, (a, b) => b - a),
    levelYearRelation: mapToObj(levelYearMap, (a, b) => b - a),
    planCollegeRelation: mapToObj(planCollegeMap),
    planMajorRelation: mapToObj(planMajorMap),
    planLevelRelation: mapToObj(planLevelMap),
  };
  filterRelationsCacheAt = Date.now();
  return filterRelationsCache;
}

function calculateClassStatus(
  enrollmentYear,
  durationYears,
  semesterInfo = null,
  semesterStartMonth = 8
) {
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

    // 预加载本页班级涉及的合班组合成员映射，用于展示合班伙伴
    const combinationIds = classes.map((c) => c.combination_id).filter((id) => id != null);
    const combinationMemberMap = await buildCombinationMemberMap(combinationIds);

    const classesWithDynamicStatus = classes.map((cls) => {
      let status;
      if (cls.is_left_school) {
        status = 'left_school';
      } else if (cls.enrollment_year && cls.duration_years) {
        status = calculateClassStatus(
          cls.enrollment_year,
          cls.duration_years,
          semesterInfo,
          semesterStartMonth
        );
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
          matchedPlanType = bestPlan.major_id
            ? 'major'
            : bestPlan.training_level_id
              ? 'level'
              : null;

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

      // FR3修复：后端计算 grade，避免前端重复公式且硬编码边界月
      let grade = null;
      if (cls.enrollment_year && cls.duration_years && semesterInfo) {
        const g = semesterInfo.startYear - cls.enrollment_year + 1;
        if (g >= 1 && g <= cls.duration_years) {
          grade = g;
        }
      }

      // 合班伙伴：从组合成员映射中排除自身
      const members = combinationMemberMap.get(cls.combination_id) || [];
      const partnerClasses = members.filter((m) => m.id !== cls.id);

      return {
        ...cls,
        status,
        grade, // FR3: 后端计算的年级（1=大一，超出学制返回null）
        matchedPlanName, // 添加匹配的方案名称
        matchedPlanType, // 添加实际匹配类型（custom/major/level）
        planMatchWarning, // 添加交叉匹配警告
        isCombinedClass: cls.combination_id != null, // 合班标记
        combinationId: cls.combination_id, // 合班组合 ID
        partnerClassNames: formatPartnerNames(partnerClasses), // 合班伙伴名称（顿号分隔）
        partnerClassIds: partnerClasses.map((m) => m.id), // 合班伙伴班级 ID 列表
      };
    });

    // 优化1：关联映射使用模块级缓存（TTL 5分钟），避免每次分页请求重复全量查询。
    // B-12 设计说明：关联映射从全量班级构建（而非当前筛选结果），
    // 保证级联筛选下拉框选项稳定，不随筛选条件变化。
    const {
      allEnrollmentYears,
      collegeMajorRelation,
      collegeLevelRelation,
      majorLevelRelation,
      collegeYearRelation,
      majorYearRelation,
      levelYearRelation,
      planCollegeRelation,
      planMajorRelation,
      planLevelRelation,
    } = await getClassFilterRelations();

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
      combination_class_ids,
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

    const collegeIdNum = college_id ? Number(college_id) : null;

    // 先创建班级，再在事务中应用合班关系
    const cls = await prisma.classes.create({
      data: {
        name,
        enrollment_year: Number(enrollment_year),
        duration_years: Number(duration_years),
        major_id: major_id ? Number(major_id) : null,
        college_id: collegeIdNum,
        training_level_id: Number(training_level_id),
        student_count: Number(student_count) || 0,
        custom_plan_id: custom_plan_id ? Number(custom_plan_id) : null,
        status: autoStatus,
        is_left_school: leftSchool,
      },
      include: { majors: true, colleges: true, training_levels: true, training_plans: true },
    });

    // 应用合班关系（如有）
    if (combination_class_ids !== undefined) {
      await prisma.$transaction(async (tx) => {
        await applyCombination(
          tx,
          cls.id,
          Array.isArray(combination_class_ids) ? combination_class_ids : [],
          collegeIdNum
        );
      });
    }

    const result =
      combination_class_ids !== undefined
        ? await prisma.classes.findUnique({
            where: { id: cls.id },
            include: { majors: true, colleges: true, training_levels: true, training_plans: true },
          })
        : cls;

    await createAuditLog({
      action: 'create',
      module: 'class',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: cls.id, name, combination_class_ids },
      result: 'success',
      message: `创建班级：${name}`,
    });

    invalidateDurationCache();
    invalidateFilterRelationsCache();
    invalidateQueryFilterCache();
    success(res, result, '创建成功');
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
      combination_class_ids,
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
      autoStatus = calculateClassStatus(
        calcEnrollmentYear,
        calcDurationYears,
        semesterInfo,
        semesterStartMonth
      );
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

    // 计算用于合班同学院校验的学院 ID（取更新后的值或原值）
    const effectiveCollegeId =
      college_id !== undefined ? (college_id ? Number(college_id) : null) : currentClass.college_id;

    // M-2修复：班级更新与级联删除排课记录放入同一事务，保证原子性
    let cls;
    let deletedAssignmentCount = 0;
    let dissolvedCombinationIds = [];
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

      // 应用合班关系（仅当请求体显式传 combination_class_ids 时）
      if (combination_class_ids !== undefined) {
        const combResult = await applyCombination(
          tx,
          Number(id),
          Array.isArray(combination_class_ids) ? combination_class_ids : [],
          effectiveCollegeId
        );
        dissolvedCombinationIds = combResult.dissolvedCombinationIds;
        // 重新查询以返回最新 combination_id
        cls = await tx.classes.findUnique({
          where: { id: Number(id) },
          include: { majors: true, colleges: true, training_levels: true, training_plans: true },
        });
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
        combination_class_ids,
        dissolvedCombinations: dissolvedCombinationIds,
      },
      result: 'success',
      message:
        `更新班级：${name}` +
        (deletedAssignmentCount > 0 ? `，级联删除 ${deletedAssignmentCount} 条排课记录` : '') +
        (combination_class_ids !== undefined
          ? `，合班伙伴 ${Array.isArray(combination_class_ids) ? combination_class_ids.length : 0} 个`
          : ''),
    });

    success(res, cls, '更新成功');

    if (duration_years !== undefined) invalidateDurationCache();
    invalidateFilterRelationsCache();
    invalidateQueryFilterCache();
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

    // 删除前查询合班组合 ID（删除后需清理组合）
    const classBeforeDelete = await prisma.classes.findUnique({
      where: { id: classId },
      select: { name: true, combination_id: true },
    });
    if (!classBeforeDelete) throw new NotFoundError('班级');

    try {
      // 删除班级 + 清理合班组合放入同一事务
      let dissolvedCombinationIds = [];
      await prisma.$transaction(async (tx) => {
        await tx.classes.delete({ where: { id: classId } });
        // 班级删除后，其原所属组合若剩余 ≤1 班则解散
        const dissolvedId = await dissolveAfterClassDeletion(tx, classBeforeDelete.combination_id);
        if (dissolvedId != null) dissolvedCombinationIds.push(dissolvedId);
      });

      await createAuditLog({
        action: 'delete',
        module: 'class',
        userId: req.user?.id,
        ip: req.ip,
        details: {
          id: Number(id),
          name: classBeforeDelete.name,
          dissolvedCombinations: dissolvedCombinationIds,
        },
        result: 'success',
        message: `删除班级：${classBeforeDelete.name}`,
      });

      success(res, null, '删除成功');
      invalidateDurationCache();
      invalidateFilterRelationsCache();
      invalidateQueryFilterCache();
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
    const blockedMap = new Map(blockedAssignments.map((a) => [a.class_id, a._count]));

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

    // 4.5) 查询待删班级的合班组合 ID，删除后需清理组合
    const combinationIdSet = new Set();
    if (deletableIds.length > 0) {
      const combClasses = await prisma.classes.findMany({
        where: { id: { in: deletableIds }, combination_id: { not: null } },
        select: { combination_id: true },
      });
      for (const c of combClasses) {
        if (c.combination_id != null) combinationIdSet.add(c.combination_id);
      }
    }

    // 5) 在单个事务中批量删除 + 清理合班组合
    let deletedCount = 0;
    if (deletableIds.length > 0) {
      deletedCount = await prisma.$transaction(async (tx) => {
        const result = await tx.classes.deleteMany({
          where: { id: { in: deletableIds } },
        });
        // 批量删除后，对涉及的每个合班组合尝试清理（剩余 ≤1 班则解散）
        for (const combId of combinationIdSet) {
          await dissolveAfterClassDeletion(tx, combId);
        }
        return result.count;
      });
      invalidateDurationCache();
      invalidateFilterRelationsCache();
      invalidateQueryFilterCache();
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
    invalidateFilterRelationsCache();
    invalidateQueryFilterCache();

    success(res, {
      total: classIds.length,
      succeeded,
      failed,
    });
  } catch (e) {
    next(e);
  }
}
