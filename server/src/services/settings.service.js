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
