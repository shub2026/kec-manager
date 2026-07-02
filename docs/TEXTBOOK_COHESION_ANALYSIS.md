# KEC 教材相关性分析

> 更新时间：2026-07-02
> 版本：v2.17.1
> 分析对象：`server/src/services/arrange/` 目录（`auto-arrange.js`、`queries.js`、`batch.js`、`validate.js`）
> 配置文件：`server/src/constants/index.js`
> 适用范围：自动排课（`autoArrange`）与批量排课（`batchAutoArrange`）的教材内聚策略

---

## 一、背景与目标

自动排课完成后，曾出现"教师教材分散"现象：同一教师在本学期被分配到使用 2~3 本不同教材的班级，导致教学准备成本上升、教材库存难以集中规划。

理想状态：每位教师尽量集中使用少数教材（1~2 本），相同教材的班级优先归集到同一教师。

本文档描述 **v2 算法**（5 阶段重写）落地后的实际实现，已与旧版"6 阶段链 + phase2.5"方案完全不同。旧文档中的 phase2.5、6 阶段链均已废弃，不再保留。

---

## 二、代码架构

排课逻辑已从单文件 `teaching-arrange.service.js` 重构为 `server/src/services/arrange/` 目录，按职责拆分：

| 文件 | 职责 |
|------|------|
| `auto-arrange.js` | 自动排课主算法（v2 五阶段）、评分函数 `calcMatchScore`、置换回溯 `trySwapUnassigned`、结果构建 `buildResult`、统计 `calcAllMatchRates` |
| `queries.js` | 数据查询与匹配工具：`getClassesWithCourse`、`getTeachersForCourse`、`isTextbookMatch`、`isCollegeEligible`、`isLevelEligible` |
| `batch.js` | 批量排课 `batchAutoArrange`：按课程供需比排序、跨课程累计教材/课时 |
| `validate.js` | 课时设置校验 `validateHourSettings` |

`TEXTBOOK_COHESION` 配置位于 `constants/index.js`，是所有教材内聚行为的总开关与参数来源。

---

## 三、教材匹配核心：isTextbookMatch

**位置**：`arrange/queries.js` 第 12-21 行

```javascript
export function isTextbookMatch(teacher, cls) {
  // P1-A 修复：教材匹配始终使用教师固有教材快照，不受本次分配累加污染
  const inherentIds = teacher.inherentTextbookIds ?? teacher.textbookIds;
  // 修复九轮：inherentIds 为空时返回 true（无教材约束 = 能教任何教材）
  // 根因：FALLBACK_EMPTY=true 让无排课记录教师 inherentTextbookIds=[]
  //       原逻辑 !inherentIds?.length → true → return false → Phase 1-3 全部屏蔽
  if (!cls.textbookIds?.length) return false; // 班级无教材，不需要匹配
  if (!inherentIds?.length) return true; // 教师无固有教材约束，能教任何教材
  return inherentIds.some((tid) => cls.textbookIds.includes(tid));
}
```

### 实际行为

| 条件 | 返回值 | 说明 |
|------|:------:|------|
| 班级无教材（`cls.textbookIds` 为空） | `false` | 班级无教材，不需要匹配 |
| 教师无固有教材约束（`inherentIds` 为空） | `true` | 教师能教任何教材 |
| 二者均有 | 取交集 | `inherentIds` 与 `cls.textbookIds` 有交集即匹配 |

### 关键设计：固有教材快照

`isTextbookMatch` 始终读取 `teacher.inherentTextbookIds`（教师固有教材快照），**不读取** `teacher.assignedTextbookIds`（本轮运行时累加集合）。这保证了匹配判断不会被本次分配过程污染——教师接到新班级后教材集合会累加，但匹配判断仍以入场时的固有教材为准。

### 与旧文档"修复 1"的差异

旧文档（v1.0）的"修复 1：收紧教材兜底推导"预期效果为：

> `isTextbookMatch` 对新教师返回 false
> phase1 真正筛选出"有历史教材匹配"的教师
> 新教师从 phase3（偏好）或 phase4（无偏好）进入

**实际实现与该预期相反**。当 `FALLBACK_EMPTY=true` 时：

1. `getTeachersForCourse`（queries.js 第 401-408 行）将无排课记录教师的 `inherentTextbookIds` 设为空数组 `[]`
2. `isTextbookMatch` 检测到 `inherentIds` 为空，走第二分支 `return true`
3. 新教师在教材维度上"能教任何教材"，**不会被教材匹配阶段屏蔽**

这一设计选择的原因（见代码注释"修复九轮"）：原逻辑 `!inherentIds?.length → true → return false` 会导致新教师在 phase1-3 全部被屏蔽，反而无法参与分配。当前实现让新教师具备教材匹配资格，由 v2 五阶段算法的"先拿第一本教材"策略自然形成教材归属。

---

## 四、兜底教材推导

**位置**：`arrange/queries.js` 第 261-408 行

`getTeachersForCourse` 构建教师教材上下文的流程：

1. **查询全部排课记录**（跨课程）：拉取教师在当前学期的所有 `teaching_assignments`，通过 `plan_courses` → `plan_course_semesters` → `plan_textbooks` 反查每个 (class_id, course_id) 对应的教材 ID
2. **构建 `teacherTextbookMap`**：教师已实际授课的教材集合（跨课程累计）
3. **兜底赋值**（第 401-408 行）：

```javascript
const fallbackTextbookIds = TEXTBOOK_COHESION.FALLBACK_EMPTY
  ? [] // 修复1：收紧兜底推导 —— 无排课记录教师教材为空，避免 isTextbookMatch 对新教师全通过
  : [...fallbackTextbookSet];
for (const t of teachers) {
  if (!teacherTextbookMap.has(t.id)) {
    teacherTextbookMap.set(t.id, new Set(fallbackTextbookIds));
  }
}
```

- `FALLBACK_EMPTY=true`（当前配置）：无排课记录教师的 `inherentTextbookIds=[]`，配合 `isTextbookMatch` 返回 `true`
- `FALLBACK_EMPTY=false`：兜底为该课程所有培养方案、所有学期教材的并集（超集），新教师拥有所有教材

> 注：`fallbackTextbookSet`（第 272-279 行）仍会构建全量并集，但在 `FALLBACK_EMPTY=true` 时不被使用。

### 固有教材快照固化

`getTeachersForCourse` 返回的教师对象包含：

- `textbookIds`：初始等于 `inherentTextbookIds`，运行时会被 `recordAssignment` 累加
- `inherentTextbookIds`：固化的快照，运行时不变
- `assignedTextbookIds`：`new Set()`，本轮运行时累加

`buildTeacherConstraints`（auto-arrange.js 第 199 行）再次固化快照：

```javascript
inherentTextbookIds: [...(t.textbookIds || [])],
```

确保 `isTextbookMatch` 在整个排课过程中读取的是入场时的教材集合。

---

## 五、v2 排课算法（5 阶段）

**位置**：`arrange/auto-arrange.js` `autoArrange` 函数第 927-1265 行

v2 算法彻底重写为"教师拿教材"视角，核心策略（代码注释第 930-936 行）：

1. 所有教师先拿完第一本教材，再拿第二本
2. 优先拿完一个学院的班级，再拿其他学院
3. 有指定意向学院/层次的教师，必须严格按意向分配
4. 无指定的教师，按课时容量去拿
5. 手动排课的教材和课时需要追踪

### 5.1 教材分组预处理（autoArrange 内部）

**位置**：第 1046-1074 行

v2 在 `autoArrange` 内部按教材签名对班级分组：

```javascript
const textbookGroups = new Map();
for (const cls of validClassesToAssign) {
  const key =
    cls.textbookIds && cls.textbookIds.length > 0
      ? cls.textbookIds.slice().sort().join(',')
      : '__no_textbook__';
  if (!textbookGroups.has(key)) textbookGroups.set(key, []);
  textbookGroups.get(key).push(cls);
}

// 每组内按学院排序（保证同教材内优先拿完一个学院）
for (const [key, group] of textbookGroups) {
  group.sort((a, b) => {
    if (a.collegeId !== b.collegeId) return a.collegeId - b.collegeId;
    return a.classId - b.classId;
  });
}
```

- **教材签名**：班级教材 ID 排序后用逗号拼接（无教材班级归入 `__no_textbook__` 组）
- **组内排序**：按 `collegeId` 升序，保证同教材内优先拿完一个学院
- **可变追踪**：`groupAvailable` Map 跟踪每组的剩余班级，分配后即时 `splice` 移除

> 注：`batch.js` 未实现教材分组预处理，仅按课程供需比排序。教材分组完全在 `autoArrange` 内部完成。

### 5.2 手动排课教材追踪

**位置**：第 940-959 行

手动排课的班级虽不参与自动排课，但教师已分配的教材和课时需计入上下文：

```javascript
for (const ma of manualAssignments) {
  const teacher = teacherConstraints.find((t) => t.id === ma.teacher_id);
  if (!teacher) continue;
  const cls = allClassMap.get(ma.class_id);
  if (!cls) continue;
  for (const tid of (cls.textbooks || []).map((tb) => tb.id)) {
    teacher.assignedTextbookIds.add(tid);
    if (!teacher.textbookIds.includes(tid)) teacher.textbookIds.push(tid);
  }
  teacher.assignedCollegeIds.add(cls.collegeId);
}
```

### 5.3 五阶段执行流程

每个阶段都遍历 `groupAvailable` 的所有教材组，按教师容量从大到小排序后分配。

#### 阶段 1：有指定意向的教师拿第一本教材（第 1077-1123 行）

- 候选教师：`teachersWithPref`（有 `schedulingCollegeIds` 或 `schedulingLevelIds`）
- 教材约束：教师若已有教材，必须包含当前教材组的教材；0 本教师可拿当前组（第一本）
- 严格意向检查：`isPrefMatch` 过滤，只拿匹配学院/层次的班级
- 调用 `takeClassesForTeacher(teacher, matchingClasses, true)` 严格模式

#### 阶段 2：无指定意向的教师拿第一本教材（第 1127-1166 行）

- 候选教师：`teachersWithoutPref`（无任何意向）
- 教材约束同阶段 1（已有教材须匹配，0 本可拿）
- 调用 `takeClassesForTeacher(teacher, available, false)` 非严格模式（不检查意向）

#### 阶段 3：所有教师追加同教材班级（第 1170-1201 行）

- 候选教师：所有已持有此教材组教材的教师
- 目标：让已持有教材的教师继续拿同教材班级，不增加教材数
- 严格意向检查

#### 阶段 4：所有教师拿第二本教材（第 1204-1250 行）

- 候选教师：未持有此教材组任何教材、且有剩余容量的教师
- 教材硬上限校验（`MAX_TEXTBOOKS_PER_TEACHER`）：`t.assignedTextbookIds.size + textbookIds.length > MAX` 则跳过
- 严格意向检查

#### 阶段 5：兜底（第 1254-1265 行）

```javascript
let allRemaining = [];
for (const [, available] of groupAvailable) {
  allRemaining.push(...available);
}

if (allRemaining.length > 0) {
  const fallbackRemaining = assignRound(allRemaining);
  unassigned.push(...fallbackRemaining);
}
```

- 收集五阶段后剩余的所有班级
- 调用 `assignRound(allRemaining)` 放宽约束（无 `eligibilityFilter`，仅做容量与教材硬上限校验）
- 仍未分配的进入 `unassigned`

### 5.4 takeClassesForTeacher 内部逻辑

**位置**：第 1004-1044 行

- 按"教师已分配学院优先 → 学院 ID → 班级 ID"排序候选班级
- 严格意向检查（`strictPrefCheck=true` 时）
- **教材上限校验**（P1-2 修复）：用 `projectedTextbooks` 假设集合追踪，若拿取后教材总数超 `MAX_TEXTBOOKS_PER_TEACHER` 则跳过

### 5.5 recordAssignment

**位置**：第 982-1001 行

分配后更新教师状态：

- `assignedHours` 累加课时
- `assignedCollegeIds` 加入学院
- `textbookIds` 与 `assignedTextbookIds` 加入班级教材（`textbookIds` 只增不减，`assignedTextbookIds` 是 Set）

---

## 六、评分机制 calcMatchScore

**位置**：`arrange/auto-arrange.js` 第 35-128 行

`calcMatchScore` 用于 `assignRound`（阶段 5 兜底）中的候选教师排序。v2 主流程（阶段 1-4）使用 `takeClassesForTeacher` 的容量优先策略，不依赖评分。

### 6.1 配置化权重（来自 TEXTBOOK_COHESION）

| 评分项 | 配置键 | 实际值 | 说明 |
|--------|--------|:------:|------|
| 学院匹配 | `COLLEGE_WEIGHT` | +5 | 教师意向学院包含班级学院 |
| 同学院内聚奖励 | （硬编码） | +3 | 教师已接过该学院班级 |
| 层次匹配 | `LEVEL_WEIGHT` | +5 | 教师意向层次包含班级层次 |
| 本轮已用教材 | `ASSIGNED_WEIGHT` | +10 | 班级教材与 `assignedTextbookIds` 有交集 |
| 固有教材匹配 | `INHERENT_WEIGHT` | +4 | `isTextbookMatch` 返回 true |
| 新增教材惩罚 | `PENALTY_PER_NEW` | -10/本 | 班级教材中教师未持有者的数量 |

### 6.2 硬编码奖惩（二轮优化，第 91-125 行）

当 `TEXTBOOK_COHESION.ENABLED=true` 时，根据教师当前 `assignedTextbookIds.size`（`tbCount`）分级奖惩。`MAX_TEXTBOOKS_PER_TEACHER=2` 时的可达分支：

| `tbCount` | 班级教材情况 | 奖惩 | 代码 |
|:---------:|------------|------|------|
| `>= maxTb`（≥2） | 有新教材 | `return score - 10000` | 第 102 行（硬上限阻断） |
| `=== 0` | 任意 | `score += ZERO_TEXTBOOK_BONUS`（+30） | 第 106 行 |
| `=== 1` | `newCount === 0`（同教材） | `score += 10` | 第 112 行（同教材奖励） |
| `=== 1` | `newCount > 0`（新增教材） | `return score - 10000` | 第 114 行（新增教材惩罚） |

> 注：`tbCount >= 3` 与 `tbCount >= 2` 的分支（第 120-124 行）在 `MAX_TEXTBOOKS_PER_TEACHER=2` 时不可达，因为 `tbCount >= maxTb` 已在上方捕获。若将 `MAX_TEXTBOOKS_PER_TEACHER` 调高至 3+，这些分支才会生效，使用 `TEXTBOOK_COUNT_PENALTY_2`（-20）和 `TEXTBOOK_COUNT_PENALTY_3PLUS`（-150）。

### 6.3 教材硬上限

**位置**：`isTeacherEligible` 第 149-156 行、`assignRound` 第 858-865 行、`takeClassesForTeacher` 第 1033-1037 行、阶段 4 第 1220-1230 行

`MAX_TEXTBOOKS_PER_TEACHER=2` 是硬上限，在多处校验：

- `isTeacherEligible`：`t.assignedTextbookIds.size + newTbCount > maxTb` → 不可选
- `assignRound` 候选筛选：已达上限且班级是新教材 → 排除
- `takeClassesForTeacher`：用 `projectedTextbooks` 假设集合提前校验
- 阶段 4：未持有此教材组的教师，新增后超限则跳过

### 6.4 事务内二次校验

**位置**：第 1356-1404 行

非预览模式写入数据库前，对每位教师做容量与教材上限的二次校验：

- **baseline**：`assignedTextbookIds ∩ inherentTextbookIds`（入场前已存在的教材）
- **written**：本次事务已通过校验的新增教材
- **projected**：`baseline ∪ written ∪ 当前班级教材`
- 若 `projected.size > MAX_TEXTBOOKS_PER_TEACHER`，该分配降级跳过，归入 `unassigned`

---

## 七、教材内聚度统计

**位置**：`calcAllMatchRates` 第 326-381 行

预览模式下（`preview=true`），`buildResult` 调用 `calcAllMatchRates` 输出教材内聚统计：

```javascript
return {
  collegeMatchRate: ...,      // 学院匹配率
  textbookMatchRate: ...,     // 教材匹配率（isTextbookMatch）
  levelMatchRate: ...,        // 层次匹配率
  textbookCohesionRate: ...,  // 教材内聚度（0-100）
  avgTextbookPerTeacher: ..., // 教师人均教材数
  scatteredTeacherCount: ..., // 教材分散教师数（>= SCATTERED_THRESHOLD）
  involvedTeacherCount: ...,  // 参与排课的教师数
};
```

### 内聚度计算公式

每位教师的内聚度：

```
cohesion = max(0, 1 - (教材数 - 1) / 班级数)
```

- 教材数 = 1 或 班级数 = 0 → cohesion = 1（最内聚）
- 教材数 = 班级数 → cohesion = 0（最分散）

整体 `textbookCohesionRate` = 所有教师 cohesion 平均值 × 100。

`SCATTERED_THRESHOLD=3`：教师教材数 ≥ 3 计入 `scatteredTeacherCount`。

---

## 八、置换回溯

**位置**：`trySwapUnassigned` 第 458-503 行、`trySwapOne` 第 510-652 行

五阶段 + 兜底完成后，对未分配班级尝试置换：

1. 遍历教师 T（含已满），找能教未分配班级 U 且置换后可容纳的场景
2. 遍历 T 的已分配班级 V，找能被其他教师 T'' 接管的
3. 校验 T、T'' 对应班级的学院/层次资格（S-02 修复）
4. 校验教材上限：T 移除 V 独有教材后 + U 新增教材 ≤ maxTb；T'' 接管 V 后 ≤ maxTb（C-2 修复：先计算移除后集合再算新增）
5. 执行置换：T 减 V 加 U，T'' 加 V，更新教材追踪与 assignmentsByTeacher

> 注：无效课时班级（`weeklyHours <= 0`）不参与置换（P1-10 修复）。

---

## 九、批量排课

**位置**：`arrange/batch.js` `batchAutoArrange` 第 14-181 行

### 9.1 课程优先级

按"供需比"降序排序，优先处理"可选教师少、需求大"的课程：

```
supplyDemandRatio = demand / (teacherCount * defaultStandard)
```

`teacherCount === 0` 时 ratio = `MAX_SAFE_INTEGER`（最优先）。

### 9.2 跨课程累计

预览模式下：

- `virtualTeacherHours`：累计每位教师的虚拟课时，保证后续课程容量计算累积（H-11 修复）
- `globalTextbookMap`：累计每位教师的教材 ID 集合，传入 `autoArrange` 的 `options.globalTextbookMap`，由 `buildTeacherConstraints` 后的初始化逻辑（第 750-757 行）写入 `t.assignedTextbookIds`，实现跨课程教材内聚（S-13 修复）

### 9.3 并发与超时

- `batchLocks`：按学期维度锁定，批量进行中拒绝单课程 `autoArrange`（P1-12 修复），批量内部调用通过 `skipBatchLockCheck=true` 绕过
- `BATCH_TIMEOUT_MS = 5 分钟`：每门课程排课前检查，超时则停止处理剩余课程

### 9.4 未实现的优化

旧文档"修复 5：批量排课按教材分组预处理"在 `batch.js` 中**未实现**。`batch.js` 仅按课程供需比排序，不做教材分组。教材分组完全由 `autoArrange` 内部（第 5.1 节）完成。

---

## 十、配置项一览

**位置**：`server/src/constants/index.js` 第 89-114 行

```javascript
export const TEXTBOOK_COHESION = {
  ENABLED: true,                          // 总开关
  COLLEGE_WEIGHT: 5,                      // 学院匹配权重
  LEVEL_WEIGHT: 5,                        // 层次匹配权重
  ASSIGNED_WEIGHT: 10,                    // 本轮已用教材权重
  INHERENT_WEIGHT: 4,                     // 固有教材权重
  PENALTY_PER_NEW: 10,                    // 新增教材每本扣分
  ZERO_TEXTBOOK_BONUS: 30,                // 0本教师加分
  TEXTBOOK_COUNT_PENALTY_1_NEW: 200,      // 1本教师接新课惩罚（注：calcMatchScore 实际用硬编码 -10000，此项未生效）
  TEXTBOOK_COUNT_BONUS_1_SAME: 8,         // 1本教师接同类加分（注：calcMatchScore 实际用硬编码 +10，此项未生效）
  TEXTBOOK_COUNT_PENALTY_2: 20,           // 已有2本教材扣分（注：maxTb=2 时不可达）
  TEXTBOOK_COUNT_PENALTY_3PLUS: 150,      // 已有3+本教材惩戒（注：maxTb=2 时不可达）
  MAX_TEXTBOOKS_PER_TEACHER: 2,           // 硬上限
  COHESION_PHASE_ENABLED: true,           // 注：phase2.5 已废弃，此项不再使用
  PHASE0_ENABLED: false,                  // 注：旧 Phase 0 已关闭
  FALLBACK_EMPTY: true,                   // 无排课记录教师教材为空集合
  SCATTERED_THRESHOLD: 3,                 // 教材数 >= 此值视为"分散"
};
```

### 配置与实际生效情况

| 配置项 | 实际值 | 是否生效 | 说明 |
|--------|:------:|:--------:|------|
| `ENABLED` | true | ✅ | 总开关 |
| `COLLEGE_WEIGHT` | 5 | ✅ | calcMatchScore 学院匹配 |
| `LEVEL_WEIGHT` | 5 | ✅ | calcMatchScore 层次匹配 |
| `ASSIGNED_WEIGHT` | 10 | ✅ | calcMatchScore 本轮已用教材 |
| `INHERENT_WEIGHT` | 4 | ✅ | calcMatchScore 固有教材 |
| `PENALTY_PER_NEW` | 10 | ✅ | calcMatchScore 新增教材惩罚 |
| `ZERO_TEXTBOOK_BONUS` | 30 | ✅ | calcMatchScore 0本教师加分 |
| `TEXTBOOK_COUNT_PENALTY_1_NEW` | 200 | ❌ | calcMatchScore 用硬编码 -10000 |
| `TEXTBOOK_COUNT_BONUS_1_SAME` | 8 | ❌ | calcMatchScore 用硬编码 +10 |
| `TEXTBOOK_COUNT_PENALTY_2` | 20 | ❌ | maxTb=2 时不可达 |
| `TEXTBOOK_COUNT_PENALTY_3PLUS` | 150 | ❌ | maxTb=2 时不可达 |
| `MAX_TEXTBOOKS_PER_TEACHER` | 2 | ✅ | 多处硬上限校验 |
| `COHESION_PHASE_ENABLED` | true | ❌ | phase2.5 已废弃 |
| `PHASE0_ENABLED` | false | ❌ | 旧 Phase 0 已关闭 |
| `FALLBACK_EMPTY` | true | ✅ | 兜底教材推导 |
| `SCATTERED_THRESHOLD` | 3 | ✅ | 内聚度统计 |

> 注：`TEXTBOOK_COUNT_PENALTY_1_NEW`、`TEXTBOOK_COUNT_BONUS_1_SAME` 等配置项虽在 constants 中定义，但 `calcMatchScore` 实际使用硬编码值（`score - 10000` 与 `score += 10`）。这是历史调试过程中的遗留，调整这些配置项不会影响实际评分。

---

## 十一、与旧文档（v1.0）的差异说明

旧文档 `TEXTBOOK_COHESION_ANALYSIS.md`（v1.0，2026-06-20）描述的是"6 项修复待落地"的方案，与当前实际实现存在重大差异：

| 旧文档内容 | 实际状态 | 说明 |
|-----------|:--------:|------|
| 分析对象 `teaching-arrange.service.js` | ❌ 已重构 | 拆分为 `arrange/` 目录 |
| 6 阶段链（phase1-6） | ❌ 已废弃 | v2 采用 5 阶段结构 |
| phase2.5 内聚优先阶段 | ❌ 未实现 | v2 用教材分组 + 阶段3"追加同教材班级"替代 |
| 修复 1 预期：`isTextbookMatch` 对新教师返回 false | ❌ 相反 | 实际返回 true（`inherentIds` 为空时） |
| 修复 2：插入 phase2.5 | ❌ 未实现 | 见上 |
| 修复 3：内聚惩罚评分 | ✅ 已实现 | 但权重与旧文档不同 |
| 修复 4：内聚度统计 | ✅ 已实现 | `calcAllMatchRates` |
| 修复 5：批量教材分组预处理 | ❌ 未实现 | 教材分组在 `autoArrange` 内部完成 |
| 修复 6：权重配置化 | ⚠️ 部分实现 | 部分权重硬编码，配置项未全部生效 |
| 实施状态"6 项修复待落地" | ❌ 过时 | v2 重写已远超该范围 |

---

## 十二、关键代码位置索引

| 功能 | 文件 | 行号 |
|------|------|------|
| 教材匹配判断 `isTextbookMatch` | `arrange/queries.js` | 12-21 |
| 兜底教材推导 | `arrange/queries.js` | 261-408 |
| 兜底赋值（FALLBACK_EMPTY） | `arrange/queries.js` | 401-408 |
| 固有教材快照固化 | `arrange/auto-arrange.js` | 199 |
| 评分函数 `calcMatchScore` | `arrange/auto-arrange.js` | 35-128 |
| 资格校验 `isTeacherEligible` | `arrange/auto-arrange.js` | 130-157 |
| 教材分组预处理 | `arrange/auto-arrange.js` | 1046-1074 |
| 手动排课教材追踪 | `arrange/auto-arrange.js` | 940-959 |
| v2 阶段 1（有意向教师拿第一本） | `arrange/auto-arrange.js` | 1077-1123 |
| v2 阶段 2（无意向教师拿第一本） | `arrange/auto-arrange.js` | 1127-1166 |
| v2 阶段 3（追加同教材班级） | `arrange/auto-arrange.js` | 1170-1201 |
| v2 阶段 4（拿第二本教材） | `arrange/auto-arrange.js` | 1204-1250 |
| v2 阶段 5（兜底 assignRound） | `arrange/auto-arrange.js` | 1254-1265 |
| `takeClassesForTeacher` | `arrange/auto-arrange.js` | 1004-1044 |
| `recordAssignment` | `arrange/auto-arrange.js` | 982-1001 |
| `assignRound` | `arrange/auto-arrange.js` | 834-905 |
| 置换回溯 `trySwapUnassigned` | `arrange/auto-arrange.js` | 458-503 |
| 置换单次 `trySwapOne` | `arrange/auto-arrange.js` | 510-652 |
| 内聚度统计 `calcAllMatchRates` | `arrange/auto-arrange.js` | 326-381 |
| 事务内二次校验 | `arrange/auto-arrange.js` | 1356-1404 |
| 批量排课 `batchAutoArrange` | `arrange/batch.js` | 14-181 |
| 配置 `TEXTBOOK_COHESION` | `constants/index.js` | 89-114 |

---

*文档版本：v2.17.1 | 建议结合 `docs/TEACHING_ARRANGE_LOGIC.md` 对照阅读*
