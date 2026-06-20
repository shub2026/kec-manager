# 新排课算法快速测试指南

> 日期：2026-06-20  
> 版本：v2.0

---

## 一、服务状态确认

### ✅ 后端服务
- **状态**：运行中
- **地址**：http://localhost:3001
- **自动重启**：已启用（`--watch-path=src`）
- **新代码加载**：✅ 已确认

### ✅ 前端服务
- **状态**：运行中
- **地址**：http://localhost:5176

---

## 二、测试步骤

### 步骤1：登录系统

1. 打开浏览器访问：http://localhost:5176
2. 使用管理员账号登录

### 步骤2：进入教学安排页面

1. 点击左侧菜单"教学安排"
2. 选择要测试的课程（建议选择有多个班级和教师的课程）
3. 选择学期（如：2025-2026-1）

### 步骤3：预览排课结果

1. 点击"自动排课"按钮
2. 选择排课模式：
   - **标准模式**：教师课时不超过标准课时
   - **全量模式**：教师课时可达到最大课时
3. **勾选"预览模式"**（重要！先预览再正式排课）
4. 点击"开始排课"

### 步骤4：检查日志输出

打开浏览器控制台（F12），查看Network标签中的排课API响应，或者查看后端日志。

**预期日志输出**：

```
[TEXTBOOK_COHESION] v2024-06-20-REWRITE autoArrange 入口 courseId=X semester=2025-2026-1 mode=standard

========== 排课诊断 ==========
课程ID=X 学期=2025-2026-1 模式=standard
教师数=Y 班级数=Z
--- 班级教材分布 ---
  教材[1,2]: 5个班 → 班级A, 班级B, ...
  教材[3]: 3个班 → 班级C, 班级D, ...
--- 教师初始状态 ---
  教师A: inherentTextbookIds=[1,2] effectiveTotal=4 standardCap=12 fullCap=16 defaultWeeklyHours=null
  教师B: inherentTextbookIds=[] effectiveTotal=0 standardCap=16 fullCap=20 defaultWeeklyHours=null
================================

[手动排课追踪] N 条手动排课，教师教材已更新
[新分配算法v2] 共 M 个教材组，开始分配...
  教材组 1,2: 5 个班级
  教材组 3: 3 个班级
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
[兜底] 剩余 0 个班级，用 assignRound 放宽约束
[新分配算法v2] 完成，总分配 X，未分配 0

--- 最终教师教材分布 ---
  教师A: 1本 [1,2] 班级数=3
  教师B: 1本 [3] 班级数=2
--- 教材数统计 ---
  1本教材: 2位教师
  2本教材: 0位教师
========== 诊断结束 ==========
```

**关键检查点**：
1. ✅ 看到 `[新分配算法v2]` 标识
2. ✅ 看到 `[阶段1]` 到 `[阶段4]` 的完整流程
3. ✅ 每个阶段的剩余班级数逐渐减少
4. ✅ 最终未分配班级数为0或接近0
5. ✅ 大部分教师只持有1-2本教材

### 步骤5：检查排课结果统计数据

在预览模式的返回结果中，检查 `statistics` 字段：

```javascript
{
  statistics: {
    textbookCohesionRate: 85,      // 教材内聚度（目标>80%）
    avgTextbookPerTeacher: 1.5,    // 平均每教师教材数（目标<2）
    scatteredTeacherCount: 0,      // 分散教师数（目标=0）
    collegeMatchRate: 90,          // 学院匹配率（越高越好）
    levelMatchRate: 85,            // 层次匹配率（越高越好）
  }
}
```

**达标标准**：
- ✅ `textbookCohesionRate` > 80%
- ✅ `avgTextbookPerTeacher` < 2
- ✅ `scatteredTeacherCount` = 0
- ✅ `collegeMatchRate` > 85%
- ✅ `levelMatchRate` > 80%

### 步骤6：验证意向约束

选择一个有指定意向的教师，检查其分配的班级：

**SQL查询**：
```sql
-- 查看某教师分配的班级和学院
SELECT 
  ta.teacher_id,
  t.name as teacher_name,
  ta.class_id,
  c.name as class_name,
  cl.id as college_id,
  cl.name as college_name,
  tl.id as level_id,
  tl.name as level_name
FROM teaching_assignments ta
JOIN teachers t ON ta.teacher_id = t.id
JOIN classes c ON ta.class_id = c.id
JOIN colleges cl ON c.college_id = cl.id
LEFT JOIN training_levels tl ON c.training_level_id = tl.id
WHERE ta.teacher_id = <教师ID> 
  AND ta.course_id = <课程ID>
  AND ta.semester = '2025-2026-1';
```

**检查点**：
1. ✅ 如果教师指定了意向学院，所有分配的班级都应该属于该学院
2. ✅ 如果教师指定了意向层次，所有分配的班级都应该属于该层次

### 步骤7：验证教材内聚

**SQL查询**：
```sql
-- 查看某教师分配的班级和教材
SELECT 
  ta.teacher_id,
  t.name as teacher_name,
  ta.class_id,
  c.name as class_name,
  txt.id as textbook_id,
  txt.title as textbook_title
FROM teaching_assignments ta
JOIN teachers t ON ta.teacher_id = t.id
JOIN classes c ON ta.class_id = c.id
JOIN plan_courses pc ON pc.course_id = ta.course_id
JOIN plan_course_semesters pcs ON pcs.plan_course_id = pc.id
JOIN plan_textbooks pt ON pt.plan_course_semester_id = pcs.id
JOIN textbooks txt ON pt.textbook_id = txt.id
WHERE ta.teacher_id = <教师ID> 
  AND ta.course_id = <课程ID>
  AND ta.semester = '2025-2026-1'
ORDER BY txt.id;
```

**检查点**：
1. ✅ 大部分教师只持有1-2本教材
2. ✅ 没有教师持有3本或以上教材（除非特殊情况）
3. ✅ 同教材的班级尽量分配给同一教师

### 步骤8：正式排课

如果预览结果满意：

1. 取消勾选"预览模式"
2. 点击"开始排课"
3. 等待排课完成
4. 查看排课结果

---

## 三、常见问题排查

### Q1：预览模式看不到详细日志？

**解决方法**：
1. 打开浏览器开发者工具（F12）
2. 切换到 Network 标签
3. 找到 `/api/teaching-arrange/auto-arrange` 请求
4. 查看 Response 中的 `statistics` 字段

### Q2：后端日志在哪里查看？

**位置**：`server/logs/combined.log` 或 `server/logs/audit.log`

**实时查看**：
```powershell
Get-Content server/logs/combined.log -Wait -Tail 50
```

### Q3：排课结果不符合预期？

**排查步骤**：
1. 检查教师的意向设置是否正确
2. 检查班级的学院和层次是否正确
3. 检查教材关联是否正确
4. 检查教师的课时容量是否充足
5. 查看日志中的诊断信息

### Q4：有大量班级未分配？

**可能原因**：
1. 教师数量不足
2. 教师课时容量已满
3. 教师意向与班级不匹配
4. 教师教材与班级不匹配

**解决方法**：
1. 增加教师数量
2. 提高课时容量设置
3. 调整教师意向设置
4. 检查教材关联

---

## 四、性能测试

### 测试场景

| 场景 | 班级数 | 教师数 | 预期耗时 |
|------|--------|--------|---------|
| 小规模 | < 20 | < 10 | < 1秒 |
| 中规模 | 20-50 | 10-20 | 1-3秒 |
| 大规模 | 50-100 | 20-40 | 3-10秒 |
| 超大规模 | > 100 | > 40 | 10-30秒 |

### 优化建议

如果排课耗时过长：

1. **分批排课**：按学院或层次分批排课
2. **单课程排课**：避免批量排课
3. **降低日志级别**：生产环境使用 `logger.debug` 代替 `logger.info`

---

## 五、回滚方案

如果新算法出现问题，可以快速回滚：

### 方法1：临时禁用新算法

在 `constants/index.js` 中设置：

```javascript
export const TEXTBOOK_COHESION = {
  ENABLED: false,  // 临时禁用
  // ... 其他配置
};
```

### 方法2：恢复旧代码

从Git恢复旧版本：

```bash
git checkout HEAD~1 -- server/src/services/teaching-arrange.service.js
```

然后重启服务。

---

## 六、反馈收集

测试完成后，请记录以下信息：

1. **测试课程**：课程名称、班级数、教师数
2. **排课模式**：标准模式 / 全量模式
3. **排课结果**：
   - 分配班级数
   - 未分配班级数
   - 教材内聚度
   - 平均教材数
4. **问题反馈**：
   - 是否符合预期
   - 有哪些问题
   - 改进建议

---

*测试指南版本：v1.0 | 最后更新：2026-06-20*
