# kec-manager 前后端构造检查报告

> 仓库：https://gitee.com/shub77/kec-manager | 版本：v2.6.3 | 检查日期：2026-06-20

---

## 一、项目总体结构

```
kec-manager/
├── package.json              # 根工作区（concurrently 同时启动前后端）
├── docker-compose.yml        # 容器化部署（server + client 双服务）
├── client/                   # 前端（Vue 3 + Vite + Element Plus + Pinia）
└── server/                   # 后端（Express 5 + Prisma + SQLite）
    ├── prisma/
    │   ├── schema.prisma     # 14 个数据模型
    │   ├── seed.js
    │   └── migrations/       # 8 个迁移文件
    └── src/
        ├── app.js            # Express 应用入口（中间件注册 + 路由挂载）
        ├── server.js         # 服务启动（进程级错误处理 + 优雅关闭）
        ├── config/           # 认证配置
        ├── routes/           # 16 个路由文件
        ├── controllers/      # 控制器（含 import/export 子模块）
        ├── services/         # 业务服务层
        ├── middleware/       # 6 个中间件
        └── utils/            # 工具函数
```

---

## 二、技术栈对照

| 层级 | 前端 | 后端 |
|------|------|------|
| 框架 | Vue 3.5 + Vite 5.4 | Express 5.1 |
| 状态管理 | Pinia 3.0 | — |
| UI 库 | Element Plus 2.14 | — |
| 路由 | Vue Router 4.6 | Express Router |
| HTTP | Axios 1.17 | — |
| ORM/DB | — | Prisma 6.19 + SQLite |
| 认证 | JWT（Cookie 存储 + 刷新队列） | JWT（双 Token + bcrypt） |
| 校验 | Element Plus 表单校验 | express-validator |
| 安全 | XSS 过滤（前端 cache 清理） | helmet + xss + rate-limit |
| 日志 | console（DEV） | winston（文件+控制台） |
| 部署 | Nginx 静态托管 | Node 进程 + Docker |

---

## 三、后端架构分析

### 3.1 分层结构（标准 MVC 变体）

```
routes → controllers → services → prisma(ORM) → DB
                ↓
           middleware（auth/validation/xss/naming）
```

| 层级 | 职责 | 评价 |
|------|------|------|
| `routes/` | 路由定义 + 权限守卫 + 校验链 | ✅ 清晰，权限在路由层控制 |
| `controllers/` | 参数处理 + 调用 service + 审计日志 | ⚠️ 部分 controller 直接操作 prisma，未走 service |
| `services/` | 业务逻辑封装 | ✅ auth/audit/plan/teaching 有 service，基础 CRUD 无 |
| `middleware/` | 认证/校验/XSS/命名转换/分页 | ✅ 完整 |
| `utils/` | 响应/错误/日志/排序工具 | ✅ 规范 |

### 3.2 认证体系

| 机制 | 实现 | 状态 |
|------|------|------|
| Access Token | JWT 15min，`Authorization: Bearer` | ✅ |
| Refresh Token | JWT 7d，独立密钥 `jwtRefreshSecret` | ✅ |
| Download Token | JWT 30s，用于 window.open 下载 | ✅ |
| 密码哈希 | bcrypt，rounds 可配置（默认12） | ✅ |
| 速率限制 | 登录 10次/15min，刷新 30次/15min | ✅ |
| 用户状态校验 | 每请求查库（30s 缓存），防止降级/禁用后旧 token 生效 | ✅ |

### 3.3 中间件链（app.js）

```
helmet → cors → express.json → 请求日志 →
convertRequestNaming(camel→snake) → convertResponseNaming(snake→camel) → sanitizeQuery(XSS) →
路由 → errorHandler
```

**命名转换中间件**是本项目特色：前端用 camelCase，数据库用 snake_case，中间件自动双向转换，避免手动映射。

### 3.4 数据模型（14 个）

| 模型 | 说明 | 关键关系 |
|------|------|---------|
| `users` | 用户（super_admin/admin/viewer） | → audit_logs |
| `audit_logs` | 操作审计 | → users |
| `colleges` | 学院 | → classes, training_plans, teachers |
| `majors` | 专业 | → classes, training_plans |
| `training_levels` | 培养层次 | → classes, training_plans |
| `courses` | 课程 | → plan_courses, teaching_assignments |
| `textbooks` | 教材 | → plan_textbooks |
| `classes` | 班级 | → majors, colleges, teaching_assignments |
| `training_plans` | 培养方案 | → majors, colleges, plan_courses |
| `plan_courses` | 方案-课程关联 | → training_plans, plan_course_semesters |
| `plan_course_semesters` | 学期明细 | → plan_courses, plan_textbooks |
| `plan_textbooks` | 学期-教材关联 | → plan_course_semesters, textbooks |
| `teachers` | 教师 | → teacher_courses, teaching_assignments |
| `teaching_assignments` | 教学安排 | → teachers, classes, courses |

**索引覆盖**：主要查询字段均建了索引（status/enrollment_year/major_id/semester 等），性能合理。

### 3.5 安全措施

| 措施 | 实现 |
|------|------|
| HTTPS | nginx 配 HSTS；Cookie 设 Secure（HTTPS 环境） |
| Helmet | CSP/X-Frame-Options/X-Content-Type-Options 等 |
| CORS | 白名单制，支持环境变量配置 |
| XSS | 请求体 + 查询参数双重过滤（xss 库） |
| 速率限制 | 登录/刷新/改密码独立限流 |
| 密码强度 | 大小写+数字+特殊字符，8-128 位 |
| 错误脱敏 | 生产环境 Prisma 错误转友好提示，不泄露堆栈 |
| 审计日志 | 登录/登出/CRUD 全量记录 |

---

## 四、前端架构分析

### 4.1 目录结构

```
client/src/
├── api/            # 11 个 API 模块（封装 request 调用）
├── components/     # 6 个公共组件（Layout/CourseMatrix 等）
├── composables/    # 5 个组合式函数（useCrudList/useSortable 等）
├── router/         # 路由 + 三级权限守卫
├── stores/         # Pinia（auth/settings）
├── utils/          # request/cookies/cache
├── views/          # 页面（按模块组织：class/course/plan/query 等）
├── App.vue
└── main.js
```

### 4.2 权限模型（前后端一致）

| 角色 | 前端路由 | 后端接口 |
|------|---------|---------|
| `super_admin` | 全部 + 系统设置 + 操作日志 | 全部 + settings + audit |
| `admin` | 管理功能（除系统设置/操作日志） | 管理功能 + users |
| `viewer` | 仅查询报表 | query + export |

### 4.3 前后端数据流

```
前端 camelCase → [convertRequestNaming] → 后端 snake_case → Prisma → DB
                                              ↓
前端 camelCase ← [convertResponseNaming] ← 后端 snake_case ← Prisma ← DB
```

统一响应格式：`{ success: boolean, message: string, data: any }`

---

## 五、部署架构

### 5.1 Docker Compose 双容器

| 容器 | 基础镜像 | 端口 | 职责 |
|------|---------|------|------|
| `kec-server` | node:18-alpine | 3000 | Express API + SQLite |
| `kec-client` | nginx:alpine | 80 | 静态文件 + API 反代 |

### 5.2 Nginx 配置要点

- gzip 压缩（level 6）
- 安全响应头（CSP/HSTS/X-Frame-Options 等）
- 静态资源 1 年缓存（hash 文件名）
- API 反代到 `server:3000`
- Vue Router history 模式 `try_files`

### 5.3 数据持久化

```
./data → /app/data     # SQLite 数据库文件
./uploads → /app/uploads  # 上传文件
```

---

## 六、发现的问题

### 🔴 严重

| # | 位置 | 问题 |
|---|------|------|
| 1 | `server/package.json` | version 仍为 `2.6.2`，与根 package.json `2.6.3` **不一致**，版本管理脱节 |
| 2 | `server/` 目录 | 残留两个测试 Excel 文件（`Users80330.qoderworkcnworkspacemqj6cx1uamtydl1p*.xlsx`），不应提交到仓库 |

### 🟠 高危

| # | 位置 | 问题 |
|---|------|------|
| 3 | `auth.service.js` L-84~106 | `refreshToken` 方法**不返回新的 refreshToken**，但前端已修复为支持接收新值——当前后端只返回 `{ token }`，前端 `newRefreshToken` 永远是 `undefined`，refreshToken 无法轮换 |
| 4 | `auth.middleware.js` L-62 | `getActiveUserStatus` 返回 Promise 但用 `.then()` 链式调用，未 `await`——若数据库查询慢，`req.user` 可能在 `next()` 之后才赋值，导致竞态 |
| 5 | ~~`app.js` L-119~~ | ~~`/api/settings` 未加 `authMiddleware`~~ → **已核实为误报**：路由文件内 GET 公开、PUT/POST 均有 `super_admin` 守卫 |

### 🟡 中等

| # | 位置 | 问题 |
|---|------|------|
| 6 | `naming.middleware.js` L-32 | `res.json` 被重写，但未处理 `res.send`/`res.end` 等其他响应方式——若 controller 用 `res.send()` 返回数据，命名转换不生效 |
| 7 | `response.js` `paginate` | 分页响应用 `data.list`，但 `convertResponseNaming` 只处理 `data.data` 和 `data.items`/`data.logs`，**分页数据不会被驼峰转换** |
| 8 | `Dockerfile`（server/client） | 基础镜像用 `node:18-alpine`，但 `package.json` engines 要求 `node>=20.0.0`，**版本不匹配** |
| 9 | `docker-compose.yml` L-1 | `version: '3.8'` 已废弃，新版 docker compose 不再需要 version 字段 |
| 10 | `auth.config.js` L-22~23 | `jwtRefreshSecret`/`jwtDownloadSecret` 在环境变量未设置时**派生自 jwtSecret**，有密钥关联风险 |

### 🟢 低危/建议

| # | 位置 | 问题 |
|---|------|------|
| 11 | `major.routes.js` L-22 | 行尾多余分号 `;;` |
| 12 | 根目录 | 残留大量历史报告文档（CODE_ANALYSIS_REPORT/FRONTEND_OPTIMIZATION_REPORT 等 8 个 md），建议归档到 `docs/` |
| 13 | `server/uploads/` | 目录下有两个测试 xlsx 文件，应加入 `.gitignore` 或清理 |
| 14 | `schema.prisma` | `teachers`/`teacher_courses` 等模型用了 `@@map` 显式映射表名，但其他模型未用——命名风格不统一 |

---

## 七、问题汇总表

| 编号 | 严重度 | 位置 | 问题 |
|------|--------|------|------|
| 1 | 🔴 严重 | `server/package.json` | 后端版本号 2.6.2 与根 2.6.3 不一致 |
| 2 | 🔴 严重 | `server/` | 残留测试 Excel 文件已提交仓库 |
| 3 | 🟠 高危 | `auth.service.js` | refreshToken 接口不返回新 refreshToken，无法轮换 |
| 4 | 🟠 高危 | `auth.middleware.js` | getActiveUserStatus 未 await，存在竞态 |
| 5 | ✅ 误报 | `app.js` | /api/settings 未挂全局 authMiddleware，但路由文件内部 GET 公开、PUT/POST 均加了 super_admin 守卫，权限正确 |
| 6 | 🟡 中等 | `naming.middleware.js` | 仅拦截 res.json，res.send 不转换 |
| 7 | 🟡 中等 | `response.js` + `naming` | 分页响应 data.list 不被驼峰转换 |
| 8 | 🟡 中等 | `Dockerfile` | node:18 与 engines 要求 node>=20 不符 |
| 9 | 🟡 中等 | `docker-compose.yml` | version 字段已废弃 |
| 10 | 🟡 中等 | `auth.config.js` | refresh/download 密钥派生自主密钥 |
| 11 | 🟢 低危 | `major.routes.js` | 多余分号 |
| 12 | 🟢 低危 | 根目录 | 历史报告文档未归档 |
| 13 | 🟢 低危 | `server/uploads/` | 测试文件未清理 |
| 14 | 🟢 低危 | `schema.prisma` | @@map 使用不统一 |

---

## 八、架构评价

### 优点
- **分层清晰**：routes→controllers→services→prisma 标准分层，职责明确
- **安全完善**：JWT 三 Token 体系、helmet、CORS 白名单、XSS 过滤、速率限制、审计日志一应俱全
- **命名转换**：中间件自动处理 camelCase/snake_case，减少手动映射错误
- **部署就绪**：Docker Compose + Nginx 反代 + 健康检查 + 资源限制
- **权限三级**：super_admin/admin/viewer 前后端一致

### 待改进
- **版本同步**：前后端版本号需统一管理
- **controller 直连 prisma**：基础 CRUD controller 直接操作 prisma，未抽象 service 层，复杂业务变更时维护成本高
- **响应转换覆盖不全**：分页响应和 res.send 未纳入命名转换
- **仓库整洁度**：历史文档和测试文件需清理

---

## 九、优先修复建议

**第一批（严重，立即修复）**：
1. 同步 `server/package.json` 版本号至 2.6.3
2. 删除 `server/` 下的测试 Excel 文件

**第二批（高危）**：
3. `auth.service.js` refreshToken 方法返回新的 refreshToken
4. `auth.middleware.js` getActiveUserStatus 改为 await
5. 确认 `/api/settings` 写操作的权限控制

**第三批（中等）**：
6. `naming.middleware.js` 兼容 res.send 或统一用 res.json
7. 分页响应纳入命名转换
8. Dockerfile 升级 node:20-alpine
