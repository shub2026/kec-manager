import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { NotFoundError, ValidationError } from '../utils/error.js';
import { getCurrentSemesterInfo } from '../services/settings.service.js';
import { getActiveClassFilter, invalidateDurationCache } from '../services/class.service.js';
import { buildClassFilter } from '../services/class-filter.service.js';
import { isClassMatchPlan } from '../services/plan.service.js';

function calculateClassStatus(enrollmentYear, durationYears, semesterInfo = null) {
  let startYear;

  if (semesterInfo && semesterInfo.startYear) {
    startYear = semesterInfo.startYear;
  } else if (semesterInfo && semesterInfo.value) {
    startYear = Number(semesterInfo.value.split('-')[0]);
  } else {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    startYear = currentMonth >= 9 ? currentYear : currentYear - 1;
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
    const { page, pageSize } = req.query;
    const pageNum = page ? Number(page) : 1;
    const pageSizeNum = pageSize ? Number(pageSize) : 20;

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

    // 预加载所有培养方案，用于自动匹配
    const allPlans = await prisma.training_plans.findMany({
      select: { id: true, name: true, major_id: true, training_level_id: true },
    });

    const classesWithDynamicStatus = classes.map((cls) => {
      let status;
      if (cls.is_left_school) {
        status = 'left_school';
      } else if (cls.enrollment_year && cls.duration_years) {
        status = calculateClassStatus(cls.enrollment_year, cls.duration_years, semesterInfo);
      }

      // 计算匹配的培养方案名称
      let matchedPlanName = null;
      let planMatchWarning = null; // 交叉匹配警告
      
      if (cls.custom_plan_id && cls.training_plans) {
        // 有自定义方案
        matchedPlanName = cls.training_plans.name;
      } else {
        // 使用统一的三级互斥匹配，避免 null===null 误匹配
        const matchedPlans = allPlans.filter((p) => isClassMatchPlan(cls, p));
        
        if (matchedPlans.length > 0) {
          // 取第一个匹配的方案作为显示
          matchedPlanName = matchedPlans[0].name;
          
          // 检测是否存在专业和层次同时匹配的情况（交叉匹配）
          const hasMajorMatch = matchedPlans.some(p => p.major_id && cls.major_id && cls.major_id === p.major_id);
          const hasLevelMatch = matchedPlans.some(p => p.training_level_id && cls.training_level_id && cls.training_level_id === p.training_level_id);
          
          if (hasMajorMatch && hasLevelMatch) {
            // 存在交叉匹配，给出警告
            const majorPlans = matchedPlans.filter(p => p.major_id).map(p => p.name);
            const levelPlans = matchedPlans.filter(p => p.training_level_id).map(p => p.name);
            planMatchWarning = `专业层次交叉，请检查：按专业匹配(${majorPlans.join('、')})，按层次匹配(${levelPlans.join('、')})`;
          }
        }
      }

      return {
        ...cls,
        status,
        matchedPlanName, // 添加匹配的方案名称
        planMatchWarning, // 添加交叉匹配警告
      };
    });

    // H-10: 合并 7 次班级查询为单次查询，从结果集推导所有关联映射
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
        if (!levelYearMap.has(cls.training_level_id)) levelYearMap.set(cls.training_level_id, new Set());
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
      collegeMajorRelation,     // 学院-专业关联
      collegeLevelRelation,     // 学院-层次关联
      majorLevelRelation,       // 专业-层次关联
      collegeYearRelation,      // 学院-入学年份关联
      majorYearRelation,        // 专业-入学年份关联
      levelYearRelation,        // 层次-入学年份关联
      planCollegeRelation,      // 培养方案-学院关联
      planMajorRelation,        // 培养方案-专业关联
      planLevelRelation         // 培养方案-层次关联
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
      const semesterInfo = await getCurrentSemesterInfo();
      autoStatus = calculateClassStatus(
        Number(enrollment_year),
        Number(duration_years),
        semesterInfo
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
    const semesterInfo = await getCurrentSemesterInfo();
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
      autoStatus = calculateClassStatus(calcEnrollmentYear, calcDurationYears, semesterInfo);
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

    const cls = await prisma.classes.update({
      where: { id: Number(id) },
      data: updateData,
      include: { majors: true, colleges: true, training_levels: true, training_plans: true },
    });

    // 班级标记离校时，级联删除当前学期排课记录，释放教师课时容量
    let deletedAssignmentCount = 0;
    if (leftSchool) {
      const result = await prisma.teaching_assignments.deleteMany({
        where: { class_id: Number(id), semester: semesterInfo.raw },
      });
      deletedAssignmentCount = result.count;
    }

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
      return fail(res, `该班级存在 ${assignmentCount} 条排课记录，请先删除排课后再删除班级`);
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
