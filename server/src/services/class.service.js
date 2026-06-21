import { prisma } from '../lib/prisma.js';
import { getCurrentSemesterInfo } from './settings.service.js';

/**
 * 构建"在读班级"的 Prisma WHERE 条件
 *
 * 在读条件：is_left_school = false 且 grade <= duration_years
 * 即 enrollment_year >= startYear - duration_years + 1
 *
 * 返回 { OR: [...] } 格式，可直接用作 Prisma where 条件
 *
 * @returns {object} Prisma WHERE 条件对象
 */
export async function getActiveClassFilter() {
  const semesterInfo = await getCurrentSemesterInfo();
  if (!semesterInfo) {
    // 降级方案：无法获取学期信息时，只排除离校班级
    return { is_left_school: false };
  }

  const startYear = semesterInfo.startYear;

  // 获取所有不重复的学制值
  const durations = await prisma.classes.findMany({
    select: { duration_years: true },
    distinct: ['duration_years'],
  });
  const durationValues = durations.map((d) => d.duration_years).filter((d) => d != null);

  // 对每种学制构建条件：enrollment_year >= startYear - duration_years + 1
  // active: grade <= duration → enrollment_year >= startYear - duration + 1
  return {
    OR: durationValues.map((d) => ({
      duration_years: d,
      is_left_school: false,
      enrollment_year: { gte: startYear - d + 1 },
    })),
  };
}
