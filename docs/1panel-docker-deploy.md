# 1Panel 容器化部署指南

本文档详细介绍如何在 1Panel 面板中部署 KEC 课程管理平台。

---

## 📋 目录

- [前置要求](#前置要求)
- [快速开始](#快速开始)
- [部署步骤](#部署步骤)
  - [第一步：安装 1Panel](#第一步安装-1panel)
  - [第二步：准备项目文件](#第二步准备项目文件)
  - [第三步：配置环境变量](#第三步配置环境变量)
  - [第四步：启动服务](#第四步启动服务)
  - [第五步：初始化管理员](#第五步初始化管理员)
- [域名与 HTTPS 配置](#域名与-https-配置)
- [数据备份与恢复](#数据备份与恢复)
- [常见问题](#常见问题)

---

## 前置要求

### 服务器要求

| 项目 | 最低配置 | 推荐配置 |
|------|---------|---------|
| 操作系统 | CentOS 7+ / Ubuntu 20.04+ / Debian 11+ | Ubuntu 22.04 LTS |
| CPU | 1 核 | 2 核及以上 |
| 内存 | 2 GB | 4 GB 及以上 |
| 硬盘 | 20 GB 可用空间 | 50 GB SSD |
| 网络 | 可访问外网（下载镜像） | 固定公网 IP |

### 软件要求

- **1Panel**: v1.10+（内置 Docker + Docker Compose）
- **浏览器**: Chrome 90+ / Edge 90+（用于访问管理界面）

---

## 快速开始

如果你已经安装了 1Panel，可以通过以下步骤快速部署：

```bash
# 1. 克隆项目
cd /opt && git clone https://gitee.com/shub77/kec-manager.git && cd kec-manager

# 2. 复制环境变量文件
cp .env.example .env

# 3. 生成 JWT 密钥并写入 .env 文件
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
sed -i "s/your-super-secret-jwt-key-change-in-production/$JWT_SECRET/" .env

# 4. 创建数据目录
mkdir -p data uploads

# 5. 构建并启动服务
docker compose up -d --build

# 6. 等待服务启动（约 30-60 秒）
sleep 45

# 7. 初始化管理员账号
docker compose exec server npm run db:seed

# 8. 访问系统
echo "前端地址: http://$(hostname -I | awk '{print $1}')"
echo "后端地址: http://$(hostname -I | awk '{print $1}'):3000"
echo "默认账号: admin / admin@123456"
```

---

## 部署步骤

### 第一步：安装 1Panel

#### 1.1 一键安装脚本

以 root 用户登录服务器，执行以下命令：

```bash
# CentOS/RHEL
curl -sSL https://resource.fit2cloud.com/1panel/package/quick_start.sh -o quick_start.sh && bash quick_start.sh

# Ubuntu/Debian
curl -sSL https://resource.fit2cloud.com/1panel/package/quick_start.sh -o quick_start.sh && sudo bash quick_start.sh
```

#### 1.2 获取登录信息

安装完成后，终端会显示 1Panel 的登录地址、用户名和密码：

```
======================= 1Panel 安装完成 =======================
外网访问地址: http://your-server-ip:10086/xxxxx
内网访问地址: http://localhost:10086/xxxxx
用户名: your-username
密码: your-password
==============================================================
```

> ⚠️ **重要**：请妥善保存登录信息，建议立即修改默认密码。

#### 1.3 登录 1Panel

在浏览器中访问外网地址，使用显示的用户名和密码登录。

---

### 第二步：准备项目文件

#### 2.1 上传项目文件

**方法一：通过 1Panel 文件管理器**

1. 登录 1Panel，进入左侧菜单 **主机 → 文件**
2. 进入 `/opt` 目录（或你希望部署的目录）
3. 点击 **上传** 按钮，上传 `kec-manager.zip` 压缩包
4. 解压文件：右键压缩包 → **解压**

**方法二：通过 Git 克隆（推荐）**

1. 进入 1Panel **主机 → 终端**
2. 执行以下命令：

```bash
cd /opt
git clone https://gitee.com/shub77/kec-manager.git
cd kec-manager
```

#### 2.2 创建数据目录

在项目根目录创建数据持久化目录：

```bash
cd /opt/kec-manager
mkdir -p data uploads
```

> 💡 **说明**：新版 docker-compose.yml 使用本地目录挂载而非 Docker Volume，方便在 1Panel 中直接管理和备份数据。

---

### 第三步：配置环境变量

#### 3.1 复制环境变量模板

```bash
cd /opt/kec-manager
cp .env.example .env
```

#### 3.2 生成 JWT 密钥

在 1Panel **主机 → 终端** 中执行：

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

复制输出的长字符串（类似 `a3f5b8c2d1e4...`）。

#### 3.3 编辑 .env 文件

1. 进入 1Panel **主机 → 文件**
2. 导航到 `/opt/kec-manager` 目录
3. 右键 `.env` 文件 → **编辑**
4. 修改以下内容：

```bash
# ========== 必填配置 ==========

# JWT 密钥（必须修改为上面生成的随机字符串）
JWT_SECRET=a3f5b8c2d1e4...（替换为实际生成的值）

# CORS 允许的源（根据实际访问域名修改，逗号分隔）
CORS_ORIGINS=http://your-server-ip,http://your-domain.com

# ========== 可选配置 ==========

# 容器名称前缀（默认: kec）
CONTAINER_PREFIX=kec

# 后端服务端口（默认: 3000）
SERVER_PORT=3000

# 前端服务端口（默认: 80）
CLIENT_PORT=80

# 网络名称（默认: kec-network）
NETWORK_NAME=kec-network
```

5. 点击 **保存**

#### 3.4 环境变量说明

| 变量名 | 说明 | 默认值 | 是否必填 |
|--------|------|--------|---------|
| `JWT_SECRET` | JWT 签名密钥 | 无 | ✅ 是 |
| `CORS_ORIGINS` | 允许跨域的源 | 无 | ✅ 是 |
| `CONTAINER_PREFIX` | 容器名称前缀 | `kec` | 否 |
| `SERVER_PORT` | 后端服务宿主机端口 | `3000` | 否 |
| `CLIENT_PORT` | 前端服务宿主机端口 | `80` | 否 |
| `NETWORK_NAME` | Docker 网络名称 | `kec-network` | 否 |

---

### 第四步：启动服务

#### 4.1 构建并启动

**方法一：通过 1Panel 应用管理**

1. 进入 1Panel **应用 → 应用商店 → 我的应用**
2. 点击 **创建应用** 按钮
3. 填写应用信息：

   | 字段 | 值 |
   |------|-----|
   | 应用名称 | `kec-manager` |
   | 应用类型 | 选择 **Docker Compose** |
   | 工作目录 | `/opt/kec-manager` |

4. 点击 **确认** 创建应用
5. 在应用列表中点击 `kec-manager`，然后点击 **启动** 按钮

**方法二：通过命令行**

在 1Panel **主机 → 终端** 中执行：

```bash
cd /opt/kec-manager
docker compose up -d --build
```

#### 4.2 查看启动日志

1. 在 1Panel **应用 → 我的应用** 中找到 `kec-manager`
2. 点击进入应用详情页
3. 切换到 **日志** 标签页
4. 观察后端和前端容器的启动日志

正常日志示例：

```
# 后端日志
Server running on http://localhost:3000

# 前端日志
/nginx: ready for connections
```

或使用命令行查看：

```bash
# 查看所有服务日志
docker compose logs -f

# 查看单个服务日志
docker compose logs -f server
docker compose logs -f client
```

#### 4.3 检查健康状态

在 1Panel **容器 → 容器列表** 中查看：

- `kec-server`: 状态应为 **运行中**，健康检查显示 **健康**
- `kec-client`: 状态应为 **运行中**

或使用命令行：

```bash
docker compose ps
```

预期输出：

```
NAME            STATUS                    PORTS
kec-server      Up (healthy)              0.0.0.0:3000->3000/tcp
kec-client      Up                        0.0.0.0:80->80/tcp
```

---

### 第五步：初始化管理员

#### 5.1 执行种子脚本

**方法一：通过 1Panel 容器终端**

1. 进入 1Panel **容器 → 容器列表**
2. 找到 `kec-server` 容器
3. 点击右侧 **终端** 按钮
4. 在容器终端中执行：

```bash
npm run db:seed
```

**方法二：通过命令行**

在 1Panel **主机 → 终端** 中执行：

```bash
docker compose exec server npm run db:seed
```

看到以下输出表示成功：

```
✓ 超级管理员账号已创建
  用户名: admin
  密码: admin@123456
  角色: super_admin
```

#### 5.2 访问系统

在浏览器中访问：

| 地址 | 说明 |
|------|------|
| `http://your-server-ip` | 前端管理界面 |
| `http://your-server-ip:3000/api/health` | 后端健康检查 |

使用默认账号登录：

- **用户名**: `admin`
- **密码**: `admin@123456`

> ⚠️ **重要**：首次登录后请立即修改密码！

---

## 域名与 HTTPS 配置

### 方案一：使用 1Panel 网站功能（推荐）

#### 1. 创建反向代理网站

1. 进入 1Panel **网站 → 网站**
2. 点击 **创建网站**
3. 选择 **反向代理** 类型
4. 填写配置：

   | 字段 | 值 |
   |------|-----|
   | 主域名 | `kec.your-domain.com` |
   | 代理地址 | `http://127.0.0.1:80` |
   | 备注 | KEC 课程管理平台 |

5. 点击 **确认**

#### 2. 申请 SSL 证书

1. 在网站列表中找到刚创建的网站
2. 点击 **配置 → SSL**
3. 选择 **Let's Encrypt** 免费证书
4. 填写邮箱，点击 **申请**
5. 申请成功后，开启 **强制 HTTPS**

#### 3. 修改 CORS 配置

编辑 `/opt/kec-manager/.env`：

```bash
CORS_ORIGINS=https://kec.your-domain.com
```

重启服务：

```bash
cd /opt/kec-manager
docker compose restart server
```

### 方案二：同时暴露前后端（高级）

如果需要分别访问前端和后端 API，可以配置两个反向代理：

| 域名 | 代理地址 | 用途 |
|------|---------|------|
| `kec.your-domain.com` | `http://127.0.0.1:80` | 前端界面 |
| `api.kec.your-domain.com` | `http://127.0.0.1:3000` | 后端 API |

然后在 CORS 配置中同时允许两个域名：

```bash
CORS_ORIGINS=https://kec.your-domain.com,https://api.kec.your-domain.com
```

---

## 数据备份与恢复

### 数据目录说明

新版配置使用本地目录挂载，数据存储在以下位置：

| 目录 | 内容 | 重要性 |
|------|------|--------|
| `/opt/kec-manager/data` | SQLite 数据库文件 | ⭐⭐⭐ 核心数据 |
| `/opt/kec-manager/uploads` | 用户上传的文件 | ⭐⭐ 业务数据 |

### 自动备份（推荐）

#### 1. 配置 1Panel 计划任务

1. 进入 1Panel **计划任务 → 计划任务**
2. 点击 **创建计划任务**
3. 配置如下：

   | 字段 | 值 |
   |------|-----|
   | 任务类型 | 备份目录 |
   | 任务名称 | `KEC数据备份` |
   | 备份目录 | `/opt/kec-manager/data` 和 `/opt/kec-manager/uploads` |
   | 执行周期 | 每天 02:00 |
   | 备份目标 | 本地磁盘 / OSS / S3 |
   | 保留份数 | 7 天 |

4. 点击 **确认**

### 手动备份

#### 备份全部数据

```bash
cd /opt/kec-manager

# 创建备份目录
mkdir -p backups

# 备份数据库
tar czf backups/db-backup-$(date +%Y%m%d-%H%M%S).tar.gz data/

# 备份上传文件
tar czf backups/uploads-backup-$(date +%Y%m%d-%H%M%S).tar.gz uploads/

# 查看备份文件
ls -lh backups/
```

#### 恢复数据

```bash
cd /opt/kec-manager

# 停止服务
docker compose down

# 恢复数据库（以 20260613 的备份为例）
tar xzf backups/db-backup-20260613-020000.tar.gz

# 恢复上传文件
tar xzf backups/uploads-backup-20260613-020000.tar.gz

# 启动服务
docker compose up -d
```

### 导出完整应用数据

```bash
cd /opt
tar czf kec-manager-full-backup-$(date +%Y%m%d).tar.gz kec-manager/
```

---

## 常见问题

### Q1: 容器启动失败，日志显示 "Permission denied"

**原因**: 数据目录权限不正确

**解决**:
```bash
cd /opt/kec-manager

# 设置正确的所有权（容器内用户 UID 通常为 1000）
chown -R 1000:1000 data uploads

# 重启服务
docker compose up -d
```

### Q2: 前端页面空白，控制台报 404 错误

**原因**: Nginx 配置未正确处理 Vue Router history 模式

**解决**: 

1. 检查 `client/nginx.conf` 是否包含：
```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

2. 重新构建前端容器：
```bash
docker compose build client
docker compose up -d client
```

### Q3: 后端 API 返回 500 错误

**排查步骤**:

```bash
# 1. 查看后端日志
docker compose logs -f server

# 2. 检查健康状态
docker compose ps

# 3. 测试健康检查接口
curl http://localhost:3000/api/health
```

**常见原因及解决**:

| 问题 | 解决方法 |
|------|---------|
| 数据库文件损坏 | 删除 `data/kec.db` 后重新执行 `npm run db:seed` |
| JWT_SECRET 未配置 | 检查 `.env` 文件是否正确设置 |
| 端口被占用 | 修改 `.env` 中的 `SERVER_PORT` |
| CORS 配置错误 | 检查 `CORS_ORIGINS` 是否包含当前域名 |

### Q4: 如何修改前端访问端口？

编辑 `.env` 文件：

```bash
# 将前端端口改为 8080
CLIENT_PORT=8080
```

重启服务：

```bash
docker compose up -d client
```

访问地址变为 `http://your-server-ip:8080`

### Q5: 如何更新应用到最新版本？

```bash
cd /opt/kec-manager

# 1. 拉取最新代码
git pull

# 2. 检查是否有新的环境变量需要配置
diff .env.example .env

# 3. 重新构建并启动
docker compose up -d --build

# 4. 查看日志确认启动成功
docker compose logs -f
```

### Q6: 如何查看资源使用情况？

**方法一：1Panel 界面**

在 1Panel **容器 → 容器列表** 中可以查看每个容器的：
- CPU 使用率
- 内存使用量
- 网络流量
- 磁盘 I/O

**方法二：命令行**

```bash
# 实时查看资源使用
docker stats kec-server kec-client

# 查看历史资源使用（需要启用 Docker 监控）
docker inspect kec-server | grep -i memory
```

### Q7: 忘记 admin 密码怎么办？

**方法一：通过 Prisma Studio（图形界面）**

```bash
# 启动 Prisma Studio
docker compose exec server npx prisma studio --port 5555 --hostname 0.0.0.0
```

然后在浏览器访问 `http://your-server-ip:5555`，找到 `users` 表修改密码。

**方法二：重置数据库（⚠️ 会清空所有数据）**

```bash
cd /opt/kec-manager

# 停止并删除所有容器和数据卷
docker compose down -v

# 删除本地数据
rm -rf data/* uploads/*

# 重新启动
docker compose up -d --build

# 重新初始化
docker compose exec server npm run db:seed
```

### Q8: 如何调整容器资源限制？

编辑 `docker-compose.yml`，修改 `deploy.resources` 部分：

```yaml
services:
  server:
    deploy:
      resources:
        limits:
          cpus: '2.0'      # CPU 上限
          memory: 1G       # 内存上限
        reservations:
          cpus: '0.5'      # CPU 保证
          memory: 256M     # 内存保证
  
  client:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 128M
```

重启服务生效：

```bash
docker compose up -d
```

### Q9: 如何迁移到其他服务器？

```bash
# 在原服务器上打包数据
cd /opt
tar czf kec-manager-migration.tar.gz kec-manager/

# 传输到新服务器
scp kec-manager-migration.tar.gz user@new-server:/opt/

# 在新服务器上解压
cd /opt
tar xzf kec-manager-migration.tar.gz

# 启动服务
cd kec-manager
docker compose up -d
```

### Q10: 数据库文件在哪里？

SQLite 数据库文件位于：

```
/opt/kec-manager/data/kec.db
```

可以直接复制此文件进行备份或迁移。

---

## 附录：1Panel 常用操作速查

| 操作 | 路径 |
|------|------|
| 查看容器日志 | 容器 → 容器列表 → 点击容器 → 日志 |
| 进入容器终端 | 容器 → 容器列表 → 点击容器 → 终端 |
| 重启容器 | 容器 → 容器列表 → 选择容器 → 重启 |
| 查看资源占用 | 容器 → 容器列表 → 查看 CPU/内存列 |
| 备份目录数据 | 计划任务 → 创建备份任务 → 选择目录 |
| 查看磁盘占用 | 主机 → 磁盘分析 |
| 修改防火墙规则 | 安全 → 防火墙 |
| 管理 Docker 网络 | 容器 → 网络 |

---

## 更新日志

| 日期 | 版本 | 变更内容 |
|------|------|---------|
| 2026-06-13 | v2.0 | 改用本地目录挂载，简化备份流程；新增环境变量配置；添加资源限制 |
| 2026-06-13 | v1.0 | 初始版本，基于 Docker Volume |

---

<div align="center">

**KEC 课程管理平台** · 1Panel 部署指南

最后更新：2026-06-13

</div>
