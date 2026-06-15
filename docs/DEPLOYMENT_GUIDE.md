# KEC 课程管理平台 - 生产环境部署指南

## 概述

本文档介绍 KEC 课程管理平台的生产环境完整部署流程，支持一键部署和更新部署两种方式。

## 前置要求

### 服务器要求

| 项目 | 最低要求 |
|------|---------|
| 操作系统 | CentOS 7+ / Ubuntu 18+ / Debian 10+ |
| CPU | 1 核 |
| 内存 | 2 GB |
| 磁盘 | 10 GB |
| Node.js | 18.x 或 20.x |
| npm | 8.x+ |
| Git | 任意版本 |
| SQLite | 3.x（系统自带） |
| Nginx | 1.18+（反向代理） |

### 端口要求

| 端口 | 用途 |
|------|------|
| 80 | Nginx HTTP |
| 443 | Nginx HTTPS |
| 3000 | 后端 API（内部，不对外暴露） |

---

## 一、首次部署（从零开始）

### 1. 安装基础环境

```bash
# 安装 Node.js 20.x（以 CentOS 为例）
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs

# 验证版本
node -v   # 应显示 v20.x.x
npm -v    # 应显示 10.x.x

# 安装 PM2（进程管理器）
npm install -g pm2

# 安装 Git（如未安装）
yum install -y git   # CentOS
# apt install -y git # Ubuntu/Debian
```

### 2. 安装 Nginx（如未安装）

```bash
# CentOS
yum install -y epel-release
yum install -y nginx
systemctl start nginx
systemctl enable nginx

# Ubuntu/Debian
apt update
apt install -y nginx
systemctl start nginx
systemctl enable nginx
```

### 3. 执行部署脚本

```bash
# 克隆仓库到临时位置
git clone https://gitee.com/shub77/kec-manager.git /tmp/kec-manager

# 执行部署脚本
cd /tmp/kec-manager
bash deploy.sh

# 清理临时文件
rm -rf /tmp/kec-manager
```

部署脚本会自动执行以下 9 个步骤：

```
[1/9] 检查前置条件（Git、Node.js 版本）
[2/9] 创建部署目录
[3/9] 克隆代码到 /opt/1panel/www/sites/kec/index/kec-manager
[4/9] 安装前后端依赖
[5/9] 生成环境变量（JWT 密钥等）
[6/9] 数据库迁移 + 生成 Prisma Client + 初始化管理员账号
[7/9] 初始化系统设置（学期、系统标识）
[8/9] 构建前端
[9/9] 启动服务并验证
```

### 4. 配置 CORS 域名

```bash
# 编辑环境变量
vim /opt/1panel/www/sites/kec/index/kec-manager/server/.env

# 修改 CORS_ORIGINS 为你的实际域名
CORS_ORIGINS=https://your-domain.com,https://www.your-domain.com
```

### 5. 配置 Nginx 反向代理

创建 Nginx 配置文件：

```bash
vim /etc/nginx/conf.d/kec.conf
```

写入以下内容：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 强制 HTTPS（配置 SSL 后取消注释）
    # return 301 https://$server_name$request_uri;

    # 前端静态文件
    root /opt/1panel/www/sites/kec/index/kec-manager/client/dist;
    index index.html;

    # 前端路由（Vue Router history 模式）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        # 文件上传大小限制
        client_max_body_size 10m;
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

测试并重载 Nginx：

```bash
nginx -t
systemctl reload nginx
```

### 6. 配置 HTTPS（推荐）

使用 Let's Encrypt 免费证书：

```bash
# 安装 certbot
yum install -y certbot python3-certbot-nginx   # CentOS
# apt install -y certbot python3-certbot-nginx # Ubuntu/Debian

# 申请并自动配置证书
certbot --nginx -d your-domain.com

# 验证自动续期
certbot renew --dry-run
```

### 7. 重启后端服务（应用 CORS 配置）

```bash
pm2 restart kec-server
```

### 8. 验证部署

```bash
# 健康检查
curl http://localhost:3000/api/health

# Settings 接口
curl http://localhost:3000/api/settings

# PM2 状态
pm2 status

# 浏览器访问
# http://your-domain.com（或 https://）
```

### 默认管理员账号

| 项目 | 值 |
|------|-----|
| 用户名 | admin |
| 密码 | admin@123456 |

> 首次登录后请立即修改密码。

---

## 二、更新部署

代码有更新时，只需执行：

```bash
cd /opt/1panel/www/sites/kec/index/kec-manager

# 拉取最新代码
git pull

# 重新部署
bash deploy.sh
```

脚本会自动检测已有环境，跳过 .env 配置步骤，执行代码更新、依赖安装、数据库迁移、前端构建和服务重启。

---

## 三、数据库操作

### 备份数据库

```bash
# 手动备份
cp /opt/1panel/www/sites/kec/index/kec-manager/server/data/kec.db \
   /opt/1panel/www/sites/kec/index/kec-manager/server/data/kec.db.backup.$(date +%Y%m%d)
```

### 设置自动备份

```bash
# 编辑 crontab
crontab -e

# 添加每天凌晨 2 点自动备份
0 2 * * * cp /opt/1panel/www/sites/kec/index/kec-manager/server/data/kec.db /opt/1panel/www/sites/kec/index/kec-manager/server/data/backup/kec_$(date +\%Y\%m\%d).db
```

### 恢复数据库

```bash
# 停止服务
pm2 stop kec-server

# 替换数据库文件
cp /path/to/backup/kec.db /opt/1panel/www/sites/kec/index/kec-manager/server/data/kec.db

# 重启服务
pm2 restart kec-server
```

---

## 四、故障排查

### 查看日志

```bash
# PM2 实时日志
pm2 logs kec-server

# PM2 错误日志
pm2 logs kec-server --err --lines 50

# Nginx 错误日志
tail -f /var/log/nginx/error.log
```

### 常见问题

#### 问题 1：登录页报 `/api/settings` 500 错误

**原因：** `system_settings` 表为空

```bash
cd /opt/1panel/www/sites/kec/index/kec-manager/server
npm run init:settings
pm2 restart kec-server
```

#### 问题 2：登录报 `/api/auth/login` 500 错误

**原因：** `users` 表为空（管理员账号未创建）

```bash
cd /opt/1panel/www/sites/kec/index/kec-manager/server
npm run db:seed
pm2 restart kec-server
```

#### 问题 3：PM2 进程冲突（端口占用）

**原因：** 存在旧的 PM2 进程占用端口

```bash
pm2 delete kec-api 2>/dev/null || true
pm2 delete kec-server 2>/dev/null || true
cd /opt/1panel/www/sites/kec/index/kec-manager/server
pm2 start src/server.js --name kec-server
pm2 save
```

#### 问题 4：Nginx 502 Bad Gateway

**原因：** 后端服务未启动或端口不对

```bash
# 检查后端是否运行
pm2 status

# 检查端口是否监听
ss -tlnp | grep 3000

# 重启后端
pm2 restart kec-server
```

#### 问题 5：CORS 跨域错误

**原因：** `.env` 中的 `CORS_ORIGINS` 未包含前端域名

```bash
vim /opt/1panel/www/sites/kec/index/kec-manager/server/.env
# 确保 CORS_ORIGINS 包含你的域名
pm2 restart kec-server
```

### 运行诊断工具

```bash
cd /opt/1panel/www/sites/kec/index/kec-manager/server

# 完整诊断
npm run diagnose

# 快速检查
bash scripts/quick-check.sh
```

---

## 五、项目目录结构

```
/opt/1panel/www/sites/kec/index/kec-manager/
├── client/                  # 前端代码
│   ├── dist/               # 构建产物（Nginx 指向此目录）
│   ├── src/                # 前端源码
│   └── package.json
├── server/                  # 后端代码
│   ├── data/               # SQLite 数据库文件
│   │   └── kec.db
│   ├── prisma/             # 数据库 Schema 和迁移
│   │   └── schema.prisma
│   ├── src/                # 后端源码
│   │   ├── routes/         # API 路由
│   │   ├── services/       # 业务逻辑
│   │   ├── middleware/     # 中间件
│   │   └── app.js          # Express 入口
│   ├── scripts/            # 运维脚本
│   │   ├── diagnose.js     # 诊断工具
│   │   ├── init-settings.js # 初始化设置
│   │   └── fix-database.sh  # 数据库修复
│   ├── .env                # 环境变量（不提交到 Git）
│   └── package.json
├── docs/                    # 项目文档
├── deploy.sh               # 部署脚本
└── README.md
```

---

## 六、环境变量说明

`server/.env` 文件配置项：

| 变量 | 说明 | 示例 |
|------|------|------|
| NODE_ENV | 运行环境 | production |
| DATABASE_URL | 数据库路径 | file:/opt/.../server/data/kec.db |
| PORT | 后端端口 | 3000 |
| JWT_SECRET | JWT 签名密钥 | 随机 64 位 hex |
| JWT_REFRESH_SECRET | Refresh Token 密钥 | 随机 64 位 hex |
| JWT_DOWNLOAD_SECRET | 下载 Token 密钥 | 随机 64 位 hex |
| JWT_EXPIRES_IN | Token 过期时间 | 15m |
| JWT_REFRESH_EXPIRES_IN | Refresh Token 过期时间 | 7d |
| CORS_ORIGINS | 允许的前端域名 | https://your-domain.com |
| LOG_LEVEL | 日志级别 | info |
| MAX_FILE_SIZE | 上传文件大小限制（MB） | 10 |

---

## 七、运维命令速查

```bash
# 服务管理
pm2 status                    # 查看状态
pm2 logs kec-server           # 查看日志
pm2 restart kec-server        # 重启服务
pm2 stop kec-server           # 停止服务

# 数据库
npm run db:seed               # 重新初始化管理员
npm run init:settings         # 初始化系统设置
npm run diagnose              # 运行诊断

# 更新
cd /opt/.../kec-manager
git pull && bash deploy.sh    # 拉取更新并部署
```
