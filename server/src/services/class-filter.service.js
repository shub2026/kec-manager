import { prisma } from '../lib/prisma.js';
import { getCurrentSemesterInfo } from './settings.service.js';

/**
 * 构建班级筛选条件（供 listClasses 和 exportClasses 共用）
 * @param {Object} query - 请求查询参数
 * @returns {Promise<Object>} Prisma where 条件
 */
export async function buildClassFilter(query) {
  const { name, major_id, college_id, status, training_level_id, plan_id, enrollment_year } =
    query;

  const where = {};
  if (name) where.name = { contains: name };

  if (major_id) {
    where.major_id = Number(major_id);
  }

  if (college_id) {
    where.college_id = Number(college_id);
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
          status === 'active' ? { gte: startYear - d + 1 } : { lt: startYear - d + 1 },
      }));
    }
  }

  if (training_level_id) {
    where.training_level_id = Number(training_level_id);
  }

  if (enrollment_year) {
    where.enrollment_year = Number(enrollment_year);
  }

  if (plan_id) {
    if (plan_id === 'none') {
      const allPlans = await prisma.training_plans.findMany({
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
