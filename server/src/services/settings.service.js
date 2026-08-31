/**
 * 学期相关函数已迁移至 semester.service.js
 *
 * 本文件保留 re-export 与 parseSemesterString 兼容包装，
 * 让其他未迁移的文件 `import { parseSemesterString, ... } from './settings.service.js'` 仍可工作。
 *
 * 注意：parseSemesterString 返回 {success, data} 结构（兼容旧调用方），
 * 而底层 semester.service.js#parseSemester 返回 null 或对象。
 */
import { parseSemester } from './semester.service.js';
import { prisma } from '../lib/prisma.js';
import { log } from '../utils/logger.js';

// 重新导出学期相关函数，保持向后兼容
export {
  formatSemesterLabel,
  getCurrentSemesterInfo,
  getSemesterInfoFromRequest,
  getSemesterStartMonth,
  invalidateSemesterCache,
} from './semester.service.js';

/**
 * @deprecated 请改用 semester.service.js#parseSemester
 * 包装新 parseSemester，返回 {success, data} 兼容旧调用方
 *
 * 旧返回结构：{ success: boolean, error?: string, data?: object }
 * 新 parseSemester 返回：null 或 { startYear, endYear, semesterIndex, raw, label }
 *
 * @param {string} semester - 学期字符串
 * @returns {{success: boolean, error?: string, data?: object}}
 */
export function parseSemesterString(semester) {
  const result = parseSemester(semester);
  if (!result) {
    return { success: false, error: '学期格式错误，应为 YYYY-YYYY-N' };
  }
  return { success: true, data: result };
}

/**
 * 读取单个系统设置值
 * @param {string} key - 设置键
 * @param {string|null} defaultValue - 未配置时的默认值
 * @returns {Promise<string|null>}
 */
export async function getSettingValue(key, defaultValue = null) {
  const row = await prisma.system_settings.findUnique({ where: { key } });
  return row ? row.value : defaultValue;
}

/**
 * 注册开放开关：仅当 register_enabled 显式为 'true' 时返回 true。
 * 键缺失或 DB 异常时 fail-close（视为关闭），避免数据库故障期间注册被意外放行。
 * 与 settings.controller.js DEFAULT_SETTINGS.register_enabled 默认值 'false' 保持一致。
 * @returns {Promise<boolean>}
 */
export async function isRegisterEnabled() {
  try {
    return (await getSettingValue('register_enabled', 'false')) === 'true';
  } catch (e) {
    log.warn('读取注册开放开关失败，按关闭处理（fail-close）', { error: e.message });
    return false;
  }
}
