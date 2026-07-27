import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useFilterLinkage } from './useFilterLinkage';

const majors = [
  { id: 10, name: '软件工程' },
  { id: 11, name: '网络工程' },
  { id: 20, name: '机械设计' },
];

describe('useFilterLinkage - getFilteredOptions', () => {
  it('选中父级后按关系表过滤子级选项', () => {
    const filters = ref({ collegeId: 1, majorId: null });
    const { getFilteredOptions } = useFilterLinkage({
      filters,
      relations: {
        collegeIdMajorIdRelation: { 1: [10, 11], 2: [20] },
      },
    });

    const result = getFilteredOptions.value('majorId', majors, ['collegeId']);
    expect(result.map((m) => m.id)).toEqual([10, 11]);
  });

  it('父级未选时返回全量选项', () => {
    const filters = ref({ collegeId: null, majorId: null });
    const { getFilteredOptions } = useFilterLinkage({
      filters,
      relations: {
        collegeIdMajorIdRelation: { 1: [10, 11], 2: [20] },
      },
    });

    const result = getFilteredOptions.value('majorId', majors, ['collegeId']);
    expect(result).toHaveLength(3);
  });

  it('关系表缺失时返回全量选项（容错）', () => {
    const filters = ref({ collegeId: 1 });
    const { getFilteredOptions } = useFilterLinkage({ filters, relations: {} });

    const result = getFilteredOptions.value('majorId', majors, ['collegeId']);
    expect(result).toHaveLength(3);
  });

  it('父级值无对应子级时返回空数组', () => {
    const filters = ref({ collegeId: 99 });
    const { getFilteredOptions } = useFilterLinkage({
      filters,
      relations: {
        collegeIdMajorIdRelation: { 1: [10, 11] },
      },
    });

    const result = getFilteredOptions.value('majorId', majors, ['collegeId']);
    expect(result).toEqual([]);
  });

  it('多父级时取最近（数组末尾优先）有值的父级', () => {
    const filters = ref({ collegeId: 1, trainingLevelId: 5 });
    const { getFilteredOptions } = useFilterLinkage({
      filters,
      relations: {
        collegeIdMajorIdRelation: { 1: [10, 11] },
        trainingLevelIdMajorIdRelation: { 5: [20] },
      },
    });

    // parentFields 末位优先：trainingLevelId 有值 → 走 trainingLevelIdMajorIdRelation
    const result = getFilteredOptions.value('majorId', majors, ['collegeId', 'trainingLevelId']);
    expect(result.map((m) => m.id)).toEqual([20]);
  });

  it('支持 ref 包装的关系表（storeToRefs 场景）', () => {
    const filters = ref({ collegeId: 2 });
    const { getFilteredOptions } = useFilterLinkage({
      filters,
      relations: {
        collegeIdMajorIdRelation: ref({ 1: [10, 11], 2: [20] }),
      },
    });

    const result = getFilteredOptions.value('majorId', majors, ['collegeId']);
    expect(result.map((m) => m.id)).toEqual([20]);
  });

  it("父级值为 'none' 时视为未选择", () => {
    const filters = ref({ collegeId: 'none' });
    const { getFilteredOptions } = useFilterLinkage({
      filters,
      relations: {
        collegeIdMajorIdRelation: { 1: [10, 11] },
      },
    });

    const result = getFilteredOptions.value('majorId', majors, ['collegeId']);
    expect(result).toHaveLength(3);
  });
});

describe('useFilterLinkage - handleParentChange', () => {
  it('父级变化时清空子级字段并触发回调', () => {
    const filters = ref({ collegeId: 1, majorId: 10, trainingLevelId: 5 });
    const { handleParentChange } = useFilterLinkage({ filters, relations: {} });

    let emitted = false;
    handleParentChange('collegeId', ['majorId', 'trainingLevelId'], () => {
      emitted = true;
    });

    expect(filters.value.majorId).toBeNull();
    expect(filters.value.trainingLevelId).toBeNull();
    expect(emitted).toBe(true);
  });
});

describe('useFilterLinkage - getIntersectedOptions', () => {
  it('多父级取交集过滤', () => {
    const filters = ref({ collegeId: 1, trainingLevelId: 5 });
    const years = [2023, 2024, 2025];
    const { getIntersectedOptions } = useFilterLinkage({ filters, relations: {} });

    const result = getIntersectedOptions.value('enrollmentYear', years, {
      collegeId: { 1: [2023, 2024] },
      trainingLevelId: { 5: [2024, 2025] },
    });
    expect(result).toEqual([2024]);
  });
});
