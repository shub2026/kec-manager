import { ref } from 'vue';

/**
 * 筛选器折叠/展开逻辑
 * @param {number} visibleCount - 默认显示的筛选器数量（不含搜索框）
 * @returns {{ expanded: Ref<boolean>, toggleExpand: Function }}
 */
export function useFilterCollapse(initialExpanded = false) {
  const expanded = ref(initialExpanded);

  function toggleExpand() {
    expanded.value = !expanded.value;
  }

  return { expanded, toggleExpand };
}
