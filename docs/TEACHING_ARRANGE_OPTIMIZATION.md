# 排课逻辑问题分析与优化建议

**分析日期**: 2026-06-19  
**分析范围**: `server/src/services/teaching-arrange.service.js` 及相关控制器、前端组件

---

## 一、当前问题诊断

### 1.1 算法层面问题

#### 问题 1：贪心算法无回溯机制（严重）

**现象**：教师一旦分配给某班级，不会被撤回重新分配。可能导致局部最优而非全局最优解。

**示例场景**：
```
班级 A（学院 X）→ 分配给教师 T1（学院 X 偏好）
班级 B（学院 X）→ T1 容量已满，分配给教师 T2（无学院偏好）
```
**更优方案**：T1 分配给 B，T2 分配给 A（如果 T2 也能教 A）

**影响**：在教师资源紧张时，可能导致部分班级无法分配，即使存在全局可行的分配方案。

**代码位置**：`teaching-arrange.service.js:484-532`（`assignRound` 函数）

---

#### 问题 2：批量排课顺序依赖（中等）

**现象**：批量排课时，课程按数据库查询顺序处理。先处理的课程优先消耗教师容量，可能导致后续课程的教师选择受限。

**示例场景**：
```
课程 1（先处理）→ 消耗教师 T1 的 16 课时（标准容量）
课程 2（后处理）→ T1 容量已满，无法分配
```
**更优方案**：如果课程 2 只有 T1 能教，应该优先处理课程 2。

**影响**：批量排课的公平性和成功率依赖于课程处理顺序。

**代码位置**：`teaching-arrange.service.js:701-719`（`batchAutoArrange` 函数）

---

#### 问题 3：教材 ID 级联扩展副作用（轻微）

**现象**：教师被分配班级后，其 `textbookIds` 会扩展包含该班级的教材 ID。这导致教师在后续轮次被视为"教材匹配"，形成级联效应。

**示例场景**：
```
第 1 轮：T1 分配给班级 A（教材 X）→ T1.textbookIds 包含 X
第 2 轮：班级 B（教材 X）→ T1 被视为"教材匹配"，即使 T1 原本不教教材 X
```

**影响**：可能导致教材匹配度失真，但不一定是负面效果（可能增强教材一致性）。

**代码位置**：`teaching-arrange.service.js:515-519`

---

#### 问题 4：第 3 轮与 selectBestTeacher 层级 6 重复（轻微）

**现象**：第 3 轮使用 `textbookPairs` 过滤器（仅教材匹配），而 `selectBestTeacher` 的层级 6 也是"仅教材匹配"。两者逻辑重复。

**影响**：代码冗余，不影响功能。

**代码位置**：
- 第 3 轮：`teaching-arrange.service.js:571-574`
- selectBestTeacher 层级 6：`teaching-arrange.service.js:468-471`

---

### 1.2 业务逻辑问题

#### 问题 5：课时设置默认值硬编码（中等）

**现象**：如果前端未传递 `hour_settings`，控制器使用硬编码默认值，而非从数据库加载已保存的设置。

**影响**：管理员在系统中保存的课时设置可能被忽略。

**代码位置**：`teaching-arrange.controller.js:170-175`

**当前代码**：
```javascript
const defaultHourSettings = {
  full_time: { standard: 16, max: 20 },
  part_time: { standard: 12, max: 16 },
  external: { standard: 12, max: 16 },
};
const hourSettings = hour_settings || defaultHourSettings;
```

**问题**：应该优先从 `system_settings` 加载已保存的设置。

---

#### 问题 6：课时设置无验证（轻微）

**现象**：控制器未验证 `hour_settings` 的结构和数值范围。

**影响**：如果前端传递错误的课时设置（如 `standard > max`），可能导致容量计算异常。

**代码位置**：`teaching-arrange.controller.js:166-178`

---

#### 问题 7：学期解析过于严格（轻微）

**现象**：`parseSemester` 只接受 `semesterIndex` 为 1 或 2，不支持暑期学期（学期 3）。

**影响**：如果学校有暑期学期，无法使用排课功能。

**代码位置**：`teaching-arrange.service.js:23`

**当前代码**：
```javascript
if (isNaN(startYear) || isNaN(endYear) || (semesterIndex !== 1 && semesterIndex !== 2)) return null;
```

---

#### 问题 8：容量预检不够精确（轻微）

**现象**：容量预检只比较总需求与总容量，未考虑教师-班级的匹配约束。

**示例场景**：
```
总班级课时：20
总教师容量：30
预检通过 ✓

但实际：
- 班级 A（学院 X）只能由 T1 教（容量 10）
- 班级 B（学院 Y）只能由 T2 教（容量 10）
- 班级 C（学院 Z）只能由 T3 教（容量 10）
实际需求：30，但每个教师只能教 10，总需求 20 > 可用容量 30
```

**影响**：预检通过但实际分配失败，用户体验不佳。

**代码位置**：`teaching-arrange.service.js:394-401`

---

### 1.3 性能问题

#### 问题 9：教材二次筛选性能问题（中等）

**现象**：第 1 轮和第 2 轮的教材二次筛选，对每个班级都检查所有教师约束，时间复杂度 O(n²)。

**影响**：当教师和班级数量较大时（>100），性能下降明显。

**代码位置**：`teaching-arrange.service.js:545-554`（`collegePairs` 函数）

**当前代码**：
```javascript
const collegePairs = (t, cls) => {
  if (!collegeEligible(t, cls)) return false;
  if (cls.textbookIds?.length > 0) {
    const hasBetter = teacherConstraints.some(  // ← O(n) for each class
      tc => collegeEligible(tc, cls) && isTextbookMatch(tc, cls)
    );
    if (hasBetter && !isTextbookMatch(t, cls)) return false;
  }
  return true;
};
```

---

#### 问题 10：教师教材数据查询冗余（轻微）

**现象**：`getTeachersForCourse` 中，教材数据的查询和聚合逻辑复杂，涉及多次数据库查询。

**影响**：查询性能不佳，尤其是在教材关联较多时。

**代码位置**：`teaching-arrange.service.js:203-303`

---

### 1.4 用户体验问题

#### 问题 11：未分配班级诊断信息不够详细（轻微）

**现象**：诊断信息只有 4 种类型，无法区分具体是哪个约束导致无法分配。

**当前诊断**：
- "没有可教此课程的教师"
- "所有候选教师课时容量已满"
- "所有候选教师本课程课时已达上限"
- "无匹配的教师（学院/层次偏好筛选后无候选）"

**缺失信息**：
- 哪些教师的容量已满（具体数值）
- 哪些教师的本课程课时已达上限（具体数值）
- 偏好筛选排除了哪些教师

**代码位置**：`teaching-arrange.service.js:639-659`

---

#### 问题 12：预览模式缺少统计信息（轻微）

**现象**：预览模式返回的结果与正式排课相同，缺少更详细的统计信息（如教师负荷分布、学院匹配率等）。

**影响**：管理员难以从预览结果中获取足够的决策信息。

**代码位置**：`teaching-arrange.service.js:581-583`

---

## 二、优化建议

### 优先级 P0：必须修复

#### 建议 1：修复课时设置加载逻辑

**目标**：确保管理员保存的课时设置被正确使用。

**实现方案**：
```javascript
// teaching-arrange.controller.js
export async function runAutoArrange(req, res, next) {
  try {
    const { course_id, semester, mode, hour_settings, schedule_conditions, preview } = req.body;
    if (!course_id || !semester) return fail(res, '缺少课程或学期参数');
    if (!['full', 'standard'].includes(mode)) return fail(res, '排课模式必须是full或standard');

    // 优先使用前端传递的设置，否则从数据库加载
    let hourSettings = hour_settings;
    if (!hourSettings) {
      const savedSettings = await prisma.system_settings.findUnique({
        where: { key: `teaching_hour_settings_${course_id}` },
      });
      if (savedSettings) {
        hourSettings = JSON.parse(savedSettings.value);
      } else {
        const globalSettings = await prisma.system_settings.findUnique({
          where: { key: 'teaching_hour_settings' },
        });
        hourSettings = globalSettings 
          ? JSON.parse(globalSettings.value)
          : {
              full_time: { standard: 16, max: 20 },
              part_time: { standard: 12, max: 16 },
              external: { standard: 12, max: 16 },
            };
      }
    }
    
    // 验证课时设置
    for (const [type, setting] of Object.entries(hourSettings)) {
      if (setting.standard > setting.max) {
        return fail(res, `${type} 的标准课时不能超过最大课时`);
      }
    }

    const result = await autoArrange(course_id, semester, mode, hourSettings, schedule_conditions || [], { preview: !!preview });
    // ...
  }
}
```

---

#### 建议 2：添加课时设置验证

**目标**：防止无效的课时设置导致容量计算异常。

**实现方案**：
```javascript
function validateHourSettings(hourSettings) {
  const requiredTypes = ['full_time', 'part_time', 'external'];
  for (const type of requiredTypes) {
    if (!hourSettings[type]) {
      throw new Error(`缺少 ${type} 的课时设置`);
    }
    const { standard, max } = hourSettings[type];
    if (typeof standard !== 'number' || typeof max !== 'number') {
      throw new Error(`${type} 的课时设置必须是数字`);
    }
    if (standard < 0 || max < 0) {
      throw new Error(`${type} 的课时设置不能为负数`);
    }
    if (standard > max) {
      throw new Error(`${type} 的标准课时不能超过最大课时`);
    }
  }
}
```

---

### 优先级 P1：建议优化

#### 建议 3：支持暑期学期

**目标**：允许 `semesterIndex` 为 1、2、3（暑期学期）。

**实现方案**：
```javascript
// teaching-arrange.service.js
export function parseSemester(semesterStr) {
  if (!semesterStr) return null;
  const parts = semesterStr.split('-');
  if (parts.length !== 3) return null;
  const startYear = parseInt(parts[0]);
  const endYear = parseInt(parts[1]);
  const semesterIndex = parseInt(parts[2]);
  // 支持学期 1（秋季）、2（春季）、3（暑期）
  if (isNaN(startYear) || isNaN(endYear) || semesterIndex < 1 || semesterIndex > 3) {
    return null;
  }
  return {
    startYear,
    endYear,
    semesterIndex,
    label: semesterStr,
  };
}
```

**注意**：需要同时更新学期序号计算逻辑：
```javascript
function calcClassSemester(cls, semesterInfo) {
  const grade = semesterInfo.startYear - cls.enrollment_year + 1;
  if (grade < 1 || grade > cls.duration_years) return null;
  // 每学年 3 个学期（秋季、春季、暑期）
  const currentSemesterNum = (grade - 1) * 3 + semesterInfo.semesterIndex;
  return { grade, currentSemesterNum };
}
```

---

#### 建议 4：优化批量排课顺序

**目标**：优先处理"可选教师少"的课程，避免这些课程因容量耗尽而无法分配。

**实现方案**：
```javascript
// teaching-arrange.service.js
export async function batchAutoArrange(semesterStr, mode, hourSettings, scheduleConditions, options = {}) {
  // 1. 获取所有课程
  const courses = await prisma.courses.findMany({
    where: {
      plan_courses: {
        some: {
          plan_course_semesters: { some: {} },
        },
      },
    },
    select: { id: true, name: true, code: true },
  });

  // 2. 计算每门课程的"可选教师数量"（启发式优先级）
  const coursePriorities = await Promise.all(
    courses.map(async (course) => {
      const teachers = await prisma.teachers.count({
        where: {
          status: 'active',
          courses: { some: { course_id: course.id } },
        },
      });
      const classes = await getClassesWithCourse(course.id, semesterStr);
      return {
        courseId: course.id,
        courseName: course.name,
        teacherCount: teachers,
        classCount: classes.length,
        // 优先级：可选教师少 > 班级多
        priority: (teachers === 0 ? -1 : classes.length / Math.max(1, teachers)),
      };
    })
  );

  // 3. 按优先级排序（priority 降序）
  coursePriorities.sort((a, b) => b.priority - a.priority);

  // 4. 按优先级顺序排课
  const results = [];
  let totalAssigned = 0;
  let totalUnassigned = 0;
  let totalWarnings = 0;

  for (const { courseId, courseName } of coursePriorities) {
    try {
      const result = await autoArrange(
        courseId, semesterStr, mode, hourSettings, scheduleConditions, options,
      );
      results.push({ courseId, courseName, ...result });
      totalAssigned += result.autoCount;
      totalUnassigned += result.unassignedCount;
      if (result.warnings?.length) totalWarnings += result.warnings.length;
    } catch (e) {
      results.push({
        courseId,
        courseName,
        error: e.message,
        autoCount: 0,
        unassignedCount: 0,
      });
    }
  }

  return {
    semester: semesterStr,
    mode,
    preview: !!options.preview,
    courseResults: results,
    summary: {
      totalCourses: courses.length,
      successCount: results.filter(r => !r.error).length,
      errorCount: results.filter(r => r.error).length,
      totalAssigned,
      totalUnassigned,
      totalWarnings,
    },
  };
}
```

---

#### 建议 5：优化教材二次筛选性能

**目标**：将 O(n²) 的教材二次筛选优化为 O(n)。

**实现方案**：
```javascript
// 在 autoArrange 函数开始时，预计算每个班级的"学院+教材"匹配教师数量
const collegeTextbookMatchCount = new Map(); // classId -> count
for (const cls of classesToAssign) {
  const count = teacherConstraints.filter(t =>
    collegeEligible(t, cls) && isTextbookMatch(t, cls)
  ).length;
  collegeTextbookMatchCount.set(cls.classId, count);
}

// 修改 collegePairs 函数
const collegePairs = (t, cls) => {
  if (!collegeEligible(t, cls)) return false;
  if (cls.textbookIds?.length > 0) {
    const hasBetter = collegeTextbookMatchCount.get(cls.classId) > 0;
    if (hasBetter && !isTextbookMatch(t, cls)) return false;
  }
  return true;
};
```

---

#### 建议 6：增强未分配班级诊断信息

**目标**：提供更详细的诊断信息，帮助管理员理解为什么班级无法分配。

**实现方案**：
```javascript
function diagnoseFailure(cls, teacherConstraints, mode) {
  const allTeachers = teacherConstraints;
  if (allTeachers.length === 0) {
    return { reason: '没有可教此课程的教师', details: [] };
  }

  const details = [];

  // 检查容量约束
  const capFullTeachers = allTeachers.filter(t => {
    const cap = mode === 'standard' ? t.standardCap : t.fullCap;
    return t.assignedHours + cls.weeklyHours > cap;
  });
  if (capFullTeachers.length === allTeachers.length) {
    return {
      reason: '所有候选教师课时容量已满',
      details: capFullTeachers.map(t => ({
        teacherName: t.name,
        assignedHours: t.effectiveTotal + t.assignedHours,
        cap: mode === 'standard' ? t.standardCap : t.fullCap,
      })),
    };
  }

  // 检查本课程课时上限
  const courseLimitTeachers = allTeachers.filter(t =>
    t.defaultWeeklyHours != null &&
    t.courseExistingHours + t.assignedHours + cls.weeklyHours > t.defaultWeeklyHours
  );
  if (courseLimitTeachers.length === allTeachers.length) {
    return {
      reason: '所有候选教师本课程课时已达上限',
      details: courseLimitTeachers.map(t => ({
        teacherName: t.name,
        courseHours: t.courseExistingHours + t.assignedHours,
        limit: t.defaultWeeklyHours,
      })),
    };
  }

  // 检查资格筛选
  const eligibleTeachers = allTeachers.filter(t => isTeacherEligible(t, cls, mode));
  if (eligibleTeachers.length === 0) {
    return {
      reason: '无匹配的教师（学院/层次偏好筛选后无候选）',
      details: allTeachers.map(t => ({
        teacherName: t.name,
        collegeMatch: t.schedulingCollegeIds?.includes(cls.collegeId),
        levelMatch: t.schedulingLevelIds?.includes(cls.trainingLevelId),
        textbookMatch: isTextbookMatch(t, cls),
      })),
    };
  }

  return { reason: '未知原因', details: [] };
}
```

---

### 优先级 P2：可选优化

#### 建议 7：添加简单的回溯机制

**目标**：在关键场景下尝试重新分配，提升全局最优性。

**实现方案**（简单版本）：
```javascript
// 在 assignRound 函数中，如果分配失败，尝试"交换"已分配的班级
function assignRoundWithBacktrack(classList, eligibilityFilter = null) {
  const sorted = [...classList].sort((a, b) =>
    countEligibleTeachers(a, eligibilityFilter) - countEligibleTeachers(b, eligibilityFilter)
  );

  const remaining = [];
  for (const cls of sorted) {
    const candidates = teacherConstraints
      .filter(t => {
        if (eligibilityFilter && !eligibilityFilter(t, cls)) return false;
        return isTeacherEligible(t, cls, mode);
      })
      .map(t => ({
        teacher: t,
        score: calcMatchScore(t, cls),
        loadRate: (t.effectiveTotal + t.assignedHours) / Math.max(1, maxCap(t) + t.effectiveTotal),
        cls,
      }));

    if (candidates.length === 0) {
      // 尝试回溯：检查是否有已分配的班级可以重新分配给其他教师
      const swapped = trySwap(cls, assignments, teacherConstraints, mode);
      if (swapped) {
        // 交换成功，当前班级已分配
        continue;
      }
      remaining.push(cls);
      continue;
    }

    // 正常分配逻辑
    const selected = selectBestTeacher(candidates).teacher;
    selected.assignedHours += cls.weeklyHours;
    // ...
  }
  return remaining;
}

function trySwap(newCls, assignments, teacherConstraints, mode) {
  // 查找是否有已分配的班级可以重新分配给其他教师，为新班级腾出空间
  for (let i = assignments.length - 1; i >= 0; i--) {
    const existingAssignment = assignments[i];
    const existingTeacher = teacherConstraints.find(t => t.id === existingAssignment.teacher_id);
    const existingCls = { /* 从 assignments 中恢复班级信息 */ };

    // 检查是否有其他教师可以教 existingCls
    const alternativeTeachers = teacherConstraints.filter(t => {
      if (t.id === existingTeacher.id) return false;
      return isTeacherEligible(t, existingCls, mode);
    });

    if (alternativeTeachers.length > 0) {
      // 检查 existingTeacher 是否能教 newCls
      if (isTeacherEligible(existingTeacher, newCls, mode)) {
        // 执行交换
        const alternativeTeacher = selectBestTeacher(
          alternativeTeachers.map(t => ({
            teacher: t,
            score: calcMatchScore(t, existingCls),
            loadRate: (t.effectiveTotal + t.assignedHours) / Math.max(1, maxCap(t) + t.effectiveTotal),
            cls: existingCls,
          }))
        ).teacher;

        // 更新分配
        existingAssignment.teacher_id = alternativeTeacher.id;
        existingAssignment.teacher_name = alternativeTeacher.name;
        existingTeacher.assignedHours -= existingCls.weeklyHours;
        alternativeTeacher.assignedHours += existingCls.weeklyHours;
        existingTeacher.assignedHours += newCls.weeklyHours;

        assignments.push({
          teacher_id: existingTeacher.id,
          teacher_name: existingTeacher.name,
          class_id: newCls.classId,
          class_name: newCls.className,
          course_id: newCls.courseId,
          semester: newCls.semester,
          weekly_hours: newCls.weeklyHours,
          is_auto: true,
        });

        return true;
      }
    }
  }
  return false;
}
```

**注意**：回溯机制会增加算法复杂度，建议仅在预览模式或单课程排课时启用。

---

#### 建议 8：添加工作量平衡约束

**目标**：在同等匹配度下，优先分配给负荷率低的教师，避免 workload 不均。

**实现方案**：
```javascript
// 修改 selectBestTeacher 的排序逻辑
function selectBestTeacher(candidates) {
  const byScore = (a, b) => {
    // 优先按评分排序
    if (b.score !== a.score) return b.score - a.score;
    // 评分相同时，优先分配给负荷率低的教师
    return a.loadRate - b.loadRate;
  };

  // ... 现有的分层逻辑
}
```

**当前实现已包含此逻辑**，但可以进一步增强：
```javascript
// 添加"负荷率差异惩罚"：如果某教师的负荷率显著高于平均值，降低其优先级
const avgLoadRate = candidates.reduce((sum, c) => sum + c.loadRate, 0) / candidates.length;
const adjustedByScore = (a, b) => {
  const penaltyA = a.loadRate > avgLoadRate * 1.2 ? -1 : 0;
  const penaltyB = b.loadRate > avgLoadRate * 1.2 ? -1 : 0;
  const adjustedScoreA = a.score + penaltyA;
  const adjustedScoreB = b.score + penaltyB;
  if (adjustedScoreB !== adjustedScoreA) return adjustedScoreB - adjustedScoreA;
  return a.loadRate - b.loadRate;
};
```

---

#### 建议 9：添加预览模式统计信息

**目标**：在预览模式下提供更详细的统计信息，帮助管理员决策。

**实现方案**：
```javascript
function buildResult(assignments, unassigned, classesToAssign, manualCount, message, preview, warnings, teacherConstraints, mode) {
  const result = {
    assigned: assignments,
    unassigned: unassigned.map(c => ({
      classId: c.classId,
      className: c.className,
      weeklyHours: c.weeklyHours,
      reason: teacherConstraints ? diagnoseFailure(c, teacherConstraints, mode || 'standard') : undefined,
    })),
    totalClasses: classesToAssign?.length || 0,
    manualCount,
    autoCount: assignments.length,
    unassignedCount: unassigned.length,
    preview: !!preview,
    warnings: warnings || [],
  };

  // 预览模式下添加详细统计
  if (preview && teacherConstraints) {
    result.statistics = {
      // 教师负荷分布
      teacherWorkload: teacherConstraints.map(t => ({
        teacherId: t.id,
        teacherName: t.name,
        personnelType: t.personnelType,
        assignedHours: t.effectiveTotal + t.assignedHours,
        standardCap: t.standardCap,
        fullCap: t.fullCap,
        loadRate: (t.effectiveTotal + t.assignedHours) / Math.max(1, (mode === 'standard' ? t.standardCap : t.fullCap) + t.effectiveTotal),
        classCount: assignments.filter(a => a.teacher_id === t.id).length,
      })),
      // 学院匹配率
      collegeMatchRate: calcCollegeMatchRate(assignments, classesToAssign, teacherConstraints),
      // 教材匹配率
      textbookMatchRate: calcTextbookMatchRate(assignments, classesToAssign, teacherConstraints),
    };
  }

  if (message) result.message = message;
  return result;
}

function calcCollegeMatchRate(assignments, classes, teachers) {
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const classMap = new Map(classes.map(c => [c.classId, c]));
  
  let matched = 0;
  for (const a of assignments) {
    const teacher = teacherMap.get(a.teacher_id);
    const cls = classMap.get(a.class_id);
    if (teacher?.schedulingCollegeIds?.includes(cls.collegeId)) {
      matched++;
    }
  }
  return assignments.length > 0 ? (matched / assignments.length) : 0;
}

function calcTextbookMatchRate(assignments, classes, teachers) {
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const classMap = new Map(classes.map(c => [c.classId, c]));
  
  let matched = 0;
  for (const a of assignments) {
    const teacher = teacherMap.get(a.teacher_id);
    const cls = classMap.get(a.class_id);
    if (teacher?.textbookIds?.length && cls.textbookIds?.length) {
      if (teacher.textbookIds.some(tid => cls.textbookIds.includes(tid))) {
        matched++;
      }
    }
  }
  return assignments.length > 0 ? (matched / assignments.length) : 0;
}
```

---

## 三、总结

### 问题严重程度分级

| 问题 | 严重程度 | 优先级 | 影响范围 |
|------|:--------:|:------:|---------|
| 贪心算法无回溯 | 高 | P2 | 教师资源紧张时 |
| 批量排课顺序依赖 | 中 | P1 | 批量排课场景 |
| 课时设置默认值硬编码 | 中 | P0 | 所有排课场景 |
| 课时设置无验证 | 低 | P0 | 异常输入场景 |
| 学期解析过于严格 | 低 | P1 | 暑期学期场景 |
| 容量预检不精确 | 低 | P2 | 复杂约束场景 |
| 教材二次筛选性能 | 中 | P1 | 大规模数据场景 |
| 教师教材数据查询冗余 | 低 | P2 | 大规模数据场景 |
| 未分配班级诊断不详细 | 低 | P1 | 用户体验 |
| 预览模式缺少统计 | 低 | P2 | 用户体验 |

### 实施建议

**阶段一（立即）**：
- 修复课时设置加载逻辑（建议 1）
- 添加课时设置验证（建议 2）

**阶段二（短期）**：
- 支持暑期学期（建议 3）
- 优化批量排课顺序（建议 4）
- 优化教材二次筛选性能（建议 5）
- 增强未分配班级诊断信息（建议 6）

**阶段三（长期）**：
- 添加简单的回溯机制（建议 7）
- 添加工作量平衡约束（建议 8）
- 添加预览模式统计信息（建议 9）

---

*文档版本：v1.0 | 最后更新：2026-06-19*
