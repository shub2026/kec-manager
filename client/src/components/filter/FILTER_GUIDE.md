# 筛选器联动使用指南

> **文档状态**：使用指南（与代码同步维护）  
> `useFilterLinkage` composable 位于 `components/filter/composables/`，已在班级管理、教师信息、教学安排、开课查询四个页面落地。

## 📋 目录

- [设计理念](#设计理念)
- [使用方式](#使用方式)
- [各页面集成现状](#各页面集成现状)

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

## 📝 各页面集成现状

| 页面 | 集成位置 | 联动能力 |
| ---- | -------- | -------- |
| 班级管理 (ClassList) | `views/class/components/ClassFilterBar.vue` | 学院→专业；学院/专业/层次→入学年份交集过滤（`getIntersectedOptions`），作为标准实现参考 |
| 教师信息 (TeacherList) | `views/teaching/components/TeacherFilterBar.vue` | 意向学院→意向层次过滤（`getFilteredOptions`），父级变化自动清空子级 |
| 教学安排 (TeachingArrange) | `views/teaching/components/ArrangeToolbar.vue` | 学院→专业等父子级清空联动（`handleParentChange`） |
| 开课查询 (UnifiedSemesterQuery) | `views/query/UnifiedSemesterQuery.vue` | 父子级清空联动（`handleParentChange`），后端 API 参数过滤 |
| 课时统计 (TeachingStatistics) | 未集成 | 筛选项相对独立，暂无联动需求；如需集成可参照 ClassFilterBar 模式 |

新页面接入时，建议以 `ClassFilterBar.vue` 为参考实现，遵循下方最佳实践。

---

## 🎨 最佳实践

### 1. 命名规范

```javascript
// 关联关系命名: {parent}{Child}Relation
collegeMajorRelation; // ✅
major_level_relation; // ❌

// 过滤后的选项命名: filtered{FieldName}s
filteredMajors; // ✅
majorOptions; // ⚠️ 不够明确
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
const resultSet = new Set(years1.filter((y) => years2.includes(y)));
```

### 3. 性能优化

- 使用computed缓存计算结果
- 避免在模板中直接调用函数
- 大数据量时使用Map替代对象
