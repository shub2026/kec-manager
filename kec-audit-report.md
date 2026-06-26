# KEC Manager 教学管理平台安全漏洞与业务逻辑审计报告

> **审计日期**: 2026-06-25  
> **审计范围**: 后端 80+ 文件 · 前端 58 文件 · 数据库 Schema · 排课算法  
> **发现问题**: 32 项（严重 1 · 高危 7 · 中危 13 · 低危 11）  
> **修复状态**: P0+P1+P2 已修复 8 项

---

## 📊 问题严重程度分布

| 严重程度 | 数量 | 状态 |
|---------|------|------|
| 🔴 严重 (Critical) | 1 | ✅ 已修复 |
| 🟠 高危 (High) | 7 | ✅ 6项已修复，1项待处理 |
| 🟡 中危 (Medium) | 13 | 📅 排期修复 |
| 🔵 低危 (Low) | 11 | 📅 择期修复 |

---

## 目录

1. [审计概览与方法论](#1-审计概览与方法论)
2. [严重级问题（数据丢失风险）](#2-严重级问题)
3. [高危问题（安全漏洞 + 业务逻辑缺陷）](#3-高危问题)
4. [中危问题汇总](#4-中危问题汇总)
5. [低危问题汇总](#5-低危问题汇总)
6. [修复方案与影响分析](#6-修复方案与影响分析)
7. [安全基线正面评价](#7-安全基线正面评价)

---

## 1. 审计概览与方法论

本次审计在项目既有 v2.12.3 安全修复基础上，对全量后端源码、前端关键组件、Prisma 数据模型与排课算法进行**独立第三轮深度审查**。审计聚焦三大维度：高危安全漏洞检测、业务功能与数据逻辑正确性、修复方案的连带影响评估。所有严重/高危发现均已通过源码逐行核验，确保无误报。

### 审计方法

采用三路并行深度探查：
1. **全路由授权与越权（IDOR）审计**
2. **排课算法与培养方案关联业务逻辑审计**
3. **数据导入导出与学期计算安全审计**

关键发现均经主审计师源码二次核验，重点验证了级联删除、学期校验、教材统计、公式注入四类问题的真实性与可利用性。

---

## 2. 严重级问题

### 严重-1: 编辑方案课程时级联清空全部教材关联（静默数据丢失）✅ 已修复

**问题位置**: `server/src/controllers/plan/plan-matrix.controller.js` 第 130-159 行 `updatePlanCourse` 函数

#### 问题代码

```javascript
const pc = await prisma.$transaction(async (tx) => {
  const updated = await tx.plan_courses.update({
    where: { id: Number(id) },
    data: { start_semester, end_semester, weekly_hours, sort_order, ... },
  });

  // ⚠️ 危险操作：删除全部学期记录
  await tx.plan_course_semesters.deleteMany({
    where: { plan_course_id: Number(id) },
  });

  for (let s = newStart; s <= newEnd; s++) {
    await tx.plan_course_semesters.create({
      data: { plan_course_id, semester: s, weekly_hours, weeks_count }, // 无教材
    });
  }
});
```

#### 根因分析

`updatePlanCourse` 无论修改哪个字段——即使只改 `sort_order`（拖拽排序）——都会**先 deleteMany 全部 `plan_course_semesters` 记录，再重建空记录**。由于 Schema 中 `plan_textbooks` 对 `plan_course_semesters` 是 `onDelete: Cascade`，删除学期记录会级联清空该课程所有学期的教材关联，且重建时不带任何教材。

#### 业务影响

- 用户在培养方案矩阵中**拖动课程排序**即静默丢失该课程全部教材关联
- 调整"开课学期范围"同样丢失教材
- 教材丢失后，`getClassesWithCourse` 返回空 textbooks，排课的教材内聚评分完全失效
- `getTeachersForCourse` 的教师固有教材快照变空，排课结果退化

#### 修复方案

将 `updatePlanCourse` 改为按需增删学期记录（diff 新旧区间，仅删除超出区间的、仅新增缺失的），保留区间内学期的 `plan_textbooks`。**排序（`sort_order`）更新应走独立轻量端点**，绝不触发学期重建。或在 deleteMany 前备份教材、重建后按 semester 回填。

#### 影响分析

改动仅限 `updatePlanCourse` 一个函数，前端调用方式不变（接口入参不变），无连带影响。新增排序端点需在 `plan.routes.js` 注册路由，前端 `CourseMatrix.vue` 的 `swapSortOrder` 改调新端点。

---

## 3. 高危问题

### H-1: 学期写入校验弱于解析校验，可使全系统查询静默失效 ✅ 已修复

**问题位置**: `server/src/controllers/settings.controller.js` 第 81 行（写入校验）vs `server/src/services/settings.service.js` 第 60-98 行（`parseSemesterString` 读取校验）

#### 问题代码

```javascript
// settings.controller.js:81 — 仅正则，缺连续性与年份范围校验
if (!/^\d{4}-\d{4}-[12]$/.test(String(updates.current_semester))) {
  return fail(res, '当前学期格式错误...');
}

// settings.service.js:79-87 — parseSemesterString 严格校验（读取/查询路径用）
if (semesterIndex < 1 || semesterIndex > 2) return { success: false };
if (endYear !== startYear + 1) return { success: false };
if (startYear < 2000 || startYear > 2099) return { success: false };
```

#### 根因分析

写入校验的正则 `^\d{4}-\d{4}-[12]$` 允许 `0000-0000-1`、`2025-2027-2`、`9999-0000-2` 等非法值入库。而读取路径 `getCurrentSemesterInfo` 仅查 NaN（不校验连续性/范围），`parseSemesterString` 却严格校验。写入与读取校验标准不一致。

#### 业务影响

- 存入 `2025-2027-2` 时 `formatSemesterLabel` 显示"2027年春季"（应为2026）
- 存入 `0000-0001-1` 时 `calcClassSemester` 算出大负数年级 → `getActiveClassFilter` 过滤掉所有班级 → **全系统开课查询/导出/教材查询静默返回空**
- super_admin 一次误操作即可让系统"看起来没数据"

#### 修复方案

`updateSettings` 改用 `parseSemesterString(updates.current_semester)` 做校验，与读取/查询路径统一；`getCurrentSemesterInfo` 也应复用 `parseSemesterString` 做防御性校验（当前无法拦截 `2025-2026-3` 这类非法 semesterIndex）。

#### 影响分析

仅收紧校验逻辑，不改变接口契约。已存库的非法值需手动修正一次。无其他调用方依赖宽松校验。

---

### 高-2: 手动安排教师时周课时推导仅用 custom_plan_id，非自定义方案班级归零 ✅ 已修复

**问题位置**: `server/src/controllers/teaching-arrange.controller.js` 第 138-152 行 `assignTeacher`

#### 问题代码

```javascript
if (createWeeklyHours === null) {
  const cls = await prisma.classes.findUnique({ where: { id: Number(class_id) } });
  const planId = cls?.custom_plan_id;
  if (planId) {
    const pc = await prisma.plan_courses.findUnique({ ... });
    createWeeklyHours = pc?.weekly_hours ?? 0;
  } else {
    createWeeklyHours = 0;   // ⚠️ 非 custom 班级直接给 0
  }
}
```

#### 根因分析

绝大多数班级无 `custom_plan_id`，靠 major/training_level 匹配方案。手动安排未传 `weekly_hours` 时，这些班级的 `teaching_assignments.weekly_hours` 被写成 0。而矩阵视图 `getClassesWithCourse` 按 major/level 匹配计算周课时，两者不一致。

#### 业务影响

手动安排后教师课时统计、容量计算全部基于 0，**排课容量天花板被错误放大**，教师工作量统计严重失真。

#### 修复方案

复用 `findBestMatchPlan` 方案匹配逻辑推导周课时，或调用 `getClassesWithCourse` 的匹配函数后取 `plan_course_semesters` 中对应当前程序学期号的 `weekly_hours`。

#### 影响分析

改动集中在 `assignTeacher` 推导分支，需引入 `isClassMatchPlan` / `findBestMatchPlan`（来自 plan.service.js）。这些函数已在排课路径使用，无副作用。已有 weekly_hours 为 0 的历史记录需评估是否补录。

---

### 高-3: 删除培养方案仅检查 custom_plan_id，未拦截 major/level 匹配的班级 ✅ 已修复

**问题位置**: `server/src/controllers/plan/plan.controller.js` 第 283-286 行 `deletePlan`

#### 问题代码

```javascript
const classCount = await prisma.classes.count({
  where: { custom_plan_id: Number(id) },  // ⚠️ 仅检查自定义方案
});
if (classCount > 0) throw new ConflictError('该方案已被班级使用，无法删除');

await prisma.training_plans.delete({ where: { id: Number(id) } }); // 级联删除 plan_courses/semesters/textbooks
```

#### 根因分析

方案若被班级以 major/level 方式匹配（非 custom），删除不被拦截。`plan_courses`/`plan_course_semesters`/`plan_textbooks` 因 `onDelete: Cascade` 全部消失。

#### 业务影响

该方案下所有班级的课程开设信息（周课时、教材）瞬间失效，下次排课 `getClassesWithCourse` 找不到任何 `plan_course_semesters`，这些班级不再被排课，已排课数据虽在但成"孤儿快照"。这是**静默数据源破坏**。

#### 修复方案

删除前用 `isClassMatchPlan` 对所有非离校班级做匹配检查，凡有班级匹配（含 major/level）即拒绝删除，或改为软删除/归档机制。

#### 影响分析

需查询全部在读班级并逐一匹配，数据量大时有性能开销（可加缓存）。逻辑变化仅收紧删除条件，不影响正常删除流程。

---

### 高-4: 预览与实际排课的教材内聚行为不一致 ✅ 已修复

**问题位置**: `server/src/services/arrange/batch.js` 第 102 行 · `auto-arrange.js` 第 669-676 行 · `queries.js` 第 281-291 行

#### 根因分析

预览模式下，课程 A 排完后教师已拿教材通过 `globalTextbookMap` 传递给课程 B，影响 B 的教材分组与教师筛选。但实际写入（非预览）时 `globalTextbookMap=null`，且 `getTeachersForCourse` 只查本课程教材，不累计教师该学期其他课程已排教材。

#### 业务影响

**预览展示的分配结果与实际落库结果不同**，用户据预览做的决策失真。容量（课时）跨课程累计正确（走 DB），但教材内聚不一致。

#### 修复方案

非预览模式下，`getTeachersForCourse` 应查询教师该学期**全部** `teaching_assignments`（含其他课程）来构建教材上下文；或将 `globalTextbookMap` 机制推广到非预览。

#### 影响分析

改动 `getTeachersForCourse` 查询范围，会增加每次排课的 DB 查询量（从单课程扩到教师全学期）。需评估性能影响，可加批量查询优化。排课结果会更准确，不影响其他功能。

---

### 高-5: 多方案匹配时周课时/教材取值优先级与 findBestMatchPlan 不一致 ✅ 已修复

**问题位置**: `server/src/services/arrange/queries.js` 第 65-181 行（按 `sort_order` 迭代）vs `plan.service.js` 第 71-101 行（`findBestMatchPlan`：major > level）

#### 根因分析

一个无 `custom_plan_id` 但同时有 major_id 和 training_level_id 的班级，可能同时匹配"按专业方案"和"按层次方案"。`findBestMatchPlan`（列表统计用）规定 major 优先于 level；但 `getClassesWithCourse`（实际排课用）取 `sort_order` 最小的匹配方案。若层次方案的 `sort_order` 更小，排课就会用层次方案的周课时/教材，与系统认定的"最佳匹配"相反。

#### 业务影响

排课使用的周课时和教材与列表展示不一致，**同一班级在矩阵视图和排课结果中显示不同的课时**。系统已在 `class.controller.js` 对"专业层次交叉"给出警告，说明该场景真实存在。

#### 修复方案

`getClassesWithCourse` 内对每个班级先用 `findBestMatchPlan` 选定唯一方案，再取该方案的 `plan_course_semesters`，而非依赖迭代序+去重。

#### 影响分析

统一调用 `findBestMatchPlan`，该函数已存在且被列表路径使用。改动使排课与展示口径一致，是行为收敛而非破坏。需移除 `getClassesWithCourse` 中原有的 sort_order 迭代+去重逻辑。

---

### H-2: 导入路由无速率限制 + Excel 全文件载入内存，DoS 风险 ⏳ 待处理

**问题位置**: `server/src/routes/import.routes.js`（整文件无 rateLimit）· `server/src/utils/excel.js` 第 90-134 行 `readWorkbook`

#### 根因分析

导入路由仅有 `authMiddleware + roleMiddleware('admin','super_admin')`，**无任何 rate limit**（对比 export 有 10/min，reset 有 3/h）。`readWorkbook` 用 `workbook.xlsx.readFile` 一次性全量加载，`MAX_ROWS=20000` 只限制最终数组长度，不限制 ExcelJS 解析的行数与内存。

#### 业务影响

admin 账号（或被盗的 admin）反复上传可致 Node OOM；单个"xlsx 炸弹"型文件（小压缩比、巨量共享字符串）亦可在 10MB 限额内造成高内存占用。

#### 修复方案

1. 给 `import.routes.js` 加 rate limit（如 admin 每 5 分钟若干次）
2. `readWorkbook` 用流式 `workbook.xlsx.read(stream)` 替代 `readFile`
3. 真正中断超限读取（用 `worksheet.rowCount` 预检或 for 循环替代 eachRow）

#### 影响分析

加限流不影响正常导入频率。流式读取改造涉及 `readWorkbook` 返回结构，需确保所有导入控制器（classes/courses/teachers/textbooks）兼容。建议分步实施：先加限流，再改流式。

---

### H-3: 教材使用概览未校验班级当前学期，人数统计虚高 ✅ 已修复

**问题位置**: `server/src/controllers/query.controller.js` 第 522-541 行 `queryAllTextbooksUsage`

#### 问题代码

```javascript
// queryAllTextbooksUsage（概览）— 缺学期一致性校验
const gradeForThisSemester = Math.ceil(sem.semester / 2);
const enrollmentYear = semesterInfo.startYear - gradeForThisSemester + 1;
const classesInYear = classesByEnrollmentYear.get(enrollmentYear) || [];
for (const c of classesInYear) {
  if (isClassMatchPlan(c, plan)) {
    usedClasses.add(c.id);   // ⚠️ 缺 calcClassSemester 校验
  }
}

// 对比 queryTextbookUsage（单教材）— 有正确校验
const calc = calcClassSemester(cls, semesterInfo);
if (!calc || calc.currentSemesterNum !== sem.semester) continue; // ✓
```

#### 根因分析

概览查询按入学年份+方案匹配筛选班级，但**不校验班级当前学期号是否等于教材绑定的学期号**。当全局为春季（semesterIndex=2）而某教材绑定在 sem.semester=3（二年级秋季）时，二年级全部班级被选中，但这些班级当前 currentSemesterNum=4≠3，实际并未使用该教材。

#### 业务影响

"所有教材使用情况概览"**系统性高估使用班级数与学生人数**，影响采购决策。单教材查询逻辑正确，两者结果不一致令用户困惑。

#### 修复方案

在 `queryAllTextbooksUsage` 内层循环增加 `const calc = calcClassSemester(c, semesterInfo); if (!calc || calc.currentSemesterNum !== sem.semester) continue;`，与单教材查询逻辑对齐。

#### 影响分析

改动仅增加一个 continue 条件，`calcClassSemester` 已在同文件使用。修复后概览统计数值会下降（更准确），需告知用户这是修正而非回归。

---

## 4. 中危问题汇总

以下 13 项中危问题涉及数据污染、校验缺失、性能与健壮性，建议在严重/高危修复后批量处理。

| 级别 | 编号 | 文件 / 位置 | 问题描述 | 修复建议 |
|------|------|------------|---------|---------|
| 🟡 中 | M-1 | `import-shared.js:38` | ~~导入层 `sanitizeFormulaInjection` 给 `=+-@` 开头字符串加 `'` 前缀，**永久写入数据库污染原始数据**（班级名 `-2024级` 变 `'-2024级`）。公式注入防护应只在导出层做。~~ **✅ 已修复：移除全部 4 个导入控制器的调用，仅保留 sanitizeInput。** | 已完成：移除导入层调用，防护由导出层 sanitizeCellFormula 统一承担。 |
| 🟡 中 | M-2 | `import/courses.js:40` + `export/data-export.controller.js:27` | 课程类型 `elective` 导入无法产生（非"专业课"一律变 public），导出又显示为"专业课"。**导出→导入后 elective 降级为 professional，类型信息永久丢失**。 | 导入增加 `elective`/`选修` 映射；导出 `elective` 显示为"选修课"。 |
| 🟡 中 | M-3 | `import/textbooks.js:42` 等 | 导入数值/格式校验缺失，弱于单条 API。`price=99999999`、`publish_date="随便写"` 都能入库，绕过 `validation.js` 的范围约束。 | 导入循环内复用与 `validation.js` 一致的范围/格式/长度校验，失败计入 validationErrors。 |
| 🟡 中 | M-4 | `import/classes.js:122` | 班级导入循环内 N+1 查询学期信息：未填"状态"列时每行调 `getCurrentSemesterInfo()`，20000 行 = 20000 次 DB 查询。 | 循环外调用一次 `getCurrentSemesterInfo()` 缓存，循环内复用。 |
| 🟡 中 | M-5 | `export/data-export.controller.js` | 导出全量内存构建（`createWorkbook` 一次性 addRow 再 writeBuffer），无分页，大数据量下单次导出可 OOM。 | 改用 ExcelJS 流式 worksheet 或分批 write；导出前 count 预检超阈值提示分批。 |
| 🟡 中 | M-6 | `export.routes.js:64` | 课时统计导出 `/statistics` 的 semester 参数未经格式校验，任意字符串直接进 DB where 与文件名。 | 路由挂载 `validateSemesterQuery`；控制器内用 `parseSemesterString` 校验。 |
| 🟡 中 | M-7 | `validation.js:305` | `plan_course` 学期上限 10，但学制上限 10（可达 20 学期）。长学制班级高年级学期（11-20）无法配置课程，静默跳过。 | `start/end_semester` 上限调到 `duration_years_max*2`（即 20）。 |
| 🟡 中 | M-8 | `settings.controller.js:58` | `getSettings` 异常分支向匿名用户返回含 `current_semester` 的完整默认设置（正常路径仅返回 organization_name），信息泄露策略不一致。 | catch 分支同样按 `tryGetAuthUser` 结果裁剪，仅返回 organization_name。 |
| 🟡 中 | 中-6 | `class.controller.js:378` | 班级离校级联删除仅清当前学期，其他学期排课记录残留，统计接口仍计入教师工作量。 | 离校时删除该班级**所有学期**的 `teaching_assignments`（`where: { class_id }`）。 |
| 🟡 中 | 中-7 | `auto-arrange.js:173 vs :220` | `default_weekly_hours` 语义在"容量 enforcement"（总容量）与"诊断"（per-course）间不一致，诊断分支永不触发（死分支）且提示误导。 | 统一为总容量语义，删除/改写 `diagnoseFailure` 中 per-course 分支。 |
| 🟡 中 | 中-8 | `auto-arrange.js:603` + `batch.js:28` | 批量排课锁键 `semester:mode` 与单课程锁键 `course:semester` 不交叠，两者可并发写同一唯一键导致 P2002 异常。 | 批量排课期间持有覆盖该学期的排他锁，单课程排课时检查同 semester 批量锁；多实例改 Redis 锁。 |
| 🟡 中 | 中-9 | `auto-arrange.js:86` + `constants/index.js:99` | 评分常量与 `calcMatchScore` 硬编码脱钩；v2 主算法根本不调用 `calcMatchScore`，整套精细评分仅在兜底阶段用到，名实不符。 | 让 v2 主算法接入评分（用常量），或删除死分支与未用常量，统一注释与实现。 |
| 🟡 中 | 中-10 | `arrange/queries.js:86` | `filters.grade` 清空 OR 后丢失 `is_left_school` 过滤，`OR:[]` 等价于真，可能加载离校班级且全表扫描。 | grade 过滤后若 OR 为空直接返回空结果；或把 `is_left_school:false` 提到顶层。 |

---

## 5. 低危问题汇总

| 级别 | 编号 | 文件 / 位置 | 问题描述与建议 |
|------|------|------------|---------------|
| 🔵 低 | L-1 | 各 import 控制器 | 导入字段无最大长度限制（单条 API 限 name≤100 等），可写入超长字符串。建议导入循环内对关键字段加 `isLength` 校验。 |
| 🔵 低 | L-2 | `query.controller.js:467` | `queryAllTextbooksUsage` 全表加载无分页，viewer 即可触发。建议加分页或缓存。 |
| 🔵 低 | L-3 | `import/teachers.js:117` | 教师导入 status 对任意值默认 active（"已离职/退休"都变 active）。建议对未知值报错而非默认。 |
| 🔵 低 | L-4 | `export/data-export.controller.js:345` | `exportTextbookUsage` 未对 grade 做边界校验（对比 semester-export 有判断）。建议补 `if (grade<1 || grade>duration) continue`。 |
| 🔵 低 | L-5 | `query.routes.js` | 查询路由无限流，viewer 可触发重查询（authenticated DoS 面）。建议加 rate limit。 |
| 🔵 低 | L-6 | `auth.routes.js:15` | 登录限流仅按 IP，无按账户维度限流/锁定，分布式暴力破解可绕过。建议增加按用户名限流或失败锁定。 |
| 🔵 低 | L-7 | `export.routes.js:50,53,56` | courses/textbooks/classes 全量导出未限角色，viewer 可一键全量导出。建议评估是否限 admin。 |
| 🔵 低 | L-8 | `query.routes.js:19` + `export.routes.js:72` | `/textbook/:id` 存在 ID 枚举（数据为共享性质，影响有限）。如非必需可移除单条查询。 |
| 🔵 低 | 低-11 | `arrange/queries.js:19` | `parseSemester` 未校验 semesterIndex 的 NaN，`2025-2026-x` 通过校验致排课静默返回空。建议补 `isNaN(semesterIndex)`。 |
| 🔵 低 | 低-12 | `auto-arrange.js:649` | 0/负课时班级进入置换回溯，可能落库 `weekly_hours=0` 安排。建议 `trySwapUnassigned` 跳过 `weeklyHours≤0` 项。 |
| 🔵 低 | 低-13 | `arrange/batch.js:38` | 批量排课课程查询未按目标学期过滤，含目标学期不开课的课程，浪费算力。建议按 semesterStr 过滤。 |

---

## 6. 修复方案与影响分析

### 修复优先级与批次

| 批次 | 优先级 | 涉及问题 | 修改文件 | 预计改动 | 连带影响 |
|------|--------|---------|---------|---------|---------|
| **P0** | ✅ 已修复 | 严重-1（排序丢教材） | `plan-matrix.controller.js`<br>`plan.routes.js`<br>`CourseMatrix.vue` | 重构 updatePlanCourse 按需增删学期；新增排序端点 | 低：接口入参不变，前端改调新排序端点 |
| **P1** | ✅ 已修复 | H-1 学期校验<br>高-2 手动排课周课时<br>高-3 方案删除校验<br>H-3 教材统计 | `settings.controller.js`<br>`settings.service.js`<br>`teaching-arrange.controller.js`<br>`plan.controller.js`<br>`query.controller.js` | 收紧校验 + 复用已有匹配函数 | 低-中：高-2/高-3 引入 isClassMatchPlan/findBestMatchPlan，已在排课路径使用 |
| **P2** | ✅ 已修复 | 高-4 预览一致性<br>高-5 方案优先级<br>M-1 公式注入污染 | `arrange/queries.js`<br>`arrange/auto-arrange.js`<br>`import-shared.js` | 扩查询范围 + 统一匹配逻辑 + 移除导入层公式防护 | 中：高-4 增加 DB 查询量需评估性能；M-1 需清理已污染数据 |
| **P3** | 📅 排期 | H-2 导入DoS<br>M-2~M-8<br>中-6~中-10 | `import.routes.js`<br>`excel.js`<br>各 import/export 控制器<br>`class.controller.js` | 加限流 + 流式读取 + 校验对齐 + 语义统一 | 中：流式读取改造涉及 readWorkbook 返回结构；离校删除范围扩大 |
| **P4** | 📅 择期 | 全部低危（L-1~L-8, 低-11~低-13） | 分散多文件 | 补充校验 + 限流 + 边界处理 | 低：多为防御性增强 |

### 关键修复的连带影响评估

#### 严重-1 修复：updatePlanCourse 重构

**受影响调用方**：前端 `CourseMatrix.vue` 的保存开课学期（:258）和拖拽排序（:299）两个调用点。

**影响**：若新增独立排序端点，前端 `swapSortOrder` 需改调新端点而非 `updatePlanCourse`。学期范围变更逻辑改为 diff 增删后，已关联教材的学期记录会被保留。**无破坏性接口变更**，仅内部实现优化。

---

#### 高-2 + 高-3 + 高-5 修复：统一方案匹配逻辑

**受影响调用方**：`assignTeacher`、`deletePlan`、`getClassesWithCourse` 三个独立路径。

**影响**：三处修复都引入 `findBestMatchPlan` / `isClassMatchPlan`，这些函数已在 `plan.service.js` 中定义且被列表路径稳定使用。统一后**排课、展示、删除三条路径的方案匹配口径完全一致**，消除了"同班不同课时"的矛盾。需注意 `deletePlan` 增加全班级匹配检查后，删除已被广泛使用的方案会被正确拦截（预期行为变化，需告知用户）。

---

#### M-1 修复：移除导入层公式注入防护

**受影响调用方**：4 个导入控制器（classes/courses/teachers/textbooks）均调用 `sanitizeFormulaInjection`。

**影响**：移除后导入数据不再被加 `'` 前缀，与单条 CRUD 表单录入行为一致。**需清理已污染的历史数据**（已入库的 `'-开头` 字符串）。导出层 `sanitizeCellFormula` 已完整覆盖公式注入防护，移除导入层防护不降低安全性。

---

#### 中-6 修复：班级离校删除范围扩大

**受影响调用方**：`class.controller.js` updateClass 的离校分支。

**影响**：删除范围从"当前学期"扩大到"所有学期"，会清除历史学期排课记录。若业务需要保留历史统计，应改为"当前及未来学期"。**需确认业务方对历史排课记录的保留需求**后再定范围。

---

## 7. 安全基线正面评价

经全面审查，项目在以下方面表现良好，本轮无需修改：

### ✅ 授权控制规范

全部 16 个路由文件的变更操作均正确挂载 roleMiddleware；user.controller 对垂直/水平越权有完善控制器层防护；admin 无法越权操作 super_admin。

### ✅ 认证机制健壮

JWT 密钥必填+HKDF 派生；下载令牌也校验用户状态；用户状态缓存+主动失效；角色取 DB 最新值防降级绕过。

### ✅ SQL 注入免疫

全部走 Prisma 参数化查询，无 `$queryRawUnsafe` 拼接用户输入；健康检查的 `$queryRaw` 为标签模板，安全。

### ✅ XSS 防护完整

全局 sanitizeBody/sanitizeQuery + 导入 sanitizeInput；密码字段白名单跳过；前端无 v-html/innerHTML/eval。

### ✅ 文件上传安全

MIME+扩展名+10MB 三重校验；multer 随机文件名无路径穿越；模板下载 switch(type) 无文件路径拼接。

### ✅ 安全响应头与 CORS

Helmet 启用；生产环境 CORS 白名单；trust proxy 配置；健康检查错误不泄露 DB 详情。

### ✅ 审计日志完整

所有变更操作均有审计记录；重置操作在事务内先清后写确保可追溯；审计日志仅 super_admin 可查。

### ✅ 事务与级联正确

Schema onDelete 与迁移 SQL 已对齐；reset 函数均先删子表；班级更新级联删除包入事务；排课事务内二次验证容量。

---

## 总结

项目安全基线扎实，v2.12.3 已修复的历史问题（密码 XSS、全局 sanitizeBody、重置限流、分页上限、onDelete 对齐等）均经验证到位。本轮新发现的 32 项问题中，**严重 1 项（教材级联丢失）已修复**，高危 7 项中 6 项已修复（学期校验、排课数据正确性、教材内聚一致性、方案优先级），1 项待处理（导入 DoS）。中低危问题多为输入校验对齐与防御性增强，可排期批量修复。所有修复的连带影响均局限于单一函数或单一路径，无全局破坏性变更。

---

> **报告生成**: KEC Manager 项目独立安全审计  
> **审计范围**: 后端 server/src 全量（controllers / services / routes / middleware / utils）、Prisma schema、排课算法 arrange/*、前端关键组件  
> **版本**: KEC Manager Security & Business Logic Audit Report · 2026-06-25
