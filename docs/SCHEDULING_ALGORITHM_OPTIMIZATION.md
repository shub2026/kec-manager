# KEC 排课算法优化说明

> 主代码：`server/src/services/arrange/auto-arrange.js`
> 配置：`server/src/constants/index.js`（`TEXTBOOK_COHESION`）
> 版本：v2.17.1（重写）

---

## 一、背景

排课服务原集中在一个文件 `teaching-arrange.service.js` 中，逻辑臃肿、难以维护。v2 已将其重构为 `server/src/services/arrange/` 目录，按职责拆分为四个模块：

| 文件 | 职责 |
|------|------|
| `auto-arrange.js` | 主排课算法、评分、置换回溯 |
| `queries.js` | 教师 / 班级 / 教材等数据库查询，含 `isTextbookMatch`、`isCollegeEligible`、`isLevelEligible` |
| `validate.js` | 课时设置合法性校验 `validateHourSettings` |
| `batch.js` | 批量排课入口，复用 `autoArrange` |

本文聚焦 `auto-arrange.js` 中的 v2 排课算法（5 阶段流程），不包含已废弃的 4 阶段 / 6 阶段历史版本。

---

## 二、核心数据结构

### 2.1 教师约束对象（`buildTeacherConstraints` 输出）

在原始教师数据上扩展以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `standardHours` / `maxHours` | `number` | 来自 `hourSettings` 的标准 / 满载课时 |
| `effectiveTotal` | `number` | 已排总周课时（扣除本课程已自动排部分 + 批量前序虚拟课时） |
| `courseExistingHours` | `number` | 本课程已排周课时 |
| `standardCap` / `fullCap` | `number` | 当前可继续分配的标准 / 满载容量上限（已扣除 `effectiveTotal`，并受 `defaultWeeklyHours` 天花板约束） |
| `teacherHourCap` | `number \| null` | 教师特定周课时上限（`defaultWeeklyHours - effectiveTotal`） |
| `assignedHours` | `number` | 本轮已分配周课时（初始为 0，分配时累加） |
| `inherentTextbookIds` | `number[]` | 排课前固有的教材快照，运行时累加不污染匹配判断 |
| `assignedTextbookIds` | `Set<number>` | 本轮（含手动排课）已分配教材集合，动态更新 |
| `assignedCollegeIds` | `Set<number>` | 本轮已分配学院集合，用于学院内聚奖励 |
| `textbookIds` | `number[]` | 教材列表（动态累加，含固有 + 本轮新增） |

### 2.2 班级对象

`getClassesWithCourse` 返回的班级上挂载 `textbookIds: number[]`（由 `textbooks` 映射而来），供评分与分组使用。

---

## 三、评分机制（`calcMatchScore`）

### 3.1 权重配置

权重全部来自 `constants/index.js` 中的 `TEXTBOOK_COHESION`，不再硬编码在算法文件中：

| 维度 | 常量 | 实际值 | 说明 |
|------|------|--------|------|
| 学院匹配 | `COLLEGE_WEIGHT` | **+5** | 教师意向学院命中班级学院 |
| 层次匹配 | `LEVEL_WEIGHT` | **+5** | 教师意向层次命中班级层次 |
| 本轮已分配教材 | `ASSIGNED_WEIGHT` | **+10** | 班级教材命中教师本轮已分配集合（最高权重，保证内聚） |
| 固有教材匹配 | `INHERENT_WEIGHT` | **+4** | 排课前教师已绑定教材 |
| 同学院内聚奖励 | （硬编码） | **+3** | 教师本轮已接过该学院班级，再接同学院班级 |
| 新增教材惩罚 | `PENALTY_PER_NEW` | **-10/本** | 接此班需新增 N 本教材时扣分 |
| 0 本教材奖励 | `ZERO_TEXTBOOK_BONUS` | **+30** | 教师当前 0 本教材时给加分，鼓励"先开一本" |

### 3.2 教材数量分级奖惩（二轮优化）

`TEXTBOOK_COHESION.ENABLED = true` 时启用，配合 `MAX_TEXTBOOKS_PER_TEACHER = 2`：

| 教师已有教材数 | 班级是否新增教材 | 结果 |
|----------------|------------------|------|
| 0 本 | 任意 | `score += 30`（ZERO_TEXTBOOK_BONUS） |
| 1 本 | 不新增（同教材） | `score += 10` |
| 1 本 | 新增 | `return score - 10000`（实质禁止） |
| ≥ `MAX_TEXTBOOKS_PER_TEACHER`（即 ≥2） | 新增 | `return score - 10000`（实质禁止） |
| ≥2（不可达分支，仅当调高 `MAX_TEXTBOOKS_PER_TEACHER` 时生效） | — | `score -= TEXTBOOK_COUNT_PENALTY_2`（20） |
| ≥3（不可达分支） | — | `score -= TEXTBOOK_COUNT_PENALTY_3PLUS`（150） |

> 注：当前 `MAX_TEXTBOOKS_PER_TEACHER = 2`，所以 `tbCount >= 2` 与 `tbCount >= maxTb` 等价，已在上方的"实质禁止"分支捕获；`tbCount >= 3` 与 `tbCount >= 2` 分支不可达。若将 `MAX_TEXTBOOKS_PER_TEACHER` 调高至 3+，分级惩罚分支才会生效。

### 3.3 评分优先级（综合排序）

`selectBestTeacher` 对候选教师按以下规则排序：

1. 分数差异 ≥ `WORKLOAD_BALANCE.SCORE_THRESHOLD`（=1）→ 高分优先
2. 负载率差异 > `WORKLOAD_BALANCE.LOAD_RATE_THRESHOLD`（=0.2）→ 低负载优先
3. 综合排序：分数降序 → 负载率升序

---

## 四、v2 排课算法（5 阶段）

`autoArrange` 主入口在加载教师 / 班级 / 手动排课数据后，先按教材签名对班级分组（`textbookGroups`），并预累计手动排课教师的教材与学院（`assignedTextbookIds`、`assignedCollegeIds`），随后按以下 5 个阶段顺序执行。

### 4.1 阶段总览

```
阶段1: 有指定意向的教师拿第一本教材（按教材组遍历）
阶段2: 无指定意向的教师拿第一本教材（按教材组遍历）
阶段3: 所有教师追加同教材班级（不增加教材数）
阶段4: 所有教师拿第二本教材
阶段5: 兜底（assignRound 放宽约束）
```

### 4.2 各阶段详解

#### 阶段 1 — 有指定意向的教师拿第一本教材

- 候选教师：`schedulingCollegeIds` 或 `schedulingLevelIds` 非空
- 遍历每个教材组：
  - 0 本教材的教师可拿当前组（开始第一本）
  - 已有教材的教师，仅当已有教材与当前组有交集时可继续拿（保证"先拿完第一本"）
- 教师按剩余容量降序选择
- 班级严格走意向匹配（`isPrefMatch`）：意向学院 / 层次必须命中
- 通过 `takeClassesForTeacher` 在容量与教材硬上限内连续拿班

#### 阶段 2 — 无指定意向的教师拿第一本教材

- 候选教师：无意向的教师集合
- 同样按教材组遍历，规则与阶段 1 一致（0 本可拿 / 已有教材需有交集）
- 不同点：`takeClassesForTeacher` 第三参数 `strictPrefCheck = false`，不强制意向匹配

#### 阶段 3 — 所有教师追加同教材班级（不增加教材数）

- 候选教师：已持有当前教材组教材的所有教师（有意向 + 无意向）
- 目的：在容量允许下，让已开此教材的教师尽量把同教材班级吃完
- 仍走意向匹配（`strictPrefCheck = true`）

#### 阶段 4 — 所有教师拿第二本教材

- 候选教师：当前未持有此教材组教材、且仍有剩余容量、且新增教材后不超 `MAX_TEXTBOOKS_PER_TEACHER`
- 跳过阶段 3 已处理过的教师
- 教师按剩余容量降序选择，意向匹配仍生效

#### 阶段 5 — 兜底（assignRound 放宽约束）

- 把各教材组的剩余班级汇总为 `allRemaining`
- 调用 `assignRound(allRemaining)`：
  - 按可教教师数升序排序班级（少候选的先排）
  - 候选过滤仍走 `isTeacherEligible`（含容量、意向、教材硬上限）
  - 每个候选打 `calcMatchScore` 并通过 `selectBestTeacher` 选最优
- 兜底仍未分配的班级归入 `unassigned`

### 4.3 阶段后：置换回溯

调用 `trySwapUnassigned` → `trySwapOne`：

- 对每个未分配班级 U，遍历所有教师 T（含已满）
- 在 T 的已分配班级 V 中找一个能被其他教师 T'' 接管的
- 校验 T 对 U、T'' 对 V 的学院 / 层次资格，以及双方置换后教材数不超 `MAX_TEXTBOOKS_PER_TEACHER`
- 满足条件即执行置换：T 减 V 加 U、T'' 加 V、同步更新 `assignedTextbookIds` / `assignedCollegeIds` / `assignments`
- 单轮置换，不递归；复杂度约 `O(U × T × A)`

---

## 五、关键约束函数

### 5.1 `isTeacherEligible(t, cls, mode)`

资格硬过滤，所有阶段及兜底均依赖：

1. 容量检查：`t.assignedHours + cls.weeklyHours ≤ cap`（标准模式 `standardCap`，满载模式 `fullCap`）
2. 学院意向：教师指定了 `schedulingCollegeIds` 时，班级学院必须命中
3. 层次意向：教师指定了 `schedulingLevelIds` 时，班级层次必须命中
4. 教材硬上限：教师已有教材数 + 接此班新增教材数 > `MAX_TEXTBOOKS_PER_TEACHER` 时拒绝

### 5.2 `isPrefMatch(teacher, cls)`

阶段 1 / 3 / 4 内的意向匹配（与 `isTeacherEligible` 中的意向部分一致，用于在分配前筛选可拿班级）。

### 5.3 `takeClassesForTeacher(teacher, availableClasses, strictPrefCheck)`

教师从可用班级中按以下规则连续拿班，直到剩余容量用尽：

- 按学院排序：教师已分配的学院优先，再按 `collegeId` 升序
- 容量约束：累加课时不超过剩余容量
- 意向约束（`strictPrefCheck = true` 时）：每班走 `isPrefMatch`
- 教材硬上限：维护"假设拿取后"的教材投影集合，新增教材后超 `MAX_TEXTBOOKS_PER_TEACHER` 则跳过

### 5.4 `recordAssignment(teacher, cls)`

落地一条分配：

- 累加 `assignedHours`
- 把班级学院加入 `assignedCollegeIds`
- 把班级教材加入 `textbookIds`（去重）和 `assignedTextbookIds`
- 写入 `assignments` 数组

---

## 六、容量约束总结

| 模式 | 上限 |
|------|------|
| 标准模式 | `assignedHours + cls.weeklyHours ≤ standardCap` |
| 满载模式 | `assignedHours + cls.weeklyHours ≤ fullCap` |
| 教师特定上限 | `effectiveTotal + assignedHours + cls.weeklyHours ≤ defaultWeeklyHours`（由 `teacherHourCap` 体现） |
| 教材数量 | `assignedTextbookIds.size + 新增教材数 ≤ MAX_TEXTBOOKS_PER_TEACHER`（=2） |

> 手动排课的教材和学院在算法开始前已累计到教师对象上，但课时通过 `effectiveTotal` 计入，避免重复计算。

---

## 七、关键函数索引（`auto-arrange.js`）

行号会随代码演进变化，下表为近似值（约）：

| 函数 | 行号(约) | 说明 |
|------|---------|------|
| `calcMatchScore` | ~35 | 教师-班级匹配评分（含教材内聚与分级奖惩） |
| `isTeacherEligible` | ~130 | 教师资格硬过滤（容量 + 意向 + 教材上限） |
| `buildTeacherConstraints` | ~159 | 构建教师约束对象（含 `inherentTextbookIds`） |
| `selectBestTeacher` | ~306 | 候选教师综合排序（分数 + 负载率） |
| `trySwapOne` | ~510 | 单次置换回溯（含教材上限与意向校验） |
| `autoArrange` | ~664 | 排课主入口（5 阶段流程 + 兜底 + 置换） |

`autoArrange` 内部还定义了几个闭包辅助函数：`isPrefMatch`、`recordAssignment`、`takeClassesForTeacher`、`assignRound`。

---

## 八、并发与事务

- **课程级锁** `arrangeLocks`：同一 `courseId:semester` 不允许并发排课
- **批量锁** `batchLocks`：批量排课进行中，对同 `semester` 的单课程 `autoArrange` 调用直接拒绝（批量内部用 `options.skipBatchLockCheck=true` 绕过）
- **事务**：非预览模式下，删除旧自动安排 + 写入新安排统一在 `prisma.$transaction` 内执行；事务内对每位教师做容量二次校验（避免并发排课导致超载），超载的分配降级跳过并归入 `unassigned`；教材上限同样在事务内二次校验

> 注：上述锁为进程内存级别，仅适用于单进程部署（如 PM2 fork 模式）。多实例部署需改用 Redis 分布式锁或数据库行级锁。

---

## 九、预览模式统计

预览模式（`options.preview = true`）下不写库，`buildResult` 会附带：

- `teacherWorkload`：每位教师的总课时、新分配课时、容量、负载率、班级数
- `collegeMatchRate` / `textbookMatchRate` / `levelMatchRate`：匹配率
- `textbookCohesionRate`：教材内聚度（每位教师 `1 - (教材数-1)/班级数`，clamp 到 [0,1] 后取平均）
- `avgTextbookPerTeacher`：教师平均教材数
- `scatteredTeacherCount`：教材数 ≥ `SCATTERED_THRESHOLD`（=3）的"分散"教师数
- `classTextbookMap`：班级 → 教材映射，供批量排课跨课程累计教材

---

## 十、更新日志

| 版本 | 日期 | 说明 |
|------|------|------|
| v2.17.1 | 2026-07-02 | 重写本文档，对齐 v2 算法实际代码：5 阶段流程、`arrange/` 目录拆分、`TEXTBOOK_COHESION` 真实权重（ASSIGNED_WEIGHT=10、INHERENT_WEIGHT=4、ZERO_TEXTBOOK_BONUS=30）、教材数量分级奖惩、置换回溯、事务二次校验 |
| v2.6.1 | 2026-06-20 | 旧版文档（4 阶段 → 6 阶段，权重 +6/+3/+100），已废弃 |
