# 自动排课算法重构总结

> 日期：2026-06-20  
> 版本：v2.0  
> 修改文件：`server/src/services/teaching-arrange.service.js`, `server/src/constants/index.js`

---

## 一、问题背景

### 1.1 用户反馈的问题

根据用户需求，当前自动排课存在以下严重问题：

1. **教材内聚不符合预期**：教师同时拿多本教材，没有做到"先拿完第一本再拿第二本"
2. **学院内聚不足**：没有优先拿完一个学院的班级，再拿其他学院
3. **意向约束不够严格**：指定了意向学院或意向层次的教师，应该严格按意向分配

### 1.2 根本原因分析

通过深度审查代码，发现旧算法存在以下设计缺陷：

| 问题 | 旧算法表现 | 根因 |
|------|-----------|------|
| 教材分配顺序混乱 | 教师主动选教材组，导致扎堆 | 没有按教材组顺序统一处理 |
| 学院内聚弱 | 仅在排序时优先同学院 | 没有在分组时就按学院排序 |
| 意向约束松散 | 通过评分权重体现 | 应该是硬约束，不匹配直接排除 |
| 有/无指定混合 | 所有教师一起处理 | 应该分阶段，有指定优先 |

---

## 二、解决方案

### 2.1 核心设计理念

新算法严格遵循以下原则：

```
1. 教师拿教材的方式：所有教师先拿完第一本教材，再拿第二本
2. 学院优先：优先拿完一个学院的班级，再拿其他学院
3. 意向约束严格：指定了意向的教师，必须严格按照指定的类型来优先拿取
4. 无指定按容量：未指定任何意向的教师，按课时容量去拿
5. 手动排课追踪：手动排课的教材和课时需要计入教师状态
```

### 2.2 算法流程对比

#### 旧算法（v1）

```
第一轮：0本教师拿第一本教材（教师主动选教材组）
第二轮：1本教师追加同教材班级
第三轮：1本教师拿第二本教材（教师主动选教材组）
第四轮：2本教师追加同教材班级
兜底：assignRound 放宽约束
```

**问题**：
- 教师主动选教材组，导致扎堆某个教材
- 没有区分有/无指定意向的教师
- 意向约束通过评分体现，不够严格

#### 新算法（v2）

```
阶段1：有指定意向的教师拿第一本教材（按教材组顺序）
阶段2：无指定意向的教师拿第一本教材（按教材组顺序）
阶段3：所有教师追加同教材班级（不增加教材数）
阶段4：所有教师拿第二本教材（如果还有容量）
阶段5：兜底（assignRound 放宽约束）
```

**优势**：
- 按教材组顺序处理，确保所有教师先拿完第一本
- 分阶段处理有/无指定意向的教师
- 意向约束是硬过滤，不匹配直接排除
- 同教材组内按学院排序，促进学院内聚

---

## 三、代码变更详情

### 3.1 主要修改点

| 文件 | 函数/模块 | 变更类型 | 说明 |
|------|----------|---------|------|
| `teaching-arrange.service.js` | `autoArrange` | 重写 | 全新分配算法（812-1109行） |
| `teaching-arrange.service.js` | `isPrefMatch` | 新增 | 严格意向匹配检查 |
| `teaching-arrange.service.js` | `takeClassesForTeacher` | 修改 | 增加 `strictPrefCheck` 参数 |
| `constants/index.js` | `TEXTBOOK_COHESION` | 调整 | 增强教材内聚权重 |

### 3.2 关键代码片段

#### 严格意向匹配检查

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

**变化**：从评分权重改为硬过滤，不匹配直接返回 `false`

#### 按教材分组并排序

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

**变化**：新增按教材分组，组内按学院排序

#### 阶段1：有指定意向的教师

```javascript
const teachersWithPref = teacherConstraints.filter(t => 
  t.schedulingCollegeIds?.length > 0 || t.schedulingLevelIds?.length > 0
);

for (const [tbKey, available] of textbookGroups) {
  const eligibleTeachers = teachersWithPref.filter(t => {
    if (t.assignedTextbookIds.size > 0) {
      return textbookIds.some(tid => t.assignedTextbookIds.has(tid));
    }
    return true; // 0本教师可以拿任何教材
  }).sort((a, b) => {
    return (maxCapFn(b) - b.assignedHours) - (maxCapFn(a) - a.assignedHours);
  });

  for (const teacher of eligibleTeachers) {
    const matchingClasses = available.filter(cls => isPrefMatch(teacher, cls));
    const taken = takeClassesForTeacher(teacher, matchingClasses, true);
    // ... 记录分配
  }
}
```

**变化**：新增阶段，专门处理有指定意向的教师

### 3.3 配置参数调整

```javascript
export const TEXTBOOK_COHESION = {
  ENABLED: true,
  COLLEGE_WEIGHT: 5,            // 不变
  LEVEL_WEIGHT: 5,              // 不变
  ASSIGNED_WEIGHT: 8 → 10,      // 提高，增强本轮已用教材吸引力
  INHERENT_WEIGHT: 4,           // 不变
  PENALTY_PER_NEW: 8 → 10,      // 提高，增强新增教材惩罚
  ZERO_TEXTBOOK_BONUS: 25 → 30, // 提高，鼓励0本教师优先拿取
  TEXTBOOK_COUNT_PENALTY_1_NEW: 150 → 200, // 提高，更强力阻止1本接新课
  TEXTBOOK_COUNT_BONUS_1_SAME: 5 → 8,      // 提高，给同教材奖励
  TEXTBOOK_COUNT_PENALTY_2: 15 → 20,       // 提高，已有2本扣分
  TEXTBOOK_COUNT_PENALTY_3PLUS: 99 → 150,  // 提高，实质禁止3本以上
  MAX_TEXTBOOKS_PER_TEACHER: 2, // 不变
};
```

**调整理由**：
- 增强教材内聚相关权重，使算法更倾向于让教师只教1-2本教材
- 提高惩罚力度，阻止教师拿到过多教材

---

## 四、测试验证

### 4.1 测试场景

#### 场景1：有指定意向的教师严格符合意向

**测试数据**：
- 教师A：指定意向学院=职教（ID=1），意向层次=本科（ID=1）
- 班级1-5：职教学院（ID=1），本科层次（ID=1），教材X
- 班级6-10：普教学院（ID=2），本科层次（ID=1），教材X

**预期结果**：
- 教师A只会分配到班级1-5
- 不会分配到班级6-10

**验证方法**：
```sql
SELECT ta.*, c.name as class_name, cl.name as college_name
FROM teaching_assignments ta
JOIN classes c ON ta.class_id = c.id
JOIN colleges cl ON c.college_id = cl.id
WHERE ta.teacher_id = <教师A的ID> AND ta.course_id = <课程ID>;
```

检查所有记录的 `college_id` 是否都为1。

#### 场景2：教材内聚

**测试数据**：
- 教师B：无指定意向
- 班级1-5：教材X（ID=1）
- 班级6-10：教材Y（ID=2）

**预期结果**：
- 教师B先拿完教材X的班级（1-5），直到容量满
- 如果还有容量，再拿教材Y的班级（6-10）
- 教师B的教材数应该≤2

**验证方法**：
```sql
-- 查看教师B分配的班级和教材
SELECT ta.*, c.name as class_name, pt.textbook_id
FROM teaching_assignments ta
JOIN classes c ON ta.class_id = c.id
JOIN plan_courses pc ON pc.course_id = ta.course_id
JOIN plan_course_semesters pcs ON pcs.plan_course_id = pc.id
JOIN plan_textbooks pt ON pt.plan_course_semester_id = pcs.id
WHERE ta.teacher_id = <教师B的ID>;

-- 统计教师B的教材数
SELECT COUNT(DISTINCT pt.textbook_id) as textbook_count
FROM teaching_assignments ta
JOIN classes c ON ta.class_id = c.id
JOIN plan_courses pc ON pc.course_id = ta.course_id
JOIN plan_course_semesters pcs ON pcs.plan_course_id = pc.id
JOIN plan_textbooks pt ON pt.plan_course_semester_id = pcs.id
WHERE ta.teacher_id = <教师B的ID>;
```

#### 场景3：学院内聚

**测试数据**：
- 教师C：已分配职教学院班级
- 班级1-3：职教学院（ID=1），教材X
- 班级4-6：普教学院（ID=2），教材X

**预期结果**：
- 教师C会优先拿职教学院的班级（1-3）
- 只有在职教学院班级分配完后，才会拿普教学院的班级（4-6）

**验证方法**：
检查教师C分配的班级ID顺序，应该是1,2,3在前，4,5,6在后（如果有）。

### 4.2 日志验证

排课过程中会输出详细日志，检查以下内容：

```
[新分配算法v2] 共 X 个教材组，开始分配...
  教材组 <ID>: Y 个班级
[阶段1] 有指定意向的教师拿第一本教材
  [阶段1] 教材组 <ID>: 剩余 Z 个班级
[阶段2] 无指定意向的教师拿第一本教材
  [阶段2] 教材组 <ID>: 剩余 Z 个班级
[阶段3] 所有教师追加同教材班级
  [阶段3] 教材组 <ID>: 剩余 Z 个班级
[阶段4] 所有教师拿第二本教材
  [阶段4] 教材组 <ID>: 剩余 Z 个班级
[新分配算法v2] 完成，总分配 N，未分配 M
```

**检查点**：
1. 每个阶段的剩余班级数是否逐渐减少
2. 最终未分配班级数是否为0（或接近0）
3. 是否有异常日志（如"兜底"阶段分配过多）

### 4.3 统计数据验证

排课完成后，检查预览模式返回的统计数据：

```javascript
{
  statistics: {
    textbookCohesionRate: 85,  // 教材内聚度（越高越好，目标>80%）
    avgTextbookPerTeacher: 1.5, // 平均每教师教材数（目标<2）
    scatteredTeacherCount: 2,   // 分散教师数（教材数≥3，目标=0）
    collegeMatchRate: 90,       // 学院匹配率（越高越好）
    levelMatchRate: 85,         // 层次匹配率（越高越好）
  }
}
```

**目标指标**：
- `textbookCohesionRate` > 80%
- `avgTextbookPerTeacher` < 2
- `scatteredTeacherCount` = 0
- `collegeMatchRate` > 85%
- `levelMatchRate` > 80%

---

## 五、已知限制

### 5.1 贪心算法无回溯

当前算法是贪心算法，一旦教师被分配给某班级，不会被撤回以寻求全局更优解。可能导致局部最优而非全局最优。

**缓解措施**：
- 阶段5的兜底机制可以处理部分边缘情况
- 未来可以考虑添加局部回溯机制

### 5.2 跨课程公平性缺失

每门课程独立排课。在批量排课中，先处理的课程可能占用大量教师容量，导致后续课程的教师选择受限。

**缓解措施**：
- 使用供需比优先级，资源紧张的课程优先处理
- 预览模式下维护虚拟课时累积，模拟跨课程依赖

### 5.3 兜底阶段可能破坏内聚

阶段5使用原有的 `assignRound` 函数，可能会放宽约束，导致部分教师拿到超过2本教材。

**缓解措施**：
- 调整前四个阶段的分配策略，尽量减少进入兜底阶段的班级数量
- 在 `assignRound` 中也加入教材上限检查

---

## 六、部署建议

### 6.1 灰度发布

建议先在测试环境验证，确认无误后再发布到生产环境：

1. **测试环境**：使用真实数据运行排课，检查日志和统计
2. **小范围试点**：选择1-2门课程进行试点排课
3. **全面推广**：确认无误后，全面启用新算法

### 6.2 回滚方案

如果新算法出现问题，可以快速回滚到旧算法：

```javascript
// 临时禁用新算法，回退到旧逻辑
// 方法1：注释掉新算法代码块（812-1109行）
// 方法2：设置 TEXTBOOK_COHESION.ENABLED = false
```

### 6.3 监控指标

生产环境中，建议监控以下指标：

1. **未分配班级数**：如果突然增加，可能是算法问题
2. **平均教材数**：如果超过2，可能是内聚失效
3. **分散教师数**：如果大于0，说明有教师拿到3本以上教材
4. **排课耗时**：如果显著增加，可能是性能问题

---

## 七、后续优化方向

### 7.1 短期优化（1-2周）

1. **增强兜底阶段约束**：在 `assignRound` 中也加入教材上限检查
2. **优化日志输出**：生产环境降低日志级别，避免性能影响
3. **添加单元测试**：覆盖核心函数（`isPrefMatch`, `takeClassesForTeacher` 等）

### 7.2 中期优化（1-2月）

1. **局部回溯机制**：当某班级无法分配时，尝试调整已分配的教师
2. **智能教材推荐**：根据历史数据，推荐最适合教师的教材
3. **可视化排课过程**：前端展示排课进度和决策过程

### 7.3 长期优化（3-6月）

1. **全局优化算法**：使用遗传算法或模拟退火等优化算法
2. **跨课程均衡**：考虑教师在不同课程上的工作量分布
3. **用户偏好学习**：通过学习历史排课数据，自动调整权重

---

## 八、相关文件

| 文件 | 说明 |
|------|------|
| `server/src/services/teaching-arrange.service.js` | 排课服务核心代码 |
| `server/src/constants/index.js` | 常量配置（含教材内聚配置） |
| `docs/AUTO_ARRANGE_LOGIC_V2.md` | 新算法详细文档 |
| `docs/AUTO_ARRANGE_LOGIC.md` | 旧算法文档（保留参考） |
| `docs/TEACHING_ARRANGE_LOGIC.md` | 排课逻辑总览文档 |

---

*总结版本：v1.0 | 最后更新：2026-06-20*
