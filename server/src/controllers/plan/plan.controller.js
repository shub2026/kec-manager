import { prisma } from '../../lib/prisma.js';
import { success, fail } from '../../utils/response.js';
import { NotFoundError, ValidationError, ConflictError } from '../../utils/error.js';
import { createAuditLog } from '../../services/audit.service.js';
import { autoFixSortOrder } from '../../utils/sort.js';

/**
 * 获取培养方案列表（含班级使用统计）
 */
export async function listPlans(req, res, next) {
  try {
    const { collegeId } = req.query;
    const where = {};
    
    if (collegeId) {
      where.college_id = Number(collegeId);
    }
    
    await autoFixSortOrder('training_plans');
    const plans = await prisma.training_plans.findMany({
      where,
      include: {
        majors: { select: { id: true, name: true } },
        colleges: { select: { id: true, name: true } },
        training_levels: { select: { id: true, name: true } },
        plan_courses: { select: { id: true } },
      },
      orderBy: { sort_order: 'asc' },
    });

    const allClasses = await prisma.classes.findMany({
      where: { is_left_school: false },
      select: { id: true, major_id: true, training_level_id: true, custom_plan_id: true }
    });

    const classCountMap = {};
    plans.forEach(p => { classCountMap[p.id] = 0; });
    const matchedClassIds = new Set();

    // 第一轮：custom_plan_id 直接匹配（最高优先级）
    for (const cls of allClasses) {
      if (cls.custom_plan_id && classCountMap[cls.custom_plan_id] !== undefined) {
        classCountMap[cls.custom_plan_id]++;
        matchedClassIds.add(cls.id);
      }
    }

    // 第二轮：按专业（major_id）匹配 —— 专业比层次更具体，优先匹配
    for (const cls of allClasses) {
      if (matchedClassIds.has(cls.id) || !cls.major_id) continue;
      for (const plan of plans) {
        if (plan.major_id && cls.major_id === plan.major_id) {
          classCountMap[plan.id]++;
          matchedClassIds.add(cls.id);
          break;
        }
      }
    }

    // 第三轮：按培养层次（training_level_id）匹配剩余未分配的班级
    for (const cls of allClasses) {
      if (matchedClassIds.has(cls.id) || !cls.training_level_id) continue;
      for (const plan of plans) {
        if (plan.training_level_id && cls.training_level_id === plan.training_level_id) {
          classCountMap[plan.id]++;
          matchedClassIds.add(cls.id);
          break;
        }
      }
    }

    const plansWithCount = plans.map(plan => ({
      ...plan,
      courseCount: plan.plan_courses.length,
      classCount: classCountMap[plan.id] || 0,
    }));

    success(res, plansWithCount);
  } catch (e) { 
    next(e); 
  }
}

/**
 * 获取单个培养方案详情
 */
export async function getPlanById(req, res, next) {
  try {
    const { id } = req.params;
    
    const plan = await prisma.training_plans.findUnique({
      where: { id: Number(id) },
      include: {
        majors: { select: { id: true, name: true } },
        colleges: { select: { id: true, name: true } },
        training_levels: { select: { id: true, name: true } },
        plan_courses: { select: { id: true } },
      },
    });

    if (!plan) {
      return fail(res, '培养方案不存在', 404);
    }

    success(res, plan);
  } catch (e) { 
    next(e); 
  }
}

/**
 * 创建培养方案
 */
export async function createPlan(req, res, next) {
  try {
    const { name, college_id, major_id, training_level_id, version, description } = req.body;
    if (!name) throw new ValidationError('方案名称为必填项');
    
    if (major_id && training_level_id) {
      throw new ValidationError('专业类别和培养层次只能选择一项');
    }
    if (!major_id && !training_level_id) {
      throw new ValidationError('请选择专业类别或培养层次');
    }
    
    const maxSortOrder = await prisma.training_plans.aggregate({
      _max: { sort_order: true },
    });
    const newSortOrder = (maxSortOrder._max.sort_order || 0) + 1;
    
    const plan = await prisma.training_plans.create({
      data: { 
        name, 
        college_id: college_id ? Number(college_id) : null,
        major_id: major_id ? Number(major_id) : null,
        training_level_id: training_level_id ? Number(training_level_id) : null,
        version, 
        description,
        sort_order: newSortOrder,
      },
      include: { 
        majors: true,
        colleges: true,
        training_levels: true,
      },
    });
    
    const logDetails = {
      id: plan.id,
      name: plan.name,
      colleges: plan.colleges?.name || '未设置',
      majors: plan.majors?.name || '未设置',
      training_levels: plan.training_levels?.name || '未设置',
      version: plan.version,
    };
    
    await createAuditLog({
      module: 'trainingPlan',
      action: 'create',
      userId: req.user?.id,
      ip: req.ip,
      result: 'success',
      details: logDetails,
      message: `创建培养方案：${plan.name}${plan.colleges?.name ? `（使用部门：${plan.colleges.name}）` : ''}`,
    });
    
    success(res, plan, '创建成功');
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'create',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      details: { error: e.message },
    });
    next(e);
  }
}

/**
 * 更新培养方案
 */
export async function updatePlan(req, res, next) {
  try {
    const { id } = req.params;
    const { name, college_id, major_id, training_level_id, version, description, sort_order } = req.body;
    
    // 排序交换：仅更新 sort_order
    if (sort_order !== undefined && name === undefined) {
      try {
        const plan = await prisma.training_plans.update({
          where: { id: Number(id) },
          data: { sort_order: Number(sort_order) },
          include: {
            majors: true,
            colleges: true,
            training_levels: true,
          },
        });
        return success(res, plan, '更新成功');
      } catch (e) {
        if (e.code === 'P2025') return fail(res, '培养方案不存在', 404);
        throw e;
      }
    }
    
    if (major_id && training_level_id) {
      return fail(res, '专业类别和培养层次只能选择一项');
    }
    if (!major_id && !training_level_id) {
      return fail(res, '请选择专业类别或培养层次');
    }
    
    const updateData = { 
      name, 
      college_id: college_id ? Number(college_id) : null,
      major_id: major_id ? Number(major_id) : null,
      training_level_id: training_level_id ? Number(training_level_id) : null,
      version, 
      description,
    };
    
    if (sort_order !== undefined) {
      updateData.sort_order = Number(sort_order);
    }
    
    try {
      const oldPlan = await prisma.training_plans.findUnique({
        where: { id: Number(id) },
        include: { colleges: true },
      });
      
      const plan = await prisma.training_plans.update({
        where: { id: Number(id) },
        data: updateData,
        include: { 
          majors: true,
          colleges: true,
          training_levels: true,
        },
      });
      
      const changes = {
        id: plan.id,
        name: plan.name,
      };
      
      if (oldPlan?.college_id !== plan.college_id) {
        changes.collegeChange = {
          from: oldPlan?.colleges?.name || '未设置',
          to: plan.colleges?.name || '未设置',
        };
      }
      
      await createAuditLog({
        module: 'trainingPlan',
        action: 'update',
        userId: req.user?.id,
        ip: req.ip,
        result: 'success',
        details: changes,
        message: `更新培养方案：${plan.name}${plan.colleges?.name ? `（使用部门：${plan.colleges.name}）` : ''}`,
      });
      
      success(res, plan, '更新成功');
    } catch (e) {
      if (e.code === 'P2025') return fail(res, '方案不存在', 404);
      throw e;
    }
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'update',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      details: { error: e.message },
    });
    next(e);
  }
}

/**
 * 删除培养方案
 */
export async function deletePlan(req, res, next) {
  try {
    const { id } = req.params;
    const classCount = await prisma.classes.count({ where: { custom_plan_id: Number(id) } });
    if (classCount > 0) throw new ConflictError('该方案已被班级使用，无法删除');
    try {
      await prisma.training_plans.delete({ where: { id: Number(id) } });
      
      await createAuditLog({
        module: 'trainingPlan',
        action: 'delete',
        userId: req.user?.id,
        ip: req.ip,
        result: 'success',
        details: { plan_id: Number(id) },
      });
      
      success(res, null, '删除成功');
    } catch (e) {
      if (e.code === 'P2025') throw new NotFoundError('培养方案');
      throw e;
    }
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'delete',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      details: { error: e.message },
    });
    next(e);
  }
}
