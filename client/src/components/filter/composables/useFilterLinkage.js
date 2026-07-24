/**
 * 通用筛选器联动Hook
 *
 * @param {Object} options - 配置选项
 * @param {Ref} options.filters - 筛选条件响应式对象
 * @param {Object} options.relations - 关联关系数据 { relationName: { parentId: [childId1, childId2] } }
 * @param {Array} options.fields - 筛选项配置数组
 * @returns {Object} - 包含过滤后的选项和处理函数
 */

import { computed } from 'vue';

export function useFilterLinkage({ filters, relations = {} }) {
  /**
   * 根据当前筛选条件动态计算某个字段的可用选项
   * @param {String} fieldName - 字段名
   * @param {Array} allOptions - 该字段的所有选项
   * @param {Array} parentFields - 父级字段列表(按优先级排序)
   * @param {String} relationKey - 关联关系的key前缀 (如: collegeMajorRelation 中的 collegeMajor)
   */
  const getFilteredOptions = computed(
    () =>
      (fieldName, allOptions, parentFields = [], relationKey = '') => {
        // 如果没有父级字段或没有选择任何父级,返回所有选项
        if (!parentFields.length || !relationKey) {
          return allOptions;
        }

        // 从后往前查找第一个有值的父级字段(优先级: 最近的父级 > 远的父级)
        let selectedParentValue = null;
        let selectedParentField = null;

        for (let i = parentFields.length - 1; i >= 0; i--) {
          const parentField = parentFields[i];
          const value = filters.value[parentField];
          if (value && value !== 'none') {
            selectedParentValue = value;
            selectedParentField = parentField;
            break;
          }
        }

        // 如果没有选中的父级,返回所有选项
        if (!selectedParentValue) {
          return allOptions;
        }

        // 构建关联关系的key
        // 例: college + Major + Relation = collegeMajorRelation
        const relationKeyName = `${selectedParentField}${capitalizeFirst(fieldName)}Relation`;

        // 支持ref和普通对象两种类型
        const relationData = relations[relationKeyName]?.value ?? relations[relationKeyName];

        if (!relationData) {
          return allOptions;
        }

        // 获取该父级值对应的子级ID列表
        const allowedIds = relationData[String(selectedParentValue)] || [];

        if (allowedIds.length === 0) {
          return [];
        }

        // 过滤选项
        return allOptions.filter((option) => allowedIds.includes(option.id));
      }
  );

  /**
   * 首字母大写辅助函数
   */
  function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * 当父级字段变化时,清空当前字段及所有子级字段
   * @param {String} changedField - 变化的字段
   * @param {Array} childFields - 需要清空的子级字段列表
   * @param {Function} emitChange - 触发change事件的回调
   */
  const handleParentChange = (changedField, childFields, emitChange) => {
    childFields.forEach((field) => {
      if (filters.value[field]) {
        filters.value[field] = null;
      }
    });
    emitChange();
  };

  /**
   * 多条件交集过滤(用于入学年份等需要根据多个父级取交集的场景)
   * @param {String} fieldName - 字段名
   * @param {Array} allOptions - 所有选项
   * @param {Object} parentRelations - 父级关联关系映射 { parentField: relationData }
   */
  const getIntersectedOptions = computed(() => (fieldName, allOptions, parentRelations) => {
    let resultSet = new Set();
    let hasAnyFilter = false;

    // 遍历所有父级字段,收集它们的选项并取交集
    for (const [parentField, relationDataRef] of Object.entries(parentRelations)) {
      // FR3修复：null 守卫，与 getFilteredOptions 对齐
      const relationData = relationDataRef?.value ?? relationDataRef;
      if (!relationData) continue;

      const parentValue = filters.value[parentField];

      if (!parentValue || parentValue === 'none') {
        continue;
      }

      hasAnyFilter = true;
      const allowedValues = relationData[String(parentValue)] || [];

      if (allowedValues.length === 0) {
        return []; // 如果某个父级没有对应数据,返回空
      }

      if (resultSet.size === 0) {
        // 第一次,直接添加
        allowedValues.forEach((v) => resultSet.add(v));
      } else {
        // 后续,取交集
        resultSet = new Set(allowedValues.filter((v) => resultSet.has(v)));
      }
    }

    // 如果没有任何父级被选中,返回所有选项
    if (!hasAnyFilter) {
      return allOptions;
    }

    // 如果是数值类型(如年份),返回排序后的数组
    if (allOptions.length > 0 && typeof allOptions[0] === 'number') {
      return Array.from(resultSet).sort((a, b) => b - a);
    }

    // 否则返回过滤后的选项对象
    return allOptions.filter((option) => resultSet.has(option.id));
  });

  return {
    getFilteredOptions,
    getIntersectedOptions,
    handleParentChange,
  };
}
