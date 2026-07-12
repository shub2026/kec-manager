import { prisma } from '../lib/prisma.js';

/**
 * 构建"班级必须能关联到培养方案"的 Prisma 过滤条件
 * M-6 说明：此 filter 仅为"粗筛"——收集所有方案涉及的专业 ID 和层次 ID 构建 OR 条件。
 * 精确匹配由下游 findBestMatchPlan 完成（逐班逐方案比对）。
 * 数据量较大时此 OR 条件在 SQLite 中性能较差，但通常班级/方案数量有限，暂可接受。
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
  // L-3 修复：使用 != null 替代 truthy 检查，避免 custom_plan_id=0 被跳过
  if (cls.custom_plan_id != null && cls.custom_plan_id === plan.id) return true;

  // 未设置自定义方案的班级才走通用匹配
  if (cls.custom_plan_id == null) {
    // 2. 按专业匹配(如果方案设置了专业,检查班级的专业是否相同)
    if (plan.major_id && cls.major_id && cls.major_id === plan.major_id) return true;
    // 3. 按层次匹配(如果方案设置了层次,检查班级的层次是否相同)
    if (
      plan.training_level_id &&
      cls.training_level_id &&
      cls.training_level_id === plan.training_level_id
    )
      return true;
  }

  return false;
}

/**
 * 为班级查找最佳匹配的培养方案
 * M-4: 区分匹配优先级——自定义方案 > 专业匹配 > 层次匹配
 * @param {object} cls - 班级对象
 * @param {Array} matchingPlans - 候选方案列表
 * @param {Map} classPlanMap - 自定义方案映射表（可选）
 * @returns {object|null} 最佳匹配的方案，无则返回null
 */
export function findBestMatchPlan(cls, matchingPlans, classPlanMap = null) {
  // M-3修复：按 created_at 降序排序，确保多个匹配方案时取最新创建者为确定性结果
  const sortedPlans = [...matchingPlans].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });

  // 1. 自定义方案优先
  // 审计修复：使用 != null 替代 truthy 检查，与 L-3 修复保持一致
  if (cls.custom_plan_id != null) {
    // 优先从传入的 Map 取
    let customPlan = classPlanMap?.get(cls.id);
    // Map 缺失或未命中时，自动从 sortedPlans 中查找（消除 footgun）
    if (!customPlan) {
      customPlan = sortedPlans.find((p) => p.id === cls.custom_plan_id);
    }
    if (customPlan) return customPlan;
  }

  // M-4: 两阶段匹配——先找专业匹配，再找层次匹配
  let majorMatch = null;
  let levelMatch = null;

  for (const plan of sortedPlans) {
    if (cls.custom_plan_id == null) {
      // 按专业匹配
      if (!majorMatch && plan.major_id && plan.major_id === cls.major_id) {
        majorMatch = plan;
      }
      // 按层次匹配
      if (
        !levelMatch &&
        plan.training_level_id &&
        plan.training_level_id === cls.training_level_id
      ) {
        levelMatch = plan;
      }
    }
  }

  // 专业匹配优先于层次匹配
  return majorMatch || levelMatch || null;
}
