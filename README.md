# KEC 课程管理平台

> 面向大中专职业院校教学管理人员的轻量级教学管理系统

**版本** v1.1.0 · **技术栈** Vue 3 + Express 5 + Prisma 6 · **数据库** SQLite WAL

---

## 功能概览

| 模块 | 能力 |
|------|------|
| 培养方案 | 按专业/层次制定方案，可视化课程矩阵编辑各学期课时分布，教材关联到学期 |
| 班级管理 | 班级 CRUD、合班教学组、基于入学年份和学制动态计算年级与在读状态 |
| 教师管理 | 教师档案、任课/学院/层次偏好配置、自定义周课时 |
| 自动排课 | 五阶段匹配 + 置换回溯算法，可选禁忌搜索优化；支持预览模式、批量排课、历史学期保护 |
| 教材管理 | 教材 CRUD、与培养方案学期关联、征订状态跟踪 |
| 数据导入导出 | Excel 批量导入（班级/课程/教材/教师）、模板下载、多维度数据导出 |
| 统一查询 | 开课查询、教材查询、方案查询，多维度筛选与级联联动 |
| 课时统计 | 教师/班级/课程多维统计、图表可视化、Excel 导出 |
| 审计日志 | 增删改全量记录，按模块/操作员/时间筛选 |
| 权限控制 | 三级角色（super\_admin / admin / viewer），路由守卫 + API 鉴权双重校验 |

---

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Vue 3.5 (Script Setup) + Element Plus 2.14 + Pinia 3 + Vite 5 |
| 后端 | Express 5.1 + Prisma 6.19 + Winston 3.19 |
| 数据库 | SQLite（WAL 模式） |
| 认证 | JWT 双令牌（Access 15 min + Refresh 7 d）+ HttpOnly Cookie + CSRF 双重提交 + bcrypt 12 轮 |
| 测试 | Vitest + Supertest（1343 个用例） |
| 部署 | PM2 + Nginx |

---

## 快速开始

### 环境要求

- Node.js >= 20
- npm >= 10

### 安装与启动

```bash
# 1. 克隆仓库
git clone https://gitee.com/shub77/kec-manager.git
cd kec-manager

# 2. 安装依赖（根目录 + server + client 三处）
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# 3. 配置环境变量
cp server/.env.example server/.env
# 编辑 server/.env，填入：
#   JWT_SECRET         — 随机 64 位 hex
#   JWT_REFRESH_SECRET — 随机 64 位 hex
#   JWT_DOWNLOAD_SECRET — 随机 64 位 hex
# 开发环境若未设置，启动时自动生成临时密钥（仅本次进程有效）

# 4. 初始化数据库
npm run db:migrate          # 执行迁移
npm run db:generate         # 生成 Prisma Client
cd server && npm run db:seed && cd ..   # 种子数据

# 5. 启动开发服务
npm run dev                 # 前端 :5173 + 后端 :3002 同时启动
```

访问 <http://localhost:5173>，默认账户：

| 用户名 | 密码 | 备注 |
|--------|------|------|
| `admin` | `admin@123456` | 首次登录强制改密 |

---

## 常用命令

> 根目录脚本代理到 `server/` 或 `client/`，切勿在错误层级执行。

### 根目录

```bash
npm run dev              # 同时启动前后端
npm run dev:server       # 仅后端
npm run dev:client       # 仅前端
npm run db:migrate       # 数据库迁移
npm run db:generate      # 生成 Prisma Client
npm run version:patch    # 补丁版本 1.1.0 → 1.1.1
npm run version:minor    # 次版本   1.1.0 → 1.2.0
npm run version:major    # 主版本   1.1.0 → 2.0.0
```

### server/

```bash
npm run dev              # --watch 自动重启，端口 3002
npm start                # 生产模式
npm run db:seed          # 种子数据
npm run db:seed:reset    # 强制重置 + 重新 seed
npm run db:reset         # 重建数据库
npm test                 # Vitest
npm run test:coverage    # 覆盖率报告
npm run lint             # ESLint 检查并修复
npm run format           # Prettier 格式化
```

### client/

```bash
npm run dev              # Vite 开发服务器，端口 5173
npm run build            # 生产构建
npm run lint             # ESLint 检查并修复
npm run format           # Prettier 格式化
```

---

## 项目结构

```
kec-manager/
├── client/                          # 前端 Vue 3 + Element Plus
│   ├── src/
│   │   ├── api/                     # API 接口（17 个模块）
│   │   ├── components/              # 公共组件（Layout、CourseMatrix、EmptyState 等）
│   │   ├── composables/             # 组合式函数（useCrudList、useImport、useSemesters 等）
│   │   ├── router/                  # 路由配置 + 三级权限守卫
│   │   ├── stores/                  # Pinia 状态（auth、settings）
│   │   ├── utils/                   # 工具（axios 封装、缓存、Cookie、下载）
│   │   └── views/                   # 页面视图（25 个）
│   └── vite.config.js               # Vite 构建 + 分包策略
├── server/                          # 后端 Express + Prisma
│   ├── src/
│   │   ├── controllers/             # 请求处理（含 import/export 子模块）
│   │   ├── middleware/              # 认证 / CSRF / XSS / 校验 / 分页
│   │   ├── routes/                  # 路由定义（17 个模块）
│   │   ├── services/                # 业务逻辑
│   │   │   └── arrange/             # 排课算法（五阶段 + 禁忌搜索）
│   │   └── utils/                   # Excel / SSE / 排序工具
│   ├── prisma/
│   │   ├── schema.prisma            # 21 个数据模型
│   │   ├── migrations/              # 迁移文件
│   │   └── seed.js                  # 种子数据
│   └── vitest.config.js             # 测试配置
├── docs/                            # 项目文档（16 篇）
├── deploy.sh                        # 一键部署脚本
├── deploy_ssh.sh                    # SSH 远程部署
├── ecosystem.config.cjs             # PM2 进程配置
└── package.json                     # 根配置
```

---

## 数据模型

| 模型 | 说明 |
|------|------|
| `users` | 用户账户（三级角色） |
| `colleges` | 学院/系部 |
| `majors` | 专业 |
| `training_levels` | 培养层次 |
| `classes` | 班级（入学年份、学制、状态、合班组） |
| `class_combinations` | 合班教学组 |
| `courses` | 课程（名称唯一约束） |
| `textbooks` | 教材（书名唯一约束） |
| `training_plans` | 培养方案 |
| `plan_courses` | 方案课程（起止学期、周课时） |
| `plan_course_semesters` | 课程学期明细（周课时、周数） |
| `plan_textbooks` | 课程-教材关联 |
| `teachers` | 教师档案 |
| `teacher_courses` | 教师任课关联 |
| `teacher_scheduling_colleges` | 教师上课学院意向 |
| `teacher_training_levels` | 教师培养层次意向 |
| `teaching_assignments` | 排课记录（手动/自动标记） |
| `system_settings` | 系统配置 |
| `audit_logs` | 审计日志 |
| `token_blacklist` | JWT 令牌黑名单 |
| `arrange_locks` | 排课并发锁 |

---

## API 接口

所有接口以 `/api` 为前缀，除登录和健康检查外均需 JWT 认证。

| 模块 | 路径 | 说明 |
|------|------|------|
| 健康检查 | `/api/health` | 服务状态（公开） |
| 认证 | `/api/auth` | 登录 / 刷新令牌 / 修改密码 |
| 学院 | `/api/colleges` | CRUD |
| 专业 | `/api/majors` | CRUD |
| 培养层次 | `/api/training-levels` | CRUD |
| 课程 | `/api/courses` | CRUD + 导入导出 |
| 教材 | `/api/textbooks` | CRUD + 批量操作 + 导入导出 |
| 班级 | `/api/classes` | CRUD + 合班组 + 导入 |
| 培养方案 | `/api/plans` | 方案管理 + 课程矩阵 + 教材关联 |
| 教师 | `/api/teachers` | CRUD + 导入导出 |
| 排课 | `/api/teaching-arrange` | 手动 / 自动 / 批量排课 + SSE 进度 |
| 查询 | `/api/query` | 学期 / 教材 / 方案多维查询 |
| 导出 | `/api/export` | Excel 导出 + 模板下载 |
| 导入 | `/api/import` | Excel 批量导入 |
| 系统设置 | `/api/settings` | 学期配置 / 排课优化 / 数据重置 |
| 用户管理 | `/api/users` | 用户 CRUD（管理员权限） |
| 审计日志 | `/api/audit` | 操作日志查询（超级管理员） |

---

## 角色权限

| 功能 | super\_admin | admin | viewer |
|------|:---:|:---:|:---:|
| 查看数据 | ✓ | ✓ | ✓ |
| 基础数据管理（学院/专业/课程等） | ✓ | ✓ | — |
| 培养方案与排课 | ✓ | ✓ | — |
| 导入/导出 | ✓ | ✓ | — |
| 用户管理 | ✓ | 仅 viewer | — |
| 系统设置 / 数据重置 | ✓ | — | — |
| 审计日志 | ✓ | — | — |

---

## 排课算法

自动排课采用 **五阶段匹配 + 置换回溯** 算法，可选叠加 **禁忌搜索优化层**：

1. **教材分组优先** — 所有教师先拿完第一本教材，再拿第二本
2. **学院内聚** — 优先拿完一个学院的班级，再拿其他学院
3. **意向约束严格** — 指定了学院/层次意向的教师严格按意向分配
4. **容量约束** — 教师课时不超过标准/满载容量，支持教材数量硬上限
5. **手动排课保护** — 自动排课永远不覆盖手动排课记录
6. **合班一致性** — 同一合班组的成员班强制共享同一教师，按逻辑教学单元计课时
7. **禁忌搜索（可选）** — 在贪心初始解基础上通过 Insert/Shift/Swap 邻域搜索迭代优化

算法模块位于 `server/src/services/arrange/`。禁忌搜索默认关闭，可通过系统设置页面动态启用。

---

## 部署

### 一键部署

```bash
# 本地部署
bash deploy.sh

# 远程部署
bash deploy.sh root@your-server.com

# SSH 远程部署（增量更新、备份）
bash deploy_ssh.sh root@your-server.com
```

部署脚本自动完成：环境检查 → 目录创建 → 代码拉取 → 依赖安装 → 停止旧服务 → 环境变量配置 → 数据库迁移 → 系统设置初始化 → 前端构建 → PM2 启动。

### 服务器要求

| 项目 | 最低配置 |
|------|---------|
| CPU | 1 核 |
| 内存 | 2 GB |
| 磁盘 | 10 GB |
| 系统 | CentOS 7+ / Ubuntu 18+ / Debian 10+ |
| 软件 | Node.js 20+, Nginx 1.18+, PM2, Git |

---

## 环境变量

### 开发环境

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NODE_ENV` | 运行环境 | `development` |
| `PORT` | 后端端口 | `3002` |
| `DATABASE_URL` | SQLite 连接串 | `file:./data/kec.db` |
| `JWT_SECRET` | 访问令牌签名密钥 | 开发环境自动生成 |
| `JWT_REFRESH_SECRET` | 刷新令牌签名密钥 | 开发环境自动生成 |
| `JWT_DOWNLOAD_SECRET` | 下载令牌签名密钥 | 开发环境自动生成 |
| `JWT_EXPIRES_IN` | 访问令牌有效期 | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | 刷新令牌有效期 | `7d` |
| `CORS_ORIGINS` | 允许的前端域名 | `http://localhost:5173` |
| `LOG_LEVEL` | 日志级别 | `debug` |
| `BCRYPT_ROUNDS` | bcrypt 迭代次数 | `10` |
| `MAX_FILE_SIZE` | 上传文件大小限制 | `10` (MB) |
| `DEFAULT_SEMESTER` | 默认学期 | `2025-2026-2` |

### 生产环境

| 变量 | 说明 |
|------|------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | 数据库绝对路径 |
| `JWT_*` | 三类密钥（随机 64 位 hex，部署脚本自动生成） |
| `CORS_ORIGINS` | 生产域名 |
| `LOG_LEVEL` | `info` |
| `BCRYPT_ROUNDS` | `12` |

> `DATABASE_URL` 中的 `file:./data/kec.db` 相对于 `prisma/schema.prisma` 解析，实际数据库文件位于 `server/prisma/data/kec.db`。

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [部署与运维指南](docs/DEPLOYMENT.md) | 部署、更新、备份恢复、故障排查 |
| [排课算法说明](docs/SCHEDULING_ALGORITHM.md) | 五阶段算法、评分机制、教材内聚策略 |
| [排课算法迭代分析](docs/SCHEDULING_ALGORITHM_ITERATION.md) | 禁忌搜索方案设计与实施记录 |
| [学期计算说明](docs/SEMESTER-CALCULATION.md) | 学期状态计算逻辑 |
| [安全审计报告](docs/AUDIT_REPORT.md) | 安全漏洞检测与修复记录 |
| [代码格式化指南](docs/CODE_FORMATTING.md) | Prettier + ESLint 配置 |
| [命名规范迁移](docs/NAMING_CONVENTION_MIGRATION.md) | 前后端命名规范与迁移方案 |
| [版本管理指南](docs/VERSION_MANAGEMENT.md) | 语义化版本与自动化脚本 |

---

## 许可证

[MIT License](LICENSE) — Copyright (c) 2026 Tim27
# KEC 课程管理平台

KEC (Knowledge Education Course) 是一个面向中小型教育机构的轻量级教学管理系统，涵盖培养计划、班级管理、教师排课、教材协调和数据导入导出等核心功能。采用前后端分离架构，基于 PM2 + Nginx 部署。

**版本**：v1.0.0 | **数据库**：SQLite（WAL 模式）

---

## 功能特性

- **培养计划管理** - 按专业或培养层次制定培养方案，可视化课程矩阵编辑各学期课时分布
- **班级管理** - 班级信息维护，支持合班教学组，基于学期动态计算年级和状态（在读/毕业/离校）
- **教师管理** - 教师档案、任课关联、上课学院和培养层次配置
- **自动排课** - 五阶段匹配 + 置换回溯算法，可选禁忌搜索优化层，支持学院偏好、培养层次偏好、教材匹配和容量约束；合班成员班强制共享同一教师
- **教材管理** - 教材信息维护，与培养计划学期课时关联，支持征订状态跟踪
- **数据导入导出** - Excel 批量导入班级/课程/教材/教师，支持模板下载和多维度数据导出
- **统一查询** - 开课查询、教材查询、方案查询，支持多维度筛选与联动
- **审计日志** - 全面记录增删改操作，支持筛选查询
- **权限控制** - 三级角色体系（超级管理员 / 管理员 / 查看者）

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3.5 + Element Plus 2.14 + Pinia 3 + Vite 6 |
| 后端 | Express 5.1 + Prisma 6.19 + Winston 3.19 |
| 数据库 | SQLite（WAL 模式） |
| 认证 | JWT 双令牌（Access 15min + Refresh 7天）+ HttpOnly Cookie + CSRF 双重提交 + bcrypt 12轮 |
| 测试 | Vitest + Supertest（1343 个测试用例，完整测试覆盖） |
| 部署 | PM2 + Nginx |

---

## 快速开始

### 环境要求

- Node.js >= 20.0.0
- npm >= 10.0.0
- Git

### 本地开发

```bash
# 克隆仓库
git clone https://gitee.com/shub77/kec-manager.git
cd kec-manager

# 安装依赖（根 / 后端 / 前端 三处）
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# 配置环境变量
cp server/.env.example server/.env
# 编辑 server/.env，至少填入 JWT_SECRET / JWT_REFRESH_SECRET / JWT_DOWNLOAD_SECRET（随机 64 位 hex）
# 注意：开发环境若未设置 JWT_SECRET，服务启动时会自动生成临时密钥（仅本次进程有效，并打印安全告警）；生产环境务必替换为持久随机密钥

# 初始化数据库
npm run db:migrate       # 在 server/ 下执行迁移
npm run db:generate      # 生成 Prisma Client
cd server && npm run db:seed && cd ..   # 写入种子数据（admin / admin@123456）

# 启动开发服务（前端 5173 + 后端 3002）
npm run dev
```

访问 http://localhost:5173，使用默认账户登录：

- 用户名：`admin`
- 密码：`admin@123456`
- 首次登录需修改密码

---

## 常用命令

> ⚠️ 本项目的脚本分属**根目录**与 **`server/`** 两个层级，切勿混用。根目录只代理了少量数据库脚本；种子、测试、格式化等命令都在 `server/` 下。

### 根目录（kec-manager/）

```bash
npm run dev            # 同时启动前端(5173) + 后端(3002)
npm run dev:server     # 仅启动后端
npm run dev:client     # 仅启动前端
npm run db:migrate     # 执行数据库迁移（代理到 server）
npm run db:generate    # 生成 Prisma Client（代理到 server）
npm run version        # 查看当前版本
npm run version:patch  # 补丁版本 (1.0.0 → 1.0.1)
npm run version:minor  # 次版本 (1.0.0 → 1.1.0)
npm run version:major  # 主版本 (1.0.0 → 2.0.0)
```

### 后端（kec-manager/server/）

```bash
cd server
npm run dev            # 启动后端（--watch 自动重启，端口 3002）
npm start              # 生产模式启动
npm run db:seed        # 初始化种子数据
npm run db:seed:dev    # 开发环境种子数据
npm run db:seed:reset  # 强制重置并重新 seed
npm run db:reset       # 重置数据库（重建表）
npm test               # 运行测试（Vitest）
npm run test:watch     # 监听模式运行测试
npm run test:coverage  # 测试并生成覆盖率报告
npm run format         # Prettier 格式化
npm run lint           # ESLint 检查并修复
npm run diagnose       # 运行诊断
npm run init:settings  # 初始化系统设置
```

### 前端（kec-manager/client/）

```bash
cd client
npm run dev        # 启动开发服务器（端口 5173）
npm run build      # 生产构建
npm run format     # 格式化代码
npm run lint       # ESLint 检查并修复
```

详见 [代码格式化指南](docs/CODE_FORMATTING.md) 和 [版本管理指南](docs/VERSION_MANAGEMENT.md)。

---

## 部署

### 一键部署（推荐）

```bash
# 本地部署
bash deploy.sh

# 远程部署
bash deploy.sh root@your-server.com

# SSH 远程部署（支持增量更新、备份等）
bash deploy_ssh.sh root@your-server.com
```

部署脚本会自动完成 10 个步骤：环境检查 → 目录创建 → 代码拉取 → 依赖安装 → 停止旧服务 → 配置环境变量 → 数据库迁移 → 初始化系统设置 → 前端构建 → PM2 启动。

服务启动后：

- 前端：http://your-server（80 端口，由 Nginx 代理）
- 后端 API：http://your-server:3002（内部端口，不对外暴露）
- 健康检查：http://your-server:3002/api/health

### 服务器要求

| 项目 | 最低配置 |
|------|---------|
| CPU | 1 核 |
| 内存 | 2 GB |
| 磁盘 | 10 GB |
| 系统 | CentOS 7+ / Ubuntu 18+ / Debian 10+ |
| 软件 | Node.js 20+, Nginx 1.18+, PM2, Git |

详见 [部署与运维指南](docs/DEPLOYMENT.md)。

---

## 环境变量

### 开发环境（`.env.example`）

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `NODE_ENV` | 运行环境 | `development` |
| `PORT` | 后端端口 | `3002` |
| `DATABASE_URL` | 数据库连接串 | `file:./data/kec.db` |
| `JWT_SECRET` | JWT 签名密钥（64 位 hex） | 必填 |
| `JWT_REFRESH_SECRET` | 刷新令牌密钥 | 必填 |
| `JWT_DOWNLOAD_SECRET` | 下载令牌密钥 | 必填 |
| `JWT_EXPIRES_IN` | 访问令牌过期时间 | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | 刷新令牌过期时间 | `7d` |
| `JWT_DOWNLOAD_EXPIRES_IN` | 下载令牌过期时间 | `30s` |
| `CORS_ORIGINS` | 允许的前端域名（逗号分隔） | `http://localhost:5173` |
| `LOG_LEVEL` | 日志级别 | `debug` |
| `BCRYPT_ROUNDS` | bcrypt 迭代次数 | `10` |
| `MAX_FILE_SIZE` | 文件上传大小限制（MB） | `10` |
| `DEFAULT_SEMESTER` | 默认学期（格式 YYYY-YYYY-N） | `2025-2026-2` |

> 📌 `DATABASE_URL` 中的 `file:./data/kec.db` 由 Prisma 相对于 `prisma/schema.prisma` 解析，实际数据库文件落在 **`server/prisma/data/kec.db`**（含 `.wal` / `.shm` 配套文件）。迁移/重置命令也作用于该路径。

### 生产环境（`.env.production.example`）

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `NODE_ENV` | 运行环境 | `production` |
| `DATABASE_URL` | 数据库绝对路径 | `file:/opt/.../server/data/kec.db` |
| `JWT_*` | 三类 JWT 密钥 | 随机 64 位 hex（部署脚本自动生成） |
| `CORS_ORIGINS` | 允许的生产域名 | `https://your-domain.com` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `BCRYPT_ROUNDS` | bcrypt 迭代次数 | `12` |

---

## 项目结构

```
kec-manager/
├── client/                     # 前端（Vue 3 + Element Plus）
│   ├── src/
│   │   ├── api/                # API 接口模块
│   │   ├── assets/             # 静态资源
│   │   ├── components/         # 共享组件（Layout、CourseMatrix 等）
│   │   ├── composables/        # 可复用逻辑（useCrudList、useSortable 等）
│   │   ├── router/             # 路由配置 + 导航守卫
│   │   ├── stores/             # Pinia 状态管理
│   │   ├── styles/             # 全局样式 + 响应式断点
│   │   ├── utils/              # 工具函数（request、download、cache 等）
│   │   ├── views/              # 页面组件
│   │   └── main.js             # 应用入口
│   ├── eslint.config.js        # ESLint 配置
│   └── vite.config.js          # Vite 构建配置
├── server/                     # 后端（Express + Prisma）
│   ├── src/
│   │   ├── config/             # 配置文件
│   │   ├── constants/          # 常量定义（排课算法参数等）
│   │   ├── controllers/        # 请求处理（含 import/export 子模块）
│   │   ├── lib/                # 库封装（Prisma 客户端等）
│   │   ├── middleware/         # 中间件（认证/CSRF/XSS/校验/分页/命名转换）
│   │   ├── routes/             # 路由定义
│   │   ├── services/           # 业务逻辑层
│   │   │   ├── arrange/        # 排课算法（auto-arrange/batch/lock/queries/validate/tabu-search）
│   │   │   └── *.service.js    # 其他业务服务
│   │   ├── utils/              # 工具函数（Excel/SSE/排序/命名转换）
│   │   └── server.js           # 服务入口
│   ├── prisma/
│   │   ├── schema.prisma       # 数据库模型定义（21 个模型）
│   │   ├── migrations/         # 数据库迁移文件
│   │   └── seed.js             # 种子数据
│   ├── scripts/                # 运维脚本（初始化设置、重置数据库、诊断等）
│   ├── .env.example            # 开发环境变量示例
│   ├── .env.production.example # 生产环境变量示例
│   ├── eslint.config.js        # ESLint 配置
│   └── vitest.config.js        # 测试配置
├── scripts/                    # 项目级脚本
│   └── version.js              # 版本管理脚本
├── docs/                       # 项目文档（11 个文档）
├── deploy.sh                   # 部署脚本（支持本地/远程）
├── deploy_ssh.sh               # SSH 远程部署脚本
├── CHANGELOG.md                # 变更日志
└── package.json                # 根配置（版本 1.0.0）
```

---

## 数据库模型

| 模型 | 说明 |
|------|------|
| `users` | 用户账户（三级角色：super_admin / admin / viewer） |
| `colleges` | 学院/系部 |
| `majors` | 专业 |
| `training_levels` | 培养层次（本科/专科等） |
| `classes` | 班级（入学年份、学制、状态、关联专业/学院/合班组） |
| `class_combinations` | 合班教学组（同组合班共享排课关系） |
| `courses` | 课程目录（名称、代码、类型，名称唯一） |
| `textbooks` | 教材目录（ISBN、出版社、作者、版次、价格，书名唯一） |
| `training_plans` | 培养方案（关联专业/学院/层次） |
| `plan_courses` | 方案课程（起止学期、周课时） |
| `plan_course_semesters` | 方案课程学期（周课时、周数） |
| `plan_textbooks` | 方案课程教材关联 |
| `teachers` | 教师档案（人员类型、资格、周课时、关联学院/层次） |
| `teacher_courses` | 教师任课关联 |
| `teacher_scheduling_colleges` | 教师上课学院意向 |
| `teacher_training_levels` | 教师培养层次意向 |
| `teaching_assignments` | 排课记录（教师-班级-课程-学期，手动/自动标记） |
| `system_settings` | 系统配置（键值对） |
| `audit_logs` | 审计日志（操作、模块、操作员、IP、详情） |
| `token_blacklist` | JWT 令牌黑名单（支持令牌撤销） |
| `arrange_locks` | 排课并发锁（防止同一课程重复排课） |

---

## API 接口

所有接口以 `/api` 为前缀，除登录和系统设置查询外均需 JWT 认证。

| 模块 | 路径 | 说明 |
|------|------|------|
| 健康检查 | `/api/health` | 服务状态检查（公开） |
| 认证 | `/api/auth` | 登录、刷新令牌、修改密码 |
| 学院 | `/api/colleges` | CRUD |
| 专业 | `/api/majors` | CRUD |
| 培养层次 | `/api/training-levels` | CRUD |
| 课程 | `/api/courses` | CRUD + 导入导出 |
| 教材 | `/api/textbooks` | CRUD + 批量操作 + 导入导出 |
| 班级 | `/api/classes` | CRUD + 批量操作 + 导入 |
| 培养方案 | `/api/plans` | 方案管理 + 课程矩阵 + 教材关联 |
| 教师 | `/api/teachers` | CRUD + 导入导出 |
| 排课 | `/api/teaching-arrange` | 手动排课、自动排课、批量排课、统计、课时设置 |
| 查询 | `/api/query` | 学期查询、教材查询、方案查询 |
| 导出 | `/api/export` | 多维度 Excel 导出 + 模板下载 |
| 导入 | `/api/import` | Excel 批量导入 |
| 系统设置 | `/api/settings` | 学期配置、系统设置、数据重置 |
| 用户管理 | `/api/users` | 用户 CRUD（管理员权限） |
| 审计日志 | `/api/audit` | 操作日志查询（超级管理员） |
| 首页概览 | `/api/dashboard` | 统计数据概览 |

---

## 角色权限

| 功能 | super_admin | admin | viewer |
|------|:-----------:|:-----:|:------:|
| 查看数据 | ✓ | ✓ | ✓ |
| 基础数据管理 | ✓ | ✓ | - |
| 导入/导出 | ✓ | ✓ | - |
| 排课操作 | ✓ | ✓ | - |
| 用户管理 | ✓ | 仅 viewer | - |
| 系统设置/重置 | ✓ | - | - |
| 审计日志 | ✓ | - | - |

---

## 排课算法

自动排课采用**五阶段匹配 + 置换回溯**算法，可选叠加**禁忌搜索优化层**，核心策略：

1. **教材分组优先** - 所有教师先拿完第一本教材，再拿第二本
2. **学院内聚** - 优先拿完一个学院的班级，再拿其他学院
3. **意向约束严格** - 指定了学院/层次意向的教师严格按意向分配
4. **容量约束** - 教师课时不超过标准/满载容量，支持教材数量硬上限
5. **手动排课保护** - 自动排课永远不覆盖手动排课记录
6. **合班一致性** - 同一 `combination_id` 的成员班在自动/手动排课中强制共享同一教师，且按逻辑教学单元计课时（不重复计数）
7. **禁忌搜索优化（可选）** - 在贪心初始解基础上，通过 Insert/Shift/Swap 邻域搜索迭代优化排课质量

算法模块位于 `server/src/services/arrange/`，包含完整的测试覆盖。禁忌搜索默认关闭，可通过系统设置页面动态启用。

详见 [排课算法完整说明](docs/SCHEDULING_ALGORITHM.md) 和 [排课算法迭代分析](docs/SCHEDULING_ALGORITHM_ITERATION.md)。

---

## 相关文档

- [部署与运维指南](docs/DEPLOYMENT.md) - 部署、更新、备份恢复、故障排查
- [排课算法完整说明](docs/SCHEDULING_ALGORITHM.md) - 五阶段算法、评分机制、教材内聚策略、禁忌搜索优化、代码索引
- [排课算法迭代分析](docs/SCHEDULING_ALGORITHM_ITERATION.md) - 禁忌搜索方案设计分析与实施记录
- [代码格式化指南](docs/CODE_FORMATTING.md) - Prettier 和 ESLint 配置与使用
- [学期计算说明](docs/SEMESTER-CALCULATION.md) - 学期状态计算逻辑
- [命名规范迁移](docs/NAMING_CONVENTION_MIGRATION.md) - 前后端命名规范与迁移方案
- [版本管理指南](docs/VERSION_MANAGEMENT.md) - 语义化版本与自动化版本脚本
- [UI 设计审查](docs/UI_DESIGN_REVIEW.md) - 视觉与交互设计改进建议及实施状态
- [UI 架构审查（第二轮）](docs/UI_ARCHITECTURE_REVIEW_2.md) - 布局一致性、渲染性能、交互细节审查
- [前端架构审查（第三轮）](docs/FRONTEND_ARCHITECTURE_REVIEW_3.md) - 前后端调用链、API 层、stores/composables 审查
- [安全审计报告](docs/AUDIT_REPORT.md) - 安全漏洞检测与修复记录

---

## 许可证

[MIT License](LICENSE) - Copyright (c) 2026 Tim27
