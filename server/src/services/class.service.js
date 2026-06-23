import { prisma } from '../lib/prisma.js';
import { getCurrentSemesterInfo } from './settings.service.js';

const DURATION_CACHE_TTL = 5 * 60 * 1000;
let durationCache = null;
let durationCacheAt = 0;

export function invalidateDurationCache() {
  durationCache = null;
  durationCacheAt = 0;
}

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
    return { is_left_school: false };
  }

  const startYear = semesterInfo.startYear;

  let durationValues;
  if (durationCache && Date.now() - durationCacheAt < DURATION_CACHE_TTL) {
    durationValues = durationCache;
  } else {
    const durations = await prisma.classes.findMany({
      select: { duration_years: true },
      distinct: ['duration_years'],
    });
    durationValues = durations.map((d) => d.duration_years).filter((d) => d != null);
    durationCache = durationValues;
    durationCacheAt = Date.now();
  }

  return {
    OR: durationValues.map((d) => ({
      duration_years: d,
      is_left_school: false,
      enrollment_year: { gte: startYear - d + 1 },
    })),
  };
}
