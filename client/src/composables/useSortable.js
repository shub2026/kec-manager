import { ElMessage } from 'element-plus';

/**
 * 通用排序 Composable
 * @param {object} list - Vue ref 列表数据
 * @param {Function} updateFn - 更新函数 (id, data) => Promise
 * @param {Function} reloadFn - 重新加载函数 () => Promise
 * @param {object} options - 可选配置
 * @param {string} options.sortField - 排序字段名（默认 'sortOrder'）
 * @param {Function} options.indexFinder - 自定义索引查找函数 (item) => number，用于 filtered list
 * @returns {object} { handleMoveUp, handleMoveDown }
 */
export function useSortable(list, updateFn, reloadFn, options = {}) {
  const sortField = options.sortField || 'sortOrder';
  const indexFinder = options.indexFinder || null;

  /**
   * 获取项目索引
   */
  function getItemIndex(item) {
    if (indexFinder) {
      return indexFinder(item);
    }
    return list.value.findIndex((i) => i.id === item.id);
  }

  /**
   * 上移
   */
  async function handleMoveUp(item, providedIndex) {
    const index = providedIndex !== undefined ? providedIndex : getItemIndex(item);
    if (index === 0 || index === -1) return;

    const currentItem = list.value[index];
    const prevItem = list.value[index - 1];

    try {
      // 如果排序值相同，使用基于位置的值
      const newCurrentSort =
        currentItem[sortField] === prevItem[sortField] ? index - 1 : prevItem[sortField];
      const newPrevSort =
        currentItem[sortField] === prevItem[sortField] ? index : currentItem[sortField];

      await Promise.all([
        updateFn(currentItem.id, { [sortField]: newCurrentSort }),
        updateFn(prevItem.id, { [sortField]: newPrevSort }),
      ]);

      ElMessage.success('排序已更新');
      await reloadFn();
    } catch (e) {
      if (import.meta.env.DEV) console.error('排序更新失败:', e);
      ElMessage.error('排序更新失败');
    }
  }

  /**
   * 下移
   */
  async function handleMoveDown(item, providedIndex) {
    const index = providedIndex !== undefined ? providedIndex : getItemIndex(item);
    if (index === -1 || index === list.value.length - 1) return;

    const currentItem = list.value[index];
    const nextItem = list.value[index + 1];

    try {
      // 如果排序值相同，使用基于位置的值
      const newCurrentSort =
        currentItem[sortField] === nextItem[sortField] ? index + 1 : nextItem[sortField];
      const newNextSort =
        currentItem[sortField] === nextItem[sortField] ? index : currentItem[sortField];

      await Promise.all([
        updateFn(currentItem.id, { [sortField]: newCurrentSort }),
        updateFn(nextItem.id, { [sortField]: newNextSort }),
      ]);

      ElMessage.success('排序已更新');
      await reloadFn();
    } catch (e) {
      if (import.meta.env.DEV) console.error('排序更新失败:', e);
      ElMessage.error('排序更新失败');
    }
  }

  return { handleMoveUp, handleMoveDown };
}
