import { prisma } from '../lib/prisma.js';
import { getCurrentSemesterInfo } from './settings.service.js';

/**
 * 构建班级筛选条件（供 listClasses 和 exportClasses 共用）
 * @param {Object} query - 请求查询参数
 * @returns {Promise<Object>} Prisma where 条件
 */
export async function buildClassFilter(query) {
  const { name, majorId, collegeId, status, trainingLevelId, planId, enrollmentYear } = query;

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
      const durationValues = durations.map((d) => d.duration_years).filter((d) => d != null);

      dynamicStatusFilter = durationValues.map((d) => ({
        duration_years: d,
        is_left_school: false,
        enrollment_year:
          status === 'active' ? { gte: startYear - d + 1 } : { lt: startYear - d + 1 },
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
