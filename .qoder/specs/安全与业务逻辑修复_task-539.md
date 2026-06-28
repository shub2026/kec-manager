# KEC Manager 安全与业务逻辑修复计划

## 审计总结

| 严重级别 | 数量 | 主要问题域 |
|---------|------|-----------|
| Critical | 2 | 培养方案匹配优先级不一致（listClasses / exportClasses） |
| High | 4 | 手动排课周课时推导、学期参数校验、导入数据丢失、分页不准 |
| Medium | 5 | 前后端月份不一致、weekly_hours 不同步、缓存、pageSize 上限、工作量检查 |
| Low | 2 | 班级同名检测、并发锁文档 |

**系统性根因**: `findBestMatchPlan`（major > level 优先级）已在排课算法中使用，但班级列表、导出、手动排课等模块仍使用 `isClassMatchPlan` + 取首个匹配，导致不同入口的行为不一致。

---

## Task 1 (H3): 教师导入 `hasCourseCol` 守卫 — 数据丢失风险

**文件**: `server/src/controllers/import/teachers.js`

**问题**: 更新教师时无条件删除+重建 `teacher_courses`。Excel 不含"学科"列时，所有课程关联被清空。而任课学院/层次列已有 `hasCollegeCol`/`hasLevelCol` 守卫。

**修改**:
- 第 118 行后新增 `const hasCourseCol = !!String(sanitizedRow['学科'] || '').trim();`
- `teacherOps.push` 对象中增加 `hasCourseCol` 属性
- 第 387-393 行包裹在 `if (op.hasCourseCol)` 守卫中

**影响**: 仅影响导入更新路径。不含学科列的 Excel 不再清空课程关联。

---

## Task 2 (C1): `listClasses` 使用 `findBestMatchPlan`

**文件**: `server/src/controllers/class.controller.js`

**问题**: 第 96 行 `matchedPlans[0]` 不区分 major > level 优先级。

**修改**:
- 导入 `findBestMatchPlan`
- 第 95-119 行：使用 `findBestMatchPlan(cls, allPlans)` 选定最佳方案，保留交叉匹配警告逻辑

**影响**: 仅影响班级列表显示的方案名称。

---

## Task 3 (C2): `exportClasses` 使用 `findBestMatchPlan`

**文件**: `server/src/controllers/export/data-export.controller.js`

**问题**: 第 180-191 行手动两-pass `allPlans.find()`，不走统一匹配函数。

**修改**:
- 导入 `findBestMatchPlan`
- 第 179-191 行替换为 `findBestMatchPlan(cls, allPlans)`

**影响**: 仅影响导出 Excel 的"当前方案"列。

---

## Task 4 (H1): `assignTeacher` 周课时推导使用 `findBestMatchPlan`

**文件**: `server/src/controllers/teaching-arrange.controller.js`

**问题**: 第 170-186 行迭代取首个匹配方案，忽略 major > level 优先级。

**修改**:
- 导入 `findBestMatchPlan`
- 第 169-186 行：收集候选方案，用 `findBestMatchPlan` 选定最佳方案后取周课时

**影响**: 仅影响手动安排教师且未传 `weekly_hours` 时的自动推导。

---

## Task 5 (H2): `parseSemester` 增加年份连续性校验

**文件**: `server/src/services/arrange/queries.js`

**问题**: 接受 "2025-2027-1" 等非法学期格式。

**修改**: 第 26 行后新增 `if (endYear !== startYear + 1) return null;`

**影响**: 所有调用者已正确处理 null 返回。

---

## Task 6 (M2): `updatePlanCourse` 同步 weekly_hours 到学期记录

**文件**: `server/src/controllers/plan/plan-matrix.controller.js`

**问题**: 学期范围不变时修改周课时，`plan_course_semesters` 保持旧值，排课时取到旧数据。

**修改**: 第 197 行后添加 else 分支，当 `weekly_hours` 或 `weeks_per_semester` 变化时 `updateMany` 同步（不触碰教材关联）。

**影响**: 方案矩阵编辑的周课时变更将正确传播。注意：会覆盖通过 `upsertSemester` 单独设置过的值。

---

## Task 7 (M4): 审计日志 pageSize 上限

**文件**: `server/src/services/audit.service.js`

**修改**: 第 67 行改为 `const take = Math.min(Math.max(Number(pageSize) || 20, 1), 100);`

---

## Task 8 (M1): 统一前后端学期月份边界

**文件**: `server/src/controllers/class.controller.js` 第 21 行

**修改**: `month >= 9` 改为 `month >= 8`（与前端 `useSemesters.js` 及教育行业惯例一致）

---

## Task 9 (M3): `getCurrentSemesterInfo` 添加 TTL 缓存

**文件**: `server/src/services/settings.service.js`

**修改**: 添加 30 秒 TTL 缓存 + `invalidateSemesterCache()` 导出。在 `settings.controller.js` 更新学期设置时调用 invalidate。

---

## Task 10 (H4): `querySemester` 分页总数修正

**文件**: `server/src/controllers/query.controller.js`

**问题**: `totalClassesCount` 包含无课班级（被应用层跳过），导致分页总数偏大。

**修改**: 返回时区分 `total`（DB 总数，用于分页）和 `totalClasses`（当页实际结果数），前端可展示提示。

---

## Task 11 (M5): `assignTeacher` 教师工作量警告

**文件**: `server/src/controllers/teaching-arrange.controller.js`

**修改**: upsert 成功后查询教师当前学期总课时，超阈值时返回 `workloadWarning`（非阻塞）。

---

## Task 12 (L2): 班级导入同名检测

**文件**: `server/src/controllers/import/classes.js`

**修改**: 参照教师导入的同名检测逻辑，事务前预加载同名班级计数，事务内跳过并报错。

---

## Task 13 (L1): 并发锁文档注释

**文件**: `server/src/services/arrange/auto-arrange.js`, `server/src/services/arrange/batch.js`

**修改**: 在 lock 变量声明处添加 JSDoc 注释说明单进程限制。

---

## 实施策略

- Task 1-8 无相互依赖，按顺序逐文件修改
- Task 9 需同时修改 `settings.service.js` 和 `settings.controller.js`
- Task 10-12 独立修复
- Task 13 纯注释

## 验证方式

每个修复完成后：
1. 检查文件无语法错误
2. 确认 `findBestMatchPlan` 的 import 路径正确
3. 确认不影响其他调用方的行为
