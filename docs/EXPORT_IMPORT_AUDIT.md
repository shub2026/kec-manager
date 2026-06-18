## 导出/导入/模板接口检查报告

本文档整理了教学安排模块中所有导出（数据导出、模板导出）和导入接口的检查结果，按严重程度分类。

---

### 一、严重问题（功能缺陷）

#### 1.1 教师导入丢失任课层次数据

- **文件**：`server/src/controllers/import.controller.js` — `importTeachers`
- **问题**：教师导入函数只处理了 `teacher_courses`（学科）和 `teacher_scheduling_colleges`（任课学院）两个关联表，**完全遗漏了 `teacher_training_levels`（任课层次）**。导入或覆盖教师后，任课层次数据被静默丢弃。
- **影响**：通过 Excel 导入/更新教师会导致已配置的任课层次关联被清除。
- **修复**：
  1. 导入模板和导入逻辑增加"任课层次"列
  2. 更新时重建 `teacher_training_levels` 关联
  3. 创建时同步创建任课层次关联

#### 1.2 教师导入没有事务保护

- **文件**：`server/src/controllers/import.controller.js` — `importTeachers`
- **问题**：班级/课程/教材导入都使用 `prisma.$transaction(operations)` 原子提交，但教师导入对每位教师逐个执行 `update` + `deleteMany` + `createMany`，没有包裹在事务中。如果中途失败，已处理的教师数据处于半更新状态。
- **影响**：部分导入成功、部分失败时数据不一致，无法回滚。
- **修复**：将所有教师操作收集为 Prisma 操作数组，统一在 `$transaction` 中执行。

#### 1.3 教师导出缺少归属学院和任课层次列

- **文件**：`server/src/controllers/export/data-export.controller.js` — `exportTeachers`
- **问题**：导出的列只有：教师姓名、性别、出生年月、人员类别、教师资格类型、特定周课时、学科、任课学院。缺少**归属学院**（`affiliatedCollege`）和**任课层次**（`trainingLevelList`）两列。
- **影响**：导出的 Excel 无法反映教师的完整信息，也无法通过导出→编辑→导入的循环保持数据完整。

#### 1.4 教师导入模板缺少归属学院和任课层次列

- **文件**：`server/src/controllers/export/export-template.controller.js` — `teachers` case
- **问题**：模板只有 8 列，缺少"归属学院"和"任课层次"。与教师信息页的表单字段不一致。
- **影响**：用户无法通过模板完整填写教师信息。

---

### 二、中等问题（数据一致性风险）

#### 2.1 课程导入/导出的类型映射不对称

- **导入逻辑**：`typeValue === '专业课' ? 'professional' : 'public'` — 只有"专业课"被映射为 `professional`，其他全部默认 `public`
- **导出逻辑**：`type === 'public' ? '公共基础课' : '专业课'` — 导出使用"公共基础课"
- **问题**：如果用户导出课程数据（列值为"公共基础课"），不做修改直接重新导入，`'公共基础课' !== '专业课'` → 被映射为 `public`。虽然结果正确，但映射逻辑不对称，容易在扩展课程类型时出错。

#### 2.2 班级导出列头与导入模板不完全对应

- **导出列**：班级名称、二级学院、专业、培养层次、入学年份、学制(年)、人数、年级、状态、关联类型、当前方案（11列）
- **导入模板**：班级名称、入学年份、学制(年)、专业类别、二级学院、培养层次、班级人数、状态（8列）
- **问题**：导出比导入多出"年级"、"关联类型"、"当前方案"三列（计算字段），且"专业"→"专业类别"、"人数"→"班级人数"列名不同。用户如果导出后直接作为导入文件，会因为列名不匹配导致数据丢失。

#### 2.3 班级/教师导入自动创建关联数据绕过事务回滚

- **文件**：`importClasses`、`importTeachers`
- **问题**：自动创建学院/专业/培养层次/课程的操作（`prisma.xxx.upsert`）在主循环中立即执行，而实际的班级/教师创建/更新操作收集在 `transactionOperations` 数组中延迟执行。如果事务回滚，自动创建的关联数据不会被撤销。
- **影响**：即使导入失败，数据库中也会残留自动创建的学院、专业等记录。

---

### 三、低等问题（冗余/代码质量）

#### 3.1 导出路由双重 authMiddleware

- **文件**：`app.js` 第95行 + `export.routes.js` 第21行
- **问题**：`app.use('/api/export', authMiddleware, exportRoutes)` 在挂载时注册了一次 `authMiddleware`，而 `export.routes.js` 中 `router.use(authMiddleware)` 又注册了一次。每次导出请求执行两次认证校验。
- **影响**：不影响功能，但浪费一次 JWT 解码。
- **修复**：移除 `export.routes.js` 中的 `router.use(authMiddleware)`，仅保留 `app.js` 挂载处的中间件。

#### 3.2 导入路由双重 roleMiddleware

- **文件**：`app.js` 第114行 + `import.routes.js` 每条路由
- **问题**：`app.use('/api/import', authMiddleware, roleMiddleware('admin', 'super_admin'), importRoutes)` 在挂载时已注册了权限检查，但 `import.routes.js` 每条路由又重复注册了 `roleMiddleware('admin', 'super_admin')`。
- **修复**：移除 `import.routes.js` 中各路由的 `roleMiddleware`，仅保留 `app.js` 挂载处的中间件。

#### 3.3 exportTextbookUsage 中冗余的 semester 解构

- **文件**：`server/src/controllers/export/data-export.controller.js` 第273行
- **问题**：函数开头解构了 `const { semester } = req.query`，但未使用。第277行又在条件分支内重新解构 `const { semester } = req.query`，形成变量遮蔽。
- **修复**：删除第273行的解构，仅保留条件分支内的。

#### 3.4 教师导入 autoCreatedCourses 计数逻辑冗余

- **文件**：`import.controller.js` 第722行
- **问题**：判断是否需要递增 `autoCreatedCourses` 时使用了 `!courses.find(c => c.name === cName)`（O(n) 线性搜索），而上方已经通过 `!courseMap[cName]` 判断了课程不存在（O(1) 查找），两个判断等价。
- **修复**：直接用 `if (!(cName in courseMap)) autoCreatedCourses++` 替代。

---

### 四、功能覆盖矩阵

| 实体 | 模板下载 | 数据导出 | 数据导入 | 前端导出 | 前端导入 |
|---|---|---|---|---|---|
| 班级 | ✅ | ✅（含筛选） | ✅（自动创建学院/专业/层次） | ✅ | ✅ |
| 课程 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 教材 | ✅ | ✅ + 教材使用详情 | ✅ | ✅ | ✅ |
| 教师 | ⚠️ 缺2列 | ⚠️ 缺2列 | ⚠️ 缺任课层次、无事务 | ✅ | ✅ |
| 教学安排 | — | ✅（按课程+学期） | — | ✅ | — |
| 课时统计 | — | ✅（按学期） | — | ✅ | — |
| 开课情况 | — | ✅（GET+POST，含筛选） | — | ✅ | — |

---

### 五、建议修复优先级

| 优先级 | 项目 | 原因 |
|---|---|---|
| P0 | 教师导入补充任课层次 + 事务保护 | 数据丢失风险 |
| P0 | 教师导出/模板补充归属学院和任课层次 | 导出导入无法闭环 |
| P1 | 移除双重中间件 | 减少不必要的计算开销 |
| P1 | 课程导入导出类型映射对齐 | 数据一致性 |
| P2 | 班级导出列头与导入模板对齐 | 用户体验 |
| P2 | 自动创建关联数据纳入事务 | 极端情况下数据残留 |
| P3 | 代码质量清理 | 维护性 |
