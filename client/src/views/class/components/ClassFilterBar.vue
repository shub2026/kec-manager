<template>
  <FilterBar :active-count="activeFilterCount" @reset="resetFilters">
    <template #primary>
      <el-input
        v-model="localFilters.name"
        clearable
        placeholder="按班级名称筛选"
        class="filter-2xl"
        @clear="$emit('search')"
        @keyup.enter="$emit('search')"
      />
    </template>
    <el-select
      v-model="localFilters.collegeId"
      clearable
      placeholder="选择学院"
      class="filter-xl"
      @change="handleCollegeChange"
    >
      <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
    </el-select>
    <el-select
      v-model="localFilters.majorId"
      clearable
      placeholder="选择专业"
      class="filter-xl"
      :disabled="!filteredMajors.length && localFilters.collegeId"
      @change="handleMajorChange"
    >
      <el-option v-for="m in filteredMajors" :key="m.id" :label="m.name" :value="m.id" />
    </el-select>
    <el-select
      v-model="localFilters.trainingLevelId"
      clearable
      placeholder="培养层次"
      class="filter-md"
      :disabled="!filteredTrainingLevels.length && (localFilters.collegeId || localFilters.majorId)"
      @change="handleTrainingLevelChange"
    >
      <el-option
        v-for="level in filteredTrainingLevels"
        :key="level.id"
        :label="level.name"
        :value="level.id"
      />
    </el-select>
    <el-select
      v-model="localFilters.enrollmentYear"
      clearable
      placeholder="入学年份"
      class="filter-md"
      :disabled="
        !filteredEnrollmentYears.length &&
        (localFilters.collegeId || localFilters.majorId || localFilters.trainingLevelId)
      "
      @change="$emit('change')"
    >
      <el-option
        v-for="year in filteredEnrollmentYears"
        :key="year"
        :label="year + '年'"
        :value="year"
      />
    </el-select>
    <el-select
      v-model="localFilters.status"
      clearable
      placeholder="状态"
      class="filter-sm"
      @change="$emit('change')"
    >
      <el-option label="在读" value="active" />
      <el-option label="已毕业" value="graduated" />
      <el-option label="离校" value="left_school" />
    </el-select>
    <el-select
      v-model="localFilters.isCombined"
      clearable
      placeholder="合班"
      class="filter-sm"
      @change="$emit('change')"
    >
      <el-option label="合班班级" value="1" />
      <el-option label="非合班" value="0" />
    </el-select>
    <el-select
      v-model="localFilters.planId"
      clearable
      placeholder="培养方案"
      class="filter-xl"
      :disabled="
        !filteredPlans.length &&
        (localFilters.collegeId || localFilters.majorId || localFilters.trainingLevelId)
      "
      @change="$emit('change')"
    >
      <el-option label="未关联" value="none" />
      <el-option v-for="p in filteredPlans" :key="p.id" :label="p.name" :value="p.id" />
    </el-select>

    <template #actions>
      <el-button @click="$emit('export')"
        ><el-icon><Download /></el-icon> 导出Excel</el-button
      >
      <el-button @click="$emit('download-template')"
        ><el-icon><Document /></el-icon> 下载模板</el-button
      >
      <el-upload
        :show-file-list="false"
        accept=".xlsx,.xls"
        action="/api/import/classes"
        name="file"
        :headers="uploadHeaders"
        :on-success="(res) => $emit('import-success', res)"
        :on-error="(err) => $emit('import-error', err)"
        :before-upload="(file) => $emit('before-upload', file)"
      >
        <el-button
          ><el-icon><Upload /></el-icon> 导入Excel</el-button
        >
      </el-upload>
    </template>
  </FilterBar>
</template>

<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@/stores/auth';
import { useClassDataStore } from '@/stores/classData';
import { getCookie } from '@/utils/cookies';
import { useFilterLinkage } from '@/components/filter/composables/useFilterLinkage';
import FilterBar from '@/components/filter/FilterBar.vue';

const props = defineProps({
  filters: {
    type: Object,
    required: true,
  },
});

// 从 store 直接读取参考数据（storeToRefs 保持 ref 响应式）
const classDataStore = useClassDataStore();
const {
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
} = storeToRefs(classDataStore);

// 获取认证token和CSRF token用于上传请求（el-upload不走axios拦截器，须手动附加）
const authStore = useAuthStore();
const uploadHeaders = computed(() => {
  const headers = {};
  if (authStore.token) headers.Authorization = `Bearer ${authStore.token}`;
  const csrfToken = getCookie('XSRF-TOKEN');
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  return headers;
});

const emit = defineEmits([
  'update:filters',
  'change',
  'search',
  'export',
  'download-template',
  'import-success',
  'import-error',
  'before-upload',
  'add',
]);

const localFilters = computed({
  get: () => props.filters,
  set: (val) => emit('update:filters', val),
});

// 生效筛选条件数（移动端“更多筛选”按钮角标）
const activeFilterCount = computed(
  () =>
    Object.values(localFilters.value).filter((v) => v !== '' && v !== null && v !== undefined)
      .length
);

// 移动端抽屉“重置”：清空全部筛选条件后重新加载
function resetFilters() {
  for (const key of Object.keys(localFilters.value)) {
    localFilters.value[key] = key === 'name' ? '' : null;
  }
  emit('change');
}

// 使用通用联动Hook（storeToRefs 返回的均为 Ref，useFilterLinkage 内部支持 Ref 访问）
// relations key 必须匹配 Hook 拼接规则 {parentField}{FieldName}Relation；
// 其余关系表由下方手写过滤与 getIntersectedOptions 显式传入，不经 Hook 查找
const { getFilteredOptions, getIntersectedOptions, handleParentChange } = useFilterLinkage({
  filters: localFilters,
  relations: {
    collegeIdMajorIdRelation: collegeMajorRelation, // 学院→专业联动（filteredMajors）
  },
});

// 根据选择的学院过滤专业列表
const filteredMajors = computed(() =>
  getFilteredOptions.value('majorId', majors.value, ['collegeId'])
);

// 根据选择的学院或专业过滤层次列表
const filteredTrainingLevels = computed(() => {
  if (localFilters.value.majorId) {
    const majorId = String(localFilters.value.majorId);
    const levelIds = majorLevelRelation.value[majorId] || [];
    if (levelIds.length > 0) {
      return trainingLevels.value.filter((level) => levelIds.includes(level.id));
    }
  }

  if (localFilters.value.collegeId) {
    const collegeId = String(localFilters.value.collegeId);
    const levelIds = collegeLevelRelation.value[collegeId] || [];
    if (levelIds.length > 0) {
      return trainingLevels.value.filter((level) => levelIds.includes(level.id));
    }
  }

  return trainingLevels.value;
});

// 根据已选条件（学院/专业/层次）过滤入学年份
const filteredEnrollmentYears = computed(() =>
  getIntersectedOptions.value('enrollmentYear', enrollmentYears.value, {
    collegeId: collegeYearRelation,
    majorId: majorYearRelation,
    trainingLevelId: levelYearRelation,
  })
);

// 根据已选条件（学院/专业/层次）过滤培养方案
const filteredPlans = computed(() => {
  let planSet = new Set();

  if (localFilters.value.trainingLevelId) {
    const levelId = String(localFilters.value.trainingLevelId);
    const planIds = planLevelRelation.value[levelId] || [];
    if (planIds.length > 0) planIds.forEach((p) => planSet.add(p));
  }

  if (localFilters.value.majorId) {
    const majorId = String(localFilters.value.majorId);
    const planIds = planMajorRelation.value[majorId] || [];
    if (planIds.length > 0) {
      if (planSet.size > 0) {
        planSet = new Set(planIds.filter((p) => planSet.has(p)));
      } else {
        planIds.forEach((p) => planSet.add(p));
      }
    }
  }

  if (localFilters.value.collegeId) {
    const collegeId = String(localFilters.value.collegeId);
    const planIds = planCollegeRelation.value[collegeId] || [];
    if (planIds.length > 0) {
      if (planSet.size > 0) {
        planSet = new Set(planIds.filter((p) => planSet.has(p)));
      } else {
        planIds.forEach((p) => planSet.add(p));
      }
    }
  }

  if (planSet.size === 0) return plans.value;
  return plans.value.filter((plan) => planSet.has(plan.id));
});

function handleCollegeChange() {
  handleParentChange('collegeId', ['majorId', 'trainingLevelId', 'enrollmentYear', 'planId'], () =>
    emit('change')
  );
}

function handleMajorChange() {
  handleParentChange('majorId', ['trainingLevelId', 'enrollmentYear', 'planId'], () =>
    emit('change')
  );
}

function handleTrainingLevelChange() {
  handleParentChange('trainingLevelId', ['enrollmentYear', 'planId'], () => emit('change'));
}
</script>

<style scoped>
/* filter-bar 布局由 global.css .page-toolbar / FilterBar 统一处理 */

@media (max-width: 768px) {
  :deep(.action-buttons) {
    flex-wrap: wrap;
  }
}
</style>
