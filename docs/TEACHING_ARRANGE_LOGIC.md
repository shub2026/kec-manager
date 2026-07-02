# KEC 教学安排排课逻辑说明

本文档描述 KEC 课程管理平台自动排课算法的代码结构、算法流程、评分机制、约束条件、诊断机制与配置参数，与当前项目实际代码完全一致。

---

## 一、代码结构

排课逻辑已从单文件重构为 `server/src/services/arrange/` 目录下的模块化结构。原入口文件 `server/src/services/teaching-arrange.service.js` 现为 4 行的 re-export 包装文件，仅做转发：

```javascript
export { parseSemester, getClassesWithCourse, getTeachersForCourse } from './arrange/queries.js';
export { validateHourSettings } from './arrange/validate.js';
export { autoArrange } from './arrange/auto-arrange.js';
export { batchAutoArrange } from './arrange/batch.js';
```

### 1.1 模块职责

| 文件 | 职责 | 主要导出/函数 |
|------|------|--------------|
| `arrange/queries.js` | 数据查询与匹配函数 | `getClassesWithCourse`、`getTeachersForCourse`、`isTextbookMatch`、`isCollegeEligible`、`isLevelEligible`、`parseSemester` |
| `arrange/validate.js` | 课时设置校验 | `validateHourSettings` |
| `arrange/auto-arrange.js` | 排课主算法 | `autoArrange`（导出）、`calcMatchScore`、`isTeacherEligible`、`buildTeacherConstraints`、`trySwapOne`、`trySwapUnassigned`、`calcAllMatchRates`、`buildResult`、`diagnoseFailure`、`selectBestTeacher`（后几个为内部函数，同时通过测试专用导出暴露） |
| `arrange/batch.js` | 批量排课 | `batchAutoArrange`、`batchLocks` |
| `teaching-arrange.service.js` | 入口转发 | 仅 re-export，无业务逻辑 |

### 1.2 并发锁

| 锁 | 范围 | 用途 |
|----|------|------|
| `arrangeLocks` | `courseId:semesterStr` | 防止同一课程在同一学期被并发排课 |
| `batchLocks` | `semesterStr` | 防止批量排课与单课程排课并发；批量进行中，同 semester 的单课程 `autoArrange` 直接拒绝（批量内部调用通过 `options.skipBatchLockCheck=true` 绕过） |

> 上述锁均为进程内存级别，仅适用于单进程部署（如 PM2 fork 模式）。多实例部署需改用 Redis 分布式锁或数据库行级锁。

---

## 二、核心概念

### 2.1 排课目标

为指定课程在指定学期内，将教师分配到所有需要该课程的班级，同时满足：
- 教师的学院偏好和层次偏好
- 教材匹配度与教材内聚度
- 教师课时容量约束
- 教材数量硬上限
- 保护手动排课记录不被覆盖

### 2.2 学期格式

学期使用 `"YYYY-YYYY-N"` 格式，例如 `"2025-2026-1"` 表示 2025-2026 学年第一学期。

学期序号计算由 `semester.service.js` 的 `calcClassSemester` 完成：
```
年级 = 学年起始年 - 入学年份 + 1
当前学期序号 = (年级 - 1) × 2 + 学期索引
```

---

## 三、班级筛选逻辑

### 3.1 班级纳入条件（`getClassesWithCourse`）

一个班级被纳入某课程的排课候选，必须同时满足：
- 未离校、学制内（由 `getActiveClassFilter` 统一生成查询条件）
- 该班级关联的培养方案中包含目标课程
- 该课程在当前学期有课时安排（`plan_course_semesters` 记录）

### 3.2 培养方案匹配优先级

使用 `findBestMatchPlan`（来自 `plan.service.js`）选定唯一最佳方案，三级优先级：

| 优先级 | 条件 | 说明 |
|:------:|------|------|
| 1 | `class.custom_plan_id === plan.id` | 班级绑定了自定义培养方案 |
| 2 | `class.major_id === plan.major_id` | 按专业匹配 |
| 3 | `class.training_level_id === plan.training_level_id` | 按培养层次匹配（兜底） |

### 3.3 班级字段

每条候选班级携带：`classId`、`className`、`collegeId`、`majorId`、`trainingLevelId`、`grade`、`weeklyHours`、`weeksCount`、`totalHours`、`textbooks`（数组）等。

---

## 四、教师筛选逻辑

### 4.1 教师纳入条件（`getTeachersForCourse`）

| 条件 | 说明 |
|------|------|
| 状态活跃 | `status = 'active'` |
| 课程关联 | 通过 `teacher_courses` 关联表与目标课程关联 |

### 4.2 教师字段

| 字段 | 来源 | 用途 |
|------|------|------|
| `personnelType` | `teachers.personnel_type` | 确定课时容量档次（full_time / part_time / external） |
| `defaultWeeklyHours` | `teachers.default_weekly_hours` | **教师总周课时上限**（跨所有课程），可选 |
| `schedulingCollegeIds` | `teacher_scheduling_colleges` | 学院意向 |
| `schedulingLevelIds` | `teacher_scheduling_levels` | 层次意向 |
| `textbookIds` / `inherentTextbookIds` | 实际排课或培养方案推导 | 固有教材快照 |
| `totalWeeklyHours` | 本学期所有排课课时总和 | 整体工作量 |
| `courseHours` | 本课程本学期已排课时 | 本课程课时统计 |
| `assignedTextbookIds` | 初始化为空 `Set` | 运行时累加的教材集合 |
| `assignedCollegeIds` | 初始化为空 `Set` | 运行时累加的学院集合 |

### 4.3 教材 ID 推导

**两级推导策略**：

1. **实际排课推导（优先）**：跨课程查询教师在该学期的全部排课记录，追溯每个班级的最佳匹配培养方案，提取 `plan_textbooks` 中的教材 ID。
2. **培养方案推导（兜底）**：对无排课记录的教师，根据 `TEXTBOOK_COHESION.FALLBACK_EMPTY` 决定：
   - `FALLBACK_EMPTY = true`（当前默认）：教材为空集合（收紧策略，避免 `isTextbookMatch` 对新教师全通过）
   - `FALLBACK_EMPTY = false`：取所有关联培养方案中该课程教材 ID 的并集（保守超集）

---

## 五、约束条件

### 5.1 默认课时设置（`DEFAULT_HOUR_SETTINGS`）

| 人员类型 | 标准课时 (standard) | 最大课时 (max) |
|---------|:--------:|:--------:|
| 专职 (`full_time`) | 16 | 20 |
| 兼职 (`part_time`) | 12 | 16 |
| 外聘 (`external`) | 12 | 16 |

**存储位置**：
- 全局默认：`system_settings` 键 `teaching_hour_settings`
- 按课程自定义：键 `teaching_hour_settings_{course_id}`

### 5.2 排课模式

| 模式 | 使用上限 | 行为 |
|------|---------|------|
| 标准模式 (`standard`) | `standard` 值 | 保守，教师总课时不超过标准值 |
| 全量模式 (`full`) | `max` 值 | 宽松，允许教师课时达到最大值 |

### 5.3 容量计算（`buildTeacherConstraints`）

```javascript
autoHoursForCourse = autoHoursMap.get(t.id) || 0          // 本课程即将被删除的自动排课课时
extraHours = extraTeacherHours?.get(t.id) || 0            // 批量预览时前序课程的虚拟分配课时
effectiveTotal = t.totalWeeklyHours - autoHoursForCourse + extraHours   // 全学期总课时（含所有课程）

// defaultWeeklyHours 语义：教师总周课时上限（跨所有课程），不是"本课程硬上限"
teacherHourCap = t.defaultWeeklyHours != null
  ? Math.max(0, t.defaultWeeklyHours - effectiveTotal)
  : null

standardCap = teacherHourCap != null
  ? Math.min(teacherHourCap, Math.max(0, setting.standard - effectiveTotal))
  : Math.max(0, setting.standard - effectiveTotal)

fullCap = teacherHourCap != null
  ? Math.min(teacherHourCap, Math.max(0, setting.max - effectiveTotal))
  : Math.max(0, setting.max - effectiveTotal)
```

**关键点**：
- `effectiveTotal` 包含全学期所有课程的总课时，不只是本课程
- 本课程的自动排课课时被减去，因为这些记录将被删除并重新分配
- 手动排课和其他课程的排课保持不变并计入容量
- `defaultWeeklyHours` 是教师**总周课时上限**，会同时收紧 `standardCap` 与 `fullCap`

### 5.4 资格检查（`isTeacherEligible`）

教师被分配一个班级前，必须通过以下硬约束：

| 约束 | 公式 |
|------|------|
| 容量约束 | `t.assignedHours + cls.weeklyHours ≤ (standardCap 或 fullCap)` |
| 学院意向 | 教师有 `schedulingCollegeIds` 时，必须包含 `cls.collegeId` |
| 层次意向 | 教师有 `schedulingLevelIds` 时，`cls.trainingLevelId` 必须在其中 |
| 教材硬上限 | `t.assignedTextbookIds.size + 新增教材数 ≤ MAX_TEXTBOOKS_PER_TEACHER` |

### 5.5 课时设置校验（`validateHourSettings`）

对 `full_time` / `part_time` / `external` 三种类型逐项校验：
- 必须存在 `standard` 与 `max`
- 均为有效数字
- `standard ≥ 1`
- `1 ≤ max ≤ 40`
- `standard ≤ max`

任一项不满足即抛错。

---

## 六、算法流程（v2，5 阶段）

### 6.1 前置处理

1. 加载教师候选池（`getTeachersForCourse`）
2. 加载班级候选池（`getClassesWithCourse`）
3. 加载本课程本学期的手动排课记录，提取 `manualClassIds`
4. 从候选池中排除手动排课的班级（但手动排课的教材和课时仍计入教师上下文）
5. 校验周课时合法性：`weeklyHours ≤ 0` 的班级直接进入未分配列表（原因：`课时配置异常（周课时为0或负数）`），不参与排课
6. 构建 `teacherConstraints`（含 `effectiveTotal`、`standardCap`、`fullCap`、`teacherHourCap`）
7. 追踪手动排课的教材与学院到教师的 `assignedTextbookIds` / `assignedCollegeIds`
8. 容量可行性预检：若 `总班级课时 > 总教师容量`，添加警告（非错误）
9. **按教材对班级分组**（`textbookGroups`）：同教材组内按学院排序；每组维护可变可用班级池 `groupAvailable`

### 6.2 五阶段定义

| 阶段 | 处理对象 | 筛选条件 | 说明 |
|:----:|---------|---------|------|
| **阶段 1** | 有指定意向的教师 | `schedulingCollegeIds` 或 `schedulingLevelIds` 非空；本轮已分配教材的教师必须包含当前教材组的教材；0 本教师可拿任意教材 | 严格按意向分配，拿第一本教材 |
| **阶段 2** | 无指定意向的教师 | 无意向约束；本轮已分配教材的教师必须包含当前教材组的教材；0 本教师可拿任意教材 | 按课时容量拿第一本教材 |
| **阶段 3** | 所有教师 | 已持有此教材组的教师 | 追加同教材班级（不增加教材数） |
| **阶段 4** | 所有教师 | 未持有此教材组、有剩余容量、且新增后不超 `MAX_TEXTBOOKS_PER_TEACHER` | 拿第二本教材 |
| **阶段 5** | 兜底 | 剩余班级用 `assignRound` 放宽约束处理 | 综合评分分配 |

### 6.3 阶段内通用逻辑

- 按教材组遍历 `groupAvailable`
- 筛选符合条件的教师，按剩余容量降序排序（`maxCapFn(b) - b.assignedHours - (maxCapFn(a) - a.assignedHours)`）
- 教师通过 `takeClassesForTeacher` 从可用班级中拿取，直到课时满或无匹配班级
- `takeClassesForTeacher` 内部按"教师已分配的学院优先 → 学院 ID → 班级 ID"排序班级
- 教材上限追踪：假设拿取后的教材集合不能超过 `MAX_TEXTBOOKS_PER_TEACHER`
- 拿取后调用 `recordAssignment` 更新 `assignedHours`、`assignedCollegeIds`、`assignedTextbookIds`、`textbookIds`，并写入 `assignments`

### 6.4 意向匹配（`isPrefMatch`）

- 有学院意向的教师，只能拿匹配学院的班级
- 有层次意向的教师，只能拿匹配层次的班级
- 阶段 1、3、4 使用严格意向检查；阶段 2 关闭严格检查（教师本身无意向）

### 6.5 兜底分配（`assignRound`，阶段 5）

- 按候选教师数量升序排序班级（少候选优先），同分时按教材签名排序
- 对每个班级，筛选 `isTeacherEligible` 通过的教师，且教材硬上限检查：已达上限的教师只能接已持有教材的班级
- 用 `calcMatchScore` 评分 + `loadRate` 负载均衡，调用 `selectBestTeacher` 选最优教师
- 无候选则归入 `unassigned`

### 6.6 置换回溯（`trySwapUnassigned`）

阶段 5 后对未分配班级尝试置换：

- **单轮置换**（不递归），复杂度 O(U × T × A)
- 对未分配班级 U：遍历所有教师 T（含已满的），找 T 当前某班级 V 能被其他教师 T'' 接管，且 T 腾出容量后能容纳 U
- 置换前校验：
  - T 对 U 的学院/层次资格
  - T'' 对 V 的学院/层次资格
  - T 置换后教材数 ≤ `MAX_TEXTBOOKS_PER_TEACHER`（先移除 V 独有教材，再加 U 新增教材）
  - T'' 接管 V 后教材数 ≤ `MAX_TEXTBOOKS_PER_TEACHER`
- `weeklyHours ≤ 0` 的班级不参与置换

### 6.7 教材亲和级联

教师被分配一个班级后，其 `assignedTextbookIds` 和 `textbookIds` 会扩展包含该班级的教材 ID，形成级联的教材亲和效应——后续阶段评分时同教材教师会获得更高分。

### 6.8 持久化（非预览模式）

采用**全量替换**策略，在单个数据库事务中完成：

1. **删除**本课程本学期的所有自动排课记录（`is_auto = true`）
2. **重新聚合**各教师当前学期实际总课时（已扣除本课程旧自动安排）
3. **容量二次校验**：超载的分配降级跳过，归入 `unassigned`，原因：`并发排课导致教师容量已满，已跳过`
4. **教材上限二次校验**：违规的不写入 DB
5. **批量插入**通过校验的分配记录

---

## 七、评分机制

### 7.1 `calcMatchScore` 加权评分

| 评分项 | 权重/分值 | 来源 | 触发条件 |
|--------|:----:|------|------|
| 学院意向匹配 | +`COLLEGE_WEIGHT`（5） | constants | 教师上课学院包含班级学院 |
| 学院内聚奖励 | +3 | 硬编码 | 教师已接过该学院班级（`assignedCollegeIds`） |
| 层次意向匹配 | +`LEVEL_WEIGHT`（5） | constants | 教师培养层次包含班级层次 |
| 已分配教材匹配 | +`ASSIGNED_WEIGHT`（10） | constants | 本轮已分配的教材与班级教材有交集 |
| 固有教材匹配 | +`INHERENT_WEIGHT`（4） | constants | 教师固有教材与班级教材有交集（`isTextbookMatch`） |
| 新增教材惩罚 | -`PENALTY_PER_NEW` × N（10 × N） | constants | 接此班需新增 N 本教材 |
| 0 本教材奖励 | +`ZERO_TEXTBOOK_BONUS`（30） | constants | 教师尚未持有任何教材 |
| 同教材追加奖励 | +10 | **硬编码** | 教师已持有 1 本教材且此班级教材无新增 |
| 新增教材硬淘汰 | score - 10000 | **硬编码** | 教师已达 `MAX_TEXTBOOKS_PER_TEACHER` 且需新增教材，或 1 本教师接新教材 |

> 注：`TEXTBOOK_COUNT_PENALTY_1_NEW` 与 `TEXTBOOK_COUNT_BONUS_1_SAME` 虽在 constants 中定义，但 `calcMatchScore` 实际未使用——同教材奖励与新增教材惩罚均为硬编码值（+10 与 -10000）。

### 7.2 `isTextbookMatch` 行为（`queries.js`）

```javascript
export function isTextbookMatch(teacher, cls) {
  const inherentIds = teacher.inherentTextbookIds ?? teacher.textbookIds;
  if (!cls.textbookIds?.length) return false;       // 班级无教材，不匹配
  if (!inherentIds?.length) return true;            // 教师无固有教材约束，能教任何教材
  return inherentIds.some((tid) => cls.textbookIds.includes(tid));
}
```

**关键语义**：
- 始终使用教师**固有教材快照**（`inherentTextbookIds`），不受本次分配累加污染
- 教师无固有教材约束时，对任何有教材的班级都返回 `true`（能教任何教材）
- 班级无教材时返回 `false`

### 7.3 教师选择（`selectBestTeacher`）

```javascript
const sorted = [...candidates].sort((a, b) => {
  // 1. 分数差异 ≥ SCORE_THRESHOLD（1），按分数降序
  if (Math.abs(b.score - a.score) >= WORKLOAD_BALANCE.SCORE_THRESHOLD) {
    return b.score - a.score;
  }
  // 2. 负载率差异 > LOAD_RATE_THRESHOLD（0.2），按负载率升序（低负载优先）
  if (Math.abs(a.loadRate - b.loadRate) > WORKLOAD_BALANCE.LOAD_RATE_THRESHOLD) {
    return a.loadRate - b.loadRate;
  }
  // 3. 综合排序：分数降序 > 负载率升序
  return b.score - a.score || a.loadRate - b.loadRate;
});
return sorted[0];
```

### 7.4 负载率计算

```
loadRate = (effectiveTotal + assignedHours) / max(1, maxCap + effectiveTotal)
```

---

## 八、手动排课与自动排课的交互

### 8.1 核心原则

**手动排课记录神圣不可侵犯**——自动排课永远不会覆盖手动排课。

### 8.2 保护机制

1. 加载本课程本学期所有手动排课记录（`is_auto = false`）
2. 提取手动排课的班级 ID 集合
3. 从自动排课候选池中**排除**这些班级
4. 手动排课的课时仍计入教师容量（通过 `totalWeeklyHours`）
5. 手动排课的教材与学院仍计入教师的 `assignedTextbookIds` / `assignedCollegeIds`（影响评分与教材上限）

### 8.3 手动排课操作

- 使用 `upsert`，复合键 `(class_id, course_id, semester)`
- 显式设置 `is_auto = false`
- 如果班级之前有自动排课记录，手动排课会替换它

### 8.4 重置操作

- 仅删除 `is_auto = true` 的记录
- 手动排课记录不受影响

---

## 九、批量排课（`batchAutoArrange`）

### 9.1 范围

所有在培养方案中出现过的课程（即有 `plan_courses` 记录且至少有一条 `plan_course_semesters` 记录的课程）。

### 9.2 课程排序

按"供需比"降序排序，优先处理"可选教师少、需求大"的课程：

```
supplyCapacity = teacherCount × defaultStandard
supplyDemandRatio = demand / supplyCapacity   (teacherCount=0 时为 MAX_SAFE_INTEGER)
```

### 9.3 执行模型

**顺序执行，非并行**。课程逐个处理，每门课程的排课结果会影响后续课程的教师容量（通过 `totalWeeklyHours`）。

### 9.4 超时保护

- `BATCH_TIMEOUT_MS = 5 * 60 * 1000`（5 分钟）
- 每门课程排课前检查是否超时
- 超时后停止处理剩余课程，标记 `timeoutReached: true`，未处理课程计入 `skippedCourses`

### 9.5 错误隔离

单门课程的排课失败不会中断批量流程。错误被捕获并记录在结果中（`error` 字段），继续处理剩余课程。

### 9.6 预览模式跨课程累计

预览模式下：
- `virtualTeacherHours`：累计每位教师在前序课程中的虚拟分配课时，传入 `extraTeacherHours` 参数
- `globalTextbookMap`：累计每位教师在前序课程中的教材集合，传入 `globalTextbookMap` 参数，用于初始化 `assignedTextbookIds`

非预览模式下，跨课程数据从 DB 实际读取（`getTeachersForCourse` 已查询全部课程的排课记录）。

---

## 十、预览模式

### 10.1 行为

当请求参数 `preview = true` 时：
- 算法完整执行（所有计算、匹配、评分、置换）
- **跳过数据库事务**——不删除、不插入
- 返回结果包含 `preview: true`
- **不创建审计日志**
- 附带 `classTextbookMap`，供批量排课跨课程累计教材

### 10.2 统计信息

预览模式下结果包含 `statistics` 字段：
- `teacherWorkload`：每位教师的总课时、新增课时、容量、负载率、班级数
- `collegeMatchRate` / `textbookMatchRate` / `levelMatchRate`：匹配率
- `textbookCohesionRate`：教材内聚度（每位教师 `1 - (教材数 - 1) / 班级数`，clamp [0,1]，取平均）
- `avgTextbookPerTeacher`：教师平均教材数
- `scatteredTeacherCount`：教材数 ≥ `SCATTERED_THRESHOLD`（3）的教师数
- `involvedTeacherCount`：涉及的教师数

---

## 十一、诊断机制

### 11.1 诊断函数（`diagnoseFailure`）

对每个未分配的班级，按顺序检查并返回首个匹配的原因：

| 诊断原因 | 触发条件 |
|---------|---------|
| `没有可教此课程的教师` | 该课程无关联教师（`allTeachers.length === 0`） |
| `所有候选教师课时容量已满` | 所有教师的 `assignedHours + cls.weeklyHours > cap`（standardCap 或 fullCap） |
| `所有候选教师总周课时已达上限` | 所有教师触及 `defaultWeeklyHours` 总周课时上限（用 `effectiveTotal + assignedHours + cls.weeklyHours > defaultWeeklyHours` 判定） |
| `所有候选教师教材上限已满` | 所有教师已达 `MAX_TEXTBOOKS_PER_TEACHER` 且无法接纳新教材 |
| `有资格的教师课时容量已满` | 通过意向筛选的教师，其容量全部已满 |
| `无匹配的教师（学院/层次偏好筛选后无候选）` | 上述均不满足时的兜底诊断 |

诊断同时返回 `details`，包含前 5 位教师的具体数据（姓名、已排课时、上限等）。

### 11.2 其他未分配原因

| 原因 | 触发场景 |
|------|---------|
| `课时配置异常（周课时为0或负数）` | `weeklyHours` 为 0 或负数，前置处理阶段直接归入未分配 |
| `并发排课导致教师容量已满，已跳过` | 事务内二次校验超载，降级跳过 |

### 11.3 提前退出消息

| 消息 | 条件 |
|------|------|
| `该课程没有可用教师` | `getTeachersForCourse` 返回空数组 |
| `当前学期没有开设该课程的班级` | `getClassesWithCourse` 返回空数组 |
| `学期 {semesterStr} 批量排课进行中，请稍后再试` | 单课程排课遇到 `batchLocks` |
| `该课程正在排课中，请稍后重试` | 单课程排课遇到 `arrangeLocks` |

---

## 十二、结果结构

### 12.1 单课程排课结果（`buildResult`）

```javascript
{
  assigned: [...],           // 排课记录数组
  unassigned: [{             // 未分配班级数组
    classId,
    className,
    weeklyHours,
    reason,                  // 诊断原因
    details                  // 诊断详情（教师列表或统计）
  }],
  totalClasses,              // 需排课的班级总数（不含手动）
  manualCount,               // 已有手动排课的班级数
  autoCount,                 // 本次自动排课的班级数
  unassignedCount,           // 未分配班级数
  preview,                   // 是否为预览模式
  warnings,                  // 容量警告数组
  statistics?,               // 预览模式下的统计信息
  classTextbookMap?,         // 预览模式下的班级教材映射（供批量累计）
  message?                   // 错误/提前退出消息
}
```

### 12.2 排课记录结构

```javascript
{
  teacher_id: Number,
  teacher_name: String,
  class_id: Number,
  class_name: String,
  course_id: Number,
  semester: String,          // 如 "2025-2026-1"
  weekly_hours: Number,
  is_auto: true
}
```

### 12.3 批量排课结果

```javascript
{
  semester,
  mode,
  preview,
  courseResults: [...],       // 每门课程的单课程结果
  summary: {
    totalCourses,
    successCount,
    errorCount,
    totalAssigned,
    totalUnassigned,
    totalWarnings,
    timeoutReached,
    skippedCourses?
  }
}
```

---

## 十三、配置参数（`constants/index.js`）

### 13.1 课时与模式

| 常量 | 值 | 说明 |
|------|:--:|------|
| `DEFAULT_HOUR_SETTINGS.full_time` | `{standard: 16, max: 20}` | 专职默认课时 |
| `DEFAULT_HOUR_SETTINGS.part_time` | `{standard: 12, max: 16}` | 兼职默认课时 |
| `DEFAULT_HOUR_SETTINGS.external` | `{standard: 12, max: 16}` | 外聘默认课时 |
| `ARRANGE_MODE.STANDARD` | `'standard'` | 标准模式 |
| `ARRANGE_MODE.FULL` | `'full'` | 全量模式 |

### 13.2 工作量平衡（`WORKLOAD_BALANCE`）

| 常量 | 值 | 说明 |
|------|:--:|------|
| `SCORE_THRESHOLD` | 1 | 分数差异阈值，超过则按分数排序 |
| `LOAD_RATE_THRESHOLD` | 0.2 | 负载率差异阈值，超过则按负载率排序 |

### 13.3 教材内聚优化（`TEXTBOOK_COHESION`）

| 常量 | 值 | 说明 |
|------|:--:|------|
| `ENABLED` | `true` | 总开关 |
| `COLLEGE_WEIGHT` | 5 | 学院匹配权重 |
| `LEVEL_WEIGHT` | 5 | 层次匹配权重 |
| `ASSIGNED_WEIGHT` | 10 | 本轮已分配教材权重 |
| `INHERENT_WEIGHT` | 4 | 固有教材权重 |
| `PENALTY_PER_NEW` | 10 | 新增教材每本扣分 |
| `ZERO_TEXTBOOK_BONUS` | 30 | 0 本教材教师加分 |
| `TEXTBOOK_COUNT_PENALTY_1_NEW` | 200 | 1 本教师接新课极重惩罚（**当前未使用**，硬编码 -10000 替代） |
| `TEXTBOOK_COUNT_BONUS_1_SAME` | 8 | 1 本教师接同类加分（**当前未使用**，硬编码 +10 替代） |
| `TEXTBOOK_COUNT_PENALTY_2` | 20 | 已有 2 本教材扣分（仅 `MAX_TEXTBOOKS_PER_TEACHER ≥ 3` 时生效） |
| `TEXTBOOK_COUNT_PENALTY_3PLUS` | 150 | 已有 3+ 本教材惩戒（仅 `MAX_TEXTBOOKS_PER_TEACHER ≥ 4` 时生效） |
| `MAX_TEXTBOOKS_PER_TEACHER` | 2 | 教师同时教教材硬上限（0=不限制） |
| `COHESION_PHASE_ENABLED` | `true` | 是否启用 phase2.5 内聚优先阶段（预留） |
| `PHASE0_ENABLED` | `false` | 关闭旧 Phase 0，改用教材分组优先 |
| `FALLBACK_EMPTY` | `true` | 无排课记录教师教材为空集合 |
| `SCATTERED_THRESHOLD` | 3 | 教师教材数 ≥ 此值视为"分散" |

### 13.4 批量排课

| 常量 | 值 | 说明 |
|------|:--:|------|
| `BATCH_TIMEOUT_MS` | `5 * 60 * 1000`（5 分钟） | 批量排课超时上限 |

---

## 十四、API 接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/classes` | 获取课程班级列表 | 所有用户 |
| GET | `/teachers` | 获取课程教师列表 | 所有用户 |
| GET | `/statistics` | 学期排课统计 | 所有用户 |
| GET | `/hour-settings` | 获取课时设置 | 所有用户 |
| POST | `/assign` | 手动排课 | admin+ |
| POST | `/auto-arrange` | 单课程自动排课 | admin+ |
| POST | `/batch-auto-arrange` | 批量自动排课 | admin+ |
| POST | `/reset` | 重置自动排课 | admin+ |
| PUT | `/hour-settings` | 保存课时设置 | admin+ |
| DELETE | `/assignments/:id` | 删除排课记录 | admin+ |

---

## 十五、排课流程图

```
┌─────────────────────────────────────────────────────────────┐
│                     自动排课开始                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │  加载班级和教师候选池    │
        │  排除手动排课的班级      │
        │  追踪手动排课教材/学院   │
        │  过滤无效课时班级        │
        │  按教材分组排序          │
        └────────────┬───────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │   容量可行性预检        │
        │  (需求 > 容量则警告)    │
        └────────────┬───────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │   构建教师约束           │
        │  effectiveTotal/        │
        │  standardCap/fullCap/   │
        │  teacherHourCap         │
        └────────────┬───────────┘
                     │
    ┌────────────────┼────────────────────┐
    │                │                    │
    ▼                ▼                    ▼
┌────────┐    ┌────────────┐    ┌──────────────┐
│ 阶段 1  │    │  阶段 2     │    │  阶段 3       │
│ 有意向   │───▶│  无意向     │───▶│  同教材追加   │
│ 教师首选 │    │  教师首选   │    │  (不增教材)   │
└────────┘    └────────────┘    └──────┬───────┘
                                       │
                                       ▼
                              ┌────────────┐
                              │  阶段 4     │
                              │  第二本教材  │
                              └──────┬─────┘
                                     │
                                     ▼
                              ┌────────────┐
                              │  阶段 5     │
                              │  兜底分配   │
                              │ (assignRound)│
                              └──────┬─────┘
                                     │
                                     ▼
                              ┌────────────┐
                              │  置换回溯   │
                              │  提升分配率 │
                              └──────┬─────┘
                                     │
                                     ▼
                    ┌───────────────────────────┐
                    │    诊断未分配班级原因       │
                    │    生成排课结果             │
                    └──────────────┬────────────┘
                                   │
                          ┌────────┴────────┐
                          │                 │
                          ▼                 ▼
                   ┌────────────┐   ┌────────────┐
                   │ 预览模式    │   │ 正式模式    │
                   │ (不写入)    │   │ (事务写入)  │
                   │ + 统计信息  │   │ + 容量二次校验│
                   └────────────┘   └────────────┘
```

---

## 十六、已知限制

### 16.1 贪心算法无回溯

一旦教师被分配给某班级，不会被撤回以寻求全局更优解（置换回溯仅单轮，不递归）。结果是局部最优，非全局最优。

### 16.2 跨课程公平性缺失

每门课程独立排课。在批量排课中，先处理的课程可能占用大量教师容量，导致后续课程的教师选择受限。批量排课通过"供需比降序"排序缓解此问题，但无法完全消除。

### 16.3 教材数量分级奖惩部分未启用

`TEXTBOOK_COUNT_PENALTY_2` 与 `TEXTBOOK_COUNT_PENALTY_3PLUS` 仅在 `MAX_TEXTBOOKS_PER_TEACHER ≥ 3` 时生效。当前默认值为 2，这两个分支不可达，教材数量控制主要通过硬编码的 `-10000` 惩罚与 `isTeacherEligible` 的硬上限检查实现。

### 16.4 `defaultWeeklyHours` 语义

字段名"默认周课时"具有误导性，实际作用是**教师总周课时上限**（跨所有课程，含手动排课与其他课程）。UI 中已重命名为"特定周课时"。

### 16.5 并发锁为进程级别

`arrangeLocks` 与 `batchLocks` 均为进程内存级别，仅适用于单进程部署。多实例部署需改用分布式锁。

---

*文档与 `server/src/services/arrange/` 目录代码同步 | 最后更新：2026-07-02*
