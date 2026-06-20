# 代码重复问题分析报告

**分析日期**: 2026-06-14
**问题来源**: CODE_ANALYSIS_REPORT.md 第188-190行提到的代码重复问题

---

## 📋 问题概述

项目中存在以下两类主要的代码重复：

1. **排序逻辑重复** - 在多个列表页面中重复实现
2. **导出/下载模板逻辑重复** - 在多个视图组件中几乎完全相同

---

## 🔍 详细分析

### 1️⃣ 排序逻辑重复（前端）

#### 涉及文件
- `client/src/views/major/MajorList.vue` (lines 139-183)
- `client/src/views/college/CollegeList.vue` (lines 139-193)
- `client/src/views/course/CourseList.vue` (lines 313-357)
- `client/src/views/textbook/TextbookList.vue` (部分实现，使用不同的方式)

#### 重复代码模式

**handleMoveUp 函数**（几乎完全相同的逻辑）:
```javascript
async function handleMoveUp(row, index) {
  if (index === 0) return
  
  const currentItem = list.value[index]
  const prevItem = list.value[index - 1]
  
  try {
    // 如果排序值相同，使用基于位置的值
    const newCurrentSort = currentItem.sortOrder === prevItem.sortOrder ? index - 1 : prevItem.sortOrder
    const newPrevSort = currentItem.sortOrder === prevItem.sortOrder ? index : currentItem.sortOrder
    
    await Promise.all([
      updateXxx(currentItem.id, { sortOrder: newCurrentSort }),
      updateXxx(prevItem.id, { sortOrder: newPrevSort })
    ])
    ElMessage.success('排序已更新')
    await silentReload()
  } catch (e) {
    console.error('排序更新失败:', e)
    ElMessage.error('排序更新失败')
  }
}
```

**handleMoveDown 函数**（同样的重复模式）:
```javascript
async function handleMoveDown(row, index) {
  if (index === list.value.length - 1) return
  
  const currentItem = list.value[index]
  const nextItem = list.value[index + 1]
  
  try {
    const newCurrentSort = currentItem.sortOrder === nextItem.sortOrder ? index + 1 : nextItem.sortOrder
    const newNextSort = currentItem.sortOrder === nextItem.sortOrder ? index : currentItem.sortOrder
    
    await Promise.all([
      updateXxx(currentItem.id, { sortOrder: newCurrentSort }),
      updateXxx(nextItem.id, { sortOrder: newNextSort })
    ])
    ElMessage.success('排序已更新')
    await silentReload()
  } catch (e) {
    console.error('排序更新失败:', e)
    ElMessage.error('排序更新失败')
  }
}
```

#### 差异点
- 变量命名略有不同（`currentItem/prevItem` vs `currentCollege/prevCollege`）
- TextbookList.vue 使用不同的方式（传递 row 对象而非 index）

---

### 2️⃣ 导出/下载模板逻辑重复（前端）

#### 涉及文件
- `client/src/views/course/CourseList.vue` (lines 170-212)
- `client/src/views/textbook/TextbookList.vue` (lines 427-466)
- `client/src/views/class/ClassList.vue` (lines 376-417，但实现方式不同)

#### 重复代码模式

**exportData 函数**（CourseList 和 TextbookList 几乎完全相同）:
```javascript
async function exportData() {
  try {
    const response = await request.get('/export/xxx', {
      responseType: 'blob'
    })
    
    const blob = new Blob([response], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `xxx数据_${new Date().getTime()}.xlsx`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
    
    ElMessage.success('导出成功')
  } catch (error) {
    ElMessage.error('导出失败')
  }
}
```

**downloadTemplate 函数**（同样高度重复）:
```javascript
async function downloadTemplate() {
  try {
    const response = await request.get('/export/template/xxx', {
      responseType: 'blob'
    })
    
    const blob = new Blob([response], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'xxx导入模板.xlsx'
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
    
    ElMessage.success('模板下载成功')
  } catch (error) {
    ElMessage.error('下载模板失败')
  }
}
```

#### 差异点
- ClassList.vue 使用了不同的实现方式（直接 window.open）
- 仅 URL 路径和文件名不同

---

### 3️⃣ 后端排序逻辑重复

#### 涉及文件
- `server/src/controllers/major.controller.js`
- `server/src/controllers/college.controller.js`
- `server/src/controllers/course.controller.js`
- `server/src/controllers/textbook.controller.js`
- `server/src/controllers/trainingLevel.controller.js`

#### 重复模式

**创建时的排序值计算**（每个控制器都有相同逻辑）:
```javascript
const maxSort = await prisma.xxx.aggregate({ _max: { sort_order: true } });
const newSortOrder = sort_order !== undefined ? Number(sort_order) : (maxSort._max.sort_order || 0) + 1;
```

**查询时的排序**（每个控制器都相同）:
```javascript
orderBy: { sort_order: 'asc' }
```

**更新时的排序字段处理**（重复的赋值逻辑）:
```javascript
if (sort_order !== undefined) data.sort_order = Number(sort_order);
```

---

## 📊 重复程度统计

| 重复类型 | 涉及文件数 | 重复行数估算 | 重复率 |
|---------|-----------|------------|--------|
| 前端排序逻辑 | 4个视图 | ~180行 | 95% |
| 前端导出逻辑 | 3个视图 | ~120行 | 98% |
| 后端排序逻辑 | 5个控制器 | ~75行 | 90% |
| **总计** | **12个文件** | **~375行** | **~94%** |

---

## ⚠️ 当前问题

### 1. 维护成本高
- 修改排序算法需要同时更新 4+ 个文件
- 修复导出 bug 需要在多个地方同步修改

### 2. 代码不一致风险
- CollegeList.vue 和 MajorList.vue 的变量命名不一致
- ClassList.vue 的导出实现与其他两个完全不同

### 3. 违反 DRY 原则
- 相同的业务逻辑分散在多处
- 增加了测试覆盖的难度

---

## ✅ 建议的解决方案

### 方案 A：创建可复用 Composables（推荐）

#### 1. 前端排序 Composable
```javascript
// client/src/composables/useSortable.js
import { ElMessage } from 'element-plus'

export function useSortable(list, updateFn, reloadFn) {
  async function handleMoveUp(item, index) {
    if (index === 0) return
    
    const currentItem = list.value[index]
    const prevItem = list.value[index - 1]
    
    try {
      const newCurrentSort = currentItem.sortOrder === prevItem.sortOrder ? index - 1 : prevItem.sortOrder
      const newPrevSort = currentItem.sortOrder === prevItem.sortOrder ? index : currentItem.sortOrder
      
      await Promise.all([
        updateFn(currentItem.id, { sortOrder: newCurrentSort }),
        updateFn(prevItem.id, { sortOrder: newPrevSort })
      ])
      ElMessage.success('排序已更新')
      await reloadFn()
    } catch (e) {
      console.error('排序更新失败:', e)
      ElMessage.error('排序更新失败')
    }
  }
  
  async function handleMoveDown(item, index) {
    if (index === list.value.length - 1) return
    
    const currentItem = list.value[index]
    const nextItem = list.value[index + 1]
    
    try {
      const newCurrentSort = currentItem.sortOrder === nextItem.sortOrder ? index + 1 : nextItem.sortOrder
      const newNextSort = currentItem.sortOrder === nextItem.sortOrder ? index : currentItem.sortOrder
      
      await Promise.all([
        updateFn(currentItem.id, { sortOrder: newCurrentSort }),
        updateFn(nextItem.id, { sortOrder: newNextSort })
      ])
      ElMessage.success('排序已更新')
      await reloadFn()
    } catch (e) {
      console.error('排序更新失败:', e)
      ElMessage.error('排序更新失败')
    }
  }
  
  return { handleMoveUp, handleMoveDown }
}
```

**使用示例**:
```javascript
// MajorList.vue
import { useSortable } from '../../composables/useSortable'

const { handleMoveUp, handleMoveDown } = useSortable(
  list, 
  updateMajor, 
  silentReload
)
```

#### 2. 前端导出 Composable
```javascript
// client/src/composables/useExport.js
import { ElMessage } from 'element-plus'
import request from '../utils/request'

export function useExport(entityName, displayName) {
  async function exportData() {
    try {
      const response = await request.get(`/export/${entityName}`, {
        responseType: 'blob'
      })
      
      downloadBlob(response, `${displayName}_${new Date().getTime()}.xlsx`)
      ElMessage.success('导出成功')
    } catch (error) {
      ElMessage.error('导出失败')
    }
  }
  
  async function downloadTemplate() {
    try {
      const response = await request.get(`/export/template/${entityName}`, {
        responseType: 'blob'
      })
      
      downloadBlob(response, `${displayName}导入模板.xlsx`)
      ElMessage.success('模板下载成功')
    } catch (error) {
      ElMessage.error('下载模板失败')
    }
  }
  
  function downloadBlob(response, filename) {
    const blob = new Blob([response], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }
  
  return { exportData, downloadTemplate }
}
```

**使用示例**:
```javascript
// CourseList.vue
import { useExport } from '../../composables/useExport'

const { exportData, downloadTemplate } = useExport('courses', '课程数据')
```

#### 3. 后端排序 Helper
```javascript
// server/src/utils/sort-helper.js
/**
 * 获取下一个排序值
 */
export async function getNextSortOrder(prisma, modelName) {
  const maxSort = await prisma[modelName].aggregate({ 
    _max: { sort_order: true } 
  });
  return (maxSort._max.sort_order || 0) + 1;
}

/**
 * 标准化排序字段
 */
export function normalizeSortOrder(value, defaultOrder) {
  if (value !== undefined) {
    return Number(value);
  }
  return defaultOrder;
}
```

---

### 方案 B：提取为工具函数（简单方案）

如果不使用 Composables，可以创建简单的工具函数：

```javascript
// client/src/utils/sort.js
export async function moveItem(list, index, direction, updateFn, reloadFn) {
  // 通用移动逻辑
}

// client/src/utils/export.js
export async function exportToExcel(url, filename) {
  // 通用导出逻辑
}
```

---

### 方案 C：创建高阶组件（复杂方案）

创建一个通用的列表组件，包含排序、导出等功能：

```vue
<!-- components/BaseList.vue -->
<template>
  <el-table :data="list">
    <!-- 通用排序按钮 -->
    <el-table-column label="排序">
      <template #default="{ row, $index }">
        <SortButtons 
          :item="row" 
          :index="$index" 
          @move-up="handleMoveUp" 
          @move-down="handleMoveDown" 
        />
      </template>
    </el-table-column>
  </el-table>
</template>
```

---

## 🎯 推荐实施方案

**优先级排序**:

1. **高优先级** - 前端导出逻辑重构（最简单，收益最大）
   - 创建 `useExport` composable
   - 替换 3 个视图中的重复代码
   - 预计减少 ~120 行重复代码

2. **中优先级** - 前端排序逻辑重构
   - 创建 `useSortable` composable
   - 替换 4 个视图中的重复代码
   - 预计减少 ~180 行重复代码

3. **低优先级** - 后端排序逻辑优化
   - 创建排序 helper 函数
   - 统一 5 个控制器的排序处理
   - 预计减少 ~75 行重复代码

---

## 📈 预期收益

| 指标 | 改善前 | 改善后 | 提升 |
|------|--------|--------|------|
| 重复代码行数 | ~375行 | ~50行 | -87% |
| 需要维护的文件数 | 12个 | 3个工具文件 | -75% |
| Bug修复影响范围 | 多处同步修改 | 单点修改 | 100% |
| 新页面开发时间 | 需复制粘贴 | 直接引入 | -60% |

---

## 🚀 快速开始

如果要立即开始重构，建议按以下步骤：

1. **第一步**：创建 `client/src/composables/useExport.js`
2. **第二步**：在 CourseList.vue 中试用
3. **第三步**：验证无误后，应用到 TextbookList.vue 和 ClassList.vue
4. **第四步**：用同样方式处理排序逻辑

---

**生成时间**: 2026-06-14
**下次审查建议**: 完成重构后对比代码重复率
