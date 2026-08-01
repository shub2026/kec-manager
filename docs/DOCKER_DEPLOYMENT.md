# KEC 课程管理平台 - Docker 部署指南

## 概述

Docker 部署方案采用**多阶段构建**，将前端构建产物直接打包进后端镜像，形成一个完整的单容器应用。这种方式的优势：

- **简化部署**：无需在服务器上安装 Node.js、npm、PM2 等工具
- **环境一致性**：开发、测试、生产环境完全一致
- **快速回滚**：只需切换镜像标签即可回滚到任意版本
- **资源隔离**：容器化运行，不影响宿主机其他服务

## 架构说明

```
┌─────────────────────────────────────┐
│         Docker Container            │
│  ┌───────────────────────────────┐  │
│  │   Node.js 20 Alpine           │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │ Express Server (:3000)  │  │  │
│  │  │  - API Routes (/api)    │  │  │
│  │  │  - Static Files (/)     │  │  │
│  │  └─────────────────────────┘  │  │
│  │         ↓                      │  │
│  │  SQLite (WAL mode)            │  │
│  └───────────────────────────────┘  │
│              ↕ (volume mount)        │
└─────────────────────────────────────┘
         ↓
   Host: ./data, ./uploads, ./logs
```

## 快速开始

### 1. 环境要求

- Docker 20.10+
- Docker Compose 2.0+
- 至少 1GB 可用内存（构建时需要约 1.5GB）

### 2. 克隆项目

```bash
git clone https://gitee.com/shub77/kec-manager.git
cd kec-manager
```

### 3. 配置环境变量

```bash
# 复制环境变量模板
cp .env.docker .env

# 编辑 .env 文件，必须修改以下内容：
vim .env
```

**必须修改的配置项：**

```bash
# 生成 JWT 密钥（执行以下命令 3 次，生成 3 个不同的密钥）
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 将生成的密钥填入 .env
JWT_SECRET=<第一个密钥>
JWT_REFRESH_SECRET=<第二个密钥>
JWT_DOWNLOAD_SECRET=<第三个密钥>

# 修改为你的实际域名
CORS_ORIGINS=https://your-domain.com,https://www.your-domain.com

# 修改为当前学期
DEFAULT_SEMESTER=2025-2026-2
```

### 4. 构建并启动

```bash
# 构建镜像（首次约需 3-5 分钟）
docker compose build

# 启动服务（后台运行）
docker compose up -d

# 查看启动日志
docker compose logs -f
```

### 5. 验证部署

```bash
# 检查容器状态
docker compose ps

# 测试健康检查接口
curl http://localhost:3000/api/health

# 预期输出：
# {"status":"ok","timestamp":"...","database":"connected"}
```

访问 http://localhost:3000，使用默认账户登录：
- 用户名：`admin`
- 密码：`admin@123456`（首次登录需修改密码）

## 生产环境部署

### 在 1Panel 上部署（推荐）

1Panel 使用 OpenResty 作为 Web 服务器，与标准 Nginx 兼容但有细微差异。

**步骤 1：通过 Docker Compose 启动应用**

```bash
cd /path/to/kec-manager
cp .env.docker .env
vim .env  # 修改配置
docker compose up -d
```

**步骤 2：在 1Panel 创建网站**

1. 打开 1Panel 控制台 → 网站 → 创建网站
2. 填写域名：`your-domain.com`
3. 选择 PHP 版本：`纯静态`（重要！不要选 Node.js）
4. 点击创建

**步骤 3：修改网站配置**

进入 网站 → your-domain.com → 配置文件，**完全替换**为以下内容：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # 1Panel 会自动生成 SSL 证书配置，保留这部分
    ssl_certificate     /opt/1panel/apps/openresty/openresty/conf/conf.d/ssl/your-domain.com/fullchain.pem;
    ssl_certificate_key /opt/1panel/apps/openresty/openresty/conf/conf.d/ssl/your-domain.com/privkey.pem;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=63072000" always;

    client_max_body_size 10M;

    # 关键：将所有请求代理到 Docker 容器
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;  # 重要：使用 $remote_addr 而非 $proxy_add_x_forwarded_for
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # SSE 支持（排课进度推送）
        proxy_buffering off;
        proxy_cache off;
        
        # 超时配置（排课可能需要较长时间）
        proxy_connect_timeout 60s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
}
```

**步骤 4：启用 gzip 压缩**

1Panel OpenResty 默认配置中已启用 gzip，但需确认支持 `gzip_static`：

1. 进入 1Panel → OpenResty → 配置修改
2. 在 `http {}` 块中添加：

```nginx
gzip_static on;
gzip on;
gzip_comp_level 6;
gzip_min_length 1024;
gzip_vary on;
gzip_proxied any;
gzip_types text/plain text/css text/xml text/javascript
    application/javascript application/json application/xml
    image/svg+xml font/ttf font/otf font/woff font/woff2;
```

3. 保存并重载 OpenResty

**步骤 5：配置 HTTPS 证书**

1. 在 1Panel 网站管理 → your-domain.com → HTTPS 设置
2. 选择 Let's Encrypt 或上传自有证书
3. 开启 HTTP 强制跳转

**步骤 6：申请 SSL 证书（如果没有）**

```bash
# 在 1Panel 中：网站 → your-domain.com → HTTPS → Let's Encrypt
# 点击申请即可，1Panel 会自动处理
```

### 传统 Nginx 反向代理（非 1Panel 环境）

在 Docker 外使用 Nginx 提供 HTTPS 和负载均衡：

```nginx
# /etc/nginx/conf.d/kec.conf

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # 推荐的安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # 安全头
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # SSE 支持
        proxy_buffering off;
        proxy_cache off;
        
        # 超时配置
        proxy_connect_timeout 60s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
}
```

重载 Nginx：

```bash
nginx -t
systemctl reload nginx
```

### 配置 Systemd 服务（可选）

让 Docker Compose 随系统启动：

```bash
# 创建 systemd 服务文件
cat > /etc/systemd/system/kec-manager.service << 'EOF'
[Unit]
Description=KEC Manager Docker Compose
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/path/to/kec-manager
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

# 启用并启动服务
systemctl daemon-reload
systemctl enable kec-manager.service
systemctl start kec-manager.service

# 查看状态
systemctl status kec-manager.service
```

## 数据持久化

### Volume 说明

docker-compose.yml 中配置了 3 个持久化卷：

| 卷名 | 容器路径 | 用途 |
|------|---------|------|
| `./data` | `/app/server/data` | SQLite 数据库文件 |
| `./uploads` | `/app/server/uploads` | 用户上传的文件 |
| `./logs` | `/app/server/logs` | 应用日志（Winston） |

### 备份数据

```bash
# 创建备份脚本
cat > backup-kec.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backup/kec"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# 备份数据库（SQLite 支持在线备份）
sqlite3 ./data/kec.db ".backup '$BACKUP_DIR/kec_$DATE.db'"

# 压缩备份
gzip "$BACKUP_DIR/kec_$DATE.db"

# 保留最近 30 天的备份
find "$BACKUP_DIR" -name "kec_*.db.gz" -mtime +30 -delete

echo "备份完成: $BACKUP_DIR/kec_$DATE.db.gz"
EOF

chmod +x backup-kec.sh

# 添加到 crontab（每天凌晨 2 点备份）
crontab -e
0 2 * * * /path/to/backup-kec.sh
```

### 恢复数据

```bash
# 停止容器
docker compose down

# 解压备份
gunzip kec_20260801_020000.db.gz

# 替换数据库文件
mv kec_20260801_020000.db ./data/kec.db

# 启动容器
docker compose up -d
```

## 更新部署

### 更新到最新版本

```bash
# 拉取最新代码
git pull origin main

# 重新构建镜像（仅当有更新时）
docker compose build

# 重启服务（自动执行数据库迁移）
docker compose up -d

# 查看更新日志
docker compose logs -f --tail 100
```

### 回滚到特定版本

```bash
# 切换到目标版本
git checkout v1.0.0

# 重新构建并启动
docker compose build
docker compose up -d
```

## 性能优化

### 1. 使用 BuildKit 加速构建

```bash
export DOCKER_BUILDKIT=1
docker compose build
```

### 2. 配置 Docker 资源限制

在 `docker-compose.yml` 中添加：

```yaml
services:
  kec-manager:
    # ... 其他配置
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
```

### 3. 启用 Gzip 压缩

如果使用 Nginx，在 `nginx.conf` 的 `http` 块中添加：

```nginx
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml text/javascript
           application/json application/javascript application/xml;
```

## 监控与维护

### 查看日志

```bash
# 实时查看日志
docker compose logs -f

# 查看最近 100 行
docker compose logs --tail 100

# 查看应用日志文件
docker compose exec kec-manager tail -f /app/server/logs/app.log
```

### 监控容器状态

```bash
# 查看资源使用
docker stats kec-manager

# 查看容器详细信息
docker inspect kec-manager

# 进入容器调试
docker compose exec kec-manager sh
```

### 健康检查

容器内置了健康检查，可通过以下方式查看：

```bash
docker inspect --format='{{.State.Health.Status}}' kec-manager
```

## 故障排查

### 容器启动失败

```bash
# 查看详细错误
docker compose logs

# 检查环境变量
docker compose config

# 检查端口占用
netstat -tlnp | grep 3000
```

### 数据库锁定

如果出现 "database is locked" 错误：

```bash
# 进入容器
docker compose exec kec-manager sh

# 检查 WAL 文件
ls -la /app/server/data/

# 手动执行 WAL checkpoint
sqlite3 /app/server/data/kec.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

### 内存不足

如果容器因 OOM 被杀死：

```bash
# 检查系统日志
dmesg | grep -i oom

# 增加内存限制或优化配置
# 编辑 docker-compose.yml 调整 resources 限制
```

### 前端页面空白

```bash
# 检查前端是否构建成功
docker compose exec kec-manager ls -la /app/client/dist

# 检查 Nginx 配置（如果使用反向代理）
nginx -t
tail -f /var/log/nginx/error.log
```

## 常见问题

**Q: 为什么不用 docker-compose 编排独立的 Nginx 容器？**  
A: 单容器方案更简单，适合中小型部署。如果需要独立的 Nginx 容器，可以将前端 `dist` 目录作为 volume 挂载给 Nginx 容器。

**Q: SQLite 适合 Docker 部署吗？**  
A: 适合。SQLite 通过 volume 挂载持久化，性能与直接部署无异。但注意不要同时运行多个容器实例（SQLite 不支持并发写入）。

**Q: 如何扩展为多实例部署？**  
A: 需要将数据库切换为 MySQL/PostgreSQL，然后可以运行多个容器实例配合负载均衡。参考 `server/.env.production.example` 中的 MySQL 配置。

**Q: 容器重启后数据会丢失吗？**  
A: 不会。数据库、上传文件、日志都通过 volume 挂载到宿主机，容器重启不影响数据。

## 安全建议

1. **修改默认密码**：首次登录后立即修改 admin 密码
2. **生成强 JWT 密钥**：使用 64 位随机 hex 字符串
3. **限制 CORS 域名**：仅允许信任的域名
4. **配置 HTTPS**：生产环境必须使用 HTTPS
5. **定期备份**：配置自动备份脚本
6. **更新依赖**：定期更新 Docker 基础镜像和应用依赖
7. **限制资源**：配置 CPU 和内存限制防止资源耗尽

## 参考链接

- [Docker 官方文档](https://docs.docker.com/)
- [Docker Compose 官方文档](https://docs.docker.com/compose/)
- [项目 README](../README.md)
- [PM2 部署指南](./DEPLOYMENT.md)
