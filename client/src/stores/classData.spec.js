import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mockGetMajors = vi.fn();
const mockGetPlans = vi.fn();
const mockGetTrainingLevels = vi.fn();
const mockGetColleges = vi.fn();

vi.mock('@/api/major', () => ({ getMajors: (...a) => mockGetMajors(...a) }));
vi.mock('@/api/plan', () => ({ getPlans: (...a) => mockGetPlans(...a) }));
vi.mock('@/api/trainingLevel', () => ({
  getTrainingLevels: (...a) => mockGetTrainingLevels(...a),
}));
vi.mock('@/api/college', () => ({ getColleges: (...a) => mockGetColleges(...a) }));

import { useClassDataStore } from '@/stores/classData';

describe('classData store', () => {
  let store;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    store = useClassDataStore();
  });

  describe('loadBaseData', () => {
    it('并行加载四类基础数据并写入 state', async () => {
      mockGetMajors.mockResolvedValue({ data: [{ id: 1, name: '软件工程' }] });
      mockGetPlans.mockResolvedValue({ data: [{ id: 2 }] });
      mockGetTrainingLevels.mockResolvedValue({ data: [{ id: 3 }] });
      mockGetColleges.mockResolvedValue({ data: [{ id: 4 }] });

      expect(store.isBaseDataLoaded()).toBe(false);
      await store.loadBaseData();

      expect(store.majors).toEqual([{ id: 1, name: '软件工程' }]);
      expect(store.plans).toEqual([{ id: 2 }]);
      expect(store.trainingLevels).toEqual([{ id: 3 }]);
      expect(store.colleges).toEqual([{ id: 4 }]);
      expect(store.isBaseDataLoaded()).toBe(true);
    });

    it('响应缺少 data 时回退为空数组', async () => {
      mockGetMajors.mockResolvedValue(null);
      mockGetPlans.mockResolvedValue({});
      mockGetTrainingLevels.mockResolvedValue({ data: null });
      mockGetColleges.mockResolvedValue({ data: [] });

      await store.loadBaseData();

      expect(store.majors).toEqual([]);
      expect(store.plans).toEqual([]);
      expect(store.trainingLevels).toEqual([]);
      expect(store.colleges).toEqual([]);
    });
  });

  describe('ingestRelations', () => {
    const relationData = {
      allEnrollmentYears: [2024, null, 2025],
      collegeMajorRelation: { 1: [10, 11] },
      planLevelRelation: { 5: [1] },
    };

    it('提取关联映射并过滤空的入学年份', () => {
      store.ingestRelations(relationData);

      expect(store.enrollmentYears).toEqual([2024, 2025]);
      expect(store.collegeMajorRelation).toEqual({ 1: [10, 11] });
      expect(store.planLevelRelation).toEqual({ 5: [1] });
      // 未提供的映射保持初始空对象
      expect(store.majorLevelRelation).toEqual({});
    });

    it('首次加载后不再重复赋值', () => {
      store.ingestRelations(relationData);
      store.ingestRelations({ collegeMajorRelation: { 9: [99] } });

      expect(store.collegeMajorRelation).toEqual({ 1: [10, 11] });
    });

    it('空数据直接忽略且不锁定加载标志', () => {
      store.ingestRelations(null);
      store.ingestRelations(undefined);

      // 之后的有效数据仍可正常提取
      store.ingestRelations(relationData);
      expect(store.enrollmentYears).toEqual([2024, 2025]);
    });
  });
});
