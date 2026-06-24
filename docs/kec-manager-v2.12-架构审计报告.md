## KEC Manager v2.12 系统架构审计报告

审计日期：2026-06-25 | 审计范围：安全漏洞检测、业务逻辑正确性、修复影响分析

---

## 一、高危安全漏洞（HIGH）

### S-01 | 删除学院/层次时静默级联清除教师排课偏好

**位置：** `college.controller.js:144` / `trainingLevel.controller.js:101`
**Schema 依据：** `teacher_scheduling_colleges.college` 和 `teacher_training_levels.training_level` 均设置 `onDelete: Cascade`

**问题描述：**
`deleteCollege` 仅检查 `classes.count`（该学院下是否有班级），不检查教师排课偏好关联。当一个学院没有班级但有多位教师将其设为排课意向学院时，删除该学院会静默级联删除所有 `teacher_scheduling_colleges` 记录，导致教师的排课学院偏好被无声清除。`deleteTrainingLevel` 同理。

**影响：** 排课算法依赖教师的学院/层次偏好做优先级分配。偏好被清除后，教师在自动排课中可能被分配到非预期的班级，且管理员无任何提示。

**修复方案：**
在 `deleteCollege` / `deleteTrainingLevel` 中增加前置检查：

```js
// deleteCollege 增加：
const schedulingCount = await prisma.teacher_scheduling_colleges.count({ where: { college_id: Number(id) } });
const planCount = await prisma.training_plans.count({ where: { college_id: Number(id) } });
const affiliatedCount = await prisma.teachers.count({ where: { affiliated_college_id: Number(id) } });
if (schedulingCount > 0 || planCount > 0 || affiliatedCount > 0) {
  return fail(res, `该学院仍被引用：${schedulingCount}位教师排课偏好、${planCount}个培养方案、${affiliatedCount}位教师所属`);
}

// deleteTrainingLevel 增加：
const schedulingCount = await prisma.teacher_training_levels.count({ where: { training_level_id: Number(id) } });
const planCount = await prisma.training_plans.count({ where: { training_level_id: Number(id) } });
if (schedulingCount > 0 || planCount > 0) {
  return fail(res, `该层次仍被引用：${schedulingCount}位教师排课偏好、${planCount}个培养方案`);
}
```

**影响分析：** 修复后删除行为变严格，但只阻止有实际引用的删除操作。正常无引用的删除不受影响。`deleteMajor`（`major.controller.js:122`）也建议同步补查 `training_plans.count`。

---

### S-02 | 排课置换算法绕过学院/层次资格校验

**位置：** `auto-arrange.js:486-515`（`trySwapOne` 函数）

**问题描述：**
主排课算法的四阶段分配严格执行了学院偏好、层次偏好、教材匹配等业务规则。但 `trySwapOne` 置换函数在寻找接管教师 T2 时，**只检查了课时容量和教材上限**，没有检查：
- T2 是否有 V 所在学院的排课意向（`isCollegeEligible`）
- T2 是否有 V 所属层次的排课意向（`isLevelEligible`）
- T2 是否被授权教该课程（`teacher_courses` 关联）

这意味着一个明确设置了"只在计算机学院排课"的教师，可能在置换中被分配到经管学院的班级。

**修复方案：**
在 `trySwapOne` 的 T2 循环内（line 489 之后）增加资格校验：

```js
// 在容量检查之后、教材检查之前插入：
// 检查 T2 是否能教 V 的学院和层次
const vClass = classInfoMap.get(vAssign.class_id); // 需要传入 classInfoMap
if (vClass) {
  if (t2.schedulingCollegeIds.length > 0 && !t2.schedulingCollegeIds.includes(vClass.collegeId)) continue;
  if (t2.schedulingLevelIds.length > 0 && !t2.schedulingLevelIds.includes(vClass.trainingLevelId)) continue;
}
// 检查 T2 是否能教该课程
if (t2.courseIds && !t2.courseIds.includes(Number(courseId))) continue;
```

**影响分析：** 需要在 `trySwapOne` 调用链中传入 `classInfoMap`（班级→学院/层次映射）。`autoArrange` 函数内部已有 `classTextbookMap`，可一并构建 `classInfoMap`。修复后置换成功率会降低，但保证了业务规则一致性。

---

### S-03 | `getClassesWithCourse` 年级筛选逻辑过严

**位置：** `queries.js:108-110`

**问题描述：**
```js
classWhere.OR = classWhere.OR.filter(
  (o) => o.enrollment_year.gte <= enrollmentYear && o.enrollment_year.gte >= enrollmentYear
);
```
`OR` 数组中每个元素对应一种 `duration_years` 的 WHERE 条件，其中 `enrollment_year.gte` 是该学制下目标年级的最低入学年份。当前的双重不等式等价于 `gte === enrollmentYear`，要求精确匹配，导致不同学制（如2年制 vs 3年制）中 `gte` 值不同的班级被错误排除。

**影响：** 自动排课时，如果某个年级存在多种学制的班级，部分班级不会出现在排课候选列表中，导致漏排。

**修复方案：**
将精确匹配改为范围匹配——只要求 `gte <= enrollmentYear`（该班级的入学年份范围覆盖了目标年级）：

```js
classWhere.OR = classWhere.OR.filter(
  (o) => o.enrollment_year.gte <= enrollmentYear
);
```

或者更精确地考虑学制：

```js
classWhere.OR = classWhere.OR.filter(
  (o) => {
    const minYear = o.enrollment_year.gte;
    const maxYear = minYear + (o.duration_years || 0) - 1; // 该学制覆盖的入学年范围
    return enrollmentYear >= minYear && enrollmentYear <= maxYear;
  }
);
```

**影响分析：** 该函数被 `autoArrange`、`batchAutoArrange`、`semesterExport` 和 `textbookUsage` 查询共用。修复后可能增加候选班级数量，需要验证排课结果和导出结果的正确性。

---

### S-04 | `parseSemesterString` 不校验学期索引范围

**位置：** `settings.service.js:74`

**问题描述：**
`parseSemesterString` 只检查 `isNaN(semesterIndex)`，不检查 `semesterIndex` 是否在 1-2 范围内。输入 `"2025-2026-7"` 会被接受并产生 `semesterIndex=7`。下游 `calcClassSemester` 使用公式 `(grade - 1) * 2 + semesterIndex` 计算学期序号，异常值会导致学期计算结果荒谬。

虽然 `parseSemester`（`queries.js:19`）做了 1-2 范围校验，但两者是独立实现，`parseSemesterString` 被 `settings.controller` 的学期设置接口和 `getSemesterInfoFromRequest` 使用。

**修复方案：**
```js
if (isNaN(startYear) || isNaN(endYear) || isNaN(semesterIndex)) {
  return { success: false, error: '学期格式错误' };
}
if (semesterIndex < 1 || semesterIndex > 2) {
  return { success: false, error: '学期索引必须为1或2' };
}
if (endYear !== startYear + 1) {
  return { success: false, error: '结束年份必须为起始年份+1' };
}
```

**影响分析：** 仅增加校验，对正常使用无影响。建议同时统一两套 `parseSemester` 实现，消除重复代码。

---

## 二、中危问题（MEDIUM）

### S-05 | 培养方案匹配语义不一致：`isClassMatchPlan` vs `findBestMatchPlan`

**位置：** `plan.service.js:43-101`

**问题描述：**
`isClassMatchPlan` 对专业匹配和层次匹配使用 OR 逻辑——一个班级可以同时匹配多个方案（按专业和按层次各匹配一个）。而 `findBestMatchPlan` 使用优先级链（专业 > 层次），只返回一个最佳方案。

不同业务路径使用了不同的匹配语义：
- `listPlans` 的班级计数使用 `isClassMatchPlan` → 同一班级被重复计入多个方案
- `listClasses` 的方案显示使用 `allPlans.filter(isClassMatchPlan)[0]` → 取第一个匹配，取决于数据库返回顺序
- `semesterExport` 使用 `findBestMatchPlan` → 取优先级最高的匹配

结果：同一个班级在不同页面显示不同的"关联方案"，方案列表的班级计数之和大于实际班级数。

**修复方案：**
统一所有路径使用 `findBestMatchPlan` 的优先级语义。修改 `listPlans` 的班级计数逻辑：

```js
// 为每个班级只匹配一个最佳方案
for (const cls of allClasses) {
  const bestPlan = findBestMatchPlan(cls, allPlans, classPlanMap);
  if (bestPlan) planClassCounts[bestPlan.id] = (planClassCounts[bestPlan.id] || 0) + 1;
}
```

**影响分析：** 修改后方案列表的班级计数之和将等于实际班级数（不再重复计数），各页面的方案关联显示将一致。需要同步检查 `data-export.controller.js` 中的导出逻辑是否也使用统一匹配。

---

### S-06 | `deleteMajor` 不检查培养方案关联

**位置：** `major.controller.js:122`

**问题描述：** 删除专业时仅检查班级数量，不检查 `training_plans`。Schema 中 `training_plans.majors` 设为 `onDelete: SetNull`，删除专业后所有关联方案的 `major_id` 被静默置空，导致依赖专业匹配的培养方案失效。

**修复方案：** 增加 `training_plans.count({ where: { major_id: Number(id) } })` 前置检查。

**影响分析：** 同 S-01 模式，不影响正常删除操作。

---

### S-07 | 教师导入时空列静默清除排课偏好

**位置：** `teachers.js:339-356`

**问题描述：** 教师更新导入时，对排课学院和层次执行 `deleteMany` + `createMany`。如果 Excel 行中学院/层次列为空，所有现有关联被删除但不创建新的。用户导出教师表后只修改了姓名就重新导入，会丢失所有排课偏好。

**修复方案：**
```js
// 仅在 Excel 行明确提供了学院/层次时才执行 deleteMany+createMany
if (row.collegeIds && row.collegeIds.length > 0) {
  await prisma.teacher_scheduling_colleges.deleteMany({ where: { teacher_id } });
  await prisma.teacher_scheduling_colleges.createMany({ ... });
}
// 或者：如果列为空，保留现有关联不变
```

**影响分析：** 改变了导入行为——空列不再清除关联。如果需要支持"清除关联"的场景，可以增加一个特殊标记（如"无"）。

---

### S-08 | 课程导入静默覆盖课程类型

**位置：** `courses.js:78-81`

**问题描述：** 课程已存在时（按名称匹配），导入直接用 Excel 数据更新，包括 `type` 字段（默认值 `'public'`）。如果用户导出的 Excel 没有正确填写类型列，导入时会将专业核心课静默降级为公共课。

**修复方案：** 对 `type` 字段使用"Excel 中有值才更新"的策略：

```js
const updateData = { ...r };
if (!r.type || r.type === 'public') {
  // 如果 Excel 中 type 列为空或默认值，保留原有类型
  delete updateData.type;
}
```

**影响分析：** 修改后导入不会意外更改课程类型，但需要确认导出模板中 type 列的值是否完整。

---

### S-09 | 排课并发锁为进程内存级别

**位置：** `auto-arrange.js:17` / `batch.js:8`

**问题描述：** `arrangeLocks` 和 `batchLocks` 使用 `new Set()` 实现，仅在单进程内有效。如果使用 PM2 cluster 模式部署（多 worker 进程），多个进程可能同时通过锁检查，导致重复排课或数据覆盖。

**当前风险：** 项目使用单进程 PM2（非 cluster 模式）部署，且用户量小，实际风险低。但如果未来扩展部署规模，此问题会显现。

**修复方案（如需要）：** 使用数据库行级锁（`SELECT ... FOR UPDATE`）或 Redis 分布式锁替代内存锁。SQLite 场景下，Prisma 的事务已提供串行写保证，可在事务内做二次检查。

**影响分析：** 当前部署模式下无需立即修复，但应在代码注释中标注此限制。

---

### S-10 | `sort_order` 初始值计算存在竞态

**位置：** 多个 controller 的 `create` 方法（`plan.controller.js:123`、`course.controller.js`、`teacher.controller.js` 等）

**问题描述：** 所有创建操作都先 `aggregate({ _max: { sort_order } })` 再 +1，这不是原子操作。并发创建可能导致 `sort_order` 重复。SQLite 单写者模型下概率极低。

**修复方案：** 在 `sort_order` 上加唯一约束或在事务内执行。低优先级。

---

### S-11 | 系统重置 `resetBasic` 静默清除教师排课偏好

**位置：** `settings.controller.js:188-208`

**问题描述：** `resetBasic` 删除 `training_levels`、`majors`、`colleges`，通过级联自动清除 `teacher_scheduling_colleges` 和 `teacher_training_levels`，但不会删除教师本身。重置后教师保留但其排课偏好被无声清除。

**修复方案：** 在执行 reset 前，先显式删除 `teacher_scheduling_colleges` 和 `teacher_training_levels`，并在审计日志中记录清除数量。或者在 reset 确认弹窗中明确提示"教师的排课偏好也将被清除"。

**影响分析：** 功能正确性层面无误（级联行为一致），但用户体验上需要明确提示。

---

## 三、低危问题（LOW）

### S-12 | 下载令牌绕过完整鉴权链

**位置：** `auth.middleware.js:49-58`

**问题描述：** `downloadToken` 路径在验证成功后直接 `return next()`，跳过了后续的用户状态检查。被禁用的用户在令牌有效期内（30秒）仍可完成下载。

**风险：** 极低——令牌有效期仅 30 秒，且仅用于文件下载场景。

**修复方案：** 在 downloadToken 路径也加入 `getActiveUserStatus` 检查。

---

### S-13 | 批量排课预览模式不累计教材负载

**位置：** `batch.js:122-129`

**问题描述：** 预览模式下 `virtualTeacherHours` 跨课程累计，但 `assignedTextbookIds` 不跨课程传递。预览结果中每位教师的教材多样性分析不准确。

**修复方案：** 在 batch 层面维护一个 `globalTextbookMap = Map<teacherId, Set<textbookId>>`，跨课程传递。

---

### S-14 | 导入计数器在事务回滚后状态不一致

**位置：** `classes.js:29-51`、其他 import 文件

**问题描述：** `imported`/`overwritten` 等计数器声明在事务外部，在事务回调中递增。如果事务回滚，计数器已被部分修改，错误日志和审计日志中的计数不准确。

**修复方案：** 将计数器声明移入事务回调内部，或在 catch 中将计数器重置为 0。

---

### S-15 | 学期字符串 `endYear !== startYear + 1` 未校验

**位置：** `settings.service.js:60-87`

与 S-04 相关。`"2025-2028-1"` 会被接受。修复已在 S-04 方案中覆盖。

---

## 四、业务逻辑正确性总结

| 业务领域 | 状态 | 关键发现 |
|---------|------|---------|
| 学期计算 | 基本正确，有边界缺陷 | `parseSemesterString` 缺少范围校验（S-04）；`endYear` 不验证（S-15） |
| 培养方案关联 | 存在语义不一致 | 两套匹配函数返回不同结果（S-05）；删除方案不警告隐式关联班级 |
| 开课情况 | 年级筛选有bug | `getClassesWithCourse` 漏排多学制班级（S-03） |
| 教师排课 | 核心算法正确，置换有缺陷 | 四阶段分配逻辑完整，但 `trySwapOne` 绕过资格校验（S-02） |
| 级联删除安全 | 存在多处静默级联 | 学院/层次/专业删除不清理教师偏好和方案关联（S-01, S-06） |
| 数据导入 | 基本可用，有细节陷阱 | 教师导入空列清除偏好（S-07）；课程导入覆盖类型（S-08） |

---

## 五、修复优先级建议

| 优先级 | 编号 | 问题 | 修复工作量 |
|-------|------|------|----------|
| P0 立即 | S-01 | 学院/层次删除级联清除教师偏好 | 小（增加前置检查） |
| P0 立即 | S-02 | 置换算法绕过资格校验 | 中（传入classInfoMap） |
| P0 立即 | S-03 | 年级筛选逻辑过严 | 小（改范围匹配） |
| P1 本周 | S-04 | 学期索引范围校验 | 小（加一行 if） |
| P1 本周 | S-05 | 方案匹配语义统一 | 中（改计数逻辑+导出） |
| P1 本周 | S-06 | deleteMajor 补方案检查 | 小 |
| P2 下周 | S-07 | 教师导入空列保护 | 小（加条件守卫） |
| P2 下周 | S-08 | 课程导入类型保护 | 小 |
| P3 排期 | S-09~S-15 | 并发锁/排序竞态/预览精度等 | 小~中 |

---

## 六、修复影响交叉分析

S-01/S-06（级联删除检查）→ 影响所有删除操作的响应行为，前端需要处理新的错误消息格式。不影响创建、更新、导入。

S-02（置换资格校验）→ 仅影响 `trySwapOne` 内部逻辑，不改变函数签名和返回值。主排课流程和批量排课流程的调用不受影响，但置换成功率会降低，可能导致更多课程进入 fallback 路径。

S-03（年级筛选修复）→ 影响所有调用 `getClassesWithCourse` 的路径：自动排课、批量排课、学期导出、教材使用查询。修复后候选班级集合可能扩大，需要验证这些路径的下游逻辑是否能正确处理新增的班级。

S-05（方案匹配统一）→ 影响 `listPlans`（班级计数）、`listClasses`（方案显示）、`semesterExport`（导出方案列）、`data-export`（数据导出）。修改后各页面显示一致，但班级计数数值会变化（总数不变，分布变化）。
