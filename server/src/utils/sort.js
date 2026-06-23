/**
 * 排序工具集
 *
 * 提供排序值计算、标准化、自动修复和缓存失效功能
 */
import { prisma } from '../lib/prisma.js';
import { log } from './logger.js';

const CACHE_TTL = 5 * 60 * 1000;
const sortCache = new Map();

export function invalidateSortOrderCache(modelName) {
  if (modelName) {
    sortCache.delete(modelName);
  } else {
    sortCache.clear();
  }
}

export async function getNextSortOrder(prismaClient, modelName) {
  const maxSort = await prismaClient[modelName].aggregate({
    _max: { sort_order: true },
  });
  return (maxSort._max.sort_order || 0) + 1;
}

export function normalizeSortOrder(value, defaultOrder) {
  if (value !== undefined) {
    return Number(value);
  }
  return defaultOrder;
}

export function buildUpdateData(data, allowedFields) {
  const updateData = {};

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      if (field === 'sort_order') {
        updateData[field] = Number(data[field]);
      } else {
        updateData[field] = data[field];
      }
    }
  }

  return updateData;
}

/**
 * 检查并自动修复重复的 sort_order 值
 * @param {string} modelName - Prisma 模型名称（如 'majors', 'courses'）
 * @param {object} [where={}] - 可选的过滤条件
 * @returns {Promise<boolean>} 是否执行了修复
 */
export async function autoFixSortOrder(modelName, where = {}) {
  const cacheKey = `${modelName}:${JSON.stringify(where)}`;
  const cached = sortCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) return false;

  try {
    const items = await prisma[modelName].findMany({
      where,
      select: { id: true, sort_order: true },
      orderBy: { id: 'asc' },
    });

    if (!items || items.length <= 1) {
      sortCache.set(cacheKey, { at: Date.now() });
      return false;
    }

    const sortValues = items.map((i) => i.sort_order);
    const uniqueValues = new Set(sortValues);

    const needsFix = uniqueValues.size === 1 || uniqueValues.size < items.length * 0.5;

    if (!needsFix) {
      sortCache.set(cacheKey, { at: Date.now() });
      return false;
    }

    const updates = items.map((item, index) =>
      prisma[modelName].update({
        where: { id: item.id },
        data: { sort_order: index + 1 },
      })
    );

    await prisma.$transaction(updates);
    sortCache.set(cacheKey, { at: Date.now() });
    return true;
  } catch (e) {
    log.error(`自动修复 ${modelName} 排序失败`, { error: e.message });
    return false;
  }
}
