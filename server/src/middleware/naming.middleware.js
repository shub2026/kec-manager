/**
 * 命名转换中间件
 *
 * 自动处理请求和响应中的字段命名转换：
 * - 请求：将 req.body 从驼峰转换为下划线（适配数据库）
 * - 响应：将 res.json 从下划线转换为驼峰（适配前端）
 */

import { camelToSnake, snakeToCamel } from '../utils/naming.js';

/**
 * 请求体转换中间件
 * 将客户端发送的驼峰命名请求体转换为下划线命名
 */
export function convertRequestNaming(req, res, next) {
  // 只处理有 body 的请求（POST, PUT, PATCH 等）
  if (req.body && Object.keys(req.body).length > 0) {
    req.body = camelToSnake(req.body);
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
      const SKIP_KEYS = new Set(['code', 'message', 'success']);
      for (const key of Object.keys(data)) {
        if (SKIP_KEYS.has(key)) continue;
        const val = data[key];
        if (Array.isArray(val)) {
          data[key] = val.map((item) =>
            item && typeof item === 'object' && !Array.isArray(item) ? snakeToCamel(item) : item
          );
        } else if (val && typeof val === 'object' && !Array.isArray(val)) {
          // 嵌套分页对象（如 data.data.list）
          if (Array.isArray(val.list)) {
            val.list = val.list.map((item) =>
              item && typeof item === 'object' ? snakeToCamel(item) : item
            );
          }
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
 */
export function autoConvertNaming() {
  return [convertRequestNaming, convertResponseNaming];
}
