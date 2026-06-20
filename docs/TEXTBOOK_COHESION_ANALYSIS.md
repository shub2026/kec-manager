# 排课教材内聚度优化分析报告

> 分析对象：`server/src/services/teaching-arrange.service.js`
> 问题现象：排课时教材内聚力度不够，大量教师同时上二三本教材
> 报告日期：2026-06-20
> **实施状态：2026-06-20 全部 6 项修复已落地，待重启后端验证**

---

## 一、问题现象

当前自动排课完成后，出现"教师教材分散"现象：

- 同一教师在本学期被分配到使用 2~3 本不同教材的班级
- 教材内聚度（教师使用教材数的倒数指标）偏低
- 教学准备成本上升：教师需同时备多本教材，降低教学质量
- 教材库存与采购难以集中规划

理想状态：每位教师尽量集中使用少数教材（1~2 本），相同教材的班级优先归集到同一教师。

---

## 二、根因分析

通读 `teaching-arrange.service.js` 全文后，定位到 **三个相互叠加的根因**，单独修复任意一个都无法彻底解决，需协同治理。

### 根因 1：教材兜底推导过于宽泛（核心病灶）

**位置**：`getTeachersForCourse` 函数，第 276-293 行、第 362-367 行

```javascript
// 第 276-293 行：构建兜底教材集合
const fallbackTextbookSet = new Set();
for (const pc of planCoursesForTextbooks) {
  for (const sem of pc.plan_course_semesters) {
    for (const pt of sem.plan_textbooks) {
      fallbackTextbookSet.add(pt.textbook_id);   // 该课程所有培养方案所有学期教材的并集
    }
  }
}

// 第 362-367 行：无实际排课记录的教师，全部赋予兜底并集
const fallbackTextbookIds = [...fallbackTextbookSet];
for (const t of teachers) {
  if (!teacherTextbookMap.has(t.id)) {
    teacherTextbookMap.set(t.id, new Set(fallbackTextbookIds));
  }
}
```

**问题机制**：

1. `fallbackTextbookSet` 收集了该课程在**所有培养方案、所有学期**中关联的全部教材，是一个"超集"。
2. 任何没有当前学期实际排课记录的教师（新教师、跨学期教师、首次排此课程的教师），其 `textbookIds` 都被设置为这个超集。
3. 后续 `isTextbookMatch`（第 77-82 行）判断"教师固有教材与班级教材是否有交集"，对新教师而言**必然通过**——因为新教师拥有所有教材。

**直接后果**：

- `phase1`（有偏好 + 教材匹配）的教材筛选对新教师**完全失效**
- 所有新教师在 phase1 就被判定为"教材匹配"，导致教材维度无法区分候选教师
- 教材匹配评分（`calcMatchScore` 中 +3 分）对所有新教师都生效，无法形成内聚引导

**为什么这是核心病灶**：即便后续修复阶段优先级和评分权重，只要兜底推导仍是"全量并集"，新教师的教材匹配判断就永远是 true，内聚优化无从发力。

### 根因 2：阶段优先级错位，偏好压制教材内聚

**位置**：`autoArrange` 函数，第 614-630 行

```javascript
const phase1Filter = (t, cls) => hasAnyPref(t) && prefMatch(t, cls) && isTextbookMatch(t, cls);
const phase2Filter = (t, cls) => hasAnyPref(t) && prefMatch(t, cls) && hasAssignedTextbook(t, cls);
const phase3Filter = (t, cls) => hasAnyPref(t) && prefMatch(t, cls);   // 有偏好，无教材要求
const phase4Filter = (t, cls) => !hasAnyPref(t) && (isTextbookMatch(t, cls) || hasAssignedTextbook(t, cls));
const phase5Filter = (t, cls) => !hasAnyPref(t);
```

**问题机制**：

阶段执行顺序为 phase1 → phase2 → phase3 → phase4 → phase5 → phase6。其中：

- `phase3`（有偏好、**不要求教材匹配**）先于 `phase4`（无偏好、**要求教材匹配**）执行
- 当 phase1/phase2 无法消化所有班级时（这在兜底推导失效时极易发生），剩余班级进入 phase3
- phase3 会把班级分配给"有学院/层次偏好但教材不匹配"的教师
- 这些教师本可以保持教材单一，却被迫接收使用其他教材的班级
- 与此同时，`phase4` 中那些"无偏好但教材完全匹配"的教师却分不到班级

**直接后果**：

- 有偏好的教师被迫开新教材，教材集合膨胀
- 无偏好但教材高度匹配的教师"闲置"，资源错配
- 教材内聚被学院/层次偏好"绑架"

### 根因 3：教材集合单调累加，评分权重反向激励

**位置**：`assignRound` 函数第 578-583 行、`calcMatchScore` 函数第 401-428 行

```javascript
// 第 578-583 行：分配班级后，班级教材全部加入教师集合
for (const tid of cls.textbookIds || []) {
  if (!selected.textbookIds.includes(tid)) {
    selected.textbookIds.push(tid);          // 教材集合只增不减
  }
  selected.assignedTextbookIds.add(tid);     // 本轮已用教材集合累加
}

// 第 401-428 行：评分权重
function calcMatchScore(teacher, classInfo) {
  // 学院匹配 +5
  // 层次匹配 +5
  // 本轮已分配教材 +6   ← 权重最高
  // 固有教材 +3         ← 权重最低
}
```

**问题机制**：

1. **集合单调膨胀**：教师每分配一个班级，该班级的**所有**教材 ID 都被加入 `textbookIds` 和 `assignedTextbookIds`。一个班级若关联 2 本教材，教师瞬间增加 2 本教材。集合只增不减，内聚度持续下降。

2. **权重反向激励**：
   - `assignedTextbookIds`（本轮已用教材）权重 +6，最高
   - `inherentTextbookIds`（固有教材）权重 +3，最低
   - 这意味着"教师已用过某教材"比"教师本来就匹配某教材"得分更高
   - 但在**初始阶段**（教师 `assignedTextbookIds` 为空时），所有教师在这条规则上同分（0 分）
   - 初始分配完全由学院(+5)/层次(+5)决定，而这两个维度与教材无关
   - 一旦教师在初始随机分配中接了某本教材，后续会因 +6 分"锁定"在该教材——但初始分配是随机的，导致不同教师锁定到不同教材

3. **班级多教材放大效应**：`plan_textbooks` 是一对多关系，一个班级可能关联多本教材。教师接一个多教材班级，教材集合一次性膨胀多本。

**直接后果**：

- 初始分配随机分散教材，后续 +6 分锁定加剧分散
- 教材集合无上限膨胀，内聚度持续恶化
- 即使有教师"教材完全匹配"，也可能因初始 +6 分未积累而排不上

### 根因 4（次要）：贪心算法无全局回溯

**位置**：文档第 15.1 节明确记载"贪心算法无回溯"

`trySwapUnassigned`（第 715-820 行）仅在"未分配"时触发置换，且置换条件只看容量，**不看教材内聚**。这意味着：

- 已分配但教材分散的教师，不会被主动优化
- 全局教材内聚最优解无法通过贪心达到

---

## 三、优化修复建议

按"投入产出比"和"风险"排序，分为三档。

### 🔴 第一档：核心修复（必做，立竿见影）

#### 修复 1：收紧教材兜底推导

**目标**：消除"新教师匹配所有教材"的假象。

**方案**：将兜底教材从"全量并集"改为"空集合"或"仅主教材"。

**改动点**：`getTeachersForCourse` 第 362-367 行

```javascript
// 方案 A（推荐）：无排课记录教师教材为空，强制走非教材匹配阶段
for (const t of teachers) {
  if (!teacherTextbookMap.has(t.id)) {
    teacherTextbookMap.set(t.id, new Set());   // 空集合，不再兜底
  }
}

// 方案 B（温和）：仅取培养方案中标记为"主教材"的单本（需 plan_textbooks 增加 is_primary 字段）
for (const t of teachers) {
  if (!teacherTextbookMap.has(t.id)) {
    const primaryIds = planProductsForTextbooks
      .flatMap(pc => pc.plan_course_semesters)
      .flatMap(sem => sem.plan_textbooks)
      .filter(pt => pt.is_primary)
      .map(pt => pt.textbook_id);
    teacherTextbookMap.set(t.id, new Set(primaryIds));
  }
}
```

**预期效果**：

- `isTextbookMatch` 对新教师返回 false
- phase1 真正筛选出"有历史教材匹配"的教师
- 新教师从 phase3（偏好）或 phase4（无偏好）进入，按学院/层次分配，自然形成教材历史

**风险**：新教师首学期教材匹配率为 0，可能略增未分配率。可通过 phase4 兜底缓解。

#### 修复 2：重排阶段优先级，插入"教材内聚优先"阶段

**目标**：让"有偏好且教材匹配"的教师优先于"有偏好但教材不匹配"的教师。

**改动点**：`autoArrange` 第 614-630 行阶段链

```javascript
// 原阶段链
// phase1: 偏好 + 教材匹配（isTextbookMatch）
// phase2: 偏好 + 本轮已用教材
// phase3: 偏好（无教材要求）  ← 问题：教材不匹配也分配
// phase4: 无偏好 + 教材匹配
// phase5: 无偏好
// phase6: 兜底

// 优化阶段链
const phase1Filter = (t, cls) => hasAnyPref(t) && prefMatch(t, cls) && isTextbookMatch(t, cls);
const phase2Filter = (t, cls) => hasAnyPref(t) && prefMatch(t, cls) && hasAssignedTextbook(t, cls);
// 新增 phase2.5：偏好 + 本轮零新增教材（内聚优先）
const phase2_5Filter = (t, cls) => hasAnyPref(t) && prefMatch(t, cls) && isNewTextbookZero(t, cls);
const phase3Filter = (t, cls) => hasAnyPref(t) && prefMatch(t, cls);
const phase4Filter = (t, cls) => !hasAnyPref(t) && (isTextbookMatch(t, cls) || hasAssignedTextbook(t, cls));
const phase5Filter = (t, cls) => !hasAnyPref(t);

// 辅助函数：教师接此班级是否零新增教材
function isNewTextbookZero(t, cls) {
  if (!cls.textbookIds?.length) return true;
  return cls.textbookIds.every(tid => t.assignedTextbookIds.has(tid));
}
```

**预期效果**：

- 偏好教师在 phase2.5 优先接"零新增教材"的班级
- 避免偏好教师被迫开新教材
- phase3 成为真正的"偏好兜底"，而非教材分散的源头

### 🟠 第二档：评分层强化内聚（推荐，低风险）

#### 修复 3：引入教材内聚惩罚项

**目标**：在候选教师排序时，从评分层强制倾向内聚。

**改动点**：`calcMatchScore` 第 401-428 行

```javascript
function calcMatchScore(teacher, classInfo) {
  let score = 0;

  // 学院匹配 +5（保留）
  if (teacher.schedulingCollegeIds?.includes(classInfo.collegeId)) score += 5;
  // 层次匹配 +5（保留）
  if (classInfo.trainingLevelId && teacher.schedulingLevelIds?.includes(classInfo.trainingLevelId)) score += 5;

  // 本轮已用教材 +6（保留，强化内聚）
  if (classInfo.textbookIds?.length && teacher.assignedTextbookIds) {
    if (classInfo.textbookIds.some(tid => teacher.assignedTextbookIds.has(tid))) score += 6;
  }

  // 固有教材 +3 → +4（提升历史教材权重）
  if (isTextbookMatch(teacher, classInfo)) score += 4;

  // 新增：教材内聚惩罚
  // 教师接此班级需新增 N 本教材时，每本扣 2 分
  if (classInfo.textbookIds?.length && teacher.assignedTextbookIds) {
    const newTextbookCount = classInfo.textbookIds.filter(
      tid => !teacher.assignedTextbookIds.has(tid)
    ).length;
    score -= newTextbookCount * 2;
  }

  return score;
}
```

**预期效果**：

- 候选教师中"零新增教材"者得 +0 惩罚，"全新增"者得 −2N 惩罚
- 在学院/层次同分时，内聚优先生效
- 惩罚系数 2 可配置化（见修复 6）

**风险**：惩罚过重可能导致教师容量利用不均。建议从 −2 起步，观察后调参。

### 🟡 第三档：配套增强（可选，提升可观测性）

#### 修复 4：新增"教材内聚度"统计指标

**目标**：让管理员能看到排课结果的教材内聚情况。

**改动点**：`buildResult` → `calcAllMatchRates` 第 991-1013 行

```javascript
function calcAllMatchRates(assignments, classes, teacherMap) {
  // ... 原有逻辑 ...

  // 新增：教材内聚度统计
  const teacherTextbookSet = new Map();   // teacherId → Set<textbookId>
  const teacherClassCount = new Map();    // teacherId → 班级数
  for (const a of assignments) {
    const cls = classMap.get(a.class_id);
    if (!cls) continue;
    if (!teacherTextbookSet.has(a.teacher_id)) teacherTextbookSet.set(a.teacher_id, new Set());
    for (const tid of cls.textbookIds || []) teacherTextbookSet.get(a.teacher_id).add(tid);
    teacherClassCount.set(a.teacher_id, (teacherClassCount.get(a.teacher_id) || 0) + 1);
  }

  let cohesionSum = 0;
  let teacherCount = 0;
  for (const [tid, tbSet] of teacherTextbookSet) {
    const classCount = teacherClassCount.get(tid) || 1;
    // 内聚度 = 1 - (教材数 - 1) / 班级数，班级数≥1 时有意义
    const cohesion = classCount > 0 ? Math.max(0, 1 - (tbSet.size - 1) / classCount) : 1;
    cohesionSum += cohesion;
    teacherCount++;
  }

  return {
    collegeMatchRate: ...,
    textbookMatchRate: ...,
    levelMatchRate: ...,
    // 新增指标
    textbookCohesionRate: Math.round(cohesionSum / Math.max(1, teacherCount) * 100),
    avgTextbookPerTeacher: +(teacherTextbookSet.size > 0
      ? [...teacherTextbookSet.values()].reduce((s, set) => s + set.size, 0) / teacherTextbookSet.size
      : 0).toFixed(2),
    scatteredTeacherCount: [...teacherTextbookSet.values()].filter(s => s.size >= 3).length,
  };
}
```

**预期效果**：

- 预览结果中展示"教材内聚度%"、"教师人均教材数"、"教材分散教师数"
- 管理员可量化评估排课质量
- 为后续调参提供数据支撑

#### 修复 5：批量排课按教材分组预处理

**目标**：在批量排课前，按教材对班级预分组，提升全局内聚。

**改动点**：`batchAutoArrange` 第 1019 行起

```javascript
// 在课程优先级排序后，增加教材分组预处理
// 同一课程下，按教材组合对班级聚类
// 优先把"教材组合相同"的班级连续分配，便于教师累积教材

// 伪代码：
// 1. 获取该课程所有班级的教材签名（排序后的教材ID元组）
// 2. 按教材签名分组
// 3. 在 assignRound 内部，班级排序时加入"教材签名"作为次要排序键
//    使教材相同的班级连续分配，教师 assignedTextbookIds 快速累积
```

**预期效果**：

- 教材相同的班级被同一教师连续承接
- `assignedTextbookIds` 的 +6 分权重在连续分配中快速生效
- 全局内聚度提升

#### 修复 6：内聚权重可配置化

**目标**：允许管理员平衡"内聚度"与"分配率"。

**改动点**：`constants/index.js` 新增配置

```javascript
export const TEXTBOOK_COHESION = {
  ENABLED: true,              // 是否启用内聚优化
  PENALTY_PER_NEW: 2,         // 每新增一本教材的扣分
  INHERENT_WEIGHT: 4,         // 固有教材权重
  ASSIGNED_WEIGHT: 6,         // 本轮已用教材权重
  COHESION_PHASE_ENABLED: true, // 是否启用 phase2.5 内聚优先阶段
};
```

**预期效果**：

- 不同机构可按实际情况调参
- 内聚过强导致未分配率上升时，可降低惩罚或关闭 phase2.5

---

## 四、实施优先级与风险矩阵

| 优先级 | 修复项 | 改动文件 | 风险 | 预期收益 |
|:------:|--------|----------|------|----------|
| P0 | 修复 1：收紧兜底推导 | service 1 处 | 低（新教师匹配率下降，可兜底） | 高（根治病灶） |
| P0 | 修复 2：插入 phase2.5 | service 1 处 | 低（仅增加一个阶段） | 高（偏好教师内聚） |
| P1 | 修复 3：内聚惩罚评分 | service 1 处 | 中（惩罚过重影响分配率） | 中高（评分层强制） |
| P1 | 修复 4：内聚度指标 | service + 前端 | 低（仅统计展示） | 中（可观测性） |
| P2 | 修复 5：批量教材分组 | service | 中（排序逻辑变更） | 中（全局优化） |
| P2 | 修复 6：权重配置化 | constants + service | 低 | 中（灵活性） |

---

## 五、验证建议

1. **回归测试**：取历史学期数据，对比修复前后的分配率、未分配率、教材内聚度
2. **关键指标**：
   - 分配率应 ≥ 修复前（允许小幅下降 ≤ 2%）
   - 教材内聚度应 ≥ 0.7
   - 教师人均教材数应 ≤ 1.5
   - 教材分散教师数（≥3本）应 ≤ 总教师数 10%
3. **预览先行**：所有修复均支持 `preview=true`，建议先预览验证再正式排课
4. **灰度策略**：先上修复 1+2，观察 1-2 个排课周期，再上修复 3

---

## 六、附录：关键代码位置索引

| 问题 | 文件 | 行号 |
|------|------|------|
| 兜底教材并集构建 | `teaching-arrange.service.js` | 276-293 |
| 兜底教材赋予教师 | `teaching-arrange.service.js` | 362-367 |
| 教材匹配判断 | `teaching-arrange.service.js` | 77-82 |
| 匹配评分函数 | `teaching-arrange.service.js` | 401-428 |
| 阶段链定义 | `teaching-arrange.service.js` | 614-630 |
| 教材集合累加 | `teaching-arrange.service.js` | 578-583 |
| 匹配率统计 | `teaching-arrange.service.js` | 991-1013 |
| 置换回溯（仅容量） | `teaching-arrange.service.js` | 715-820 |

---

*报告版本：v1.0 | 建议结合 `docs/TEACHING_ARRANGE_LOGIC.md` 对照阅读*
