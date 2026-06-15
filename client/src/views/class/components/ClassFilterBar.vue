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
      @change="$emit('change')"
    >
      <el-option label="空值" value="null" />
      <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
    </el-select>
    <el-select 
      v-model="localFilters.majorId" 
      clearable 
      placeholder="选择专业" 
      class="filter-medium"
      @change="$emit('change')"
    >
      <el-option label="空值" value="null" />
      <el-option v-for="m in majors" :key="m.id" :label="m.name" :value="m.id" />
    </el-select>
    <el-select 
      v-model="localFilters.trainingLevelId" 
      clearable 
      placeholder="培养层次" 
      class="filter-narrow"
      @change="$emit('change')"
    >
      <el-option label="空值" value="null" />
      <el-option v-for="level in trainingLevels" :key="level.id" :label="level.name" :value="level.id" />
    </el-select>
    <el-select 
      v-model="localFilters.enrollmentYear" 
      clearable 
      placeholder="入学年份" 
      class="filter-narrow"
      @change="$emit('change')"
    >
      <el-option v-for="year in enrollmentYears" :key="year" :label="year + '年'" :value="year" />
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
      @change="$emit('change')"
    >
      <el-option label="未关联" value="none" />
      <el-option v-for="p in plans" :key="p.id" :label="p.name" :value="p.id" />
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
import { computed } from 'vue'
import { Plus } from '@element-plus/icons-vue'

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
})

// 获取认证token用于上传请求
const uploadHeaders = computed(() => {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
})

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
])

const localFilters = computed({
  get: () => props.filters,
  set: (val) => emit('update:filters', val),
})
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
</style>
