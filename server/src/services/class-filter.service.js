import { prisma } from '../lib/prisma.js';
import { getCurrentSemesterInfo } from './settings.service.js';

/**
 * 构建班级筛选条件（供 listClasses 和 exportClasses 共用）
 * @param {Object} query - 请求查询参数
 * @returns {Promise<Object>} Prisma where 条件
 */
export async function buildClassFilter(query) {
  const {
    name,
    major_id,
    college_id,
    status,
    training_level_id,
    plan_id,
    enrollment_year,
    is_combined,
  } = query;

  const where = {};
  if (name) where.name = { contains: name };

  if (major_id) {
    where.major_id = Number(major_id);
  }

  if (college_id) {
    where.college_id = Number(college_id);
  }

  // 合班筛选：1=只看合班班级，0=只看非合班班级，不传=全部
  if (is_combined === '1' || is_combined === 1 || is_combined === true) {
    where.combination_id = { not: null };
  } else if (is_combined === '0' || is_combined === 0 || is_combined === false) {
    where.combination_id = null;
  }

  let dynamicStatusFilter = null;
  if (status === 'left_school') {
    dynamicStatusFilter = [{ is_left_school: true }];
  } else if (status === 'active' || status === 'graduated') {
    const semesterInfo = await getCurrentSemesterInfo();
    if (semesterInfo) {
      const startYear = semesterInfo.startYear;
      const durations = await prisma.classes.findMany({
        select: { duration_years: true },
        distinct: ['duration_years'],
      });
      const durationValues = durations.map((d) => d.duration_years).filter((d) => d != null);

      dynamicStatusFilter = durationValues.map((d) => ({
        duration_years: d,
        is_left_school: false,
        enrollment_year:
          status === 'active'
            ? { gte: startYear - d + 1, lte: startYear } // 审计修复：补上界，排除未来入学班级
            : { lt: startYear - d + 1 },
      }));
    }
  } else if (status) {
    // P2-6: 班级 status 状态机不存在 inactive 等取值，但 schema 允许任意字符串。
    // 对未知 status 显式返回永远不匹配的条件，避免静默忽略导致返回全量数据。
    return { where: { id: -1 }, planNotFound: false };
  }

  if (training_level_id) {
    where.training_level_id = Number(training_level_id);
  }

  if (enrollment_year) {
    where.enrollment_year = Number(enrollment_year);
  }

  if (plan_id) {
    if (plan_id === 'none') {
      // 归档方案不作为现行方案：仅被归档方案覆盖的班级应视为"未关联方案"
      const allPlans = await prisma.training_plans.findMany({
        where: { status: { not: 'archived' } },
        select: { id: true, major_id: true, training_level_id: true },
      });

      where.custom_plan_id = null;

      const notConditions = [];
      const majorIdsWithPlans = [
        ...new Set(allPlans.filter((p) => p.major_id).map((p) => p.major_id)),
      ];
      if (majorIdsWithPlans.length > 0) {
        notConditions.push({ major_id: { in: majorIdsWithPlans } });
      }

      const levelIdsWithPlans = [
        ...new Set(allPlans.filter((p) => p.training_level_id).map((p) => p.training_level_id)),
      ];
      if (levelIdsWithPlans.length > 0) {
        notConditions.push({ training_level_id: { in: levelIdsWithPlans } });
      }

      if (notConditions.length > 0) {
        where.NOT = { OR: notConditions };
      }
    } else {
      const planIdNum = Number(plan_id);
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
        return { where: null, planNotFound: true };
      }
    }
  }

  let finalWhere = where;
  if (dynamicStatusFilter) {
    finalWhere = {
      AND: [where, { OR: dynamicStatusFilter }],
    };
  }

  return { where: finalWhere, planNotFound: false };
}
