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
    const customLinkedCountMap = {};
    const matchedCountMap = {};
    plans.forEach((p) => {
      classCountMap[p.id] = 0;
      customLinkedCountMap[p.id] = 0;
      matchedCountMap[p.id] = 0;
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
    // 候选方案列表：包含有专业/层次的方案 + 被 custom_plan_id 引用的方案
    const referencedCustomPlanIds = new Set(
      allClasses.filter((c) => c.custom_plan_id).map((c) => c.custom_plan_id)
    );
    const candidatePlans = plans.filter(
      (p) => p.major_id || p.training_level_id || referencedCustomPlanIds.has(p.id)
    );

    for (const cls of allClasses) {
      // classCount：最佳匹配（用于"使用班级"列展示）
      const bestPlan = findBestMatchPlan(cls, candidatePlans, customPlanMap);
      if (bestPlan && classCountMap[bestPlan.id] !== undefined) {
        classCountMap[bestPlan.id]++;
      }
      // customLinkedClassCount：仅 custom_plan_id === plan.id 的班级数。
      // deletePlan 在事务中显式将这些班级的 custom_plan_id 置 null，
      // 让班级回归未关联状态——这才是删除时真正会被"解除关联"的班级。
      if (cls.custom_plan_id && customLinkedCountMap[cls.custom_plan_id] !== undefined) {
        customLinkedCountMap[cls.custom_plan_id]++;
      }
      // matchedClassCount：通过 isClassMatchPlan 任意匹配的班级数（含 major/level 匹配，
      // 也含 custom 匹配）。删除方案后这些班级将不再匹配此方案。
      // 注意：deletePlan 从不调用 isClassMatchPlan、也从不真正阻塞删除，
      // 此字段仅用于前端删除弹窗准确预告"删除后将丢失匹配的班级数"。
      for (const plan of plans) {
        if (isClassMatchPlan(cls, plan)) {
          if (matchedCountMap[plan.id] !== undefined) matchedCountMap[plan.id]++;
        }
      }
    }

    const plansWithCount = plans.map((plan) => {
      const customLinked = customLinkedCountMap[plan.id] || 0;
      return {
        ...plan,
        courseCount: plan.plan_courses.length,
        classCount: classCountMap[plan.id] || 0,
        // 删除时实际会被解除关联（custom_plan_id 置 null）的班级数
        customLinkedClassCount: customLinked,
        // 通过任意匹配（含 major/level 匹配）的班级数，删除后将丢失匹配
        matchedClassCount: matchedCountMap[plan.id] || 0,
        // 向后兼容：保留旧字段，值同 customLinkedClassCount。
        // deletePlan 从不真正阻塞删除流程，旧字段名保留以避免前端立即崩溃。
        blockingClassCount: customLinked,
      };
    });

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
    const { name, college_id, major_id, training_level_id, version, description, status } =
      req.body;
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
        status: status || 'draft',
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
    const {
      name,
      college_id,
      major_id,
      training_level_id,
      version,
      description,
      sort_order,
      status,
    } = req.body;

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
        // BIZ-H1修复：补全 sort_order 交换分支的审计记录
        await createAuditLog({
          action: 'update',
          module: 'trainingPlan',
          userId: req.user?.id,
          ip: req.ip,
          details: { id: Number(id), sort_order: Number(sort_order), type: 'sort_order' },
          result: 'success',
          message: `调整培养方案排序：${plan.name} → ${sort_order}`,
        });
        return success(res, plan, '更新成功');
      } catch (e) {
        if (e.code === 'P2025') {
          await createAuditLog({
            action: 'update',
            module: 'trainingPlan',
            userId: req.user?.id,
            ip: req.ip,
            details: { id: Number(id), sort_order: Number(sort_order), error: 'not_found' },
            result: 'failed',
            message: `调整培养方案排序失败：方案不存在`,
          });
          return fail(res, '培养方案不存在', 404);
        }
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

    if (status !== undefined) {
      updateData.status = status;
    }

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

    // 预先统计将被级联删除的子记录（用于审计日志，P2-3）
    // schema: plan_courses → plan_course_semesters → plan_textbooks（均 onDelete: Cascade）
    const [cascadeCourseCount, cascadeSemesterCount, cascadeTextbookCount] = await Promise.all([
      prisma.plan_courses.count({ where: { plan_id: planId } }),
      prisma.plan_course_semesters.count({
        where: { plan_courses: { plan_id: planId } },
      }),
      prisma.plan_textbooks.count({
        where: { plan_course_semesters: { plan_courses: { plan_id: planId } } },
      }),
    ]);

    try {
      // P2-7: 将解除关联操作移入事务内，并直接读取 updateMany 返回的 count 作为审计依据，
      // 避免原 findMany 在事务外读取导致的竞态（统计与实际解除数不一致）
      let unlinkedCount = 0;
      await prisma.$transaction(async (tx) => {
        // 1. 解除 custom_plan_id 直接引用，让班级回归未关联状态
        const unlinkResult = await tx.classes.updateMany({
          where: { custom_plan_id: planId },
          data: { custom_plan_id: null },
        });
        unlinkedCount = unlinkResult.count;
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
          unlinked_count: unlinkedCount,
          // 级联删除的子记录数量（schema onDelete: Cascade 自动执行）
          cascaded_plan_courses: cascadeCourseCount,
          cascaded_plan_course_semesters: cascadeSemesterCount,
          cascaded_plan_textbooks: cascadeTextbookCount,
        },
        message: `删除培养方案：${plan.name}${unlinkedCount > 0 ? `（同时解除 ${unlinkedCount} 个班级关联）` : ''}`,
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
