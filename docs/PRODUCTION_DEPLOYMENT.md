# KEC 课程管理平台 - 生产环境部署指南

> **版本**：v2.17.1
> **数据库**：SQLite（启用 WAL 模式）
> **部署方式**：PM2 + deploy.sh
> **部署路径**：`/opt/1panel/www/sites/kec/index/kec-manager`

---

## 一、环境要求

| 组件 | 版本 / 要求 | 说明 |
| --- | --- | --- |
| Node.js | >= 20.0.0 | `package.json` 中 `engines.node` 强制约束 |
| npm | >= 10.0.0 | 随 Node.js 20+ 自带 |
| Git | 任意版本 | 用于拉取代码 |
| sqlite3 | 可选 | 用于数据库完整性校验（缺失时跳过校验，不阻塞部署） |
| PM2 | 最新版 | 进程管理，deploy.sh 会自动安装 |
| Nginx | 任意版本 | 反向代理 + 静态资源服务 |
| 内存 | >= 2GB | 推荐 |
| 端口 | 后端 3000（内部）/ Nginx 80、443（对外） | 后端端口不对外暴露 |

> **数据库说明**：当前 `schema.prisma` 的 `provider = "sqlite"`，仅支持 SQLite，不推荐 MySQL。

---

## 二、快速部署（deploy.sh）

`deploy.sh` 是生产环境主推的一键部署脚本，支持本地或远程 SSH 部署。

### 使用方法

```bash
# 本地部署
bash deploy.sh

# 远程部署
bash deploy.sh root@your-server.com
```

### 部署流程（10 步）

脚本会依次执行以下步骤，任一步骤失败即中止：

| 步骤 | 操作 | 说明 |
| --- | --- | --- |
| [1/10] | 检查前置条件 | Git、Node.js >=20、sqlite3（可选） |
| [2/10] | 创建部署目录 | `PROJECT_DIR`、`server/data`、`client`、日志目录 |
| [3/10] | 克隆 / 更新代码 | 已存在则 `git reset --hard origin/main`，否则 `git clone` |
| [4/10] | 安装依赖 | server 与 client 均使用 `npm install`（含 devDependencies，prisma CLI / vite 需要） |
| [5/10] | 停止现有服务 | PM2 delete + `pkill` 残留 node 进程 + `sleep 2` 等待端口释放 |
| [6/10] | 配置环境变量 | `.env` 已存在则跳过；否则生成随机 JWT 密钥并写入 |
| [7/10] | 初始化数据库 | 清理 WAL 残留 → `prisma migrate deploy` → `prisma generate` → `db:seed` → 完整性验证 |
| [8/10] | 初始化系统设置 | `npm run init:settings` |
| [9/10] | 构建前端 | 校验 esbuild → `vite build` → `npm prune --production` 清理 devDependencies |
| [10/10] | 启动服务 | `pm2 start src/server.js --name kec-server` + 健康检查 |

### 部署后验证

脚本会自动调用健康检查接口：

```bash
curl http://localhost:3000/api/health    # 期望返回 200
curl http://localhost:3000/api/settings  # 期望返回 200
```

### 默认管理员账号

```
用户名：admin
密码：admin@123456
```

> ⚠️ 首次登录后请立即修改默认密码。

---

## 三、手动部署

如需精细化控制，可按以下步骤手动部署。

### 1. 克隆代码

```bash
PROJECT_DIR="/opt/1panel/www/sites/kec/index/kec-manager"
mkdir -p $(dirname ${PROJECT_DIR})
git clone https://gitee.com/shub77/kec-manager.git ${PROJECT_DIR}
cd ${PROJECT_DIR}
```

### 2. 安装依赖

```bash
# 后端：需要 devDependencies 中的 prisma CLI 用于迁移
cd ${PROJECT_DIR}/server
npm install

# 前端：需要 devDependencies 中的 vite / esbuild 用于构建
cd ${PROJECT_DIR}/client
npm install
```

### 3. 配置环境变量

```bash
cd ${PROJECT_DIR}/server

# 生成 JWT 密钥
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('JWT_DOWNLOAD_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"

# 复制模板并编辑
cp .env.production.example .env
vim .env
chmod 600 .env
```

### 4. 初始化数据库

```bash
cd ${PROJECT_DIR}/server

# 清理可能的 WAL/SHM 残留
rm -f data/kec.db-wal data/kec-shm 2>/dev/null || true

# 应用迁移
npx prisma migrate deploy
npx prisma generate

# 初始化种子数据
npm run db:seed

# 初始化系统设置
npm run init:settings
```

### 5. 构建前端

```bash
cd ${PROJECT_DIR}/client
npm run build

# 清理开发依赖，减少生产体积
npm prune --production
cd ${PROJECT_DIR}/server
npm prune --production
```

### 6. 启动服务

```bash
npm install -g pm2
cd ${PROJECT_DIR}/server
pm2 start src/server.js --name kec-server
pm2 save
pm2 startup
```

---

## 四、Nginx 配置

前端在 `client/dist` 原地构建，Nginx `root` 直接指向该目录，不拷贝到其他位置。

```nginx
server {
    listen 80;
    server_name kec.sntip.cn;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name kec.sntip.cn;

    ssl_certificate     /etc/letsencrypt/live/kec.sntip.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/kec.sntip.cn/privkey.pem;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # 前端静态文件：直接指向项目构建产物
    root /opt/1panel/www/sites/kec/index/kec-manager/client/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 反向代理（后端 3000 端口仅内部访问）
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 静态资源长缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

重载 Nginx：

```bash
nginx -t && nginx -s reload
```

---

## 五、环境变量说明

### 必填项

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `JWT_SECRET` | JWT 签名密钥 | `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | Refresh Token 签名密钥 | 同上，独立生成 |
| `JWT_DOWNLOAD_SECRET` | 下载令牌签名密钥 | 同上，独立生成 |
| `DEFAULT_SEMESTER` | 当前默认学期 | `2025-2026-2` |
| `CORS_ORIGINS` | 允许的前端域名（逗号分隔） | `https://kec.sntip.cn,https://www.kec.sntip.cn` |

### 可选项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 运行环境 |
| `DATABASE_URL` | `file:.../server/data/kec.db` | SQLite 数据库路径 |
| `PORT` | `3000` | 后端监听端口（内部） |
| `JWT_EXPIRES_IN` | `15m` | Access Token 有效期 |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh Token 有效期 |
| `LOG_LEVEL` | `info` | 日志级别（error/warn/info/http/debug） |
| `MAX_FILE_SIZE` | `10` | 文件上传大小限制（MB） |
| `BCRYPT_ROUNDS` | `12` | bcrypt 加密轮数 |

### SQLite WAL 配置（自动生效）

`server/src/lib/prisma.js` 在启动时自动应用以下 PRAGMA，无需手动配置：

```sql
PRAGMA journal_mode = WAL;          -- WAL 模式，提升并发读性能
PRAGMA busy_timeout = 5000;         -- 写锁等待 5 秒
PRAGMA synchronous = NORMAL;        -- 平衡性能与数据安全
```

---

## 六、备份与恢复

### 备份脚本

```bash
#!/bin/bash
# backup.sh
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/opt/1panel/www/sites/kec/index/log/kec-manager/backup"
PROJECT_DIR="/opt/1panel/www/sites/kec/index/kec-manager"

mkdir -p $BACKUP_DIR

# 使用 sqlite3 在线备份（避免直接 cp 导致的 WAL 不一致）
sqlite3 ${PROJECT_DIR}/server/data/kec.db ".backup '${BACKUP_DIR}/kec_${DATE}.db'"

# 备份 .env 配置
cp ${PROJECT_DIR}/server/.env ${BACKUP_DIR}/env_${DATE}

# 保留最近 30 天
find $BACKUP_DIR -name "*.db" -mtime +30 -delete
find $BACKUP_DIR -name "env_*" -mtime +30 -delete

echo "Backup completed: kec_${DATE}.db"
```

加入 crontab：

```bash
crontab -e
# 每日凌晨 3 点备份
0 3 * * * /path/to/backup.sh
```

### 恢复步骤

```bash
PROJECT_DIR="/opt/1panel/www/sites/kec/index/kec-manager"

# 1. 停止服务
pm2 delete kec-server

# 2. 替换数据库文件
cp /path/to/backup/kec_YYYYMMDD.db ${PROJECT_DIR}/server/data/kec.db
rm -f ${PROJECT_DIR}/server/data/kec.db-wal ${PROJECT_DIR}/server/data/kec.db-shm

# 3. 恢复 .env（如需）
cp /path/to/backup/env_YYYYMMDD ${PROJECT_DIR}/server/.env

# 4. 重启服务
cd ${PROJECT_DIR}/server && pm2 start src/server.js --name kec-server
```

---

## 七、更新部署

### 方式一：使用 deploy.sh（推荐）

```bash
cd /opt/1panel/www/sites/kec/index/kec-manager
bash deploy.sh
```

脚本会自动完成：拉取最新代码 → 安装依赖 → 停止旧服务 → 数据库迁移 → 构建前端 → 启动新服务。

### 方式二：手动更新

```bash
PROJECT_DIR="/opt/1panel/www/sites/kec/index/kec-manager"
cd ${PROJECT_DIR}

# 1. 拉取代码
git fetch origin && git reset --hard origin/main

# 2. 安装依赖
cd server && npm install
cd ../client && npm install

# 3. 停止服务（释放 SQLite 写锁，避免迁移时报 "database is locked"）
pm2 delete kec-server
sleep 2

# 4. 数据库迁移
cd ${PROJECT_DIR}/server
npx prisma migrate deploy
npx prisma generate

# 5. 构建前端
cd ${PROJECT_DIR}/client && npm run build
npm prune --production
cd ${PROJECT_DIR}/server && npm prune --production

# 6. 启动服务
pm2 start src/server.js --name kec-server
pm2 save
```

---

## 八、常见问题

### Q1：Prisma 迁移报 "database is locked"

**原因**：旧 Node 进程仍持有 SQLite 写锁。

**解决**：
```bash
pm2 delete kec-server
pkill -f '^node.*server/src/server\.js' 2>/dev/null || true
sleep 2
# 清理 WAL 残留
rm -f server/data/kec.db-wal server/data/kec.db-shm
npx prisma migrate deploy
```

> `deploy.sh` 的 [5/10] 已自动处理此问题。

### Q2：健康检查返回非 200

```bash
# 查看 PM2 日志
pm2 logs kec-server --lines 100

# 常见原因：
# - .env 中 JWT_SECRET 未配置或过短
# - Prisma Client 未生成（npx prisma generate）
# - 数据库迁移未完成（npx prisma migrate deploy）
```

### Q3：CORS 错误

```bash
# 检查 CORS_ORIGINS 是否包含前端访问域名
grep CORS_ORIGINS server/.env

# 修改后重启
pm2 restart kec-server
```

### Q4：前端 404 / 页面空白

**原因**：Nginx `root` 未指向 `client/dist`，或前端未构建。

**解决**：
```bash
# 确认构建产物存在
ls /opt/1panel/www/sites/kec/index/kec-manager/client/dist/index.html

# 确认 Nginx 配置
# root /opt/1panel/www/sites/kec/index/kec-manager/client/dist;
nginx -t && nginx -s reload
```

### Q5：esbuild 二进制异常导致前端构建崩溃

```bash
cd client
rm -rf node_modules/esbuild node_modules/@esbuild
npm install esbuild --no-cache
npm run build
```

> `deploy.sh` 的 [9/10] 已自动检测并修复此问题。

---

## 九、更新日志

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-07-02 | v2.17.1 | 重写文档，对齐当前项目实际配置：SQLite-only、PM2 + deploy.sh 主推、1Panel 部署路径、WAL 模式、Node.js 20+ |
