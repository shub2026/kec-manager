/**
 * 排序辅助工具
 *
 * 提供统一的排序值计算和标准化功能，消除控制器中的重复代码
 */

/**
 * 获取下一个排序值
 * @param {object} prisma - Prisma 客户端实例
 * @param {string} modelName - 模型名称（如 'majors', 'courses'）
 * @returns {Promise<number>} 下一个排序值
 */
export async function getNextSortOrder(prisma, modelName) {
  const maxSort = await prisma[modelName].aggregate({
    _max: { sort_order: true },
  });
  return (maxSort._max.sort_order || 0) + 1;
}

/**
 * 标准化排序字段
 * @param {*} value - 排序值
 * @param {number} defaultOrder - 默认排序值
 * @returns {number} 标准化后的排序值
 */
export function normalizeSortOrder(value, defaultOrder) {
  if (value !== undefined) {
    return Number(value);
  }
  return defaultOrder;
}

/**
 * 构建包含排序字段的更新数据对象
 * @param {object} data - 原始数据对象
 * @param {string[]} allowedFields - 允许更新的字段列表
 * @returns {object} 过滤后的数据对象
 */
export function buildUpdateData(data, allowedFields) {
  const updateData = {};

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      // 特殊处理排序字段
      if (field === 'sort_order') {
        updateData[field] = Number(data[field]);
      } else {
        updateData[field] = data[field];
      }
    }
  }

  return updateData;
}
