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
    // 如果 data 有 data 属性（标准响应格式），转换 data 内部的内容
    if (
      data &&
      typeof data === 'object' &&
      'data' in data &&
      data.data !== null &&
      data.data !== undefined
    ) {
      data.data = snakeToCamel(data.data);
    }
    // 如果有 items 数组（分页响应），转换数组中的每个对象
    if (data && typeof data === 'object' && Array.isArray(data.items)) {
      data.items = data.items.map((item) => snakeToCamel(item));
    }
    // 如果有 logs 数组（审计日志响应），转换数组中的每个对象
    if (data && typeof data === 'object' && Array.isArray(data.logs)) {
      data.logs = data.logs.map((log) => snakeToCamel(log));
    }
    // 如果 data.data 是分页对象且包含 list 数组，转换 list 中每个对象
    if (
      data &&
      typeof data === 'object' &&
      data.data &&
      typeof data.data === 'object' &&
      Array.isArray(data.data.list)
    ) {
      data.data.list = data.data.list.map((item) => snakeToCamel(item));
    }
    // 转换顶层的其他字段（如 errors、message 等保持不变）
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
