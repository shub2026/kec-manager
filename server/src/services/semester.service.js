/**
 * 学期服务 - 统一收敛所有学期相关计算逻辑
 *
 * 设计目标：
 * - 消除 parseSemester / parseSemesterString 双实现不一致
 * - 消除 calcClassSemester 公式 5 处内联副本
 * - 统一 label 字段语义
 * - getActiveClassFilter 接受查询学期参数，避免学期错位
 *
 * 命名约定：所有函数返回的 semesterInfo 均含 { startYear, endYear, semesterIndex, raw, label }
 * 其中 raw = 原始字符串，label = 格式化字符串
 */

import { prisma } from '../lib/prisma.js';
import { log } from '../utils/logger.js';

const YEAR_MIN = 2000;
const YEAR_MAX = 2099;

/**
 * 解析 YYYY-YYYY-N 格式的学期字符串
 * 统一使用 Number + Number.isInteger 校验，禁止小数与杂尾字符串
 *
 * @param {string} semesterStr - 学期字符串，如 "2025-2026-1"
 * @returns {{startYear:number, endYear:number, semesterIndex:number, raw:string, label:string}|null}
 *          解析失败返回 null
 */
export function parseSemester(semesterStr) {
  if (typeof semesterStr !== 'string') return null;
  const trimmed = semesterStr.trim();
  if (!trimmed) return null;

  const parts = trimmed.split('-');
  if (parts.length !== 3) return null;

  const startYear = Number(parts[0]);
  const endYear = Number(parts[1]);
  const semesterIndex = Number(parts[2]);

  // 严格校验：必须是整数（拒绝 1.5 / 1abc / NaN）
  if (
    !Number.isInteger(startYear) ||
    !Number.isInteger(endYear) ||
    !Number.isInteger(semesterIndex)
  ) {
    return null;
  }
  if (semesterIndex < 1 || semesterIndex > 2) return null;
  if (endYear !== startYear + 1) return null;
  if (startYear < YEAR_MIN || startYear > YEAR_MAX) return null;

  return {
    startYear,
    endYear,
    semesterIndex,
    raw: trimmed,
    label: formatSemesterLabel(startYear, endYear, semesterIndex),
  };
}

/**
 * 格式化学期标签
 * @param {number} startYear
 * @param {number} endYear
 * @param {number} semesterIndex - 1=秋季, 2=春季
 * @returns {string} 如 "2025年秋季(第1学期)"
 */
export function formatSemesterLabel(startYear, endYear, semesterIndex) {
  const season = semesterIndex === 1 ? '秋季' : '春季';
  const displayYear = semesterIndex === 1 ? startYear : endYear;
  return `${displayYear}年${season}(第${semesterIndex}学期)`;
}

/**
 * 计算班级在指定学期下的相对学期序号
 *
 * 公式：grade = startYear - enrollment_year + 1
 *       currentSemesterNum = (grade - 1) * 2 + semesterIndex
 *
 * 每年按 2 学期计算（秋季=1，春季=2）
 *
 * @param {object} cls - 班级对象，需含 enrollment_year、duration_years
 * @param {object} semesterInfo - parseSemester 返回值
 * @returns {{grade:number, currentSemesterNum:number}|null} 越界返回 null
 */
export function calcClassSemester(cls, semesterInfo) {
  if (!cls || !semesterInfo) return null;
  // 防御：duration_years 缺失或为 0 时直接拒绝
  if (!cls.duration_years || cls.duration_years <= 0) return null;

  const grade = semesterInfo.startYear - cls.enrollment_year + 1;
  if (grade < 1 || grade > cls.duration_years) return null;
  const currentSemesterNum = (grade - 1) * 2 + semesterInfo.semesterIndex;
  return { grade, currentSemesterNum };
}

// === 全局当前学期缓存（保持与原 settings.service.js 行为一致）===

const semesterCache = new Map();
const SEMESTER_TTL = 30 * 1000;

setInterval(
  () => {
    const now = Date.now();
    for (const [key, value] of semesterCache) {
      if (value.expireAt <= now) semesterCache.delete(key);
    }
  },
  5 * 60 * 1000
).unref();

export function invalidateSemesterCache() {
  semesterCache.delete('current_semester');
}

/**
 * 获取全局当前学期信息（从 system_settings 读取）
 * @returns {Promise<object|null>}
 */
export async function getCurrentSemesterInfo() {
  const cacheKey = 'current_semester';
  const now = Date.now();
  const cached = semesterCache.get(cacheKey);
  if (cached && cached.expireAt > now) return cached.data;

  const setting = await prisma.system_settings.findUnique({ where: { key: 'current_semester' } });
  if (!setting) return null;

  const parsed = parseSemester(setting.value);
  if (!parsed) {
    log.error('Invalid current_semester in database', { value: setting.value });
    return null;
  }

  semesterCache.set(cacheKey, { data: parsed, expireAt: now + SEMESTER_TTL });
  return parsed;
}

/**
 * 从请求中获取学期信息（优先 query.semester，否则用全局当前学期）
 * @param {object} req - Express 请求对象
 * @returns {Promise<object|null>}
 */
export async function getSemesterInfoFromRequest(req) {
  const { semester } = req.query || {};
  if (semester) {
    return parseSemester(semester);
  }
  return await getCurrentSemesterInfo();
}

// === 在读班级过滤器 ===

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
 * 在读条件（按查询学期判定）：
 *   is_left_school = false 且 1 <= grade <= duration_years
 *   即 startYear - duration_years + 1 <= enrollment_year <= startYear
 *
 * @param {object} [semesterInfo] - 查询学期信息；缺省时回退全局当前学期
 * @returns {Promise<object>} Prisma WHERE 条件对象
 */
export async function getActiveClassFilter(semesterInfo) {
  // 显式传入查询学期；缺省时回退全局当前学期
  if (!semesterInfo) {
    semesterInfo = await getCurrentSemesterInfo();
  }
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
      // P1-5 修复：补 grade >= 1 下界（enrollment_year <= startYear）
      enrollment_year: { gte: startYear - d + 1, lte: startYear },
    })),
  };
}

/**
 * 构建连续使用教材的映射表
 *
 * 同一课程 (plan_course_id) 在上一个学期 (semester - 1) 已使用相同教材 (textbook_id)，
 * 则该教材在**当前学期**视为"连续使用"，无需重复征订。
 *
 * 返回 Map<`${plan_course_id}_${textbook_id}`, Set<semester>>，
 * 其中 Set 仅包含"上学期也存在同一教材"的学期号，调用方须按当前学期号精确查询。
 *
 * @param {Array<{plan_course_id: number, textbook_id: number, semester: number}>} records
 * @returns {Promise<Map<string, Set<number>>>}
 */
export async function buildConsecutiveTextbookMap(records) {
  const map = new Map();
  if (!records.length) return map;

  // 按 (plan_course_id, textbook_id) 聚合所有学期号
  const semesterMap = new Map();
  for (const r of records) {
    const key = `${r.plan_course_id}_${r.textbook_id}`;
    if (!semesterMap.has(key)) semesterMap.set(key, new Set());
    semesterMap.get(key).add(r.semester);
  }

  // 对每组，找出"上学期也存在"的学期号（即连续使用的学期）
  for (const [key, semesters] of semesterMap) {
    const consecutiveSemesters = new Set();
    for (const sem of semesters) {
      if (sem > 1 && semesters.has(sem - 1)) {
        consecutiveSemesters.add(sem);
      }
    }
    if (consecutiveSemesters.size > 0) {
      map.set(key, consecutiveSemesters);
    }
  }

  return map;
}
