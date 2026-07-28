<template>
  <div class="page-toolbar">
    <el-input v-model="localFilters.name" placeholder="搜索姓名" clearable class="filter-2xl" />
    <el-select
      v-model="localFilters.personnelType"
      placeholder="人员类别"
      clearable
      class="filter-sm"
    >
      <el-option label="专职" value="full_time" />
      <el-option label="兼职" value="part_time" />
      <el-option label="外聘" value="external" />
    </el-select>
    <el-select
      v-model="localFilters.courseId"
      placeholder="学科"
      clearable
      filterable
      class="filter-xl"
    >
      <el-option v-for="c in allCourses" :key="c.id" :label="c.name" :value="c.id" />
    </el-select>
    <el-select
      v-model="localFilters.collegeId"
      placeholder="意向学院"
      clearable
      filterable
      class="filter-xl"
      @change="handleCollegeFilterChange"
    >
      <el-option v-for="c in filteredColleges" :key="c.id" :label="c.name" :value="c.id" />
    </el-select>
    <el-select
      v-model="localFilters.trainingLevelId"
      placeholder="意向层次"
      clearable
      filterable
      class="filter-md"
      @change="handleTrainingLevelFilterChange"
    >
      <el-option v-for="l in filteredTrainingLevels" :key="l.id" :label="l.name" :value="l.id" />
    </el-select>
    <el-select
      v-model="localFilters.affiliatedCollegeId"
      placeholder="归属学院"
      clearable
      filterable
      class="filter-xl"
    >
      <el-option v-for="c in allColleges" :key="c.id" :label="c.name" :value="c.id" />
    </el-select>
    <el-select v-model="localFilters.status" placeholder="状态" clearable class="filter-sm">
      <el-option label="启用" value="active" />
      <el-option label="禁用" value="disabled" />
    </el-select>
    <div class="action-buttons">
      <el-button @click="$emit('export')"
        ><el-icon><Download /></el-icon> 导出Excel</el-button
      >
      <el-button @click="$emit('download-template')"
        ><el-icon><Document /></el-icon> 下载模板</el-button
      >
      <el-upload
        :show-file-list="false"
        accept=".xlsx,.xls"
        action="/api/import/teachers"
        name="file"
        :headers="uploadHeaders"
        :on-success="(res) => $emit('import-success', res)"
        :on-error="(err) => $emit('import-error', err)"
        :before-upload="beforeUpload"
      >
        <el-button
          ><el-icon><Upload /></el-icon> 导入Excel</el-button
        >
      </el-upload>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useFilterLinkage } from '@/components/filter/composables/useFilterLinkage';

const props = defineProps({
  filters: {
    type: Object,
    required: true,
  },
  allCourses: {
    type: Array,
    default: () => [],
  },
  allColleges: {
    type: Array,
    default: () => [],
  },
  allTrainingLevels: {
    type: Array,
    default: () => [],
  },
  collegeLevelMapping: {
    type: Object,
    default: () => ({ collegeToLevels: {}, levelToColleges: {} }),
  },
  uploadHeaders: {
    type: Object,
    default: () => ({}),
  },
  // el-upload 的 before-upload 需要返回值控制是否上传，必须以函数 prop 传入（事件会丢失返回值）
  beforeUpload: {
    type: Function,
    default: undefined,
  },
});

const emit = defineEmits([
  'update:filters',
  'export',
  'download-template',
  'import-success',
  'import-error',
]);

const localFilters = computed({
  get: () => props.filters,
  set: (val) => emit('update:filters', val),
});

// 转换collegeLevelMapping为Hook需要的格式
const collegeLevelRelation = computed(() => {
  const relation = {};
  for (const [collegeId, levelIds] of Object.entries(props.collegeLevelMapping.collegeToLevels)) {
    relation[collegeId] = levelIds;
  }
  return relation;
});

const levelCollegeRelation = computed(() => {
  const relation = {};
  for (const [levelId, collegeIds] of Object.entries(props.collegeLevelMapping.levelToColleges)) {
    relation[levelId] = collegeIds;
  }
  return relation;
});

// 使用通用联动Hook(意向学院 ↔ 意向层次)
const { getFilteredOptions, handleParentChange } = useFilterLinkage({
  filters: localFilters,
  relations: {
    // key名必须匹配Hook动态拼接规则: {parentField}{FieldName}Relation
    trainingLevelIdCollegeIdRelation: levelCollegeRelation, // 按层次过滤学院
    collegeIdTrainingLevelIdRelation: collegeLevelRelation, // 按学院过滤层次
  },
});

// 意向学院根据意向层次过滤
const filteredColleges = computed(() =>
  getFilteredOptions.value('collegeId', props.allColleges, ['trainingLevelId'])
);

// 意向层次根据意向学院过滤
const filteredTrainingLevels = computed(() =>
  getFilteredOptions.value('trainingLevelId', props.allTrainingLevels, ['collegeId'])
);

// 处理意向学院变化
function handleCollegeFilterChange() {
  handleParentChange('collegeId', ['trainingLevelId'], () => {});
}

// 处理意向层次变化
function handleTrainingLevelFilterChange() {
  handleParentChange('trainingLevelId', ['collegeId'], () => {});
}
</script>
