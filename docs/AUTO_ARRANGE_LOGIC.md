## 自动排课逻辑分析

本文档整理了当前自动安排教师（`autoArrange`）的完整逻辑链路，包括班级匹配、教师筛选、优先级评分和课时约束，供排查问题参考。

---

### 一、整体流程

```
选择课程 + 学期 → 触发自动排课
  ├── 1. 获取该课程下所有可用教师（getTeachersForCourse）
  ├── 2. 获取该学期下开设该课程的所有班级（getClassesWithCourse）
  ├── 3. 排除已手动安排的班级（不覆盖手动安排）
  ├── 4. 扣除本课程已有的自动安排课时（将被替换）
  ├── 5. 计算每位教师的课时容量约束
  ├── 6. 两轮贪心分配
  └── 7. 事务写入数据库（先删旧自动安排，再写新安排）
```

---

### 二、班级匹配逻辑（getClassesWithCourse）

判断哪些班级在当前学期需要上这门课，核心依据是**培养方案**（training_plans → plan_courses → plan_course_semesters）。

#### 2.1 班级入选条件

一个班级要进入待分配列表，需同时满足：

1. 该班级**未离校**（`is_left_school = false`）
2. 该班级在当前学期**在读年级**范围内（`enrollment_year` 对应年级 ≤ `duration_years`）
3. 存在一条**培养方案课程记录**，其 `course_id` 匹配当前课程，且该课程的学期记录（`plan_course_semesters`）覆盖了当前学期号

#### 2.2 培养方案三级匹配（优先级从高到低）

当一个班级需要匹配培养方案时，按以下优先级逐级判断：

| 优先级 | 条件 | 说明 |
|---|---|---|
| 1 | `class.custom_plan_id === plan.id` | 班级绑定了自定义方案，精确匹配 |
| 2 | 无自定义方案 且 `class.major_id === plan.major_id` | 按专业匹配 |
| 3 | 无自定义方案 且 `class.training_level_id === plan.training_level_id` | 按培养层次匹配（兜底） |

如果三级都未命中，该班级不会出现在当前课程的待分配列表中。

#### 2.3 学期号计算

```
grade = semesterInfo.startYear - class.enrollment_year + 1
currentSemesterNum = (grade - 1) × 2 + semesterInfo.semesterIndex
```

其中 `semesterIndex` 为学期字符串的第三段（1 = 上学期，2 = 下学期）。只有当 `currentSemesterNum` 落在 `plan_course_semesters` 的 `[start_semester, end_semester]` 范围内时，该班级才确认在本学期开设该课程。

---

### 三、教师筛选逻辑（getTeachersForCourse）

#### 3.1 教师入选条件

教师必须在其 `teacher_courses` 关联表中包含当前课程，即该教师被标记为**可以教授这门课**。

#### 3.2 教师携带的属性

每位教师被查出时会携带以下信息，用于后续评分和约束计算：

| 属性 | 来源 | 用途 |
|---|---|---|
| `personnelType` | `teachers.personnel_type` | 决定课时容量档位 |
| `defaultWeeklyHours` | `teachers.default_weekly_hours` | 本课程的课时上限（可选） |
| `schedulingCollegeIds` | `teacher_scheduling_colleges` | 任课学院偏好 |
| `schedulingLevelIds` | `teacher_training_levels` | 任课层次偏好 |
| `textbookIds` | 通过课程关联的教材 | 同教材匹配 |
| `totalWeeklyHours` | 当前学期所有课程的已安排课时合计 | 计算剩余容量 |
| `courseHours` | 当前课程的已安排课时 | 配合 defaultWeeklyHours 约束 |

---

### 四、课时约束体系

#### 4.1 人员类别课时限制（hourSettings）

按人员类别设定两档课时限制，**可在前端按课程单独调整并保存**：

| 人员类别 | 标准课时（standard） | 最大课时（max） |
|---|---|---|
| 专职（full_time） | 16 | 20 |
| 兼职（part_time） | 12 | 16 |
| 外聘（external） | 12 | 16 |

这些值存储在 `system_settings` 表中，key 为 `teaching_hour_settings_{course_id}`。

#### 4.2 排课模式对约束的影响

| 模式 | 容量上限 | 说明 |
|---|---|---|
| `standard`（标准模式） | 使用 `standard` 值 | 教师总课时不超过标准课时 |
| `full`（全量模式） | 使用 `max` 值 | 教师总课时可放宽到最大课时 |

#### 4.3 容量计算公式

```
effectiveTotal = 当前总课时 - 本课程已有的自动安排课时（将被替换）

standardCap = max(0, standard - effectiveTotal)   // 标准模式下的剩余可分配量
fullCap     = max(0, max - effectiveTotal)         // 全量模式下的剩余可分配量
```

#### 4.4 defaultWeeklyHours 约束

如果教师在教师信息页设置了**特定周课时**（`default_weekly_hours`），则该教师在**本课程**上的总课时（手动安排 + 本次自动安排）不得超过该值。这是一个独立于人员类别限制的额外硬约束。

未设置该值的教师不受此约束。

---

### 五、优先级评分（calcMatchScore）

在课时约束通过后，系统为每位候选教师计算一个匹配分数，用于排序选择最优教师。

| 条件 | 分值 | 触发条件 |
|---|---|---|
| 任课学院匹配 | +1 | 教师的 `schedulingCollegeIds` 包含该班级的 `collegeId` |
| 任课层次匹配 | +1 | 教师的 `schedulingLevelIds` 包含该班级的 `trainingLevelId` |
| 同教材匹配 | +2 | 前端勾选"同教材"条件，且教师关联的教材 ID 与班级使用的教材有交集 |

评分越高越优先被选中。

#### 同分排序规则

当多位教师评分相同时，按**当前负载升序**排列（选最空闲的教师）。

```
currentLoad = effectiveTotal + 本次已分配的课时
```

---

### 六、两轮贪心分配

#### 第一轮：有偏好匹配的班级优先

筛选出**至少有一位教师在任课学院或任课层次上与之匹配**的班级，优先进行分配。

```
isMatched(cls) = 存在教师 t，使得：
  t.schedulingCollegeIds 包含 cls.collegeId
  或 t.schedulingLevelIds 包含 cls.trainingLevelId
```

这一轮确保有明确偏好的班级能优先获得匹配的教师，避免被通用教师"抢走"。

#### 第二轮：剩余班级

处理第一轮未成功分配的班级 + 没有偏好匹配的班级。

两轮使用相同的评分和排序逻辑，区别仅在于处理顺序。

#### 单轮内的分配流程（伪代码）

```
对每个待分配班级：
  1. 筛选候选教师：
     - 总体容量检查：assignedHours + cls.weeklyHours ≤ 剩余容量（standard 或 full）
     - defaultWeeklyHours 检查（如设置）：已有课时 + 新分配 ≤ defaultWeeklyHours
  2. 对候选教师计算匹配分数
  3. 按分数降序、负载升序排序
  4. 选择排名第一的教师，累加其 assignedHours
  5. 无候选教师 → 该班级进入未分配列表
```

---

### 七、数据库写入

所有分配完成后，在**单个事务**中执行：

1. 删除该课程+学期下所有旧的自动安排记录（`is_auto = true`）
2. 逐条 upsert 新的安排记录（以 `class_id + course_id + semester` 为唯一键）
3. 手动安排记录（`is_auto = false`）不受影响

---

### 八、排课条件（scheduleConditions）

当前支持的排课条件选项（前端 checkbox）：

| 条件标识 | 说明 |
|---|---|
| `same_textbook` | 启用同教材加分（+2分），使使用相同教材的教师优先安排到对应班级 |

任课学院和任课层次的匹配加分始终生效，不需要额外勾选。

---

### 九、已知问题与局限

1. **贪心算法无回溯**：分配是单向的，一旦某位教师被分配到一个班级，不会为了后续更优的全局方案而撤销。可能导致局部最优而非全局最优。

2. **班级遍历顺序固定**：班级按照数据库查询返回的顺序遍历，没有按"最难分配的班级优先"等启发式策略排序。

3. **defaultWeeklyHours 语义模糊**：该字段同时限制了教师在"本课程"的总课时，但其原名"默认周课时"容易与人员类别课时限制产生混淆（已更名为"特定周课时"）。

4. **任课学院/层次匹配权重偏低**：学院匹配和层次匹配各仅 +1 分，同教材匹配 +2 分。在同时勾选同教材时，教材匹配的优先级更高。

5. **无跨课程均衡**：每次排课只针对单个课程独立计算，不会考虑教师在其他课程上的排课情况来做跨课程的均衡分配（虽然 `totalWeeklyHours` 参与了容量计算，但没有跨课程的公平性考量）。

6. **两轮分配可能导致第二轮质量下降**：第一轮消耗了部分教师容量后，第二轮可选教师减少，可能导致无偏好匹配的班级获得的教师质量更低。
