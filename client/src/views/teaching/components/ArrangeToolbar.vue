<template>
  <FilterBar
    :active-count="activeFilterCount"
    toolbar-class="card-header-actions arrange-header"
    @reset="clearFilters"
  >
    <template #primary>
      <el-input
        v-model="localFilters.className"
        placeholder="班级名称"
        clearable
        class="header-filter filter-lg"
      />
    </template>
    <el-select
      v-model="localFilters.college"
      placeholder="学院"
      clearable
      class="header-filter filter-md"
      @change="handleCollegeFilterChange"
    >
      <el-option v-for="v in filterOptions.colleges" :key="v" :label="v" :value="v" />
    </el-select>
    <el-select
      v-model="localFilters.major"
      placeholder="专业"
      clearable
      filterable
      class="header-filter filter-lg"
      @change="handleMajorFilterChange"
    >
      <el-option v-for="v in filterOptions.majors" :key="v" :label="v" :value="v" />
    </el-select>
    <el-select
      v-model="localFilters.trainingLevel"
      placeholder="层次"
      clearable
      class="header-filter filter-sm"
      @change="handleTrainingLevelFilterChange"
    >
      <el-option v-for="v in filterOptions.trainingLevels" :key="v" :label="v" :value="v" />
    </el-select>
    <el-select
      v-model="localFilters.grade"
      placeholder="年级"
      clearable
      class="header-filter filter-xs"
    >
      <el-option v-for="v in filterOptions.grades" :key="v" :label="v + '年级'" :value="v" />
    </el-select>
    <el-select
      v-model="localFilters.textbook"
      placeholder="教材"
      clearable
      filterable
      class="header-filter filter-xl"
    >
      <el-option v-for="v in filterOptions.textbooks" :key="v" :label="v" :value="v" />
    </el-select>
    <el-select
      v-model="localFilters.arrangeStatus"
      placeholder="安排状态"
      clearable
      class="header-filter filter-sm"
    >
      <el-option label="全部" value="" />
      <el-option label="已安排" value="assigned" />
      <el-option label="未安排" value="unassigned" />
    </el-select>
    <template #actions>
      <el-button
        type="warning"
        :loading="arranging"
        :disabled="historicalReadOnly"
        @click="emit('auto-arrange', 'full')"
      >
        <el-icon><MagicStick /></el-icon> 全量模式
      </el-button>
      <el-button
        type="success"
        :loading="arranging"
        :disabled="historicalReadOnly"
        @click="emit('auto-arrange', 'standard')"
      >
        <el-icon><SetUp /></el-icon> 标准模式
      </el-button>
      <el-button
        type="danger"
        :disabled="historicalReadOnly"
        class="dropdown-gap"
        @click="emit('reset', 'current')"
      >
        <el-icon><RefreshRight /></el-icon> 重置当前
      </el-button>
      <el-button
        type="success"
        plain
        :disabled="historicalReadOnly"
        class="lock-btn"
        @click="emit('lock-all')"
      >
        <el-icon><Lock /></el-icon> 锁定
      </el-button>
      <el-button
        type="warning"
        plain
        :disabled="historicalReadOnly"
        class="lock-btn"
        @click="emit('unlock-all')"
      >
        <el-icon><Unlock /></el-icon> 解锁
      </el-button>
    </template>
  </FilterBar>
</template>

<script setup>
import { computed } from 'vue';
// Lock 已全局注册，Unlock 未注册需显式导入（一并导入保持成对语义）
import { Lock, Unlock } from '@element-plus/icons-vue';
import { useFilterLinkage } from '@/components/filter/composables/useFilterLinkage';
import FilterBar from '@/components/filter/FilterBar.vue';

const props = defineProps({
  /** 筛选值对象：{ className, college, major, trainingLevel, grade, textbook, arrangeStatus } */
  filters: {
    type: Object,
    required: true,
  },
  /** 全量班级列表（未过滤），用于计算各筛选器可选项 */
  classList: {
    type: Array,
    default: () => [],
  },
  arranging: {
    type: Boolean,
    default: false,
  },
  historicalReadOnly: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:filters', 'auto-arrange', 'reset', 'lock-all', 'unlock-all']);

// 与父页面通过 v-model:filters 通信；直接修改属性可触发父级 deep watch
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

// 移动端抽屉“重置”：清空筛选条件（与排课重置 emit('reset') 语义不同）
function clearFilters() {
  for (const key of Object.keys(localFilters.value)) {
    localFilters.value[key] = '';
  }
}

// 使用通用联动Hook
const { handleParentChange } = useFilterLinkage({
  filters: localFilters,
  relations: {},
});

// 合并 5 个筛选 computed 为单次遍历
const filterOptions = computed(() => {
  const colleges = new Set();
  const majors = new Set();
  const grades = new Set();
  const trainingLevels = new Set();
  const textbooks = new Set();

  const fCollege = localFilters.value.college;
  const fMajor = localFilters.value.major;

  for (const c of props.classList) {
    if (c.collegeName) colleges.add(c.collegeName);

    const matchCollege = !fCollege || c.collegeName === fCollege;
    const matchCollegeMajor = matchCollege && (!fMajor || c.majorName === fMajor);

    if (c.majorName && matchCollege) majors.add(c.majorName);
    if (c.grade && matchCollegeMajor) grades.add(c.grade);
    if (c.trainingLevelName && matchCollegeMajor) trainingLevels.add(c.trainingLevelName);
    if (c.textbooks) {
      for (const tb of c.textbooks) {
        if (tb.title) textbooks.add(tb.title);
      }
    }
  }

  return {
    colleges: [...colleges].sort(),
    majors: [...majors].sort(),
    grades: [...grades].sort((a, b) => a - b),
    trainingLevels: [...trainingLevels].sort(),
    textbooks: [...textbooks].sort(),
  };
});

function handleCollegeFilterChange() {
  handleParentChange('college', ['major', 'trainingLevel'], () => {
    localFilters.value.grade = '';
    localFilters.value.textbook = '';
  });
}

function handleMajorFilterChange() {
  handleParentChange('major', ['trainingLevel'], () => {
    localFilters.value.grade = '';
    localFilters.value.textbook = '';
  });
}

function handleTrainingLevelFilterChange() {
  localFilters.value.grade = '';
  localFilters.value.textbook = '';
}
</script>

<style scoped>
/* 卡片头部筛选器宽度（scoped 已隔离，加前缀提升可读性） */
.arrange-header .header-filter.filter-xs {
  width: 80px;
}
.arrange-header .header-filter.filter-sm {
  width: 100px;
}
.arrange-header .header-filter.filter-md {
  width: 120px;
}
.arrange-header .header-filter.filter-lg {
  width: 130px;
}
.arrange-header .header-filter.filter-xl {
  width: 140px;
}
.dropdown-gap {
  margin-left: var(--space-1);
}
.lock-btn {
  margin-left: var(--space-1);
}
</style>
