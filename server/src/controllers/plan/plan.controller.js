import { prisma } from '../../lib/prisma.js';
import { success, fail } from '../../utils/response.js';
import { NotFoundError, ValidationError, ConflictError } from '../../utils/error.js';
import { createAuditLog } from '../../services/audit.service.js';
import { autoFixSortOrder, invalidateSortOrderCache } from '../../utils/sort.js';
import { findBestMatchPlan, isClassMatchPlan } from '../../services/plan.service.js';

/**
 * 获取培养方案列表（含班级使用统计）
 */
export async function listPlans(req, res, next) {
  try {
    const { college_id } = req.query;
    const where = {};

    if (college_id) {
      where.college_id = Number(college_id);
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
      select: { id: true, major_id: true, training_level_id: true, custom_plan_id: true },
    });

    const classCountMap = {};
    const blockingCountMap = {};
    plans.forEach((p) => {
      classCountMap[p.id] = 0;
      blockingCountMap[p.id] = 0;
    });

    // S-05 修复：使用 findBestMatchPlan 优先级语义（自定义>专业>层次），
    // 每个班级只计入其最佳匹配方案，避免同一班级被重复计入多个方案
    // 构建自定义方案的快速查找 Map
    const customPlanMap = new Map();
    for (const cls of allClasses) {
      if (cls.custom_plan_id) {
        customPlanMap.set(cls.id, plans.find((p) => p.id === cls.custom_plan_id) || null);
      }
    }
    // 候选方案列表（排除纯自定义方案，用于专业/层次匹配）
    const candidatePlans = plans.filter((p) => p.major_id || p.training_level_id);

    for (const cls of allClasses) {
      // classCount：最佳匹配（用于"使用班级"列展示）
      const bestPlan = findBestMatchPlan(cls, candidatePlans, customPlanMap);
      if (bestPlan && classCountMap[bestPlan.id] !== undefined) {
        classCountMap[bestPlan.id]++;
      }
      // blockingClassCount：任意匹配（与 deletePlan 的 isClassMatchPlan 检查一致，
      // 用于前端删除弹窗预告"删除会被拒绝的班级数"）
      for (const plan of plans) {
        if (isClassMatchPlan(cls, plan)) {
          if (blockingCountMap[plan.id] !== undefined) blockingCountMap[plan.id]++;
        }
      }
    }

    const plansWithCount = plans.map((plan) => ({
      ...plan,
      courseCount: plan.plan_courses.length,
      classCount: classCountMap[plan.id] || 0,
      blockingClassCount: blockingCountMap[plan.id] || 0,
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

    invalidateSortOrderCache('training_plans');
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
    const { name, college_id, major_id, training_level_id, version, description, sort_order } =
      req.body;

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
        invalidateSortOrderCache('training_plans');
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

      invalidateSortOrderCache('training_plans');
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
 *
 * 行为变更（应需求）：已关联班级的方案允许删除。
 * - custom_plan_id 直接引用的班级：在事务中显式置 null，让班级回归未关联状态
 * - 按专业/层次匹配的班级：删除方案后自然不再匹配该方案（班级自身的 major_id/
 *   training_level_id 是班级属性，保持不变，不视为"关联"）
 * - 级联清理：plan_courses / plan_course_semesters / plan_textbooks 通过 schema
 *   onDelete: Cascade 自动级联删除
 */
export async function deletePlan(req, res, next) {
  try {
    const { id } = req.params;
    const planId = Number(id);

    const plan = await prisma.training_plans.findUnique({
      where: { id: planId },
      select: { id: true, name: true, major_id: true, training_level_id: true },
    });
    if (!plan) throw new NotFoundError('培养方案');

    // 预先统计将被解除关联的班级（用于审计日志）
    const affectedClasses = await prisma.classes.findMany({
      where: { custom_plan_id: planId },
      select: { id: true, name: true },
    });

    try {
      await prisma.$transaction(async (tx) => {
        // 1. 解除 custom_plan_id 直接引用，让班级回归未关联状态
        if (affectedClasses.length > 0) {
          await tx.classes.updateMany({
            where: { custom_plan_id: planId },
            data: { custom_plan_id: null },
          });
        }
        // 2. 删除方案；plan_courses/plan_course_semesters/plan_textbooks 级联删除
        await tx.training_plans.delete({ where: { id: planId } });
      });

      await createAuditLog({
        module: 'trainingPlan',
        action: 'delete',
        userId: req.user?.id,
        ip: req.ip,
        result: 'success',
        details: {
          plan_id: planId,
          plan_name: plan.name,
          unlinked_classes: affectedClasses.map((c) => ({ id: c.id, name: c.name })),
          unlinked_count: affectedClasses.length,
        },
        message: `删除培养方案：${plan.name}${affectedClasses.length > 0 ? `（同时解除 ${affectedClasses.length} 个班级关联）` : ''}`,
      });

      invalidateSortOrderCache('training_plans');
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
