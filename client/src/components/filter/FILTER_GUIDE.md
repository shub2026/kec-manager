# 筛选器联动优化指南

> **文档状态**：设计参考文档（v1.4.1）  
> `useFilterLinkage` composable 已实现并位于 `components/filter/composables/`，各页面可按需集成。  
> 下方迁移清单中的复选框反映初始规划状态，实际集成进度请以各页面代码为准。

## 📋 目录
- [设计理念](#设计理念)
- [使用方式](#使用方式)
- [各页面迁移方案](#各页面迁移方案)

---

## 🎯 设计理念

### 为什么不提取为完全通用的组件?

经过分析,发现各页面的筛选器存在以下差异:

1. **数据结构不同**:
   - 班级管理页: 基于ID的关联关系 (`collegeMajorRelation`)
   - 教师信息页: 基于数组包含关系 (`courseList.some()`)
   - 教学安排页: 基于字符串匹配 (`collegeName === filter`)

2. **过滤方式不同**:
   - 部分页面: 前端computed过滤 (TeacherList, TeachingStatistics)
   - 部分页面: 后端API参数 (ClassList, UnifiedSemesterQuery)
   - 部分页面: 混合模式 (TeachingArrange)

3. **UI布局不同**:
   - 筛选项数量不同 (5-8个)
   - 排列方式不同 (横向/纵向)
   - 附加功能不同 (导出/导入/新增按钮)

### 推荐方案: **Hook + 最佳实践**

✅ **提供可复用的联动逻辑Hook** (`useFilterLinkage`)
✅ **提供标准化的实现示例** (ClassFilterBar.vue作为参考)
✅ **各页面按需定制,但遵循统一模式**

---

## 💡 使用方式

### 1. 基础用法 - 简单联动

```vue
<script setup>
import { ref, computed } from 'vue';
import { useFilterLinkage } from '@/components/filter/composables/useFilterLinkage';

const filters = ref({
  collegeId: null,
  majorId: null,
});

const relations = {
  collegeMajorRelation: {
    1: [1, 2, 3], // 学院1有专业1,2,3
    2: [4, 5],    // 学院2有专业4,5
  },
};

const { getFilteredOptions, handleParentChange } = useFilterLinkage({
  filters,
  relations,
});

const allMajors = ref([...]); // 所有专业列表

// 动态过滤专业列表
const filteredMajors = computed(() => 
  getFilteredOptions.value('majorId', allMajors.value, ['collegeId'])
);

// 处理学院变化
function handleCollegeChange() {
  handleParentChange('collegeId', ['majorId'], () => emit('change'));
}
</script>

<template>
  <el-select v-model="filters.collegeId" @change="handleCollegeChange">
    <!-- 学院选项 -->
  </el-select>
  
  <el-select v-model="filters.majorId" :disabled="!filteredMajors.length">
    <el-option v-for="m in filteredMajors" :key="m.id" :label="m.name" :value="m.id" />
  </el-select>
</template>
```

### 2. 高级用法 - 多条件交集

```vue
<script setup>
const { getIntersectedOptions } = useFilterLinkage({ filters, relations });

// 入学年份需要根据学院、专业、层次三者取交集
const filteredYears = computed(() =>
  getIntersectedOptions.value('enrollmentYear', allYears.value, {
    collegeId: relations.collegeYearRelation,
    majorId: relations.majorYearRelation,
    trainingLevelId: relations.levelYearRelation,
  })
);
</script>
```

---

## 📝 各页面迁移方案

### 1. 教师信息页 (TeacherList.vue)

**当前状态**: 
- ❌ 筛选器无联动
- ✅ 编辑表单有联动
- 前端computed过滤

**迁移步骤**:

#### Step 1: 后端添加关联数据
```javascript
// server/src/controllers/teacher.controller.js
// 在 listTeachers 接口中添加:
const teacherCourseRelation = {}; // 教师-课程关联
const teacherCollegeRelation = {}; // 教师-意向学院关联
const teacherLevelRelation = {}; // 教师-意向层次关联
```

#### Step 2: 前端接收关联数据
```javascript
// client/src/views/teaching/TeacherList.vue
const teacherCourseRelation = ref({});
const teacherCollegeRelation = ref({});
const teacherLevelRelation = ref({});

async function load() {
  const res = await getTeachers(params);
  if (res?.data?.teacherCourseRelation) {
    teacherCourseRelation.value = res.data.teacherCourseRelation;
  }
  // ... 其他关联数据
}
```

#### Step 3: 使用Hook实现联动
```javascript
import { useFilterLinkage } from '@/components/filter/composables/useFilterLinkage';

const { getFilteredOptions, handleParentChange } = useFilterLinkage({
  filters,
  relations: {
    teacherCollegeRelation: teacherCollegeRelation.value,
    teacherLevelRelation: teacherLevelRelation.value,
  },
});

// 意向层次根据意向学院过滤
const filteredTrainingLevels = computed(() =>
  getFilteredOptions.value('trainingLevelId', allTrainingLevels.value, ['collegeId'])
);

function handleCollegeFilterChange() {
  handleParentChange('collegeId', ['trainingLevelId'], applyFilters);
}
```

**预计工作量**: 2-3小时

---

### 2. 教学安排页 (TeachingArrange.vue)

**当前状态**:
- ⚠️ 学院→专业有部分联动
- ❌ 其他字段无联动
- 后端API + 前端computed混合

**迁移步骤**:

#### Step 1: 完善后端关联数据
```javascript
// server/src/controllers/teaching-arrange.controller.js
// 已有 collegeMajorRelation,需要补充:
const majorLevelRelation = {}; // 专业-层次
const collegeLevelRelation = {}; // 学院-层次
```

#### Step 2: 前端使用Hook重构
```javascript
const { getFilteredOptions, getIntersectedOptions } = useFilterLinkage({
  filters: reactive({
    college: filterCollege,
    major: filterMajor,
    trainingLevel: filterTrainingLevel,
  }),
  relations: {
    collegeMajorRelation,
    majorLevelRelation,
    collegeLevelRelation,
  },
});

// 专业根据学院过滤
const majorOptions = computed(() =>
  getFilteredOptions.value('major', allMajors.value, ['college'])
);

// 层次根据学院和专业取交集
const trainingLevelOptions = computed(() =>
  getIntersectedOptions.value('trainingLevel', allLevels.value, {
    college: collegeLevelRelation.value,
    major: majorLevelRelation.value,
  })
);
```

**预计工作量**: 2小时

---

### 3. 课时统计页 (TeachingStatistics.vue)

**当前状态**:
- ❌ 完全无联动
- 前端computed过滤

**迁移步骤**:

#### Step 1: 后端添加关联数据
```javascript
// server/src/controllers/teacher.controller.js (统计数据来自教师表)
// 添加:
const teacherTypeRelation = {}; // 类别-教师关联
const teacherSubjectRelation = {}; // 科目-教师关联
const teacherCollegeRelation = {}; // 学院-教师关联
```

#### Step 2: 前端实现联动
```javascript
const filteredTypes = computed(() =>
  getFilteredOptions.value('type', allTypes.value, [])
);

const filteredSubjects = computed(() =>
  getFilteredOptions.value('subject', allSubjects.value, ['type'])
);
```

**预计工作量**: 1.5小时

---

### 4. 开课查询页 (UnifiedSemesterQuery.vue)

**当前状态**:
- ❌ 完全无联动
- 后端API参数

**迁移步骤**:

类似班级管理页,需要后端返回完整的关联关系数据。

**预计工作量**: 2小时

---

## 🎨 最佳实践

### 1. 命名规范

```javascript
// 关联关系命名: {parent}{Child}Relation
collegeMajorRelation    // ✅
major_level_relation    // ❌

// 过滤后的选项命名: filtered{FieldName}s
filteredMajors          // ✅
majorOptions            // ⚠️ 不够明确
```

### 2. 联动优先级

```
高优先级(先判断) → 低优先级
层次 > 专业 > 学院
```

### 3. 清空策略

```javascript
// 父级变化时,清空所有子级
handleCollegeChange() {
  clearFields(['majorId', 'trainingLevelId', 'enrollmentYear', 'planId']);
}
```

### 4. 禁用状态

```vue
:disabled="!filteredOptions.length && hasParentSelected"
```

---

## 🔧 技术要点

### 1. 关联数据格式

```javascript
{
  "1": [1, 2, 3],  // 父级ID -> 子级ID数组
  "2": [4, 5]
}
```

### 2. 交集过滤

```javascript
// Set自动去重,适合数值类型
const resultSet = new Set(years1.filter(y => years2.includes(y)));
```

### 3. 性能优化

- 使用computed缓存计算结果
- 避免在模板中直接调用函数
- 大数据量时使用Map替代对象

---

## 📊 迁移优先级建议

1. **高优先级**: 教学安排页 (已有部分联动,用户频繁使用)
2. **中优先级**: 教师信息页 (数据量大,筛选需求强)
3. **中优先级**: 开课查询页 (与班级管理页类似,易迁移)
4. **低优先级**: 课时统计页 (筛选相对独立)

---

## ✅ 验收标准

每个页面迁移完成后应满足:

- [ ] 所有相关筛选项实现联动
- [ ] 切换父级时自动清空子级
- [ ] 无可用选项时禁用下拉框
- [ ] 导出功能应用筛选条件
- [ ] 性能无明显下降
