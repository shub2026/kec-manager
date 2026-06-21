/**
 * 命名转换工具
 *
 * 用于在驼峰命名(camelCase)和下划线命名(snake_case)之间进行转换
 * 实现前后端数据传输的自动命名转换
 */

/**
 * 将驼峰命名转换为下划线命名
 * @param {*} obj - 要转换的对象、数组或基本类型
 * @returns {*} 转换后的结果
 *
 * @example
 * camelToSnake({ enrollmentYear: 2024, studentCount: 30 })
 * // => { enrollment_year: 2024, student_count: 30 }
 */
export function camelToSnake(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  // Date 对象不需要转换，直接返回
  if (obj instanceof Date) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => camelToSnake(item));
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    result[snakeKey] =
      typeof value === 'object' && value !== null && !(value instanceof Date)
        ? camelToSnake(value)
        : value;
  }
  return result;
}

/**
 * 将下划线命名转换为驼峰命名
 * @param {*} obj - 要转换的对象、数组或基本类型
 * @returns {*} 转换后的结果
 *
 * @example
 * snakeToCamel({ enrollment_year: 2024, student_count: 30 })
 * // => { enrollmentYear: 2024, studentCount: 30 }
 */
export function snakeToCamel(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  // Date 对象不需要转换，直接返回
  if (obj instanceof Date) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => snakeToCamel(item));
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] =
      typeof value === 'object' && value !== null && !(value instanceof Date)
        ? snakeToCamel(value)
        : value;
  }
  return result;
}

/**
 * 递归转换对象的第一层键名为驼峰（保留嵌套对象的原始结构）
 * 用于部分转换场景
 */
export function shallowSnakeToCamel(obj) {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj;

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

/**
 * 递归转换对象的第一层键名为下划线（保留嵌套对象的原始结构）
 * 用于部分转换场景
 */
export function shallowCamelToSnake(obj) {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj;

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    result[snakeKey] = value;
  }
  return result;
}
