# KEC 课程管理平台 -- 全方位代码审计报告

**审计日期**: 2026-07-11
**项目版本**: v1.3.2
**审计范围**: 安全、架构、数据层、前端、性能、部署、测试
**审计人**: 系统架构审计

---

## 执行摘要

KEC 课程管理平台整体安全成熟度**较高**，在认证体系、输入验证、错误处理、日志审计等方面已建立完善的防护体系。本次审计共发现 **3 项高危**、**6 项中危**、**8 项低危** 问题，无 Critical 级别漏洞。

### 安全能力矩阵

| 能力维度 | 评级 | 说明 |
|---------|------|------|
| 认证体系 | ★★★★☆ | JWT 三令牌隔离 + HttpOnly Cookie + Token 黑名单双层缓存 |
| CSRF 防护 | ★★★★☆ | Double-Submit Cookie 模式，与 SameSite=strict 互补 |
| XSS 防护 | ★★★★☆ | 全局 body/query XSS 清洗 + 导入公式注入防护 |
| 输入验证 | ★★★★★ | express-validator 全覆盖 + 严格类型/范围校验 |
| 权限控制 | ★★★★★ | 三级角色 + 路由级 + 接口级双重鉴权 |
| 错误处理 | ★★★★☆ | 生产环境安全消息 + 堆栈不泄露 |
| 速率限制 | ★★★★★ | 全局 + 登录 + 用户名级 + 导入/导出/重置独立限流 |
| 审计日志 | ★★★★★ | 全操作审计 + 系统重置留痕 + 独立审计日志文件 |
| 文件上传 | ★★★★☆ | MIME + 魔数 + 扩展名 + 大小四层校验 |
| 部署安全 | ★★★★☆ | .env 权限 600 + JWT 密钥强度强制校验 |

---

## Critical 级别（0 项）

无。

---

## High 级别（3 项）

### H-1: JWT 密钥曾提交至 Git 历史

**影响范围**: 密钥泄露风险
**涉及文件**: `server/.env`（Git 历史）

**问题描述**: 虽然 `server/.env` 已从 Git 跟踪中移除（commit `5299c44`），但 `.env` 文件的明文内容（含 `your-jwt-secret-here` 占位符）仍可从 Git 历史中恢复。若该仓库曾 push 到公共远程仓库（如 Gitee），则占位符密钥可能被已知。

**风险评估**: 当前生产部署脚本 `deploy.sh` 会重新生成高强度随机密钥，因此**生产环境不受影响**。但若开发环境使用占位符密钥，且 CORS 配置宽松，存在理论上的 Token 伪造风险。

**修复建议**:
1. 执行 `git filter-repo --invert-paths --path server/.env` 清除 Git 历史中的 `.env` 文件
2. 确认远程仓库（Gitee）是否为私有仓库
3. 开发环境也建议使用独立的随机密钥而非占位符

---

### H-2: 删除用户后活跃 JWT 存在 5 秒窗口期

**影响范围**: 用户删除/禁用后的短暂授权窗口
**涉及文件**: `server/src/middleware/auth.middleware.js` (L7), `server/src/controllers/user.controller.js` (L262)

**问题描述**: `auth.middleware.js` 中 `userStatusCache` 的 TTL 为 5 秒。当管理员删除或禁用用户后，该用户已持有的有效 JWT 在最多 5 秒内仍可通过认证（缓存命中旧状态）。`deleteUser` 已调用 `invalidateUserStatusCache`，但缓存清理仅在服务器进程内生效——若未来扩展为多实例部署，其他进程的缓存不受影响。

**修复建议**:
1. 当前单实例部署下 5 秒窗口可接受
2. 若扩展为多实例，建议引入 Redis Pub/Sub 通知缓存失效，或将 TTL 降至 1-2 秒
3. 高安全场景下可在 `deleteUser`/`updateUserStatus` 中将该用户的所有活跃 JTI 加入 Token 黑名单

---

### H-3: 部署脚本中 `rm -f kec.db-wal kec.db-shm` 可能丢失未刷盘数据

**影响范围**: 数据丢失风险
**涉及文件**: `deploy.sh` (L249)

**问题描述**: 部署步骤 [5/10] 停止 PM2 服务后等待 2 秒，步骤 [7/10] 直接删除 WAL/SHM 文件。SQLite WAL 模式下，未完成的 checkpoint 数据存储在 WAL 文件中。如果服务非正常退出（如 `pkill -f` 强制终止），WAL 中可能有未刷入主数据库的写入。2 秒等待时间不一定足够完成 WAL checkpoint。

**修复建议**:
1. 在删除 WAL 文件前，执行 `sqlite3 kec.db "PRAGMA wal_checkpoint(TRUNCATE);"` 强制刷盘
2. 将等待时间从 2 秒增加到 5 秒
3. 添加 WAL 文件大小检查：若 `kec.db-wal` 大小为 0 或不存在，则跳过删除

---

## Medium 级别（6 项）

### M-1: XSS 清洗中间件对 `__proto__` 键无防护

**影响范围**: 潜在原型污染
**涉及文件**: `server/src/middleware/xss.js` (L51)

**问题描述**: `sanitizeObject` 递归遍历对象时使用 `Object.entries(obj)` 并写入 `sanitized[key]`。若请求体中包含 `__proto__` 或 `constructor.prototype` 键，理论上可能造成原型污染。Express 5 默认使用 `qs` 解析 body，`qs` 自身有 `allowPrototypes: false` 保护，但 `express.json()` 的 JSON 解析器不做此限制。

**修复建议**:
在 `sanitizeObject` 的 object 遍历中跳过 `__proto__`、`constructor`、`prototype` 键：
```js
if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
```

---

### M-2: 命名转换中间件存在同类风险

**影响范围**: 潜在原型污染
**涉及文件**: `server/src/middleware/naming.middleware.js` (L54, L95)

**问题描述**: `camelToSnake(req.body)` 整体替换 `req.body`，内部实现若遍历对象键并赋值到新对象，同样面临 `__proto__` 问题。此外 `convertResponseNaming` 中 `data[key]` 的直接赋值也有类似风险。

**修复建议**: 在 `naming.js` 的 `camelToSnake`/`snakeToCamel` 工具函数中添加原型键过滤。

---

### M-3: `system_settings` 表缺少审计字段

**影响范围**: 可追溯性
**涉及文件**: `server/prisma/schema.prisma` (L156-L161)

**问题描述**: `system_settings` 模型缺少 `created_at` / `updated_at` 字段，无法追溯设置的创建时间和最后修改时间。其他所有业务表均有这两个字段。

**修复建议**: 添加 `created_at` 和 `updated_at` 字段，并创建对应迁移。

---

### M-4: `lock.js` 使用 SQLite 专有语法 `INSERT OR IGNORE`

**影响范围**: 数据库迁移兼容性
**涉及文件**: `server/src/services/arrange/lock.js` (L21-L23)

**问题描述**: 排课并发锁使用 `INSERT OR IGNORE` 和 `datetime('now')` 等 SQLite 专有 SQL。Schema 注释中已声明"做好切换 MySQL 的准备"，但此处的 `$executeRaw` 无法直接迁移到 MySQL（MySQL 使用 `INSERT IGNORE` 且 `datetime` 函数不同）。

**修复建议**:
1. 添加注释标记此处为 SQLite 专有依赖
2. 未来切换 MySQL 时需同步修改此处
3. 或改用 Prisma Client 高级 API（`upsert`）替代原生 SQL

---

### M-5: 导出接口无数据量上限保护

**影响范围**: 内存压力 / OOM 风险
**涉及文件**: `server/src/controllers/export/data-export.controller.js`

**问题描述**: 虽然引入了 `batchFindMany` 分批加载（每批 500 条）和 `exportLimiter`（10 次/分钟），但最终所有数据仍累积到内存数组中生成 Excel。在数据量极大（如 10000+ 班级全量导出）时，ExcelJS 的 workbook 构建可能消耗大量内存。PM2 配置了 `max_memory_restart: '512M'` 作为兜底，但触发重启会中断用户请求。

**修复建议**:
1. 对全量导出添加行数上限检查（如超过 50000 行时提示缩小筛选范围）
2. 考虑使用 ExcelJS 的 streaming API（`WorkbookWriter`）替代全量内存构建

---

### M-6: `cookies.js` 注释与实际实现不一致

**影响范围**: 代码可维护性
**涉及文件**: `client/src/utils/cookies.js` (L1-L9)

**问题描述**: 文件头注释声称"当前实现仍由 JS 写入 Cookie，属过渡方案"，但实际上 `auth.routes.js` 已完全通过后端 `Set-Cookie` 设置 HttpOnly Cookie，前端 `cookies.js` 仅用于读取 XSRF-TOKEN 和清理残留 Cookie。注释描述的是旧状态，可能误导维护者。

**修复建议**: 更新注释，说明当前 `cookies.js` 的实际用途（XSRF-TOKEN 读取 + 残留清理）。

---

## Low 级别（8 项）

### L-1: CSRF Double-Submit 与 SameSite=strict 存在功能重叠

**涉及文件**: `server/src/middleware/csrf.js`, `server/src/routes/auth.routes.js` (L24)

**说明**: Cookie 设置了 `SameSite: 'strict'`，该属性已阻止跨站请求携带 Cookie，因此 CSRF Token 验证在大多数现代浏览器中是冗余的。但保留 CSRF 作为纵深防御是合理的（防御 SameSite=None 降级、非浏览器客户端等场景）。

**评级**: 信息性，无需修改。

---

### L-2: Controller 层直接依赖 Prisma Client

**涉及文件**: 多个 `controllers/*.js`（如 `user.controller.js`, `settings.controller.js`, `import/classes.js`）

**说明**: 多数 Controller 直接调用 `prisma.users.findMany()` 等，未通过 Service 层。对于 CRUD 简单的实体操作，这在实际项目中是常见的务实选择。但对于复杂业务逻辑（如排课算法 `services/arrange/`），已正确抽取到 Service 层。

**评级**: 代码风格，可在后续重构中渐进迁移。

---

### L-3: 前端无自动化测试

**涉及文件**: `client/` 目录

**说明**: 前端 0 个测试文件，所有自动化测试（47 个）均在后端。前端的路由守卫、状态管理、API 拦截器等关键逻辑无测试覆盖。

**建议**: 引入 Vitest + Vue Test Utils，优先为 `stores/auth.js` 和 `router/index.js` 的守卫逻辑添加单元测试。

---

### L-4: `DEFAULT_SEMESTER` 硬编码值需定期更新

**涉及文件**: `server/src/constants/index.js` (L35)

**说明**: `process.env.DEFAULT_SEMESTER || '2025-2026-2'`。`server.js` 在生产环境会打印警告提醒修改，但常量文件中的默认值仍需手动更新。已有注释说明。

**评级**: 已知设计决策，无需修改。

---

### L-5: `clearAuthCookies` 清理的 Cookie 名与实际设置的不完全匹配

**涉及文件**: `client/src/utils/cookies.js` (L62-L66)

**说明**: `clearAuthCookies` 清理 `auth_token` 和 `auth_refreshToken`，但后端 `auth.routes.js` 设置的 Cookie 名为 `token` 和 `refreshToken`。前端 `auth.js` 的 `clearAuth` 中额外调用了 `deleteCookie('token')` 和 `deleteCookie('refreshToken')` 作为兜底，因此功能正确，但 `clearAuthCookies` 函数本身清理的是旧版命名。

**建议**: 更新 `clearAuthCookies` 中的 Cookie 名以匹配当前后端设置。

---

### L-6: `cleanupFile` 使用回调式 `fs.unlink` 非 `fs.promises.unlink`

**涉及文件**: `server/src/controllers/import-shared.js` (L68-L70)

**说明**: `cleanupFile` 使用 `fs.unlink(path, () => {})` 静默吞掉所有错误（包括权限不足等）。在临时文件目录（`os.tmpdir()`）中通常不会出问题，但错误吞没可能导致磁盘空间泄漏（临时文件未被清理）。

**建议**: 添加 `log.warn` 记录清理失败的情况。

---

### L-7: 前端缓存清理定时器未使用 `.unref()`

**涉及文件**: `client/src/utils/cache.js` (L100)

**说明**: `setInterval(() => cleanupExpired(), 5 * 60 * 1000)` 在浏览器环境中无 `.unref()` 概念（仅 Node.js 支持），但在 SSR 场景下可能阻止进程退出。当前项目为纯 SPA，不受影响。

**评级**: 信息性，无需修改。

---

### L-8: `keepAliveTimeout` 与 Nginx 配置需协调

**涉及文件**: `server/src/server.js` (L57-L58)

**说明**: `keepAliveTimeout = 65000`（65 秒）、`headersTimeout = 66000`（66 秒）。Node.js 的 keepAlive 超时必须大于 Nginx upstream 的 keepalive 超时（通常 60 秒），否则 Nginx 可能复用已被 Node.js 关闭的连接，导致 `ECONNRESET`。当前 65s > 60s 的配置是正确的，但需确保 Nginx 配置中 `keepalive_timeout` 不超过 60 秒。

**评级**: 运维注意事项，建议在部署文档中明确。

---

## 安全能力详细评估

### 1. 认证体系 (★★★★☆)

**已实现的防护措施**:
- JWT 三令牌隔离：Access（15min）+ Refresh（7d）+ Download（30s），各自独立密钥
- HttpOnly + Secure + SameSite=strict Cookie 存储（后端 `Set-Cookie` 设置）
- Token 黑名单：DB + 内存正缓存 + 负缓存三层架构，含定时清理
- 密钥强度强制校验：生产环境拒绝占位符、弱密钥（<32 字符）、低熵密钥
- HKDF 密钥派生：未独立配置 Refresh/Download 密钥时从主密钥安全派生
- 登录速率限制：IP 级（10 次/15 分钟）+ 用户名级（5 次/15 分钟）双重限流
- 密码修改后立即清除用户状态缓存 + 将当前 Token 加入黑名单
- Refresh Token 轮换：每次刷新将旧 Token JTI 加入黑名单
- 登出时同时黑名单化 Access Token 和 Refresh Token

**审计通过**: 认证体系设计成熟，多层防护互为兜底。

### 2. 输入验证 (★★★★★)

**验证规则覆盖**:
- `validation.js`（622 行）覆盖了所有实体的创建/更新/查询操作
- 每个写入路由均挂载了对应的验证链（`validateXxx` + `handleValidationErrors`）
- 验证包含：类型检查、范围限制、长度限制、格式校验、枚举值校验
- 密码策略：8-128 位 + 至少两种字符类型
- 分页参数：`page >= 1`, `pageSize 1-100`

**文件上传安全**:
- 扩展名白名单（.xlsx/.xls）
- MIME 类型白名单
- 文件头魔数校验（ZIP/OLE2 签名）
- 文件大小限制（环境变量配置，默认 10MB）
- 导入行数上限（`MAX_ROWS: 20000`）
- Excel 公式注入防护（`=+-@\t` 前缀转义 + XSS 清洗）

### 3. 权限控制 (★★★★★)

**三级角色体系**:
- `super_admin`：全部功能（含系统设置、审计日志、系统重置）
- `admin`：基础数据管理 + 用户管理（仅 viewer）+ 导入导出
- `viewer`：只读查询 + 导出（需 admin+）

**双重鉴权**:
- 路由级：`app.js` 中挂载 `authMiddleware` + `roleMiddleware`
- 接口级：部分路由文件内额外挂载权限中间件（如 `settings.routes.js`）
- Controller 级：`user.controller.js` 中 admin 只能管理 viewer

**前端辅助**:
- 路由守卫 `beforeEach` 检查 `requiresAdmin` / `requiresSuperAdmin`
- 明确仅为 UI 层辅助，核心权限在后端

### 4. 错误处理与信息泄露防护 (★★★★☆)

- `errorHandler` 区分生产/开发环境 + 本地/远程请求
- Prisma 错误码映射为用户友好消息（P2002→"已存在"，P2003→"关联不存在"）
- 健康检查不泄露数据库详情
- `download_token` 在日志中脱敏为 `[REDACTED]`
- `GET /api/settings` 对匿名用户仅返回 `organization_name`

### 5. 日志与审计 (★★★★★)

- Winston 日志：error.log + combined.log + audit.log 三通道
- 日志轮转：5MB/文件，error 保留 10 份，audit 保留 20 份
- 全操作审计：登录/登出/CRUD/导入/导出/系统设置/系统重置
- 系统重置时先归档审计日志数量再清空，确保破坏性操作留痕
- 审计日志含操作人 ID、IP、操作详情、成功/失败结果

---

## 架构评估

### 后端分层

```
routes/ (17 文件) → controllers/ (15+ 文件) → services/ (8+ 文件) → prisma/ (ORM)
                                                ↑
                                       middleware/ (8 文件)
```

**优点**:
- 中间件注册顺序正确：helmet → CORS → body parser → naming → XSS → CSRF → routes → error handler
- 所有异步路由处理器均有 try/catch + next(error) 包裹
- 进程级错误处理（uncaughtException/unhandledRejection）+ process.exit(1) 配合 PM2 autorestart
- 优雅关闭（SIGINT/SIGTERM）+ 10 秒超时强制退出 + Prisma 连接释放
- 命名转换中间件解决了前后端 snake_case/camelCase 不一致问题

**可改进**:
- Controller 直接访问 Prisma（见 L-2），复杂业务已正确抽取到 Service
- 排课算法模块（`services/arrange/`）设计良好：auto-arrange + tabu-search + lock + validate + queries 职责分明

### 数据模型

- 17 个模型，外键策略基本合理
- 索引覆盖率良好：status、外键、复合查询字段均有索引
- `teaching_assignments` 使用 `onDelete: Restrict` 保护教学安排不被级联删除（正确）
- `teacher_courses` 使用 `onDelete: Cascade`（删除教师时级联清除课程关联——符合业务语义）

### 前端架构

- Vue 3.5 + Pinia + Vue Router 标准 SPA 架构
- 路由懒加载 + 手动 chunk 分割（element-plus/vue-vendor/axios 独立 chunk）
- Vite 构建 `sourcemap: false` 防止源码泄露
- API 缓存（`getWithCache`）+ LRU 淘汰 + 定时清理
- Token 刷新并发控制（`_refreshPromise` 单例避免重复刷新）

---

## 测试覆盖评估

**后端**: 47 个测试文件，分布如下：

| 模块 | 测试文件数 | 覆盖范围 |
|------|-----------|---------|
| controllers/ | 14 | 班级 CRUD、仪表盘、删除守卫、设置、教师、教学安排、用户、导入 |
| controllers/plan/ | 4 | 方案删除、列表、矩阵、教材 |
| controllers/import/ | 3 | 班级/课程/教师导入 |
| controllers/export/ | 1 | 学期导出 |
| services/ | 6 | 审计、认证、班级过滤、方案、学期、设置 |
| services/arrange/ | 7 | 自动排课、批量、诊断、查询、选择置换、禁忌搜索、验证 |
| middleware/ | 6 | 认证、CSRF、错误、命名、验证、XSS |
| utils/ | 2 | 命名、排序 |
| integration/ | 1 | 认证路由集成测试 |

**前端**: 0 个测试文件。

**评估**: 后端测试覆盖良好，特别是排课算法（7 个测试文件）和认证链路（集成测试 + 中间件测试）。前端是测试盲区。

---

## 修复优先级建议

| 优先级 | 编号 | 问题 | 工作量 | 建议时间 |
|--------|------|------|--------|---------|
| 1 | H-3 | WAL 文件删除前强制 checkpoint | 小 | 下次部署前 |
| 2 | M-1 | XSS 中间件原型键过滤 | 小 | 本周内 |
| 3 | M-2 | 命名转换原型键过滤 | 小 | 本周内 |
| 4 | M-5 | 导出行数上限保护 | 中 | 本迭代内 |
| 5 | H-1 | Git 历史 .env 清除 | 小 | 本迭代内 |
| 6 | L-5 | clearAuthCookies Cookie 名对齐 | 小 | 下次改动时 |
| 7 | M-3 | system_settings 审计字段 | 小 | 下次迁移时 |
| 8 | L-3 | 前端测试引入 | 大 | 长期规划 |

---

## 结论

KEC 课程管理平台在安全性方面展现出**高于同类项目平均水准**的成熟度。认证体系的三令牌隔离 + 多层黑名单 + 密钥强制校验、全面的速率限制策略、完善的审计日志系统，以及生产部署脚本中的安全实践（密钥随机生成、.env 权限控制），均表明团队具备良好的安全意识。

当前发现的 3 项高危问题均属于**边界场景**（Git 历史残留、TTL 窗口、WAL 刷盘时序），不存在可被远程直接利用的安全漏洞。建议按上述优先级逐步修复。
