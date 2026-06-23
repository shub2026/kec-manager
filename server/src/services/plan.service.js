import { prisma } from '../lib/prisma.js';

/**
 * 构建"班级必须能关联到培养方案"的 Prisma 过滤条件
 * @returns {Promise<object>} Prisma where 条件片段（{ OR: [...] }）
 */
export async function buildClassWithPlanFilter() {
  const allPlans = await prisma.training_plans.findMany({
    select: { id: true, major_id: true, college_id: true, training_level_id: true },
  });

  const conditions = [];
  conditions.push({ custom_plan_id: { not: null } });

  const majorIdsWithPlans = [...new Set(allPlans.filter((p) => p.major_id).map((p) => p.major_id))];
  if (majorIdsWithPlans.length > 0) {
    conditions.push({ major_id: { in: majorIdsWithPlans } });
  }

  const levelIdsWithPlans = [
    ...new Set(allPlans.filter((p) => p.training_level_id).map((p) => p.training_level_id)),
  ];
  if (levelIdsWithPlans.length > 0) {
    conditions.push({ training_level_id: { in: levelIdsWithPlans } });
  }

  return { OR: conditions };
}

/**
 * M4修复：统一的方案匹配逻辑
 * 提供findBestMatchPlan和isClassMatchPlan的共享实现
 */

/**
 * 判断班级是否匹配指定培养方案(三级互斥匹配)
 * 优先级:自定义方案 > (按专业 OR 按层次,二选一,无先后之分)
 * 注意:major_id/training_level_id 为可空字段,必须做真值守卫,避免 null===null 误匹配
 * @param {object} cls - 班级对象(包含major_id, training_level_id, custom_plan_id)
 * @param {object} plan - 培养方案对象(包含id, major_id, training_level_id)
 * @returns {boolean} 是否匹配
 */
export function isClassMatchPlan(cls, plan) {
  // 1. 自定义方案优先匹配
  if (cls.custom_plan_id && cls.custom_plan_id === plan.id) return true;

  // 未设置自定义方案的班级才走通用匹配
  if (!cls.custom_plan_id) {
    // 2. 按专业匹配(如果方案设置了专业,检查班级的专业是否相同)
    if (plan.major_id && cls.major_id && cls.major_id === plan.major_id) return true;
    // 3. 按层次匹配(如果方案设置了层次,检查班级的层次是否相同)
    if (plan.training_level_id && cls.training_level_id && cls.training_level_id === plan.training_level_id)
      return true;
  }

  return false;
}

/**
 * 为班级查找最佳匹配的培养方案
 * @param {object} cls - 班级对象
 * @param {Array} matchingPlans - 候选方案列表
 * @param {Map} classPlanMap - 自定义方案映射表（可选）
 * @returns {object|null} 最佳匹配的方案，无则返回null
 */
export function findBestMatchPlan(cls, matchingPlans, classPlanMap = null) {
  // 1. 自定义方案优先
  if (cls.custom_plan_id && classPlanMap) {
    const customPlan = classPlanMap.get(cls.id);
    if (customPlan) return customPlan;
  }

  // 2. 遍历所有方案，根据方案的关联类型来匹配
  for (const plan of matchingPlans) {
    // 方案按专业关联：检查班级的专业是否匹配
    if (plan.major_id && plan.major_id === cls.major_id) {
      return plan;
    }

    // 方案按层次关联：检查班级的层次是否匹配
    if (plan.training_level_id && plan.training_level_id === cls.training_level_id) {
      return plan;
    }
  }

  return null;
}
