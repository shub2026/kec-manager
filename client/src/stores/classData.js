import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getMajors } from '../api/major';
import { getPlans } from '../api/plan';
import { getTrainingLevels } from '../api/trainingLevel';
import { getColleges } from '../api/college';

/**
 * 班级管理共享参考数据 store
 * 消除 ClassFilterBar / ClassFormDialog 的 prop drilling：
 * 基础数据（学院、专业、层次、方案）和关联关系映射统一存放于此，
 * 子组件直接通过 useStore 访问，无需父组件逐层传递 15+ props。
 */
export const useClassDataStore = defineStore('classData', () => {
  // 基础数据
  const colleges = ref([]);
  const majors = ref([]);
  const trainingLevels = ref([]);
  const plans = ref([]);
  const enrollmentYears = ref([]);

  // 关联关系映射
  const collegeMajorRelation = ref({});
  const collegeLevelRelation = ref({});
  const majorLevelRelation = ref({});
  const collegeYearRelation = ref({});
  const majorYearRelation = ref({});
  const levelYearRelation = ref({});
  const planCollegeRelation = ref({});
  const planMajorRelation = ref({});
  const planLevelRelation = ref({});

  let _baseDataLoaded = false;
  let _relationsLoaded = false;

  /** 加载基础下拉数据（学院/专业/层次/方案），每次调用均重新请求 */
  async function loadBaseData() {
    const [majorsRes, plansRes, levelsRes, collegesRes] = await Promise.all([
      getMajors(),
      getPlans(),
      getTrainingLevels(),
      getColleges(),
    ]);
    majors.value = majorsRes?.data || [];
    plans.value = plansRes?.data || [];
    trainingLevels.value = levelsRes?.data || [];
    colleges.value = collegesRes?.data || [];
    _baseDataLoaded = true;
  }

  /** 从班级列表响应中提取关联关系映射（首次加载后不再重复赋值） */
  function ingestRelations(data) {
    if (!data || _relationsLoaded) return;
    const fields = [
      'allEnrollmentYears',
      'collegeMajorRelation',
      'collegeLevelRelation',
      'majorLevelRelation',
      'collegeYearRelation',
      'majorYearRelation',
      'levelYearRelation',
      'planCollegeRelation',
      'planMajorRelation',
      'planLevelRelation',
    ];
    for (const f of fields) {
      if (data[f] != null) {
        if (f === 'allEnrollmentYears') {
          enrollmentYears.value = (data[f] || []).filter((y) => y != null);
        } else {
          // 使用动态赋值
          const target = {
            collegeMajorRelation,
            collegeLevelRelation,
            majorLevelRelation,
            collegeYearRelation,
            majorYearRelation,
            levelYearRelation,
            planCollegeRelation,
            planMajorRelation,
            planLevelRelation,
          }[f];
          if (target) target.value = data[f];
        }
      }
    }
    _relationsLoaded = true;
  }

  function isBaseDataLoaded() {
    return _baseDataLoaded;
  }

  return {
    colleges,
    majors,
    trainingLevels,
    plans,
    enrollmentYears,
    collegeMajorRelation,
    collegeLevelRelation,
    majorLevelRelation,
    collegeYearRelation,
    majorYearRelation,
    levelYearRelation,
    planCollegeRelation,
    planMajorRelation,
    planLevelRelation,
    loadBaseData,
    ingestRelations,
    isBaseDataLoaded,
  };
});
