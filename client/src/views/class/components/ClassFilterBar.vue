<template>
  <div class="filter-bar">
    <el-input
      v-model="localFilters.name"
      clearable
      placeholder="按班级名称筛选"
      class="filter-name"
      @clear="$emit('search')"
      @keyup.enter="$emit('search')"
    />
    <el-select
      v-model="localFilters.collegeId"
      clearable
      placeholder="选择学院"
      class="filter-medium"
      @change="handleCollegeChange"
    >
      <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
    </el-select>
    <el-select
      v-model="localFilters.majorId"
      clearable
      placeholder="选择专业"
      class="filter-medium"
      :disabled="!filteredMajors.length && localFilters.collegeId"
      @change="handleMajorChange"
    >
      <el-option v-for="m in filteredMajors" :key="m.id" :label="m.name" :value="m.id" />
    </el-select>
    <el-select
      v-model="localFilters.trainingLevelId"
      clearable
      placeholder="培养层次"
      class="filter-narrow"
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
      class="filter-narrow"
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
      class="filter-small"
      @change="$emit('change')"
    >
      <el-option label="在读" value="active" />
      <el-option label="已毕业" value="graduated" />
      <el-option label="离校" value="left_school" />
    </el-select>
    <el-select
      v-model="localFilters.planId"
      clearable
      placeholder="培养方案"
      class="filter-medium"
      :disabled="
        !filteredPlans.length &&
        (localFilters.collegeId || localFilters.majorId || localFilters.trainingLevelId)
      "
      @change="$emit('change')"
    >
      <el-option label="未关联" value="none" />
      <el-option v-for="p in filteredPlans" :key="p.id" :label="p.name" :value="p.id" />
    </el-select>

    <div class="action-buttons">
      <el-button @click="$emit('export')">数据导出</el-button>
      <el-button @click="$emit('download-template')">下载模板</el-button>
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
        <el-button>导入Excel</el-button>
      </el-upload>
      <el-button type="primary" @click="$emit('add')">
        <el-icon><Plus /></el-icon> 新增班级
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import { useFilterLinkage } from '@/components/filter/composables/useFilterLinkage';

const props = defineProps({
  filters: {
    type: Object,
    required: true,
  },
  colleges: {
    type: Array,
    default: () => [],
  },
  majors: {
    type: Array,
    default: () => [],
  },
  trainingLevels: {
    type: Array,
    default: () => [],
  },
  enrollmentYears: {
    type: Array,
    default: () => [],
  },
  plans: {
    type: Array,
    default: () => [],
  },
  collegeMajorRelation: {
    type: Object,
    default: () => ({}),
  },
  collegeLevelRelation: {
    type: Object,
    default: () => ({}),
  },
  majorLevelRelation: {
    type: Object,
    default: () => ({}),
  },
  collegeYearRelation: {
    type: Object,
    default: () => ({}),
  },
  majorYearRelation: {
    type: Object,
    default: () => ({}),
  },
  levelYearRelation: {
    type: Object,
    default: () => ({}),
  },
  planCollegeRelation: {
    type: Object,
    default: () => ({}),
  },
  planMajorRelation: {
    type: Object,
    default: () => ({}),
  },
  planLevelRelation: {
    type: Object,
    default: () => ({}),
  },
});

// 获取认证token用于上传请求
const authStore = useAuthStore();
const uploadHeaders = computed(() => {
  return authStore.token ? { Authorization: `Bearer ${authStore.token}` } : {};
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

// 使用通用联动Hook
const { getFilteredOptions, getIntersectedOptions, handleParentChange } = useFilterLinkage({
  filters: localFilters,
  relations: {
    collegeMajorRelation: props.collegeMajorRelation,
    collegeLevelRelation: props.collegeLevelRelation,
    majorLevelRelation: props.majorLevelRelation,
    collegeYearRelation: props.collegeYearRelation,
    majorYearRelation: props.majorYearRelation,
    levelYearRelation: props.levelYearRelation,
    planCollegeRelation: props.planCollegeRelation,
    planMajorRelation: props.planMajorRelation,
    planLevelRelation: props.planLevelRelation,
  },
});

// 根据选择的学院过滤专业列表
const filteredMajors = computed(() =>
  getFilteredOptions.value('majorId', props.majors, ['collegeId'])
);

// 根据选择的学院或专业过滤层次列表
const filteredTrainingLevels = computed(() => {
  // 如果选择了专业，优先使用专业-层次关联
  if (localFilters.value.majorId) {
    const majorId = String(localFilters.value.majorId);
    const levelIds = props.majorLevelRelation[majorId] || [];

    if (levelIds.length > 0) {
      return props.trainingLevels.filter((level) => levelIds.includes(level.id));
    }
  }

  // 如果没有选择专业但选择了学院，使用学院-层次关联
  if (localFilters.value.collegeId) {
    const collegeId = String(localFilters.value.collegeId);
    const levelIds = props.collegeLevelRelation[collegeId] || [];

    if (levelIds.length > 0) {
      return props.trainingLevels.filter((level) => levelIds.includes(level.id));
    }
  }

  // 未选择学院和专业，显示所有层次
  return props.trainingLevels;
});

// 根据已选条件（学院/专业/层次）过滤入学年份 - 使用交集过滤
const filteredEnrollmentYears = computed(() =>
  getIntersectedOptions.value('enrollmentYear', props.enrollmentYears, {
    collegeId: props.collegeYearRelation,
    majorId: props.majorYearRelation,
    trainingLevelId: props.levelYearRelation,
  })
);

// 根据已选条件（学院/专业/层次）过滤培养方案 - 使用交集过滤
const filteredPlans = computed(() => {
  let planSet = new Set();

  // 如果选择了层次，使用层次-培养方案关联
  if (localFilters.value.trainingLevelId) {
    const levelId = String(localFilters.value.trainingLevelId);
    const planIds = props.planLevelRelation[levelId] || [];
    if (planIds.length > 0) {
      planIds.forEach((p) => planSet.add(p));
    }
  }

  // 如果选择了专业，使用专业-培养方案关联（取交集）
  if (localFilters.value.majorId) {
    const majorId = String(localFilters.value.majorId);
    const planIds = props.planMajorRelation[majorId] || [];
    if (planIds.length > 0) {
      if (planSet.size > 0) {
        planSet = new Set(planIds.filter((p) => planSet.has(p)));
      } else {
        planIds.forEach((p) => planSet.add(p));
      }
    }
  }

  // 如果选择了学院，使用学院-培养方案关联（取交集）
  if (localFilters.value.collegeId) {
    const collegeId = String(localFilters.value.collegeId);
    const planIds = props.planCollegeRelation[collegeId] || [];
    if (planIds.length > 0) {
      if (planSet.size > 0) {
        planSet = new Set(planIds.filter((p) => planSet.has(p)));
      } else {
        planIds.forEach((p) => planSet.add(p));
      }
    }
  }

  // 如果没有选择任何条件，显示所有培养方案
  if (planSet.size === 0) {
    return props.plans;
  }

  return props.plans.filter((plan) => planSet.has(plan.id));
});

// 处理学院变化
function handleCollegeChange() {
  // 当学院改变时，清空专业、层次、入学年份和培养方案选择
  handleParentChange('collegeId', ['majorId', 'trainingLevelId', 'enrollmentYear', 'planId'], () =>
    emit('change')
  );
}

// 处理专业变化
function handleMajorChange() {
  // 当专业改变时，清空层次、入学年份和培养方案选择
  handleParentChange('majorId', ['trainingLevelId', 'enrollmentYear', 'planId'], () =>
    emit('change')
  );
}

// 处理层次变化
function handleTrainingLevelChange() {
  // 当层次改变时，清空入学年份和培养方案选择
  handleParentChange('trainingLevelId', ['enrollmentYear', 'planId'], () => emit('change'));
}
</script>

<style scoped>
.filter-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.filter-name {
  width: 200px;
}

.filter-medium {
  width: 160px;
}

.filter-narrow {
  width: 120px;
}

.filter-small {
  width: 100px;
}

.action-buttons {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

@media (max-width: 768px) {
  .filter-name,
  .filter-medium,
  .filter-narrow,
  .filter-small {
    width: 100%;
  }

  .action-buttons {
    width: 100%;
    margin-left: 0;
    flex-wrap: wrap;
  }
}
</style>
