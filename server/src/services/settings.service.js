import { prisma } from '../lib/prisma.js';
import { log } from '../utils/logger.js'; // L1修复：使用winston logger

// M3 修复：学期信息 TTL 缓存（避免批量操作时重复查询 DB）
const semesterCache = new Map();
const SEMESTER_TTL = 30 * 1000; // 30 秒

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of semesterCache) {
    if (value.expireAt <= now) semesterCache.delete(key);
  }
}, 5 * 60 * 1000).unref();

export function invalidateSemesterCache() {
  semesterCache.delete('current_semester');
}

export async function getCurrentSemesterInfo() {
  const cacheKey = 'current_semester';
  const now = Date.now();
  const cached = semesterCache.get(cacheKey);
  if (cached && cached.expireAt > now) return cached.data;

  const setting = await prisma.system_settings.findUnique({ where: { key: 'current_semester' } });
  if (!setting) return null;

  // H-1修复：复用 parseSemesterString 做防御性校验，与写入/查询路径统一标准
  // 防止库中已存在非法值（如 0000-0001-1、2025-2027-2）导致后续计算静默失效
  const result = parseSemesterString(setting.value);
  if (!result.success) {
    log.error('Invalid current_semester in database', {
      value: setting.value,
      error: result.error,
    });
    return null;
  }

  semesterCache.set(cacheKey, { data: result.data, expireAt: now + SEMESTER_TTL });
  return result.data;
}

/**
 * 将学期格式转换为友好显示格式
 * @param {number} startYear - 学年起始年
 * @param {number} endYear - 学年结束年
 * @param {number} semesterIndex - 学期索引(1或2)
 * @returns {string} 格式化后的学期标签，如 "2026年春季(第2学期)"
 */
export function formatSemesterLabel(startYear, endYear, semesterIndex) {
  const season = semesterIndex === 1 ? '秋季' : '春季';
  const displayYear = semesterIndex === 1 ? startYear : endYear;

  return `${displayYear}年${season}(第${semesterIndex}学期)`;
}

/**
 * M3修复：统一学期参数解析逻辑
 * 解析YYYY-YYYY-N格式的学期字符串
 * @param {string} semester - 学期字符串，格式为 YYYY-YYYY-N
 * @returns {{success: boolean, error?: string, data?: object}} 解析结果
 */
export function parseSemesterString(semester) {
  if (!semester || typeof semester !== 'string') {
    return { success: false, error: '学期参数不能为空' };
  }

  const parts = semester.split('-');
  if (parts.length !== 3) {
    return { success: false, error: '学期格式错误，应为 YYYY-YYYY-N' };
  }

  const startYear = Number(parts[0]);
  const endYear = Number(parts[1]);
  const semesterIndex = Number(parts[2]);

  if (isNaN(startYear) || isNaN(endYear) || isNaN(semesterIndex)) {
    return { success: false, error: '学期格式错误，应为 YYYY-YYYY-N' };
  }

  // S-04 修复：校验学期索引范围和年份连续性
  if (semesterIndex < 1 || semesterIndex > 2) {
    return { success: false, error: '学期索引必须为1（秋季）或2（春季）' };
  }
  if (endYear !== startYear + 1) {
    return { success: false, error: '结束年份必须为起始年份+1，如 2025-2026-1' };
  }
  if (startYear < 2000 || startYear > 2099) {
    return { success: false, error: '年份范围应在 2000-2099 之间' };
  }

  // 生成学期标签
  const season = semesterIndex === 1 ? '秋季' : '春季';
  const displayYear = semesterIndex === 1 ? startYear : endYear;
  const label = `${displayYear}年${season}(第${semesterIndex}学期)`;

  return {
    success: true,
    data: { startYear, endYear, semesterIndex, raw: semester, label },
  };
}

/**
 * M3修复：从请求中获取学期信息（优先使用查询参数，否则使用全局设置）
 * @param {object} req - Express请求对象
 * @returns {Promise<object|null>} 学期信息对象或null
 */
export async function getSemesterInfoFromRequest(req) {
  const { semester } = req.query;

  // 优先使用传入的学期参数
  if (semester) {
    const result = parseSemesterString(semester);
    if (result.success) {
      return result.data;
    }
    // 如果解析失败，返回null让调用者处理
    return null;
  }

  // 否则使用全局设置
  return await getCurrentSemesterInfo();
}
