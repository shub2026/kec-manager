/**
 * 命名转换中间件
 *
 * 自动处理请求和响应中的字段命名转换：
 * - 请求：将 req.body 从驼峰转换为下划线（适配数据库）
 * - 响应：将 res.json 从下划线转换为驼峰（适配前端）
 */

import { camelToSnake, snakeToCamel } from '../utils/naming.js';
import { log } from '../utils/logger.js';

const isDev = process.env.NODE_ENV !== 'production';

// 响应转换时跳过的顶层字段（框架约定字段，不做命名转换）
const SKIP_KEYS = new Set(['code', 'message', 'success']);

/**
 * 检测对象中是否存在「已经是 snake_case 的 key 被错误地当作 camelCase 再转一次」
 * 例如：前端误发 current_semester（snake），中间件会转成 current__semester（双下划线）
 * 一旦发现此类字段，在 dev 环境打印 warning，帮助定位前后端命名不一致
 */
function detectDoubleConversion(obj, direction, path = '') {
  if (!isDev || !obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => detectDoubleConversion(item, direction, `${path}[${i}]`));
    return;
  }
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    // snake_case key 在请求方向被再次 camelToSnake 会产生双下划线
    if (direction === 'request' && key.includes('_')) {
      const reSnaked = key.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
      if (reSnaked !== key && reSnaked.includes('__')) {
        log.warn('[Naming] 请求字段已是 snake_case，被中间件再次转换', {
          path: path || '(root)',
          field: key,
          converted: reSnaked,
          hint: '前端应使用 camelCase，由中间件统一转换',
        });
      }
    }
    // 递归检查嵌套对象（限制深度避免性能问题）
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      detectDoubleConversion(val, direction, path ? `${path}.${key}` : key);
    }
  }
}

/**
 * 请求体转换中间件
 * 将客户端发送的驼峰命名请求体和查询参数转换为下划线命名
 */
export function convertRequestNaming(req, res, next) {
  // 处理 body（POST, PUT, PATCH 等）
  if (req.body && Object.keys(req.body).length > 0) {
    detectDoubleConversion(req.body, 'request');
    req.body = camelToSnake(req.body);
  }

  // 处理 query params（GET 请求）
  // Express 5 中 req.query 是 prototype 上的 getter，每次访问都重新解析 URL 返回新对象，
  // 原地 delete/set 修改的是临时对象，完全无效。必须用 Object.defineProperty 重定义 getter，
  // 让后续访问返回已转换的缓存对象。
  const originalQuery = req.query;
  if (originalQuery && typeof originalQuery === 'object') {
    let needsReconvert = false;
    const converted = {};
    for (const key of Object.keys(originalQuery)) {
      const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      if (snakeKey !== key) needsReconvert = true;
      converted[snakeKey] = originalQuery[key];
    }
    if (needsReconvert) {
      Object.defineProperty(req, 'query', {
        configurable: true,
        enumerable: true,
        get: () => converted,
      });
    }
  }

  next();
}

/**
 * 响应转换中间件工厂函数
 * 拦截 res.json，将返回数据从下划线命名转换为驼峰命名
 */
export function convertResponseNaming(req, res, next) {
  // 保存原始的 json 方法
  const originalJson = res.json.bind(res);

  // 重写 json 方法
  res.json = function (data) {
    if (data && typeof data === 'object') {
      // M-1: 通用转换——遍历顶层所有字段，对对象或对象数组执行 snake→camel 转换
      for (const key of Object.keys(data)) {
        if (SKIP_KEYS.has(key)) continue;
        const val = data[key];
        if (Array.isArray(val)) {
          data[key] = val.map((item) =>
            item && typeof item === 'object' && !Array.isArray(item) ? snakeToCamel(item) : item
          );
        } else if (val && typeof val === 'object' && !Array.isArray(val)) {
          // 嵌套分页对象（如 data.data.list）—— snakeToCamel 递归处理所有嵌套含数组
          data[key] = snakeToCamel(val);
        }
      }
    }
    return originalJson(data);
  };

  next();
}

/**
 * 组合中间件
 * 同时应用请求和响应转换
 * // TODO: exported for future use, currently unused
 */
export function autoConvertNaming() {
  return [convertRequestNaming, convertResponseNaming];
}
