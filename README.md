# KEC 课程管理平台

KEC (Knowledge Education Course) 是一个面向中小型教育机构的轻量级教学管理系统，涵盖培养计划、班级管理、教师排课、教材协调和数据导入导出等核心功能。采用前后端分离架构，支持 Docker 容器化部署或裸机部署。

---

## 功能特性

- **培养计划管理** - 按专业或培养层次制定培养方案，可视化课程矩阵编辑各学期课时分布
- **班级管理** - 班级信息维护，基于学期动态计算年级和状态（在读/毕业/离校）
- **教师管理** - 教师档案、任课关联、上课学院和培养层次配置
- **自动排课** - 四轮匹配算法，支持学院偏好、培养层次偏好、教材匹配和容量约束
- **教材管理** - 教材信息维护，与培养计划学期课时关联
- **数据导入导出** - Excel 批量导入班级/课程/教材/教师，支持模板下载和多维度数据导出
- **审计日志** - 全面记录增删改操作，支持筛选查询
- **权限控制** - 三级角色体系（超级管理员/管理员/查看者）

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3.5 + Element Plus 2.14 + Pinia 3 + Vite 5 |
| 后端 | Express 5.1 + Prisma 6.19 + Winston 3.19 |
| 数据库 | SQLite（默认）/ MySQL（可选） |
| 认证 | JWT 双令牌（Access 15min + Refresh 7天）+ bcrypt 12轮 |
| 部署 | Docker Compose / 裸机部署（PM2 + Nginx） |

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

# 安装依赖
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# 配置环境变量
cp server/.env.example server/.env
# 编辑 server/.env，填入 JWT_SECRET 等配置

# 初始化数据库
npm run db:migrate
npm run db:generate
cd server && npm run db:seed && cd ..

# 启动开发服务（前端 5173 + 后端 3000）
npm run dev
```

访问 http://localhost:5173，使用默认账户登录：
- 用户名：`admin`
- 密码：`admin@123456`

### 代码格式化

项目已配置 Prettier 和 ESLint 用于代码格式化和质量检查：

```bash
# 前端代码格式化
cd client
npm run format    # 格式化代码
npm run lint      # 检查并自动修复

# 后端代码格式化
cd server
npm run format    # 格式化代码
npm run lint      # 检查并自动修复
```

详见 [代码格式化指南](CODE_FORMATTING.md)。

---

## 部署

### 方式一：Docker Compose（推荐）

```bash
# 创建环境变量文件
cat > .env << 'EOF'
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
JWT_DOWNLOAD_SECRET=$(openssl rand -hex 32)
CORS_ORIGINS=https://your-domain.com
SERVER_PORT=3000
CLIENT_PORT=80
CONTAINER_PREFIX=kec
NETWORK_NAME=kec-network
EOF

# 构建并启动
docker-compose up -d --build
```

服务启动后：
- 前端：http://your-server:80
- 后端 API：http://your-server:3000
- 健康检查：http://your-server:3000/api/health

### 方式二：裸机部署

```bash
# 一键部署脚本（支持本地或远程服务器）
bash deploy.sh
# 远程部署：bash deploy.sh root@your-server.com
```

部署脚本会自动完成：环境检查 → 目录创建 → 代码拉取 → 依赖安装 → 密钥生成 → 数据库迁移 → 前端构建 → PM2 启动。

### 服务器要求

| 项目 | 最低配置 |
|------|---------|
| CPU | 1 核 |
| 内存 | 2 GB |
| 磁盘 | 10 GB |
| 系统 | CentOS 7+ / Ubuntu 18+ / Debian 10+ |
| 软件 | Node.js 20+, Nginx 1.18+ |

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NODE_ENV` | 运行环境 | `production` |
| `DATABASE_URL` | 数据库连接串 | `file:./data/kec.db` |
| `PORT` | 后端端口 | `3000` |
| `JWT_SECRET` | JWT 签名密钥（64位 hex） | 必填 |
| `JWT_REFRESH_SECRET` | 刷新令牌密钥 | 自动生成（基于主密钥） |
| `JWT_DOWNLOAD_SECRET` | 下载令牌密钥 | 自动生成（基于主密钥） |
| `CORS_ORIGINS` | 允许的前端域名（逗号分隔） | `http://localhost:5173` |
| `LOG_LEVEL` | 日志级别 | `info` |

---

## 项目结构

```
kec-manager/
├── client/                     # 前端（Vue 3 + Element Plus）
│   ├── src/
│   │   ├── api/                # API 接口模块
│   │   ├── components/         # 共享组件（Layout、CourseMatrix 等）
│   │   ├── composables/        # 可复用逻辑（useCrudList、useSortable 等）
│   │   ├── router/             # 路由配置 + 导航守卫
│   │   ├── stores/             # Pinia 状态管理
│   │   ├── views/              # 页面组件（按领域划分）
│   │   └── main.js             # 应用入口
│   ├── .prettierrc             # Prettier 配置
│   ├── eslint.config.js        # ESLint 配置
│   ├── nginx.conf              # Nginx 配置
│   └── vite.config.js          # Vite 构建配置
├── server/                     # 后端（Express + Prisma）
│   ├── src/
│   │   ├── controllers/        # 请求处理（按领域划分）
│   │   ├── services/           # 业务逻辑层
│   │   ├── middleware/         # 中间件（认证/XSS/校验/分页/命名转换）
│   │   ├── routes/             # 路由定义
│   │   └── utils/              # 工具函数
│   ├── .prettierrc             # Prettier 配置
│   ├── eslint.config.js        # ESLint 配置
│   └── prisma/
│       └── schema.prisma       # 数据库模型定义
├── docker-compose.yml          # Docker 编排配置
├── deploy.sh                   # 裸机部署脚本
├── CODE_FORMATTING.md          # 代码格式化指南
└── docs/                       # 项目文档
```

---

## 数据库模型

| 模型 | 说明 |
|------|------|
| `users` | 用户账户（三级角色） |
| `colleges` / `majors` / `training_levels` | 基础数据（学院/专业/培养层次） |
| `classes` | 班级（入学年份、学制、状态、关联专业/学院） |
| `courses` / `textbooks` | 课程目录 / 教材目录 |
| `training_plans` → `plan_courses` → `plan_course_semesters` → `plan_textbooks` | 培养方案链路 |
| `teachers` → `teacher_courses` / `teacher_scheduling_colleges` / `teacher_training_levels` | 教师关联 |
| `teaching_assignments` | 排课记录（教师-班级-课程-学期） |
| `system_settings` | 系统配置 |
| `audit_logs` | 审计日志 |

---

## API 接口

所有接口以 `/api` 为前缀，除登录和系统设置查询外均需 JWT 认证。

| 模块 | 路径 | 说明 |
|------|------|------|
| 认证 | `/api/auth/*` | 登录、刷新令牌、修改密码 |
| 学院 | `/api/colleges` | CRUD |
| 专业 | `/api/majors` | CRUD |
| 培养层次 | `/api/training-levels` | CRUD |
| 课程 | `/api/courses` | CRUD + 导入导出 |
| 教材 | `/api/textbooks` | CRUD + 批量操作 + 导入导出 |
| 班级 | `/api/classes` | CRUD + 批量操作 + 导入 |
| 培养方案 | `/api/plans` | 方案管理 + 课程矩阵 + 教材关联 |
| 教师 | `/api/teachers` | CRUD + 导入导出 |
| 排课 | `/api/teaching-arrange` | 手动排课、自动排课、批量排课、统计 |
| 查询 | `/api/query` | 学期查询、教材查询、方案查询 |
| 导出 | `/api/export` | 多维度 Excel 导出 + 模板下载 |
| 导入 | `/api/import` | Excel 批量导入 |
| 系统设置 | `/api/settings` | 学期配置、数据重置 |
| 用户管理 | `/api/users` | 用户 CRUD（管理员权限） |
| 审计日志 | `/api/audit` | 操作日志查询（超级管理员） |

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

## 相关文档

- [代码格式化指南](CODE_FORMATTING.md) - Prettier 和 ESLint 配置与使用
- [排课逻辑详解](docs/TEACHING_ARRANGE_LOGIC.md) - 自动排课算法、匹配规则、容量约束
- [部署指南](docs/DEPLOYMENT_GUIDE.md) - 详细部署步骤和 Nginx 配置
- [生产环境部署](docs/PRODUCTION_DEPLOYMENT.md) - 生产环境最佳实践

---

## 许可证

[MIT License](LICENSE) - Copyright (c) 2026 Tim27
