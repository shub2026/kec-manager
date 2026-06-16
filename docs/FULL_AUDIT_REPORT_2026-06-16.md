## KEC Manager 全面代码与功能审计报告

**审计日期：** 2026-06-16
**项目版本：** v1.5.19
**技术栈：** Vue 3 + Vite + Element Plus (前端) / Express 5 + Prisma + SQLite (后端)

---

### 一、项目概况

KEC Manager 是一个课程培训管理平台，采用 Monorepo 架构，包含 14 个路由模块、16 个控制器、7 个中间件、22 个前端视图页面和 6 个共享组件。项目整体架构清晰，分层合理（路由 → 控制器 → 服务 → 工具），已具备基本的安全防护（bcrypt、JWT、XSS 过滤、RBAC）。但在安全性、代码质量、性能和工程化方面仍存在若干需要改进的问题。

---

### 二、关键发现总览

| 严重等级 | 数量 | 说明 |
|---------|------|------|
| 严重 (Critical) | 4 | 需要立即修复的安全漏洞 |
| 高危 (High) | 8 | 高优先级修复项 |
| 中等 (Medium) | 12 | 建议在下一迭代中修复 |
| 低 (Low) | 18+ | 长期改进项 |

---

### 三、严重问题 (Critical)

**C1. 系统重置确认验证可被绕过**
`validation.js` 中 `validateReset` 的 `confirm` 字段使用了 `.optional()`，导致攻击者可以在不发送确认文本的情况下直接触发所有破坏性重置接口（基础数据、专业、学院等）。`.optional()` 使 `.equals('DELETE')` 仅在字段存在时才校验，省略字段则直接通过。
```
// server/src/middleware/validation.js:400-411
body('confirm').optional().equals('DELETE')  // BUG: 省略confirm即可绕过
```
**修复：** 移除 `.optional()`，使 `confirm` 字段成为必填项。

**C2. 系统重置操作不留审计痕迹**
`settings.controller.js` 中 `resetSystem` 函数在事务外创建审计日志，随后事务内第一条操作就是 `audit_logs.deleteMany()`，将刚创建的审计记录一并删除。系统中最具破坏性的操作反而没有任何审计记录。
```
// server/src/controllers/settings.controller.js:233-257
await createAuditLog({ message: '执行系统重置' });  // 事务外创建
await prisma.$transaction(async (tx) => {
  await tx.audit_logs.deleteMany();  // 立即删除，包括上面这条
});
```
**修复：** 在 `deleteMany()` 之后、事务结束之前重新插入该审计记录。

**C3. Cookie 缺少 Secure 标志**
`cookies.js` 中设置 JWT token 的 cookie 时，虽然使用了 `SameSite=Strict`，但遗漏了 `Secure` 标志。在非 HTTPS 环境下（或遭遇 MITM 降级攻击时），JWT token 将以明文传输。
```
// client/src/utils/cookies.js:17
document.cookie = `...;SameSite=Strict`  // 缺少 ;Secure
```
**修复：** 添加 `;Secure`，或在 HTTPS 环境下条件添加。

**C4. JWT Token 可通过 URL 参数传递**
`auth.middleware.js` 允许通过 `req.query.token` 传递标准访问令牌。URL 中的 token 会出现在服务器日志、浏览器历史、代理日志和 Referrer 头中。虽然有 15 分钟过期时间，但风险窗口仍然过大。
```
// server/src/middleware/auth.middleware.js:25
else if (req.query.token) { token = req.query.token }
```
**修复：** 移除 `req.query.token` 回退，仅保留 60 秒过期的 `downloadToken` 用于下载场景。

---

### 四、高危问题 (High)

**H1. JWT Token 存储在非 HttpOnly Cookie 中**
访问令牌和刷新令牌都通过 `document.cookie` 设置，可被 JavaScript 读取。任何 XSS 漏洞（包括第三方依赖中的）都可能导致令牌被盗。刷新令牌有效期长达 30 天，攻击窗口极大。
**修复：** 改为后端通过 `Set-Cookie` 响应头设置 HttpOnly Cookie。

**H2. 无服务端 CSRF 验证**
前端 axios 拦截器读取 `XSRF-TOKEN` cookie 并发送 `X-CSRF-Token` 请求头，但服务端从未生成该 cookie、也未验证该请求头。这是一段无效代码，给人以虚假的安全感。
**修复：** 移除无效代码，或实现完整的双提交 Cookie CSRF 防护。

**H3. 验证错误日志泄露请求体（含密码）**
`validation.js` 在验证失败时通过 `console.log` 打印完整 `req.body`，密码修改请求的 `old_password` 和 `new_password` 会被明文写入日志文件。
```
// server/src/middleware/validation.js:17-21
console.log('[VALIDATION ERROR]', { body: req.body });  // 密码泄露
```
**修复：** 移除 `body` 字段或对敏感字段脱敏。

**H4. 仅在认证路由启用限流**
只有 `/api/auth/*` 路由配置了速率限制（登录 10 次/15 分钟）。其余所有路由——包括数据导入、批量删除、导出、系统重置——均无限流保护。
**修复：** 在 `app.js` 中添加全局限流器（如 100 次/分钟/IP），对导出/导入等重操作设置更严格的限制。

**H5. 登出和密码修改不会撤销已有令牌**
登出仅创建审计日志，不撤销任何令牌。修改密码也不会使现有会话失效。被盗的刷新令牌在 7 天内持续有效，即使用户已修改密码。
**修复：** 服务端存储刷新令牌标识（jti），登出和密码修改时撤销该用户的所有令牌。

**H6. Query 参数 XSS 过滤中间件未注册**
`xss.js` 中定义了 `sanitizeQuery` 中间件，但在 `app.js` 中从未注册使用。查询参数（如导出路由中的 `name`）未经过滤。
**修复：** 在 `app.js` 中全局注册 `sanitizeQuery`。

**H7. JWT 验证未指定算法**
所有 `jwt.verify()` 调用都未指定 `algorithms` 选项。虽然默认使用 HS256，但最佳实践要求显式指定以防止算法混淆攻击。
**修复：** 在所有 `jwt.verify()` 调用中添加 `{ algorithms: ['HS256'] }`。

**H8. autoFixSortOrder 在每次列表请求时执行**
`sort.js` 中的 `autoFixSortOrder` 函数在每次 GET 请求 majors/courses/textbooks/colleges/training-levels/plans 时都会执行全表扫描，检查排序值重复并修复。对于频繁访问的接口，这直接翻倍了数据库负载。
**修复：** 改为一次性迁移脚本或启动时执行，从请求处理链中移除。

---

### 五、中等问题 (Medium)

**M1. 文件上传缺少 MIME 类型验证**
Multer 仅检查文件扩展名（`.xlsx/.xls`），未验证 MIME 类型或文件魔数。攻击者可将任意文件改扩展名后上传。

**M2. validateLogin 已定义但从未挂载到登录路由**
`validation.js` 中定义了 `validateLogin`（最低 6 位密码），但 `auth.routes.js` 的登录路由未使用该中间件，服务端对登录密码无最低长度校验。

**M3. 登录密码最低 6 位与修改密码最低 8 位不一致**
登录验证允许 6 位密码，但修改密码要求 8 位以上加复杂度。如果用户在新策略前创建，可能可以登录但无法修改密码。

**M4. Settings GET 端点完全无认证**
`/api/settings` 的 GET 路由没有挂载 `authMiddleware`，任何人都可以读取系统设置。

**M5. validateSortOrder 要求所有 PUT 请求必须包含 sort_order**
该中间件未标记 `.optional()`，导致任何不包含 `sort_order` 的更新请求都被 422 拒绝，而控制器逻辑视其为可选。

**M6. 导入操作在事务外创建关联数据**
`import.controller.js` 在事务之前单独创建培训层次、专业和学院，如果后续事务失败，这些记录作为孤儿数据残留。

**M7. JSON Body 限制为 10MB 过大**
管理系统的结构化数据不需要 10MB 的 JSON 请求体，过大的限制可能被利用消耗服务器内存。建议降至 1MB。

**M8. 前端多处 load() 函数缺少 catch 处理**
CollegeList、MajorList、TrainingLevelList、CourseList、TextbookList、PlanDetail 等页面的数据加载函数没有 `catch` 块，API 失败时表现为无反馈的空白页面。

**M9. 部分导出使用原生 fetch 而非统一 request 实例**
TextbookQuery 和 HistoricalTextbookQuery 使用 `fetch` API，绕过了集中式 token 刷新、错误处理和拦截器逻辑。

**M10. el-upload 上传绕过 token 刷新机制**
CourseList、TextbookList、ClassFilterBar 中的 el-upload 组件使用独立 XMLHttpRequest，不经过 axios 拦截器，token 过期时无法自动刷新。

**M11. ClassFormDialog 通过共享引用直接修改父组件 props**
虽然使用了 computed get/set 模式，但 `v-model="localForm.name"` 实际直接修改了父对象属性，未触发 setter/emit，违反了 Vue 单向数据流原则。

**M12. 侧边栏布局不支持移动端响应式**
侧边栏始终显示（220px 或 64px 折叠），没有移动端断点使其变为抽屉/浮层。

---

### 六、低优先级问题 (Low)

**代码重复：** CourseMatrixTable 与 PlanQuery 包含几乎相同的课程矩阵逻辑（~250 行 CSS + 计算函数）；CollegeList/MajorList/TrainingLevelList 三个 CRUD 页面高度雷同；5 个查询页面共享相同的 `availableSemesters` 计算逻辑；6 处重复的 Blob 下载代码。

**死代码：** 4 个旧版查询视图文件（SemesterQuery、TextbookQuery、HistoricalSemesterQuery、HistoricalTextbookQuery）已不被路由引用但仍保留在代码中；Layout.vue 中遗留的密码表单 ref；CourseEditPopover 中空 watcher。

**双重认证中间件：** 导出路由在 `app.js` 和 `export.routes.js` 中各挂载一次 `authMiddleware`，每个请求执行两次 JWT 验证。

**双 Logger 实例：** `config/logger.js` 和 `utils/logger.js` 是两个不同的 Winston 实例，配置不同，日志可能写入不同目录。

**console.log 绕过 Winston：** validation.js 和 query.controller.js 中直接使用 `console.log`，生产环境日志文件中缺失这些信息。

**缓存模块无上限：** 前端 Map 缓存没有最大条目数限制，在大量唯一键场景下可能无限增长。

**Element Plus 全量引入：** 未使用按需引入插件，增加了打包体积。全部 ~280 个图标也全局注册。

**无 ESLint/Prettier 配置：** 项目没有任何代码格式化和静态检查工具。

**无测试框架：** 项目中不存在任何测试文件或测试框架依赖。

---

### 七、性能瓶颈

**P1. autoFixSortOrder 每次请求全表扫描** — 6 个列表接口每次请求都执行排序值重复检查和修复，应改为一次性迁移。

**P2. listClasses 多次冗余查询** — 每次分页请求执行 4-5 次数据库查询，其中 2 次是全表扫描（distinct durations、all plans、distinct enrollment years）。

**P3. querySemester 深度嵌套查询** — 加载 classes → plans → plan_courses → plan_course_semesters → plan_textbooks → textbooks 的完整关系链，在 SQLite 上性能堪忧。

**P4. queryAllTextbooksUsage O(n*m*k) 算法** — 三层嵌套循环遍历所有教材 × 关联 × 班级，数据量增长时性能急剧下降。

**P5. buildClassWithPlanFilter 每次加载全部计划** — 多个查询/导出接口重复加载所有培训计划，应使用缓存。

---

### 八、安全亮点（做得好的地方）

项目中有许多值得肯定的安全实践：bcrypt 12 轮加密、三种独立 JWT 密钥（访问/刷新/下载）、15 分钟短期访问令牌、Prisma ORM 防 SQL 注入、XSS body 过滤、公式注入防护、完整审计日志、三级 RBAC 权限控制、管理员不能修改超级管理员账户、登录限流 10 次/15 分钟、生产环境错误消息脱敏、进程异常保护。

---

### 九、修复优先级路线图

**第一阶段（立即修复，工作量 1-2 天）：**
移除 `validateReset` 的 `.optional()`、移除 `req.query.token` 回退、添加 Cookie Secure 标志、移除验证日志中的 `req.body`、注册 `sanitizeQuery` 中间件、添加全局速率限制、JWT verify 指定算法、移除 `autoFixSortOrder` 请求钩子。

**第二阶段（短期改进，工作量 3-5 天）：**
Token 改为服务端 HttpOnly Cookie 设置、实现 Token 撤销机制、修复系统重置审计日志时序、文件上传添加 MIME 验证、挂载 `validateLogin` 到登录路由、统一错误响应格式、修复前端缺失的 catch 块、清理死代码。

**第三阶段（中期优化，工作量 1-2 周）：**
抽取共享 CRUD 组件和查询组件消除代码重复、添加 ESLint + Prettier、实现基础单元测试、Element Plus 按需引入、侧边栏移动端响应式、缓存优化。

**第四阶段（长期演进）：**
引入服务层分离更多控制器逻辑、考虑 SQLite 向 MySQL/PostgreSQL 迁移以支持并发写入、批量操作改为并行 Promise.allSettled、导出接口统一使用 POST + Blob 模式。

---

### 十、总结

KEC Manager 是一个功能完整、架构清晰的管理平台，安全防护的基础工作已经到位。当前最紧迫的 4 个严重问题都可以通过小幅代码修改解决，不影响整体架构。性能瓶颈在数据量较小时不会显现，但随着数据增长需要关注。最大的工程化缺口是缺少测试和代码检查工具，建议尽快补齐以防止回归问题。
