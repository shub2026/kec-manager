/**
 * getActiveClassFilter / invalidateDurationCache 已迁移至 semester.service.js
 *
 * 本文件保留 re-export，保持向后兼容，
 * 让其他文件 `import { getActiveClassFilter, invalidateDurationCache } from './class.service.js'` 仍可工作。
 */
export { getActiveClassFilter, invalidateDurationCache } from './semester.service.js';
