## KEC Manager v2.12.1 二次全面检查报告

**检查日期:** 2026-06-23 | **检查范围:** 后端 80+ 文件 + 前端 58 文件 + 数据库 Schema + 排课算法 | **基线版本:** v2.12.0 → v2.12.1

---

### 总览

在 50 项审计问题 + 3 项架构观察全部修复后，对 v2.12.0 进行全维度二次检查。本次检查发现 **25 个新问题**，按严重程度分布如下：

| 严重程度 | 数量 | 说明 |
|---------|------|------|
| CRITICAL | 3 | 数据完整性风险，需立即修复 |
| HIGH | 4 | 功能缺陷或安全隐患 |
| MEDIUM | 8 | 性能/健壮性问题 |
| LOW | 10 | 代码质量/一致性问题 |

---

### 一、CRITICAL 级问题（3 项）

**C-1. schema.prisma — 8+ 处 onDelete 与迁移 SQL 不一致** `已修复 v2.12.1`

Prisma Schema 中多处外键的 `onDelete` 声明与实际数据库迁移 SQL 不一致，导致 Prisma Client 的运行时行为预期与数据库实际行为矛盾：

| 关系 | Schema（Prisma 默认） | 迁移 SQL（实际 DB） | 影响 |
|------|----------------------|---------------------|------|
| `teaching_assignments.teacher_id` | Restrict（显式声明） | CASCADE | Schema 说阻止删除，DB 实际级联删除 |
| `teaching_assignments.class_id` | Restrict（显式声明） | CASCADE | 同上 |
| `teaching_assignments.course_id` | Restrict（显式声明） | CASCADE | 同上 |
| `classes.major_id` | Restrict（默认） | SET NULL | Schema 说阻止删除，DB 实际置空 |
| `classes.college_id` | Restrict（默认） | SET NULL | 同上 |
| `classes.training_level_id` | Restrict（默认） | SET NULL | 同上 |
| `classes.custom_plan_id` | Restrict（默认） | SET NULL | 同上 |
| `audit_logs.operator_id` | Restrict（默认） | SET NULL | 同上 |

**风险：** 若执行 `prisma migrate dev`，Prisma 可能尝试重建外键约束以匹配 Schema，导致生产数据丢失。`teaching_assignments` 的 Restrict 在 v2.9.0（H-3）中修复了 Schema 但未同步迁移 SQL。

**建议修复：** 在 Schema 中显式声明所有外键的 `onDelete`，使其与迁移 SQL 一致；或创建新迁移统一 DB 行为。

---

**C-2. auto-arrange.js — 单课程 autoArrange 无并发锁**

`batch.js` 有 `batchLocks` 并发保护，但 `autoArrange`（单课程排课）无任何锁机制。两个并发请求对同一课程+学期排课时：

1. 两个请求读取相同的初始状态
2. 各自独立计算分配方案
3. 先后进入 Prisma 事务
4. TX1 删除旧自动分配 → 创建新分配
5. TX2 删除旧分配（已被 TX1 删除）→ 创建自己的分配 → 可能产生唯一约束冲突或重复数据

**建议修复：** 为 `autoArrange` 添加与 `batch.js` 类似的内存锁，或复用 `batchLocks`。

---

**C-3. auto-arrange.js — calcMatchScore 中教材惩罚死代码（105-109 行）**

```js
// Line 85: if (tbCount >= maxTb)  →  捕获 tbCount >= 2（因为 maxTb=2）
// Line 94: else if (tbCount === 0)  →  捕获 0
// Line 96: else if (tbCount === 1)  →  捕获 1
// Line 105: else if (tbCount >= 3)  →  永远不可达！已被 Line 85 捕获
// Line 107: else if (tbCount >= 2)  →  永远不可达！已被 Line 85 捕获
```

常量 `TEXTBOOK_COHESION.TEXTBOOK_COUNT_PENALTY_3PLUS`（150）和 `TEXTBOOK_COUNT_PENALTY_2`（20）**永远不会被应用**。原本设计的分级惩罚体系（2 本扣 20 分、3+ 本扣 150 分）实际失效，所有 >= 2 本的情况统一走 Line 85-93 的逻辑。

**建议修复：** 重构条件分支，使分级惩罚正确生效。

---

### 二、HIGH 级问题（4 项）

**H-1. settings.controller.js — resetClasses/resetCourses/resetBasic 缺少关联清理** `已修复 v2.12.1`

`resetClasses`（296-306 行）仅执行 `tx.classes.deleteMany()`，未先清理 `teaching_assignments`。对比 `resetTeachers`（308-322 行）正确地先删除 `teaching_assignments`。

同理，`resetCourses`（268-281 行）删除了 `plan_courses` 但未清理 `teaching_assignments`。

**当前实际行为：** 由于迁移 SQL 中 `teaching_assignments` 使用 `ON DELETE CASCADE`，数据库会级联删除。但这与 Schema 声明的 `Restrict` 矛盾（见 C-1），且依赖隐式级联是脆弱的。

**建议修复：** 显式在 reset 函数中先删除 `teaching_assignments`，与 `resetTeachers` 保持一致。

---

**H-2. 用户创建时不校验密码复杂度**

`PASSWORD_POLICY.REGEX`（`constants/index.js:39`）定义了复杂密码规则（大小写 + 数字 + 特殊字符），但**从未被任何文件导入使用**。

- `validateChangePassword`（`validation.js:114`）：修改密码时有复杂度校验 ✓
- `validateUser`（`validation.js:218-221`）：创建用户时**仅检查长度** ✗

管理员创建用户时可设置 `12345678` 这样的弱密码。

**建议修复：** 在 `validateUser` 的 `password` 规则中添加 `.matches()` 校验，或导入 `PASSWORD_POLICY.REGEX`。

---

**H-3. auto-arrange.js — 生产环境过度诊断日志**

当 `TEXTBOOK_COHESION.ENABLED = true`（默认开启）时，算法在每次排课时输出大量诊断信息（636-660 行、1145-1161 行），包括每位教师状态、教材分组分布、最终逐人明细。批量排课时，这些日志按课程数倍增，可能产生数千行日志。

**建议修复：** 将诊断日志置于 `DEBUG` 级别或增加 `verbose` 开关。

---

**H-4. teaching-arrange.controller.js — assignTeacher 中无效的 include 条件**

```js
// Line 145
include: { plan_course_semesters: { where: { semester: null } } }
```

过滤 `semester IS NULL` 的记录几乎肯定是 bug——应过滤实际学期或不过滤。当前因 `pc?.weekly_hours` 读取的是 `plan_courses` 记录本身而非学期记录，所以功能不受影响，但 include 是无效开销。

**建议修复：** 移除 `where: { semester: null }` 或替换为正确的学期过滤。

---

### 三、MEDIUM 级问题（8 项）

| 编号 | 文件 | 问题描述 |
|------|------|---------|
| M-1 | vite.config.js:46 | 开发代理目标 `localhost:3002`，但服务端默认端口 `3000`，开发者需手动设置 PORT 才能联调 |
| M-2 | auth.config.js:53-55 | `jwtExpiresIn` / `jwtRefreshExpiresIn` 硬编码，`.env.production.example` 中定义的 `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` 从未被读取 |
| M-3 | .env.example | 缺少 `DATABASE_URL`、`PORT`、`NODE_ENV` 等关键变量定义 |
| M-4 | schema.prisma:165 | `textbooks.price` 使用 `Float` 存储金额，IEEE 754 浮点精度可能导致舍入误差 |
| M-5 | auto-arrange.js:1210-1212 | 事务内 `alreadyWritten` 计算为 O(A²)，应用累加 Map 优化为 O(A) |
| M-6 | queries.js:229+248 | `teacherAssignmentsWithCollege` 和 `teacherAssignmentsWithLevel` 查询同一张表两次，应合并为一次查询 |
| M-7 | batch.js:8 | 内存级 `batchLocks` 在多进程部署（PM2 cluster / 多容器）中无效，需 Redis 或 DB 级锁 |
| M-8 | auth.middleware.js:49 | 下载令牌通过 URL 查询参数传递（`?downloadToken=xxx`），会被 Web 服务器日志、浏览器历史、Referer 头泄露 |

---

### 四、LOW 级问题（10 项）

| 编号 | 文件 | 问题描述 |
|------|------|---------|
| L-1 | 6 个 routes 文件 | `validateSortOrder` 被导入但从未使用（plan/trainingLevel/textbook/course/major/college） |
| L-2 | class.service.js:8 | `invalidateDurationCache()` 已导出但无文件导入 | `已修复 v2.12.1` |
| L-3 | naming.js:74,90 | `shallowSnakeToCamel()` / `shallowCamelToSnake()` 已导出但无文件导入 |
| L-4 | naming.middleware.js:64 | `autoConvertNaming()` 已导出但无文件导入 |
| L-5 | app.js:59 | CORS 允许无 Origin 头的请求通过，弱化 CSRF 保护 |
| L-6 | validation-audit.js:8 | 审计日志重置 `confirm` 为 optional，空 `{}` 即可通过验证（对比系统重置要求必填） |
| L-7 | auth.routes.js:81 | `/logout` 端点无速率限制 |
| L-8 | schema.prisma | `teachers.status` 无索引，按在职/离职状态筛选时效率低 |
| L-9 | constants/index.js:33 | `DEFAULT_SEMESTER = '2025-2026-2'` 硬编码，每学期需手动更新 |
| L-10 | CourseMatrix.vue:216 | 批量更新学期周时 `.catch(() => {})` 静默吞掉失败，用户看到成功提示但部分数据可能未更新 |

---

### 五、正面评价

以下方面表现良好，无需修改：

- **安全基线扎实：** Helmet 启用、XSS 过滤、公式注入防护、参数化查询、文件上传校验、PII 保护（viewer 不可见教师生日）
- **前端无 XSS 向量：** 无 `v-html`、`innerHTML`、`eval` 使用
- **Token 刷新机制健壮：** 队列化处理并发请求、`_retry` 防无限循环、auth 端点排除
- **路由守卫完善：** 全局 try-catch 防白屏、角色分级检查、开放重定向防护
- **优雅降级：** 全局 `uncaughtException` / `unhandledRejection` 处理、Prisma 优雅关闭
- **审计日志完整：** 所有变更操作均有审计记录
- **排课五阶段算法正确：** 无死循环风险、无空指针崩溃、事务内二次验证容量
- **密码修改有复杂度校验**
- **前端 validate() 反模式已全部清除**

---

### 六、修复优先级建议

| 优先级 | 问题 | 预估工作量 |
|--------|------|-----------|
| **P0 立即修复** | C-1 Schema/迁移 onDelete 对齐 | 中（需新建迁移） |
| **P0 立即修复** | C-2 autoArrange 并发锁 | 小（复用 batchLocks） |
| **P0 立即修复** | C-3 calcMatchScore 死代码 | 小（重构条件分支） |
| **P1 尽快修复** | H-1 reset 函数关联清理 | 小 |
| **P1 尽快修复** | H-2 用户创建密码复杂度 | 小 |
| **P2 计划修复** | H-3 诊断日志级别 | 小 |
| **P2 计划修复** | H-4 assignTeacher include | 小 |
| **P2 计划修复** | M-1~M-8 | 中 |
| **P3 后续清理** | L-1~L-10 | 小 |
