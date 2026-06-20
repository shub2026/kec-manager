# 自动排课算法 v2 - 教材内聚优化版

> 更新日期：2026-06-20  
> 版本：v2.0  
> 文件：`server/src/services/teaching-arrange.service.js`

---

## 一、核心设计理念

### 1.1 设计目标

根据用户需求，新算法严格遵循以下原则：

1. **教师拿教材的方式**：所有教师先拿完第一本教材，再拿第二本
2. **学院优先**：优先拿完一个学院的班级，再拿其他学院
3. **意向约束严格**：指定了意向学院或意向层次的教师，必须严格按照指定的类型来优先拿取教材
4. **无指定按容量**：未指定任何意向的教师，按课时容量去拿
5. **手动排课追踪**：手动排课的教材和课时需要计入教师状态

### 1.2 与旧算法的区别

| 维度 | 旧算法（v1） | 新算法（v2） |
|------|-------------|-------------|
| 教材分配顺序 | 教师主动选教材组 | 按教材组顺序，所有教师先拿完第一本 |
| 学院内聚 | 排序时优先同学院 | 同教材组内严格按学院排序 |
| 意向约束 | 评分权重体现 | 严格过滤，不匹配直接排除 |
| 有/无指定教师 | 混合处理 | 分阶段处理，有指定优先 |
| 手动排课追踪 | 仅追踪教材 | 追踪教材+学院+课时 |

---

## 二、算法流程详解

### 2.1 整体流程图

```
┌─────────────────────────────────────────────┐
│         自动排课开始 (autoArrange)           │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
    ┌──────────────────────────────┐
    │  1. 加载班级和教师候选池      │
    │  2. 追踪手动排课状态          │
    │     - 教材ID                  │
    │     - 学院ID                  │
    │     - 已用课时                │
    └──────────────┬───────────────┘
                   │
                   ▼
    ┌──────────────────────────────┐
    │  3. 按教材分组                │
    │     - 同教材的班级放一起      │
    │     - 每组内按学院排序        │
    └──────────────┬───────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
         ▼                   ▼
┌─────────────────┐ ┌─────────────────┐
│ 阶段1：有指定   │ │ 阶段2：无指定   │
│ 意向的教师      │ │ 意向的教师      │
│                 │ │                 │
│ - 严格按意向    │ │ - 按容量分配    │
│ - 拿第一本教材  │ │ - 拿第一本教材  │
└────────┬────────┘ └────────┬────────┘
         │                   │
         └─────────┬─────────┘
                   │
                   ▼
    ┌──────────────────────────────┐
    │  阶段3：所有教师              │
    │  追加同教材班级               │
    │  （不增加教材数）             │
    └──────────────┬───────────────┘
                   │
                   ▼
    ┌──────────────────────────────┐
    │  阶段4：所有教师              │
    │  拿第二本教材                 │
    │  （如果还有容量）             │
    └──────────────┬───────────────┘
                   │
                   ▼
    ┌──────────────────────────────┐
    │  阶段5：兜底                  │
    │  剩余班级用 assignRound       │
    │  放宽约束分配                 │
    └──────────────┬───────────────┘
                   │
                   ▼
    ┌──────────────────────────────┐
    │  诊断未分配班级原因           │
    │  生成排课结果                 │
    └──────────────┬───────────────┘
                   │
          ┌────────┴────────┐
          │                 │
          ▼                 ▼
   ┌──────────────┐  ┌──────────────┐
   │ 预览模式      │  │ 正式模式      │
   │ (不写入)      │  │ (事务写入)    │
   └──────────────┘  └──────────────┘
```

### 2.2 详细步骤说明

#### 前置准备：手动排课追踪

```javascript
// 手动排课的班级虽然不参与自动排课，但教师已分配的教材和课时需要计入
for (const ma of manualAssignments) {
  const teacher = teacherConstraints.find(t => t.id === ma.teacher_id);
  if (!teacher) continue;
  const cls = allClassMap.get(ma.class_id);
  if (!cls) continue;
  
  // 教材追踪
  for (const tid of (cls.textbooks || []).map(tb => tb.id)) {
    teacher.assignedTextbookIds.add(tid);
    if (!teacher.textbookIds.includes(tid)) {
      teacher.textbookIds.push(tid);
    }
  }
  
  // 学院追踪
  teacher.assignedCollegeIds.add(cls.collegeId);
  // 课时已通过 effectiveTotal 计入，不重复加
}
```

**关键点**：
- 手动排课的教师可能已经持有某些教材
- 这些教材需要在自动排课时被考虑，避免教师拿到过多教材
- 手动排课的课时已计入 `effectiveTotal`，不需要重复累加

#### 步骤1：按教材分组

```javascript
const textbookGroups = new Map();
for (const cls of validClassesToAssign) {
  const key = (cls.textbookIds && cls.textbookIds.length > 0)
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

**设计原理**：
- 将使用相同教材的班级放在一起
- 同教材组内按学院ID排序，确保优先拿完一个学院的班级
- 这样教师在拿取时会自然地先拿完一个学院，再拿下一个学院

#### 阶段1：有指定意向的教师拿第一本教材

```javascript
const teachersWithPref = teacherConstraints.filter(t => 
  t.schedulingCollegeIds?.length > 0 || t.schedulingLevelIds?.length > 0
);

// 按教材组顺序处理：所有教师先拿完第一本教材
for (const [tbKey, available] of textbookGroups) {
  if (available.length === 0) continue;

  const textbookIds = tbKey === '__no_textbook__' ? [] : tbKey.split(',').map(Number);

  // 筛选：有指定意向且能教此教材的教师
  const eligibleTeachers = teachersWithPref.filter(t => {
    // 必须是0本或已有此教材的教师
    if (t.assignedTextbookIds.size > 0) {
      return textbookIds.some(tid => t.assignedTextbookIds.has(tid));
    }
    return true; // 0本教师可以拿任何教材
  }).sort((a, b) => {
    // 优先选剩余容量大的教师
    return (maxCapFn(b) - b.assignedHours) - (maxCapFn(a) - a.assignedHours);
  });

  for (const teacher of eligibleTeachers) {
    if (available.length === 0) break;

    // 严格意向检查：只拿匹配的班级
    const matchingClasses = available.filter(cls => isPrefMatch(teacher, cls));
    if (matchingClasses.length === 0) continue;

    const taken = takeClassesForTeacher(teacher, matchingClasses, true);
    for (const cls of taken) {
      recordAssignment(teacher, cls);
      const idx = available.findIndex(c => c.classId === cls.classId);
      if (idx >= 0) available.splice(idx, 1);
    }
  }
}
```

**关键特性**：
1. **严格按意向过滤**：`isPrefMatch` 函数会严格检查教师的意向学院和意向层次
2. **0本优先**：0本教师可以拿任何教材，已有教材的教师只能拿已持有的教材
3. **容量优先排序**：剩余容量大的教师优先拿取，实现负载均衡
4. **教材组顺序处理**：确保所有教师先拿完第一本教材，再进入下一本

#### 阶段2：无指定意向的教师拿第一本教材

```javascript
const teachersWithoutPref = teacherConstraints.filter(t => 
  !t.schedulingCollegeIds?.length && !t.schedulingLevelIds?.length
);

// 同样按教材组顺序处理
for (const [tbKey, available] of textbookGroups) {
  // ... 类似阶段1的逻辑，但不进行严格意向检查
  const taken = takeClassesForTeacher(teacher, available, false);
}
```

**关键特性**：
1. **无意向约束**：`strictPrefCheck = false`，教师可以拿任何班级的教材
2. **按容量分配**：剩余容量大的教师优先拿取
3. **同样遵循教材顺序**：确保所有教师先拿完第一本教材

#### 阶段3：所有教师追加同教材班级

```javascript
for (const [tbKey, available] of textbookGroups) {
  const textbookIds = tbKey === '__no_textbook__' ? [] : tbKey.split(',').map(Number);

  // 所有已持有此教材的教师
  const teachers = [...teacherConstraints]
    .filter(t => textbookIds.length === 0 || textbookIds.some(tid => t.assignedTextbookIds.has(tid)))
    .sort((a, b) => (maxCapFn(b) - b.assignedHours) - (maxCapFn(a) - a.assignedHours));

  for (const teacher of teachers) {
    const matchingClasses = available.filter(cls => isPrefMatch(teacher, cls));
    const taken = takeClassesForTeacher(teacher, matchingClasses, true);
    // ... 记录分配
  }
}
```

**关键特性**：
1. **不增加教材数**：只有已持有此教材的教师才能参与
2. **促进内聚**：让教师尽可能多教同一种教材的班级
3. **严格意向检查**：即使追加同教材，也要符合意向约束

#### 阶段4：所有教师拿第二本教材

```javascript
for (const [tbKey, available] of textbookGroups) {
  const textbookIds = tbKey === '__no_textbook__' ? [] : tbKey.split(',').map(Number);

  // 筛选：未持有此教材且有容量的教师
  const eligibleTeachers = [...teacherConstraints]
    .filter(t => {
      // 跳过已持有此教材的教师（已在阶段3处理）
      if (textbookIds.some(tid => t.assignedTextbookIds.has(tid))) return false;
      // 检查是否有剩余容量
      return (maxCapFn(t) - t.assignedHours) > 0;
    })
    .sort((a, b) => (maxCapFn(b) - b.assignedHours) - (maxCapFn(a) - a.assignedHours));

  for (const teacher of eligibleTeachers) {
    const matchingClasses = available.filter(cls => isPrefMatch(teacher, cls));
    const taken = takeClassesForTeacher(teacher, matchingClasses, true);
    // ... 记录分配
  }
}
```

**关键特性**：
1. **最后才允许拿第二本**：只有在阶段1-3完成后，仍有剩余班级时才进入此阶段
2. **容量检查**：只有还有剩余容量的教师才能参与
3. **严格意向检查**：即使拿第二本教材，也要符合意向约束

#### 阶段5：兜底分配

```javascript
let allRemaining = [];
for (const [, available] of textbookGroups) {
  allRemaining.push(...available);
}

if (allRemaining.length > 0) {
  logger.info(`[兜底] 剩余 ${allRemaining.length} 个班级，用 assignRound 放宽约束`);
  const fallbackRemaining = assignRound(allRemaining);
  unassigned.push(...fallbackRemaining);
}
```

**关键特性**：
1. **放宽约束**：使用原有的 `assignRound` 函数，允许更灵活的分配
2. **处理边缘情况**：处理前四个阶段未能分配的班级
3. **诊断原因**：对未分配的班级进行原因诊断

---

## 三、辅助函数详解

### 3.1 意向匹配检查（严格约束）

```javascript
function isPrefMatch(teacher, cls) {
  // 有指定意向学院的教师，只能拿匹配的学院
  if (teacher.schedulingCollegeIds?.length > 0 &&
      !teacher.schedulingCollegeIds.includes(cls.collegeId)) {
    return false;
  }
  // 有指定意向层次的教师，只能拿匹配的层次
  if (teacher.schedulingLevelIds?.length > 0 &&
      cls.trainingLevelId &&
      !teacher.schedulingLevelIds.includes(cls.trainingLevelId)) {
    return false;
  }
  return true;
}
```

**设计原理**：
- 如果教师指定了意向学院，**只能**分配到该学院的班级
- 如果教师指定了意向层次，**只能**分配到该层次的班级
- 这是**硬约束**，不是评分权重，不匹配直接排除

### 3.2 教师拿取班级

```javascript
function takeClassesForTeacher(teacher, availableClasses, strictPrefCheck = true) {
  const cap = maxCapFn(teacher);
  const remainingCap = cap - teacher.assignedHours;
  if (remainingCap <= 0) return [];

  const taken = [];
  let usedHours = 0;

  // 按学院排序：教师已分配的学院优先，然后按学院ID排序
  const sorted = [...availableClasses].sort((a, b) => {
    const aHasCollege = teacher.assignedCollegeIds?.has(a.collegeId) ? 0 : 1;
    const bHasCollege = teacher.assignedCollegeIds?.has(b.collegeId) ? 0 : 1;
    if (aHasCollege !== bHasCollege) return aHasCollege - bHasCollege;
    if (a.collegeId !== b.collegeId) return a.collegeId - b.collegeId;
    return a.classId - b.classId;
  });

  for (const cls of sorted) {
    if (usedHours + cls.weeklyHours > remainingCap) continue;

    // 意向约束检查（严格）：有意向的教师只能拿匹配的班级
    if (strictPrefCheck && !isPrefMatch(teacher, cls)) continue;

    taken.push(cls);
    usedHours += cls.weeklyHours;
  }

  return taken;
}
```

**设计原理**：
1. **容量限制**：不能超过教师的课时容量
2. **学院优先排序**：教师已分配的学院优先，促进学院内聚
3. **意向检查**：可选的严格意向检查（无指定意向的教师可以不检查）

### 3.3 记录分配

```javascript
function recordAssignment(teacher, cls) {
  teacher.assignedHours += cls.weeklyHours;
  teacher.assignedCollegeIds.add(cls.collegeId);
  for (const tid of cls.textbookIds || []) {
    if (!teacher.textbookIds.includes(tid)) {
      teacher.textbookIds.push(tid);
    }
    teacher.assignedTextbookIds.add(tid);
  }
  assignments.push({
    teacher_id: teacher.id,
    teacher_name: teacher.name,
    class_id: cls.classId,
    class_name: cls.className,
    course_id: Number(courseId),
    semester: semesterStr,
    weekly_hours: cls.weeklyHours,
    is_auto: true,
  });
}
```

**关键操作**：
1. 累加教师已分配课时
2. 记录教师已分配的学院（用于学院内聚排序）
3. 更新教师的教材集合（包括 `textbookIds` 和 `assignedTextbookIds`）
4. 生成排课记录

---

## 四、配置参数说明

### 4.1 教材内聚配置（TEXTBOOK_COHESION）

```javascript
export const TEXTBOOK_COHESION = {
  ENABLED: true,                // 总开关
  COLLEGE_WEIGHT: 5,            // 学院匹配权重
  LEVEL_WEIGHT: 5,              // 层次匹配权重
  ASSIGNED_WEIGHT: 10,          // 本轮已用教材权重（提高，促进内聚）
  INHERENT_WEIGHT: 4,           // 固有教材权重
  PENALTY_PER_NEW: 10,          // 新增教材每本扣分
  ZERO_TEXTBOOK_BONUS: 30,      // 0本教师加分
  TEXTBOOK_COUNT_PENALTY_1_NEW: 200, // 1本教师接新课极重惩罚
  TEXTBOOK_COUNT_BONUS_1_SAME: 8,   // 1本教师接同类加分
  TEXTBOOK_COUNT_PENALTY_2: 20, // 已有2本教材扣分
  TEXTBOOK_COUNT_PENALTY_3PLUS: 150, // 已有3+本教材惩戒
  MAX_TEXTBOOKS_PER_TEACHER: 2, // 硬上限：教师最多同时教几本教材
};
```

**参数调整说明**：
- `ASSIGNED_WEIGHT` 从 8 提高到 10：增强本轮已用教材的吸引力
- `PENALTY_PER_NEW` 从 8 提高到 10：增强新增教材的惩罚
- `ZERO_TEXTBOOK_BONUS` 从 25 提高到 30：鼓励0本教师优先拿取
- `TEXTBOOK_COUNT_PENALTY_1_NEW` 从 150 提高到 200：更强力阻止1本教师接新课
- `TEXTBOOK_COUNT_PENALTY_3PLUS` 从 99 提高到 150：实质禁止3本以上教材

### 4.2 课时容量配置

```javascript
export const DEFAULT_HOUR_SETTINGS = {
  full_time: { standard: 16, max: 20 },
  part_time: { standard: 12, max: 16 },
  external: { standard: 12, max: 16 },
};
```

**说明**：
- `standard`：标准模式下的课时上限
- `max`：全量模式下的课时上限
- 可在系统设置中按课程自定义

---

## 五、测试验证

### 5.1 验证场景

#### 场景1：有指定意向的教师

**前提条件**：
- 教师A：指定意向学院=职教，意向层次=本科
- 班级1-5：职教学院，本科层次，教材X
- 班级6-10：普教学院，本科层次，教材X

**预期结果**：
- 教师A只会分配到班级1-5（职教学院）
- 不会分配到班级6-10（普教学院）

#### 场景2：无指定意向的教师

**前提条件**：
- 教师B：无指定意向
- 班级1-5：教材X
- 班级6-10：教材Y

**预期结果**：
- 教师B先拿完教材X的班级（1-5），直到容量满
- 如果还有容量，再拿教材Y的班级（6-10）

#### 场景3：教材内聚

**前提条件**：
- 教师C：已持有教材X
- 班级1-5：教材X
- 班级6-10：教材Y

**预期结果**：
- 阶段3中，教师C会优先追加教材X的班级（1-5）
- 只有在教材X的班级分配完后，才会在阶段4拿教材Y的班级

#### 场景4：学院内聚

**前提条件**：
- 教师D：已分配职教学院班级
- 班级1-3：职教学院，教材X
- 班级4-6：普教学院，教材X

**预期结果**：
- 教师D会优先拿职教学院的班级（1-3）
- 只有在职教学院班级分配完后，才会拿普教学院的班级（4-6）

### 5.2 验证步骤

1. 启动开发环境
2. 进入"教学安排"页面
3. 选择课程，使用"标准模式"或"全量模式"排课
4. 检查排课结果：
   - 有指定意向的教师是否严格符合意向
   - 教师的教材数是否尽量保持在1-2本
   - 同教材的班级是否尽量分配给同一教师
   - 同学院的班级是否尽量分配给同一教师

### 5.3 日志查看

排课过程中会输出详细日志：

```
[新分配算法v2] 共 3 个教材组，开始分配...
  教材组 1,2: 10 个班级
  教材组 3: 8 个班级
  教材组 __no_textbook__: 5 个班级
[阶段1] 有指定意向的教师拿第一本教材
  [阶段1] 教材组 1,2: 剩余 2 个班级
  [阶段1] 教材组 3: 剩余 1 个班级
[阶段2] 无指定意向的教师拿第一本教材
  [阶段2] 教材组 1,2: 剩余 0 个班级
  [阶段2] 教材组 3: 剩余 0 个班级
[阶段3] 所有教师追加同教材班级
  [阶段3] 教材组 1,2: 剩余 0 个班级
  [阶段3] 教材组 3: 剩余 0 个班级
[阶段4] 所有教师拿第二本教材
  [阶段4] 教材组 1,2: 剩余 0 个班级
  [阶段4] 教材组 3: 剩余 0 个班级
[新分配算法v2] 完成，总分配 23，未分配 0
```

---

## 六、常见问题

### Q1：为什么有指定意向的教师没有被分配到任何班级？

**可能原因**：
1. 该教师的意向学院/层次没有对应的班级
2. 该教师的课时容量已满
3. 该教师不能教此课程的教材

**解决方法**：
- 检查教师的意向设置是否正确
- 检查是否有对应学院/层次的班级
- 检查教师的课时容量是否充足

### Q2：为什么教师拿到了超过2本教材？

**可能原因**：
1. `MAX_TEXTBOOKS_PER_TEACHER` 设置为0（不限制）
2. 兜底阶段（阶段5）放宽了约束

**解决方法**：
- 确认 `MAX_TEXTBOOKS_PER_TEACHER` 设置为2
- 检查日志中是否有兜底阶段的分配记录
- 如果兜底阶段分配过多，可能需要调整前四个阶段的分配策略

### Q3：为什么有些班级没有被分配？

**可能原因**：
1. 没有可教此课程的教师
2. 所有教师的课时容量已满
3. 所有教师的意向都不匹配该班级
4. 所有教师的教材都不匹配该班级

**解决方法**：
- 检查未分配班级的诊断原因
- 增加教师数量或提高课时容量
- 调整教师的意向设置
- 检查教材关联是否正确

### Q4：手动排课的班级会影响自动排课吗？

**回答**：
- 手动排课的班级**不会**被自动排课覆盖
- 但手动排课的教材和课时**会**计入教师状态
- 这样可以避免教师因手动排课而拿到过多教材或超负荷

---

## 七、性能优化建议

### 7.1 大数据量场景

当班级数量超过100时，建议：

1. **分批排课**：按学院或层次分批排课，减少单次处理的班级数量
2. **预览模式**：先用预览模式查看排课结果，确认无误后再正式排课
3. **单课程排课**：对于重要课程，单独排课而非批量排课

### 7.2 日志优化

生产环境中，建议降低日志级别：

```javascript
// 开发环境：保留所有日志
logger.info('[阶段1] 有指定意向的教师拿第一本教材');

// 生产环境：只保留关键日志
logger.debug('[阶段1] 有指定意向的教师拿第一本教材');
```

---

## 八、未来优化方向

### 8.1 智能回溯

当前算法是贪心算法，无回溯机制。未来可以考虑：

1. **局部回溯**：当某班级无法分配时，尝试调整已分配的教师
2. **全局优化**：使用遗传算法或模拟退火等优化算法

### 8.2 跨课程均衡

当前算法是单课程独立排课。未来可以考虑：

1. **教师工作量均衡**：跨课程考虑教师的总工作量
2. **教材分布均衡**：避免某教师在同一学期教过多不同教材的课程

### 8.3 用户偏好学习

通过学习历史排课数据，自动调整：

1. **教师偏好**：自动学习教师的实际授课偏好
2. **教材亲和度**：根据教学效果调整教材匹配权重

---

*文档版本：v2.0 | 最后更新：2026-06-20*
