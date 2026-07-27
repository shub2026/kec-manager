# kec-manager 全量修复报告

> 修复时间：2026-07-27 | 测试：1441 passed | 前端构建：✅

## 修复清单

### P0（5项）

| # | 文件 | 修复内容 |
|---|------|----------|
| 1 | `client/src/views/Dashboard.vue` | `insights-grid` 的 `<div>` 改为 `<section role="region" aria-label="教学洞察">`，补齐 a11y |
| 2 | `client/src/components/CourseProgressChart.vue` | 课时显示 `Math.round` → `round1`（保留一位小数），与后端 `assignedWeeklyHours` 精度对齐 |
| 3 | `client/src/components/HoursChart.vue` | `totalHours` 补 `Math.round(sum * 10) / 10`，消除浮点尾差 |
| 4 | `client/src/views/Login.vue` | SVG + CSS 约 100 处硬编码颜色全部替换为设计令牌（`var(--brand-primary)` 等），`.card-header` → `.login-card-header` 避免全局冲突 |
| 5 | `server/src/services/arrange/optimize.js` | **N+1 查询修复**：循环内逐班 `classes.findUnique` + 逐课 `plan_courses.findMany` 改为两次批量 `findMany` |
| 6 | `server/src/services/arrange/optimize.js` | **跨课程状态同步**：优化后把 `courseTeacherConstraints` 的 `assignedTextbookIds`/`assignedCollegeIds` 增量回写到共享 `teacherConstraints` |

### P1（9项）

| # | 文件 | 修复内容 |
|---|------|----------|
| 7 | `server/src/services/arrange/optimize.js` | **目标函数统一**：`calculateMetrics.score` 补齐 `underAssignmentPenalty`(α=5) 和 `loadVariancePenalty`(β=2×100)，与 `computeObjective` 对齐 |
| 8 | `server/src/services/arrange/optimize.js` | **阈值负分修复**：`before.score > 0` → `!== 0`，否则负分→正分的巨大改进被误判为 0% |
| 9 | `server/src/services/arrange/optimize.js` | **teachers.find 线性查找** → `teacherNameMap` O(1) 查找 |
| 10 | `server/src/services/arrange/auto-arrange.js` | `isPrefMatch` 补注释：明确"不含教材上限检查，由 takeClassesForTeacher 兜底" |
| 11 | `server/src/services/arrange/auto-arrange.js` | 阶段5注释 "=== 阶段5：禁忌搜索 ===" → "=== 后置优化层：禁忌搜索 ===" |
| 12 | `server/src/services/arrange/auto-arrange.js` | 不可达分支注释补充：明确 `TEXTBOOK_COUNT_PENALTY_2/3PLUS` 仅 `MAX≥3` 时生效 |
| 13 | `client/src/views/teaching/components/TeacherSelectDialog.vue` | 自建 `matchMedia` + 无效 `removeEventListener` → 复用 `useResponsive` 共享实例，消除内存泄漏 |
| 14 | `client/src/views/teaching/TeachingArrange.vue` | `.header-filter` 宽度选择器加 `.arrange-header` 前缀 |
| 15 | `client/src/views/teaching/components/TeacherSelectDialog.vue` | `width="80%"` + `maxWidth:1400px` → `var(--dialog-width-xxl)`（新增令牌） |
| 16 | `client/src/views/class/components/ClassFormDialog.vue` | `:gutter="20"` → `:gutter="16"`（对齐 `--form-col-gutter`） |
| 17 | 6个列表页 | 排序按钮补 `aria-label="上移"` / `aria-label="下移"` |
| 18 | `client/src/components/Layout.vue` | `#fff` → `var(--bg-card)`；`_readVar` fallback 硬编码移除 |

### P2（5项）

| # | 文件 | 修复内容 |
|---|------|----------|
| 19 | `server/src/services/arrange/optimize.js` | 改进阈值 `&&` → `||`（`scoreImprovement > 5 \|\| (changes >= 3 && > 2)`），不再丢弃有效小变更 |
| 20 | `client/src/styles/global.css` | 新增不带 `.page-toolbar` 前缀的通用 `.filter-xs/sm/md/lg/xl/2xl` 工具类 |
| 21 | `client/src/styles/theme.css` | 新增 `--dialog-width-xxl: min(1200px, 95vw)` 令牌 |
| 22 | `client/src/views/teaching/components/HourSettingsCard.vue` | 内联 `style="width:80px"` → `class="filter-xs"` |
| 23 | `client/src/views/teaching/TeacherList.vue` | 内联 `style="width:200px"` → `class="filter-xl"` |
| 24 | `client/src/components/CourseMatrix.vue` | 删除未使用的 `allCourses` prop（+ PlanDetail.vue 同步删除传递） |

## 验证结果

| 验证项 | 结果 |
|--------|------|
| server 端 vitest | ✅ 64 files / 1441 tests passed |
| client 端 vite build | ✅ 构建成功，无报错 |
