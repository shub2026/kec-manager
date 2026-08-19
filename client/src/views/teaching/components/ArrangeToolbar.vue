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
      v-model="localFilters.teacher"
      placeholder="教师"
      clearable
      filterable
      class="header-filter filter-md"
    >
      <el-option v-for="t in teacherList" :key="t.id" :label="t.name" :value="t.id" />
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
      <!-- 整合下拉：锁定/解锁全部 + 交换教师班级（与批量排课下拉模式一致） -->
      <el-dropdown :disabled="historicalReadOnly" @command="handleMoreCommand">
        <el-button type="success" plain :disabled="historicalReadOnly" class="more-btn">
          更多操作<el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="lock">
              <el-icon><Lock /></el-icon>锁定全部
            </el-dropdown-item>
            <el-dropdown-item command="unlock">
              <el-icon><Unlock /></el-icon>解锁全部
            </el-dropdown-item>
            <el-dropdown-item command="swap" divided>
              <el-icon><SwitchButton /></el-icon>交换教师班级
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>
  </FilterBar>
</template>

<script setup>
import { computed } from 'vue';
// Lock 已全局注册，Unlock/SwitchButton 未注册需显式导入
import { Lock, Unlock, SwitchButton } from '@element-plus/icons-vue';
import { useFilterLinkage } from '@/components/filter/composables/useFilterLinkage';
import FilterBar from '@/components/filter/FilterBar.vue';

const props = defineProps({
  /** 筛选值对象：{ className, college, major, trainingLevel, grade, textbook, teacher, arrangeStatus } */
  filters: {
    type: Object,
    required: true,
  },
  /** 全量班级列表（未过滤），用于计算各筛选器可选项 */
  classList: {
    type: Array,
    default: () => [],
  },
  /** 本课程教师列表，供教师筛选下拉使用 */
  teacherList: {
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

const emit = defineEmits([
  'update:filters',
  'auto-arrange',
  'reset',
  'lock-all',
  'unlock-all',
  'swap-teachers',
]);

// 更多操作下拉命令分发：保持对外 lock-all / unlock-all 事件语义不变
function handleMoreCommand(command) {
  if (command === 'lock') emit('lock-all');
  else if (command === 'unlock') emit('unlock-all');
  else if (command === 'swap') emit('swap-teachers');
}

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
.more-btn {
  margin-left: var(--space-1);
}
</style>
