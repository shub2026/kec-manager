import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { NotFoundError, ValidationError } from '../utils/error.js';
import { getCurrentSemesterInfo } from '../services/settings.service.js';
import { getActiveClassFilter } from '../services/class.service.js';

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
  } catch (e) { next(e); }
}

export async function listClasses(req, res, next) {
  try {
    const { name, majorId, collegeId, status, trainingLevelId, planId, enrollmentYear, page, pageSize } = req.query;
    const pageNum = page ? Number(page) : 1;
    const pageSizeNum = pageSize ? Number(pageSize) : 20;
    
    const where = {};
    if (name) where.name = { contains: name };
    
    if (majorId === 'null') {
      where.major_id = null;
    } else if (majorId) {
      where.major_id = Number(majorId);
    }
    
    if (collegeId === 'null') {
      where.college_id = null;
    } else if (collegeId) {
      where.college_id = Number(collegeId);
    }
    
    let dynamicStatusFilter = null;
    if (status === 'null') {
      dynamicStatusFilter = [
        { enrollment_year: null, is_left_school: false },
        { duration_years: null, is_left_school: false },
      ];
    } else if (status === 'left_school') {
      dynamicStatusFilter = [{ is_left_school: true }];
    } else if (status === 'active' || status === 'graduated') {
      const semesterInfo = await getCurrentSemesterInfo();
      if (semesterInfo) {
        const startYear = semesterInfo.startYear;
        const durations = await prisma.classes.findMany({
          select: { duration_years: true },
          distinct: ['duration_years'],
        });
        const durationValues = durations.map(d => d.duration_years).filter(d => d != null);
        
        dynamicStatusFilter = durationValues.map(d => ({
          duration_years: d,
          is_left_school: false,
          enrollment_year: status === 'active'
            ? { gte: startYear - d + 1 }
            : { lt: startYear - d + 1 },
        }));
      }
    }
    
    if (trainingLevelId === 'null') {
      where.training_level_id = null;
    } else if (trainingLevelId) {
      where.training_level_id = Number(trainingLevelId);
    }
    
    if (enrollmentYear === 'null') {
      where.enrollment_year = null;
    } else if (enrollmentYear) {
      where.enrollment_year = Number(enrollmentYear);
    }
    
    if (planId) {
      if (planId === 'none') {
        const allPlans = await prisma.training_plans.findMany({
          select: { id: true, major_id: true, training_level_id: true },
        });
        
        where.custom_plan_id = null;
        
        const notConditions = [];
        const majorIdsWithPlans = [...new Set(allPlans.filter(p => p.major_id).map(p => p.major_id))];
        if (majorIdsWithPlans.length > 0) {
          notConditions.push({ major_id: { in: majorIdsWithPlans } });
        }
        
        const levelIdsWithPlans = [...new Set(allPlans.filter(p => p.training_level_id).map(p => p.training_level_id))];
        if (levelIdsWithPlans.length > 0) {
          notConditions.push({ training_level_id: { in: levelIdsWithPlans } });
        }
        
        if (notConditions.length > 0) {
          where.NOT = { OR: notConditions };
        }
      } else {
        const planIdNum = Number(planId);
        const plan = await prisma.training_plans.findUnique({
          where: { id: planIdNum },
          select: { major_id: true, training_level_id: true },
        });
        
        if (plan) {
          const conditions = [{ custom_plan_id: planIdNum }];
          
          if (plan.major_id) {
            conditions.push({ major_id: plan.major_id, custom_plan_id: null });
          }
          
          if (plan.training_level_id) {
            conditions.push({ training_level_id: plan.training_level_id, custom_plan_id: null });
          }
          
          where.OR = conditions;
        } else {
          return success(res, { items: [], total: 0 });
        }
      }
    }
    
    let finalWhere = where;
    if (dynamicStatusFilter) {
      finalWhere = {
        AND: [where, { OR: dynamicStatusFilter }],
      };
    }

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
    
    const classesWithDynamicStatus = classes.map(cls => {
      let status;
      if (cls.is_left_school) {
        status = 'left_school';
      } else if (cls.enrollment_year && cls.duration_years) {
        status = calculateClassStatus(cls.enrollment_year, cls.duration_years, semesterInfo);
      }
      
      // 计算匹配的培养方案名称
      let matchedPlanName = null;
      if (cls.custom_plan_id && cls.training_plans) {
        // 有自定义方案
        matchedPlanName = cls.training_plans.name;
      } else {
        // 尝试根据专业或培养层次匹配方案
        let matchedPlan = null;
        if (cls.major_id) {
          matchedPlan = allPlans.find(p => p.major_id === cls.major_id);
        }
        if (!matchedPlan && cls.training_level_id) {
          matchedPlan = allPlans.find(p => p.training_level_id === cls.training_level_id);
        }
        if (matchedPlan) {
          matchedPlanName = matchedPlan.name;
        }
      }
      
      return { 
        ...cls, 
        status,
        matchedPlanName, // 添加匹配的方案名称
      };
    });

    const distinctYears = await prisma.classes.findMany({
      select: { enrollment_year: true },
      distinct: ['enrollment_year'],
      orderBy: { enrollment_year: 'desc' },
    });
    const allEnrollmentYears = distinctYears
      .map(c => c.enrollment_year)
      .filter(y => y != null);

    success(res, { items: classesWithDynamicStatus, total, allEnrollmentYears });
  } catch (e) { next(e); }
}

export async function createClass(req, res, next) {
  try {
    const { name, enrollment_year, duration_years, major_id, college_id, training_level_id, student_count, custom_plan_id, is_left_school } = req.body;
    if (!name || !enrollment_year || !duration_years || !training_level_id) {
      throw new ValidationError('班级名称、入学年份、学制、培养层次为必填项');
    }

    const leftSchool = !!is_left_school;
    let autoStatus;
    if (leftSchool) {
      autoStatus = 'left_school';
    } else {
      const semesterInfo = await getCurrentSemesterInfo();
      autoStatus = calculateClassStatus(Number(enrollment_year), Number(duration_years), semesterInfo);
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
    const { name, enrollment_year, duration_years, major_id, college_id, training_level_id, student_count, custom_plan_id, is_left_school } = req.body;
    try {
      const currentClass = await prisma.classes.findUnique({ where: { id: Number(id) } });
      if (!currentClass) throw new NotFoundError('班级');

      const leftSchool = is_left_school !== undefined ? !!is_left_school : currentClass.is_left_school;
      let autoStatus;
      if (leftSchool) {
        autoStatus = 'left_school';
      } else {
        const calcEnrollmentYear = enrollment_year ? Number(enrollment_year) : currentClass.enrollment_year;
        const calcDurationYears = duration_years ? Number(duration_years) : currentClass.duration_years;
        const semesterInfo = await getCurrentSemesterInfo();
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
      if (training_level_id !== undefined) updateData.training_level_id = training_level_id ? Number(training_level_id) : null;
      if (student_count !== undefined) updateData.student_count = Number(student_count);
      if (custom_plan_id !== undefined) updateData.custom_plan_id = custom_plan_id ? Number(custom_plan_id) : null;

      const cls = await prisma.classes.update({
        where: { id: Number(id) },
        data: updateData,
        include: { majors: true, colleges: true, training_levels: true, training_plans: true },
      });

      await createAuditLog({
        action: 'update',
        module: 'class',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: cls.id, name },
        result: 'success',
        message: `更新班级：${name}`,
      });

      success(res, cls, '更新成功');
    } catch (e) {
      await createAuditLog({
        action: 'update',
        module: 'class',
        userId: req.user?.id,
        ip: req.ip,
        details: { id, ...req.body },
        result: 'failed',
        message: `更新班级失败：${e.message}`,
      });
      if (e.code === 'P2025') return fail(res, '班级不存在', 404);
      throw e;
    }
  } catch (e) { next(e); }
}

export async function deleteClass(req, res, next) {
  try {
    const { id } = req.params;
    try {
      const cls = await prisma.classes.findUnique({ where: { id: Number(id) } });
      await prisma.classes.delete({ where: { id: Number(id) } });

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
  } catch (e) { next(e); }
}
