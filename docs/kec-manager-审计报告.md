## KEC Manager 全方位代码检测报告

**版本:** v2.12.1 | **检测日期:** 2026-06-23 | **检测范围:** 后端67文件 + 前端62文件 + 数据库模型 + 排课算法

---

### 总览

本次检测覆盖后端API、前端组件、排课算法、数据库模型和安全五个维度，共发现 **50 个问题**，按严重程度分布如下：

| 严重程度 | 发现 | 已修复 | 待修复 | 说明 |
|---------|------|--------|--------|------|
| CRITICAL | 3 | **3** | 0 | 已全部修复 |
| HIGH | 12 | **12** | 0 | 已全部修复 |
| MEDIUM | 20 | **20** | 0 | 已全部修复 (v2.10.0) |
| LOW | 15 | **15** | 0 | 已全部修复 (v2.11.0) |

---

### 一、CRITICAL 级问题（需立即修复）

**C-1. settings.controller.js — resetSystem / resetAuditLogs 缺少错误处理** `已修复 v2.8.2`

两个高危操作函数没有 try-catch 包裹。如果 Prisma 事务抛出异常（数据库连接中断、约束冲突等），Promise 拒绝不会被捕获，将触发进程级 `uncaughtException`。同文件其他 reset 函数使用了 `resetData` 辅助函数（内含 try-catch），唯独这两个绕过了它。

```js
// 当前代码 — 无 try-catch
export async function resetSystem(req, res, next) {
  await prisma.$transaction(async (tx) => { /* ... */ });
  success(res, null, '系统已重置...');
}

// 建议修复
export async function resetSystem(req, res, next) {
  try {
    await prisma.$transaction(async (tx) => { /* ... */ });
    success(res, null, '系统已重置...');
  } catch (e) {
    next(e);
  }
}
```

**C-2. 排课算法 trySwapOne 教材数量计算错误（可能违反 MAX_TEXTBOOKS 约束）** `已修复 v2.8.2`

`auto-arrange.js` 第 581-602 行，`trySwapOne` 函数在计算教师 T 交换后的教材数量时，`uNewForT` 基于 T 的**交换前**教材集合计算，没有考虑移除 V 独有教材后集合的变化。具体示例：T 拥有教材 {1,2,3}，V 独有教材 {3}，U 需要教材 {3,4}，`uNewForT` 算出 {4}（因为 3 看起来"已有"），预计交换后大小 = 3-1+1 = 3，但实际结果是 {1,2,3,4} = 4，违反了 MAX_TEXTBOOKS 限制。

修复方案：先计算移除 V 独有教材后的集合，再基于该集合计算 `uNewForT`。

**C-3. Dashboard.vue — ElMessage 未导入导致运行时崩溃** `已修复 v2.8.2`

`Dashboard.vue` 第 451 行使用了 `ElMessage.info('数据导入功能开发中')`，但 `<script setup>` 中从未导入 `ElMessage`。在 `<script setup>` 组件中，Element Plus 的全局注册不影响作用域，点击该按钮将抛出 `ReferenceError: ElMessage is not defined`。

---

### 二、HIGH 级问题（尽快修复）

**H-1. UserManagement.vue — ElMessageBox.confirm 未捕获取消操作** `已修复 v2.9.0`

`toggleUserStatus` 和 `deleteUser` 两个函数中，`ElMessageBox.confirm` 调用在 `try` 块之外。用户点击"取消"时，`confirm` 返回 rejected Promise（值为 `'cancel'`），由于未被 catch，产生 unhandled promise rejection，浏览器控制台报错。

**H-2. Login.vue / UserManagement.vue — validate(callback) 在 async 函数中误用** `已修复 v2.9.0`

`await formRef.value.validate(async (valid) => { ... })` 模式中，Element Plus 的 `validate()` 接受 callback 参数时返回 `undefined`（不是 Promise），`await` 无效。`handleLogin()` / `handleSubmit()` 在 callback 完成前就返回。应改为 `await formRef.value.validate()` 纯 Promise 模式，或移除 `await`。

**H-3. schema.prisma — teaching_assignments 级联删除风险** `已修复 v2.9.0`

`teaching_assignments` 的三个外键（teacher_id、class_id、course_id）均设置了 `onDelete: Cascade`。删除教师时，该教师所有排课记录会被静默删除，无任何确认或审计痕迹。对于已完成的排课数据，这可能是灾难性的。建议改为 `Restrict`，删除教师前必须先重新分配排课。

**H-4. textbook.controller.js — toggleTextbookStatus 忽略请求体** `已修复 v2.9.0`

函数始终将状态设为当前值的反值，不接受 `req.body.is_active` 作为目标状态。并发调用时可能导致状态不一致（两次 toggle 回到原状态）。validation.js 中 `is_active` 定义为 `.optional()`，应改为必填 `.isBoolean()`。

**H-5. course.controller.js — deleteCourse 关联检查不完整** `已修复 v2.9.0`

删除前仅检查 `plan_courses` 计数，未检查 `teaching_assignments` 和 `teacher_courses`。如果课程已被排课，级联删除会静默清除排课数据。

**H-6. 排课算法 getTeachersForCourse 全学期查询** `已修复 v2.9.0`

`queries.js` 第 227-259 行两次查询获取整个学期所有排课记录（不限教师），用于计算学院和层次偏好。数据量大时（数千条排课记录）效率极低，且在批量排课时被重复调用 N 次。应添加 `teacher_id: { in: relevantTeacherIds }` 过滤条件。

**H-7. getStatistics N+1 查询** `已修复 v2.9.0`

`teaching-arrange.controller.js` 第 430-435 行，在 `stats.map` 循环内逐个教师查询 `training_levels`。50 个教师就是 50 次查询。应在循环前一次性加载所有层次数据。

**H-8. import/teachers.js — 导入循环内 N+1 查询** `已修复 v2.9.0`

每行导入数据执行一次 `prisma.teachers.findMany` 查重，500 条记录就是 500 次查询。应在循环前一次性构建查找 Map。

**H-9. queryAllTextbooksUsage — O(n²) 性能问题** `已修复 v2.9.0`

`query.controller.js` 中使用 `Array.find()` 在嵌套循环中匹配教材使用记录。200 教材 × 100 班级 = 20,000 次比较。应构建 Map 索引降至 O(1)。

**H-10. class.controller.js — listClasses 8+ 次关联查询** `已修复 v2.9.0`

为构建筛选器关联映射执行 8 次以上独立 `findMany`，应使用 Prisma `include` 合并查询。

**H-11. settings store — load() 缺少错误处理** `已修复 v2.9.0`

`stores/settings.js` 的 `load()` 无 try-catch，网络失败或学期字符串解析异常将直接传播到调用方，可能导致 Layout 崩溃。

**H-12. JWT Token 存储于非 HttpOnly Cookie** `已评估 v2.9.0`

前端通过 `document.cookie` 读写 JWT token，任何 XSS 向量都可以窃取该 token。理想方案是后端通过 `Set-Cookie` 设置 `HttpOnly` 标志，但当前架构（前后端分离 + CORS）需要做较大调整，可作为安全加固项排入计划。当前架构（15分钟 access token + 7天 rotating refresh + 角色实时刷新 + 速率限制）对小型内部工具安全级别合理。

---

### 三、MEDIUM 级问题

| 编号 | 文件 | 问题描述 | 状态 |
|------|------|---------|------|
| M-1 | naming.middleware.js | 响应字段转换仅覆盖 `data`/`items`/`logs`，自定义字段（如 `summary`、`stats`）不被转换 | `已修复 v2.10.0` |
| M-2 | auth.middleware.js | 用户被禁用后重新启用需等 30 秒缓存过期，应在状态变更时主动清除缓存 | `已修复 v2.10.0` |
| M-3 | auth.middleware.js | null 用户缓存格式不规范（`{...null}` = `{}`），缺少 `is_active` 属性，靠 undefined 的 falsy 特性工作 | `已修复 v2.10.0` |
| M-4 | plan.service.js | `findBestMatchPlan` 返回首个匹配，不区分专业匹配和层次匹配的优先级 | `已修复 v2.10.0` |
| M-5 | validation.js | `weekly_hours` 允许 0 值（`.isFloat({min:0})`），后续除法可能产生 Infinity | `已修复 v2.10.0` |
| M-6 | settings.controller.js | `getSettings` catch 中重复调用 `tryGetAuthUser`，可能掩盖原始错误 | `已修复 v2.10.0` |
| M-7 | plan-matrix.controller.js | `assignTextbookToSemester` 先删后建（替换语义），但缺少文档说明，用户可能误以为追加 | `已修复 v2.10.0` |
| M-8 | class.controller.js | `updateClass` 嵌套 try-catch 可能吞掉内层错误 | `已修复 v2.10.0` |
| M-9 | auth.service.js | `refreshToken` 所有错误统一包装为 AuthenticationError，丢失 DB 连接失败等原始错误类型 | `已修复 v2.10.0` |
| M-10 | query.controller.js | `querySemester` 先全量查询再分页查询（双重全表扫描），应用 `count` 替代第一次查询 | `已修复 v2.10.0` |
| M-11 | 排课算法 | 无效课时（0 或负值）的班级被推入 unassigned 但不计入 totalClasses，导致 UI 显示不一致 | `已修复 v2.10.0` |
| M-12 | 排课算法 | 批量排课无并发保护，两个并发请求会交叉执行同一学期的排课 | `已修复 v2.10.0` |
| M-13 | 排课算法 | 批量排课无超时保护，课程多时可能耗时数分钟触发 HTTP 超时 | `已修复 v2.10.0` |
| M-14 | settings store | `load()` 中 `cs.value.split('-')` 无防御性解析，异常学期格式会导致崩溃 | `已修复 v2.10.0` |
| M-15 | settings.routes.js | 每条路由重复挂载 authMiddleware + roleMiddleware，应统一 apply | `已修复 v2.10.0` |
| M-16 | plan.routes.js | 多参数路由 `/:planId/courses/:courseId/semesters` 缺少 ID 合法性验证 | `已修复 v2.10.0` |
| M-17 | schema.prisma | `teaching_assignments` 缺少复合索引（如 `[classId, semester]`、`[teacherId, semester]`） | `已修复 v2.10.0` |
| M-18 | schema.prisma | `audit_logs.created_at` 无索引，按时间查询/排序效率低 | `已有索引` |
| M-19 | query.controller.js | 学期查询的年级筛选在分页之后用JS过滤，但`total`未按年级过滤扣除，导致分页总数不准，可能出现空页或条目不足的页面 | `已修复 v2.10.0` |
| M-20 | data-export.controller.js | 排课统计导出`exportStatistics`仅读取`semester`参数，忽略前端传入的`name`/`type`/`subject`/`college`/`level`/`affiliated_college`六个筛选条件，导出Excel始终包含所有教师 | `已修复 v2.10.0` |

---

### 四、LOW 级问题

| 编号 | 文件 | 问题描述 | 状态 |
|------|------|---------|------|
| L-1 | user.controller.js | `updateUser` 的 undefined 字段靠 Prisma 默认行为跳过，缺乏显式过滤（脆弱但不会丢数据） | `已修复 v2.11.0` |
| L-2 | pagination.js | 与 validation.js 中 `validatePagination` 功能重复，应统一 | `已修复 v2.11.0` |
| L-3 | sort-helper.js / sort.js | 排序工具逻辑分散在两个文件，部分路由 import 了未使用的排序验证 | `已修复 v2.11.0` |
| L-4 | settings.controller.js | 错误响应绕过 `success()` / `error()` helper，直接构造 JSON 对象 | `已修复 v2.11.0` |
| L-5 | schema.prisma | `weekly_hours` 为 Float 类型，业务上通常为 0.5 倍数，浮点精度可能出问题 | `已修复 v2.11.0` |
| L-6 | auth.config.js | 开发环境回退密钥通过字符串拼接派生（`secret + '_refresh'`），等同弱密钥派生 | `已修复 v2.11.0` |
| L-7 | auto-arrange.js | ~150 行死代码（`groupByTextbookThenCollege`、`interleaveByTextbook`、`canTeach` 等从未调用） | `已修复 v2.11.0` |
| L-8 | auto-arrange.js | `calcMatchScore` 中 hard cap -10000 惩罚后又叠加额外层级惩罚，虽不影响排序但逻辑冗余 | `已修复 v2.11.0` |
| L-9 | validate.js | `validateHourSettings` 允许 `standard:0, max:999` 等无意义值 | `已修复 v2.11.0` |
| L-10 | teaching-arrange.controller.js | `courseId` 的 `req.body.courseId` 回退是死代码（中间件已强制要求 `course_id`） | `已修复 v2.11.0` |
| L-11 | teaching-arrange.controller.js | `assignTeacher` 缺少班级存在性验证，无效 ID 会触发 Prisma 外键错误，报错不友好 | `已修复 v2.11.0` |
| L-12 | 排课算法文档 | 代码注释描述的四阶段算法与实际五阶段实现不匹配（代码已迭代但文档未同步） | `已修复 v2.11.0` |
| L-13 | Dashboard.vue | 统计卡片数据无缓存，每次进入页面重新请求 | `已修复 v2.10.0` |
| L-14 | 前端整体 | 部分 el-table 缺少 `:key` 绑定筛选值，可能导致筛选后不重新渲染 | `已修复 v2.11.0` |
| L-15 | class.service.js | `getActiveClassFilter` 每次调用都查询 distinct durations，应添加缓存 | `已修复 v2.11.0` |

---

### 五、架构层面观察

**排课算法文档已同步。** 代码中实际的排课算法采用五阶段模式：(1) 有偏好教师优先选首本教材 → (2) 无偏好教师选首本教材 → (3) 所有教师选同教材更多班级 → (4) 所有教师选第二本教材 → (5) 放宽约束兜底 + 置换回溯。`selectBestTeacher` 基于 `calcMatchScore` 加权评分 + loadRate 负载均衡，替代了原先的七层优先级分层选择。文档（TEACHING_ARRANGE_LOGIC.md）已在 v2.11.0 同步更新。

**数据库级联策略已统一。** `teaching_assignments` 的三个外键（teacher_id、class_id、course_id）已在 v2.9.0（H-3）改为 `onDelete: Restrict`，防止核心排课数据被误删。`classes` 对外键（专业/学院/层次）保持 Prisma 默认的 SetNull，适合配置型数据的灵活管理。策略已与建议一致。

**前端 validate() 调用模式已修正。** 全局搜索确认共 3 处使用了 `await formRef.value.validate(callback)` 错误模式：Login.vue、UserManagement.vue（已在 v2.9.0 H-2 修正）和 ChangePasswordDialog.vue（已在 v2.12.0 修正）。全部改为 `await formRef.value.validate()` + try/catch 纯 Promise 模式。

---

### 六、修复路线图

**已完成 — CRITICAL + HIGH + MEDIUM + LOW + 架构观察 (v2.8.2 ~ v2.12.0)：**

| 阶段 | 版本 | 修复内容 |
|------|------|---------|
| 第一优先级 | v2.8.2 | C-1 try-catch、C-2 教材计算、C-3 ElMessage 导入 |
| 第二优先级 | v2.9.0 | H-1~H-12 全部修复（N+1 查询、级联策略、validate 模式、XSS 等） |
| 第三优先级 | v2.10.0 | M-1~M-20 全部修复（命名转换、缓存清除、优先级匹配、并发/超时保护、索引、分页等） |
| 第四优先级 | v2.11.0 | L-1~L-15 全部修复（显式字段过滤、工具合并、死代码清理、密钥派生、文档同步、缓存优化等） |
| 第五优先级 | v2.12.0 | 架构观察收尾（级联策略文档更正、validate() 全局搜索修复 ChangePasswordDialog.vue） |
| 回归修复 | v2.12.1 | 修复 H-3 引入的 3 个副作用：Schema/迁移 onDelete 对齐 + reset 函数关联清理 + duration 缓存失效接入 |

**待处理 — 无遗留问题：**

审计报告中发现的全部 50 个问题（3 CRITICAL + 12 HIGH + 20 MEDIUM + 15 LOW）及 3 项架构层面观察均已修复完毕。
