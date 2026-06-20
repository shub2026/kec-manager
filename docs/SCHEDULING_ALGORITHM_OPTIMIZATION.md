# 排课算法优化文档

> 文件：`server/src/services/teaching-arrange.service.js`
> 日期：2026-06-20
> 版本：v2.6.1

---

## 一、问题背景

### 1.1 现象

语文课程使用标准模式排课时，教师"薛庆玲"在教师信息中指定了任课学院为"职教"，但自动排课后没有被优先分配到职教类班级。数学、英语科目排课正常。

### 1.2 根因分析

对排课核心代码进行深度审查后，发现 **3 个根本性问题**：

| 编号 | 问题 | 影响 |
|------|------|------|
| P1 | `isTeacherEligible` 只检查容量，不检查学院/层次偏好 | 有偏好的教师在兜底阶段可被分配到非匹配班级 |
| P2 | `calcMatchScore` 教材匹配是固定 +3 分，不区分"已教"和"新教" | 教师可能同时教 5 种教材，无内聚机制 |
| P3 | 4 阶段排课流程中阶段间无"偏好隔离" | 无偏好教师可抢走有偏好教师的匹配班级 |

---

## 二、原算法缺陷详解

### 2.1 原流程（4 阶段）

```
阶段1: 学院匹配     → 有学院偏好的教师参与
阶段2: 层次匹配     → 有层次偏好的教师参与
阶段3: 教材匹配     → 所有教师可参与
阶段4: 兜底         → 任何教师可参与
```

### 2.2 缺陷 1：`isTeacherEligible` 无偏好约束

```javascript
// 原代码 — 只检查容量
function isTeacherEligible(t, cls, mode) {
  const cap = mode === 'standard' ? t.standardCap : t.fullCap;
  if (t.assignedHours + cls.weeklyHours > cap) return false;
  if (t.defaultWeeklyHours != null) {
    return t.courseExistingHours + t.assignedHours + cls.weeklyHours <= t.defaultWeeklyHours;
  }
  return true;  // ← 不检查学院/层次偏好！
}
```

**后果**：薛庆玲（学院=职教）在阶段 3/4 中可以被分配到非职教班级。

### 2.3 缺陷 2：教材匹配无内聚

```javascript
// 原代码 — 教材匹配固定 +3 分
function calcMatchScore(teacher, classInfo) {
  let score = 0;
  if (isCollegeEligible(teacher, classInfo)) score += 1;  // 学院 +1
  if (isLevelEligible(teacher, classInfo)) score += 1;    // 层次 +1
  if (isTextbookMatch(teacher, classInfo)) score += 3;    // 教材 +3（不区分已教/新教）
  return score;
}
```

**后果**：教师教完教材 A 后，对教材 B 的班级和教材 A 的班级得分相同（都是 +3），无法形成"尽量只教一种教材"的内聚。

### 2.4 缺陷 3：阶段间无隔离

阶段 3（教材匹配）和阶段 4（兜底）中，无偏好教师可以参与并抢走本应属于有偏好教师的匹配班级。有偏好的教师也可以在阶段 3/4 中被分配到非匹配班级。

### 2.5 薛庆玲案例失败路径

```
1. 阶段1运行 → 薛庆玲(学院=职教) 候选职教班级
2. 其他教师(学院=职教 + 教材匹配) 得分4 > 薛庆玲(学院=职教) 得分1
3. 薛庆玲容量未满，但职教班级已被其他教师分完
4. 阶段3/4 → 薛庆玲被分配到非职教班级（漏洞！）
5. 结果：薛庆玲没有被优先分配到职教班级
```

---

## 三、优化方案

### 3.1 改动 1：`isTeacherEligible` 增加严格偏好检查

```javascript
function isTeacherEligible(t, cls, mode) {
  // 容量检查（保留原有逻辑）
  const cap = mode === 'standard' ? t.standardCap : t.fullCap;
  if (t.assignedHours + cls.weeklyHours > cap) return false;
  if (t.defaultWeeklyHours != null) {
    if (t.courseExistingHours + t.assignedHours + cls.weeklyHours > t.defaultWeeklyHours) return false;
  }
  // 新增：严格偏好约束
  // 教师指定了任课学院 → 班级学院必须匹配
  if (t.schedulingCollegeIds && t.schedulingCollegeIds.length > 0 &&
      !t.schedulingCollegeIds.includes(cls.collegeId)) {
    return false;
  }
  // 教师指定了培养层次 → 班级层次必须匹配
  if (t.schedulingLevelIds && t.schedulingLevelIds.length > 0 &&
      cls.trainingLevelId &&
      !t.schedulingLevelIds.includes(cls.trainingLevelId)) {
    return false;
  }
  return true;
}
```

**效果**：薛庆玲（学院=职教）永远不会被分配到非职教班级，无论在哪个阶段。

### 3.2 改动 2：新增 `assignedTextbookIds` 跟踪本轮已分配教材

在 `buildTeacherConstraints` 中新增两个字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `inherentTextbookIds` | `number[]` | 教师固有教材快照（排课前已确定） |
| `assignedTextbookIds` | `Set<number>` | 本轮排课中已分配的教材（动态更新） |

在 `assignRound` 中每次分配后更新：

```javascript
for (const tid of cls.textbookIds || []) {
  if (!selected.textbookIds.includes(tid)) {
    selected.textbookIds.push(tid);
  }
  selected.assignedTextbookIds.add(tid);  // 新增：跟踪本轮已分配教材
}
```

### 3.3 改动 3：`calcMatchScore` 加入教材内聚权重

```javascript
function calcMatchScore(teacher, classInfo) {
  let score = 0;

  // 学院偏好匹配 +5
  if (teacher.schedulingCollegeIds?.length > 0 &&
      teacher.schedulingCollegeIds.includes(classInfo.collegeId)) {
    score += 5;
  }

  // 层次偏好匹配 +5
  if (teacher.schedulingLevelIds?.length > 0 &&
      classInfo.trainingLevelId &&
      teacher.schedulingLevelIds.includes(classInfo.trainingLevelId)) {
    score += 5;
  }

  // 本轮已分配教材 +6（教材内聚，最高权重）
  if (classInfo.textbookIds?.length > 0 && teacher.assignedTextbookIds) {
    const hasAssigned = classInfo.textbookIds.some(tid => teacher.assignedTextbookIds.has(tid));
    if (hasAssigned) score += 6;
  }

  // 固有教材匹配 +3
  if (isTextbookMatch(teacher, classInfo)) {
    score += 3;
  }

  return score;
}
```

**权重设计原理**：

| 维度 | 权重 | 说明 |
|------|------|------|
| 学院匹配 | +5 | 核心优先级，但不是唯一因素 |
| 层次匹配 | +5 | 核心优先级，与学院同级 |
| 本轮已分配教材 | +6 | 最高权重，保证教材内聚 |
| 固有教材匹配 | +3 | 辅助匹配，排课前已有数据 |

> 教材内聚(+6) > 学院匹配(+5) > 固有教材(+3)
> 这样设计是因为：在学院匹配的前提下（由 `isTeacherEligible` 保证），
> 教材内聚是决定"同一教师教同一种教材"的关键因素。

### 3.4 改动 4：6 阶段排课流程（替换 4 阶段）

```
阶段1: 有偏好教师 + 学院/层次匹配 + 固有教材匹配
阶段2: 有偏好教师 + 学院/层次匹配 + 本轮已分配教材
阶段3: 有偏好教师 + 学院/层次匹配（任意教材）
阶段4: 无偏好教师 + 固有/本轮教材匹配
阶段5: 无偏好教师 + 任意教材（评分强倾斜教材内聚）
阶段6: 兜底（所有教师，但 isTeacherEligible 仍拦截偏好）
```

**核心设计**：

- **阶段 1-3**：只有有偏好教师参与（严格匹配），确保有偏好的教师优先吃满匹配班级
- **阶段 4-5**：只有无偏好教师参与，教材内聚优先
- **阶段 6**：兜底，但 `isTeacherEligible` 保证有偏好教师不会被分配到非匹配班级

**阶段间不交叉**：有偏好教师和无偏好教师在各自的阶段组内运行，互不干扰。

---

## 四、薛庆玲案例 — 修复后路径

```
1. 阶段1 → 薛庆玲(学院=职教) + 固有教材匹配 → 得分 5+3=8，优先分配
2. 阶段2 → 薛庆玲本轮已教教材X → 得分 5+6=11，教材内聚延续
3. 阶段3 → 薛庆玲容量未满，继续吃职教班级（任意教材）→ 得分 5
4. 阶段4-5 → 薛庆玲不参与（她有偏好，严格约束）
5. 阶段6 → isTeacherEligible 拦截，薛庆玲不会被分配到非职教班级

结果：薛庆玲被优先分配到职教班级，教材尽量内聚
```

---

## 五、代码变更清单

| 文件 | 函数 | 变更类型 | 说明 |
|------|------|---------|------|
| `teaching-arrange.service.js` | `isTeacherEligible` | 修改 | 增加学院/层次严格偏好检查 |
| `teaching-arrange.service.js` | `buildTeacherConstraints` | 修改 | 新增 `inherentTextbookIds`、`assignedTextbookIds` |
| `teaching-arrange.service.js` | `calcMatchScore` | 重写 | 学院+5、层次+5、本轮教材+6、固有教材+3 |
| `teaching-arrange.service.js` | `assignRound` | 修改 | 分配后更新 `assignedTextbookIds` |
| `teaching-arrange.service.js` | 排课主流程 | 重写 | 4 阶段 → 6 阶段，偏好隔离 |
| `teaching-arrange.service.js` | `trySwapOne` | 修改 | 置换时更新 `assignedTextbookIds` |

---

## 六、排课规则总结

### 6.1 有偏好教师（设置了任课学院或培养层次）

1. **严格约束**：只能被分配到匹配学院/层次的班级（`isTeacherEligible` 保证）
2. **优先级**：在阶段 1-3 优先参与排课
3. **教材内聚**：同教材班级优先分配给同一教师（`calcMatchScore` 中本轮教材 +6）
4. **前提条件**：优先保证安排到的班级使用同一教材

### 6.2 无偏好教师（未设置任课学院和培养层次）

1. **无学院/层次约束**：可被分配到任何班级
2. **优先级**：在阶段 4-5 参与排课（有偏好教师之后）
3. **教材内聚**：同一教材安排完了还没达到课时容量，才安排第二教材
4. **核心原则**：在安排中尽可能只分配同一教材班级

### 6.3 容量约束（所有教师）

| 模式 | 约束 |
|------|------|
| 标准模式 | `assignedHours + cls.weeklyHours ≤ standardCap` |
| 满载模式 | `assignedHours + cls.weeklyHours ≤ fullCap` |
| 课程上限 | `courseExistingHours + assignedHours + cls.weeklyHours ≤ defaultWeeklyHours` |

---

## 七、测试验证

### 7.1 验证步骤

1. 启动开发环境
2. 进入"教学安排"页面
3. 选择"语文"课程，使用"标准模式"排课
4. 检查薛庆玲是否被优先分配到职教类班级
5. 检查无偏好教师是否尽量只教同一教材

### 7.2 预期结果

- 薛庆玲的所有分配班级学院均为"职教"
- 薛庆玲的教材尽量内聚（同一教材优先）
- 无偏好教师的教材分配呈现内聚趋势
- 不再出现 500 错误

---

## 八、附录

### 8.1 相关文件

- 排课服务：`server/src/services/teaching-arrange.service.js`
- 排课控制器：`server/src/controllers/teaching-arrange.controller.js`
- 前端页面：`client/src/views/TeachingArrange.vue`
- 前端API：`client/src/api/teachingArrange.js`

### 8.2 关键函数索引

| 函数 | 行号(约) | 说明 |
|------|---------|------|
| `isTeacherEligible` | ~796 | 教师资格检查（含严格偏好） |
| `buildTeacherConstraints` | ~814 | 构建教师约束对象 |
| `calcMatchScore` | ~373 | 匹配评分计算（含教材内聚） |
| `autoArrange` | ~408 | 排课主入口 |
| `selectBestTeacher` | ~490 | 最佳教师选择 |
| `assignRound` | ~515 | 单阶段分配 |
| `trySwapOne` | ~722 | 置换取回溯 |
