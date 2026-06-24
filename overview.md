# KEC-Manager 全盘代码审查报告

**审查日期**: 2026-06-24
**审查范围**: 前端 (client/src) + 后端 (server/src) + 数据库 (prisma) + 排课算法
**审查方法**: 架构扫描 + 逐文件审查 + 逻辑分析

---

## 一、总体评价

项目整体质量**中上**，安全基础设施投入明显（helmet、JWT 分离密钥+HKDF、bcrypt、XSS 清洗、审计日志、错误脱敏），代码中可见大量修复标记（M-x、H-x、L1），说明经历过安全审计迭代。

**主要短板**集中在三个方面：
1. 认证防御纵深不足——路由内无兜底认证
2. 分层不彻底——控制器直接持 Prisma，service 层残缺
3. 横切关注点不一致——XSS body 清洗、速率限制、分页验证等"部分全局、部分手动"

---

## 二、问题清单（按优先级排序）

### CRITICAL（严重）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| C-1 | **修改密码被 XSS 清洗导致永久锁死** | `auth.routes.js:154-178` + `xss.js` | 密码中含 `<>&` 等字符的用户，修改密码后将永远无法登录（登录不走 sanitizeBody，但改密码走） |
| C-2 | **Refresh Token 不可撤销** | `auth.service.js:84-108` | Token 窃取后 7 天有效，改密码也不失效 |
| C-3 | **系统重置清空全部审计日志** | `settings.controller.js:345-397` | super_admin 可销毁所有入侵证据 |
| C-4 | **排课 trySwapUnassigned 缺意向约束检查** | `teaching-arrange.service.js` | 交换可能违反教师意向约束 |

### HIGH（高）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| H-1 | **备份文件残留在源码中** | `server/src/services/teaching-arrange.service.js.bak-20260620-185807` | 会被打包部署，含旧逻辑 |
| H-2 | **密码策略不一致** | `validation.js:111-116` vs `218-223` | 创建用户严格字符集，修改密码宽松，可绕过 |
| H-3 | **无账号锁定机制** | `auth.routes.js:15-21` | 仅 IP 限流，代理池可绕过暴力破解 |
| H-4 | **sanitizeBody 未全局应用** | `app.js` + 各路由 | 漏加即 XSS 漏洞 |
| H-5 | **querySemester 分页无上限** | `query.controller.js:49-50` | `?pageSize=999999` 可致 OOM |
| H-6 | **并发锁仅限单进程** | `auto-arrange.js:18`, `batch.js:8` | 多实例部署排课锁失效 |
| H-7 | **用户状态缓存 TOCTOU** | `auth.middleware.js:6-38` | 禁用用户 30s 内仍可访问 |

### MEDIUM（中）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| M-1 | 路由内无 auth 兜底 | 全部 routes/*.js | 重构易致认证丢失 |
| M-2 | updateClass 级联删除不在事务内 | `class.controller.js:368-381` | 删排课失败数据不一致 |
| M-3 | 审计日志失败静默吞错 | `audit.service.js:37-48` | 审计记录可能丢失 |
| M-4 | 批量排课非原子性 | `batch.js:103-143` | 中断后部分写入 |
| M-5 | 导入事务内 N+1 查询 | `import/classes.js` 等 | 大批量导入性能差 |
| M-6 | CSP 被完全禁用 | `app.js:33-38` | XSS 深度防线缺失 |
| M-7 | 重置接口无速率限制 | `settings.routes.js:38-48` | 账号被盗可瞬间清空 |
| M-8 | validatePagination(100) 参数被忽略 | `pagination.js:13` | 调用方误以为可自定义上限 |
| M-9 | 控制器直接访问 Prisma | `query.controller.js` 等 | 分层不彻底，难单测 |
| M-10 | queryAllTextbooksUsage 全量加载无分页 | `query.controller.js:465-486` | 数据增长后 OOM |
| M-11 | SQLite 用于生产环境 | `schema.prisma:5-8` | 无行级锁，并发写受限 |
| M-12 | dotenv 加载与模块执行顺序依赖 | `server.js` + `app.js` | 隐式依赖脆弱 |
| M-13 | JWT_SECRET 无强度校验 | `auth.config.js` | 占位符可被误用 |

### LOW（低）

| # | 问题 | 位置 |
|---|------|------|
| L-1 | 健康检查暴露 DB 状态 | `app.js:92-110` |
| L-2 | 下载令牌经 URL 参数传递 | `auth.middleware.js:49` |
| L-3 | 错误处理模式不统一（throw vs fail） | 多控制器 |
| L-4 | paginate() 函数定义但从未使用 | `response.js:5-16` |
| L-5 | naming 转换硬编码 `val.list` | `naming.middleware.js:45` |
| L-6 | 日志未自动脱敏 | `logger.js` |
| L-7 | 前端 TeachingArrange.vue 1609 行 | `client/src/views/teaching/` |
| L-8 | 死代码：shallowSnakeToCamel 等 | `naming.js:91-118` |
| L-9 | trust proxy:1 不适多层代理 | `app.js` |

---

## 三、前端审查结论

前端已在上一轮修复了 P1/P2/P3 全部问题。当前剩余：
- **L-7**: `TeachingArrange.vue` 1609 行，建议拆分为 3 个子组件（非紧急）
- 整体前端代码质量良好，无安全风险

---

## 四、排课算法审查结论

排课算法是项目核心，经审查发现：

**做得好的**:
- 贪心 + 多阶段筛选（6 阶段）架构清晰
- 内存锁 + 事务内二次校验防并发超载
- 预览模式用 virtualTeacherHours 模拟
- 教材内聚评分可配置化（TEXTBOOK_COHESION 常量）

**需关注的**:
- C-4: trySwapUnassigned 未检查意向约束
- 配置常量与硬编码值不一致（评分权重）
- 批量排课无学期过滤（查全表）
- 3 处中等死代码（预计算未接入）
- 无全局回溯（贪心算法固有局限，长期优化项）

---

## 五、修复优先级建议

### 立即修复（安全阻断）
1. **C-1**: 密码字段跳过 XSS 清洗 ✅ 已修复（2026-06-24）
2. **H-1**: 删除 .bak 备份文件 ✅ 已修复（2026-06-24）
3. **H-5**: querySemester 加分页上限校验 ✅ 已修复（2026-06-24）

### 短期修复（1-2 周）
4. **C-2**: Refresh Token 加 jti 存储 + 改密码失效 ⏳ 待办（需 Prisma schema 迁移）
5. **H-2**: 统一密码验证正则 ✅ 已修复（2026-06-24）
6. **H-3**: 增加账号级登录失败锁定 ⏳ 待办（需数据库表存储失败次数）
7. **H-4**: sanitizeBody 全局应用 ✅ 已修复（2026-06-24）
8. **M-2**: updateClass 级联删除加事务 ✅ 已修复（2026-06-24）
9. **M-7**: 重置接口加速率限制 ✅ 已修复（2026-06-24）
10. **M-8**: validatePagination 参数被忽略 ✅ 已修复（2026-06-24）

### 中期修复（1 个月）
10. **C-3**: 审计日志改为只追加
11. **H-6/H-7**: 引入 Redis 分布式锁和共享缓存
12. **M-5**: 导入 N+1 优化
13. **M-9**: 补齐 service 层
14. **M-11**: 生产环境迁移 MySQL

### 长期优化
15. 排课算法全局回溯
16. TeachingArrange.vue 拆分
17. 全局速率限制
18. CSP 白名单配置

---

## 六、安全亮点（做得好的方面）

- SQL 注入：全程 Prisma 参数化查询，无 `$queryRawUnsafe`
- 密码哈希：bcrypt 12 轮，可配置
- JWT 密钥：Access/Refresh/Download 三密钥分离 + HKDF 派生
- 认证限流：登录/刷新/改密独立限流
- XSS 防护：body + query 递归清洗
- 事务完整性：重置/导入/排课使用 `$transaction`
- 排课二次校验：事务内重新查询容量
- RBAC：super_admin > admin > viewer 三级
- 自我保护：不能删除/禁用自己
- 错误脱敏：生产环境隐藏内部详情
- 外键策略：teaching_assignments 用 Restrict 防孤立
- 登录泛化：不区分"用户不存在"和"密码错误"

---

**审查人**: Senior Developer (高级开发工程师)
**审查日期**: 2026-06-24
**文件数**: 50+ 源文件
**发现问题**: 4 CRITICAL + 7 HIGH + 13 MEDIUM + 9 LOW

---

## 七、修复记录（2026-06-24）

### ✅ 已修复项（8 项）

#### C-1: 密码字段跳过 XSS 清洗
- **文件**: `server/src/middleware/xss.js`
- **改动**: 新增 `SKIP_SANITIZE_KEYS` 白名单集合（password/old_password/new_password 等），`sanitizeBody` 和 `sanitizeObject` 递归时跳过这些字段
- **原因**: 密码只会被 bcrypt 哈希，不会输出到 HTML。XSS 清洗会篡改含 `<>` 字符的密码，导致改密码后登录永久失败

#### H-1: 删除 .bak 备份文件
- **文件**: 删除 `server/src/services/teaching-arrange.service.js.bak-20260620-185807`
- **改动**: `.gitignore` 新增 `*.bak` 和 `*.bak-*` 规则
- **原因**: 备份文件会被打包部署，含旧逻辑

#### H-2: 统一密码验证正则
- **文件**: `server/src/middleware/validation.js`
- **改动**: `validateChangePassword` 的正则改为与 `validateUser` 一致的 `^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,128}$`
- **原因**: 创建用户严格字符集，修改密码宽松，可绕过

#### H-4: sanitizeBody 全局应用
- **文件**: `server/src/app.js`
- **改动**: 在 `express.json` 之后、路由之前全局挂载 `sanitizeBody`，密码类字段在中间件内自动跳过
- **原因**: 原来依赖各路由手动添加，遗漏即 XSS 漏洞

#### H-5: querySemester 分页加上限
- **文件**: `server/src/controllers/query.controller.js`
- **改动**: `pageSizeNum = Math.min(Math.max(requestedPageSize, 1), 100)` 强制上限 100
- **原因**: `?pageSize=999999` 可致 OOM

#### M-2: updateClass 级联删除加事务
- **文件**: `server/src/controllers/class.controller.js`
- **改动**: 班级更新与排课记录删除包入 `prisma.$transaction`
- **原因**: 原来两操作独立执行，删排课失败会数据不一致

#### M-7: 重置接口加速率限制
- **文件**: `server/src/routes/settings.routes.js`
- **改动**: 新增 `resetLimiter`（每用户每小时最多 3 次），应用到所有 `/reset/*` 路由
- **原因**: 原来无速率限制，账号被盗可瞬间清空全部数据

#### M-8: validatePagination 参数被忽略修复
- **文件**: `server/src/middleware/pagination.js`
- **改动**: `validatePagination(maxPageSize=100)` 接受参数，动态设置 `isInt` 的 max
- **原因**: 原来函数签名不接受参数，调用处 `validatePagination(100)` 被静默忽略

### ⏳ 待办项（需较大改动）

| # | 问题 | 原因 |
|---|------|------|
| C-2 | Refresh Token 加 jti 存储 | 需 Prisma schema 新增 token 表 + 迁移 |
| H-3 | 账号级登录失败锁定 | 需数据库表存储失败次数 |
| C-3 | 审计日志改为只追加 | 需重构 resetSystem 逻辑 |
| C-4 | trySwapUnassigned 意向约束 | 需排课算法逻辑修改 + 测试验证 |
| H-6/H-7 | Redis 分布式锁/共享缓存 | 需引入 Redis 依赖 |
| M-5 | 导入 N+1 优化 | 需重构导入逻辑 |
| M-11 | 生产环境迁移 MySQL | 需 Prisma schema provider 切换 + 数据迁移 |
