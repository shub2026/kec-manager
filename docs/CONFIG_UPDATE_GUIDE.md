# 生产环境配置更新指南

## 📋 更新内容

本次配置更新修复了以下问题：

### ✅ 已修复
1. **数据库路径** - 从相对路径改为绝对路径
2. **数据库文件名** - 从 `reset.db` 改为 `kec.db`
3. **环境变量** - 添加 `NODE_ENV=production`
4. **JWT 密钥** - 添加缺失的 `JWT_REFRESH_SECRET` 和 `JWT_DOWNLOAD_SECRET`
5. **CORS 配置** - 简化并添加生产域名支持
6. **日志配置** - 添加 `LOG_LEVEL` 设置

## 🚀 应用更新（手动方式）

### 步骤 1：登录服务器
```bash
ssh root@your-server.com
cd /opt/1panel/www/sites/kec/index/kec-manager
```

### 步骤 2：拉取最新代码
```bash
git pull
```

### 步骤 3：创建数据目录
```bash
mkdir -p /opt/1panel/www/sites/kec/index/kec-manager/server/data
chmod 755 /opt/1panel/www/sites/kec/index/kec-manager/server/data
```

> **权限说明**：无需 `chown www-data:www-data`。
> - **Docker 部署**：容器内进程以 `appuser:appgroup` 身份运行，数据通过 named volume 挂载，权限由 Dockerfile 统一管理。
> - **PM2 部署**：以 `root` 用户运行，对数据目录有读写权限，无需额外 chown。

### 步骤 4：备份当前配置
```bash
cp server/.env server/.env.backup.$(date +%Y%m%d_%H%M%S)
```

### 步骤 5：编辑配置文件
```bash
vim server/.env
```

参考以下配置修改：

```bash
# ==================== 必需修改项 ====================

# 1. 环境变量（新增）
NODE_ENV=production

# 2. 数据库路径（修改为绝对路径）
DATABASE_URL="file:/opt/1panel/www/sites/kec/index/kec-manager/server/data/kec.db"

# 3. CORS 域名（修改为你的实际域名）
CORS_ORIGINS=https://kec.sntip.cn,http://localhost:3000

# ==================== 可选配置 ====================

# 服务器端口
PORT=3000

# JWT密钥（保持现有值，不要修改）
JWT_SECRET=你现有的密钥（保持不变）

# 新增的密钥（需要生成）
# 执行以下命令生成新密钥：
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_REFRESH_SECRET=生成的128位十六进制字符串
JWT_DOWNLOAD_SECRET=生成的128位十六进制字符串

# JWT过期时间（新增）
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# 日志级别（新增）
LOG_LEVEL=info

# 文件上传限制（新增）
MAX_FILE_SIZE=10

# 默认学期（新增，格式：学年-学期，如 2025-2026-1）
DEFAULT_SEMESTER=2025-2026-1

# bcrypt 加密轮数（新增，10-14 之间，值越大越安全但越慢，默认 12）
BCRYPT_ROUNDS=12
```

### 步骤 6：生成新的 JWT 密钥
```bash
# 生成 JWT_REFRESH_SECRET
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"

# 生成 JWT_DOWNLOAD_SECRET  
node -e "console.log('JWT_DOWNLOAD_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"

# 将输出的密钥复制到 .env 文件中
```

### 步骤 7：迁移数据库（如果需要）
```bash
cd server

# 应用 Prisma 迁移（保留现有数据，推荐）
npx prisma migrate deploy

# 如需重新初始化种子数据（会重置数据，谨慎使用）
# npm run db:seed
```

### 步骤 8：重启服务
```bash
pm2 restart kec-server

# 检查状态
pm2 status

# 查看日志
pm2 logs kec-server --lines 50
```

### 步骤 9：验证部署
```bash
# 健康检查
curl http://localhost:3000/api/health

# 测试设置接口
curl http://localhost:3000/api/settings

# 外部访问测试
curl https://kec.sntip.cn/api/health
```

## 🚀 应用更新（自动方式）

如果你想要自动化部署，可以使用提供的部署脚本：

```bash
# 在项目根目录执行
bash deploy.sh root@your-server.com
```

**注意：** 自动部署会：
- ✅ 自动生成新的 JWT 密钥
- ✅ 自动安装依赖
- ✅ 自动初始化数据库
- ⚠️ **会清空现有数据**（如果是全新部署）

**如果已有生产数据，请使用手动方式更新配置！**

## 🐳 Docker 部署

如果使用 Docker 部署，配置方式与上述 PM2 流程不同，**不要**直接编辑 `server/.env`，而是使用项目根目录的 `.env.docker`。

### 1. 使用 `.env.docker` 配置环境变量

Docker 部署通过根目录的 `.env.docker` 文件向 `docker-compose.yml` 注入变量，参考 `.env.docker.example` 创建：

```bash
cp .env.docker.example .env.docker
vim .env.docker
```

`.env.docker` 中同样需要配置 `NODE_ENV`、`CORS_ORIGINS`、`JWT_*`、`DEFAULT_SEMESTER`、`BCRYPT_ROUNDS` 等项。注意：Docker 部署下 `DATABASE_URL` 指向容器内路径（通常为 `file:/app/server/data/kec.db`），**不要**填宿主机的 `/opt/1panel/...` 绝对路径。

### 2. 使用 docker-compose 编排

```bash
# 构建并启动
docker compose up -d --build

# 查看状态与日志
docker compose ps
docker compose logs -f
```

### 3. 关键说明

- **named volume 持久化**：数据库文件通过 `docker-compose.yml` 中定义的 named volume（如 `kec_data`）持久化到 Docker 管理的宿主机路径。**不要**直接到容器内 `/app/server/data` 修改或拷贝 `kec.db`，应通过 volume 操作或进入容器执行 Prisma 命令。
- **appuser 非 root 运行**：容器内进程以非 root 用户 `appuser`（属组 `appgroup`）运行，镜像构建时已在 `Dockerfile` 中创建并设置目录归属。因此 Docker 部署**无需也不应**执行 `chown www-data`，named volume 挂载后由 appuser 读写。
- **WAL 模式**：Prisma 连接 SQLite 时已启用 WAL（Write-Ahead Logging）模式，支持并发读、提升写入吞吐。数据目录中出现 `kec.db-wal`、`kec.db-shm` 是正常产物，**不要**手动删除，否则可能丢数据。备份时需连同这两个文件一起复制，或先执行 `PRAGMA wal_checkpoint(TRUNCATE)`。
- **数据库初始化**：容器首次启动会自动执行 `npx prisma migrate deploy` 应用迁移，**无需**手动 `cp reset.db`。如需种子数据，进入容器执行 `docker compose exec kec-server npm run db:seed`（仅限首次初始化）。

## 🔍 验证清单

更新完成后，请确认以下项目：

- [ ] `.env` 文件中的 `DATABASE_URL` 指向正确的路径
- [ ] 数据目录 `/opt/1panel/www/sites/kec/index/kec-manager/server/data/` 存在且有写入权限
- [ ] `NODE_ENV=production` 已设置
- [ ] `JWT_REFRESH_SECRET` 和 `JWT_DOWNLOAD_SECRET` 已配置
- [ ] `CORS_ORIGINS` 包含你的生产域名
- [ ] 服务正常运行：`pm2 status`
- [ ] 健康检查返回成功：`curl http://localhost:3000/api/health`
- [ ] 前端可以正常访问
- [ ] 登录页不再出现 500 错误
- [ ] 可以成功登录系统

## 🐛 常见问题

### Q1: 数据库文件不存在怎么办？
```bash
# 检查文件是否存在
ls -la /opt/1panel/www/sites/kec/index/kec-manager/server/data/kec.db

# 如果不存在，应用迁移并初始化种子数据
cd /opt/1panel/www/sites/kec/index/kec-manager/server && npx prisma migrate deploy && npm run db:seed
```

### Q2: CORS 错误仍然存在？
```bash
# 检查 .env 中的域名是否正确
cat server/.env | grep CORS_ORIGINS

# 修改后必须重启服务
pm2 restart kec-server
```

### Q3: JWT 认证失败？
```bash
# 检查密钥格式（应该是纯十六进制，无特殊字符）
echo $JWT_SECRET | grep -E '^[a-f0-9]+$'

# 密钥长度至少 32 字符
echo -n $JWT_SECRET | wc -c
```

### Q4: 服务启动失败？
```bash
# 查看详细日志
pm2 logs kec-server --err

# 常见原因：
# - 端口被占用：lsof -i:3000
# - 数据库路径错误：检查 DATABASE_URL
# - 权限问题：Docker 用 appuser:appgroup（见 Dockerfile），PM2 以 root 运行，均无需 chown www-data
```

## 📊 回滚方案

如果更新后出现问题，可以快速回滚：

```bash
# 1. 恢复配置文件
cp server/.env.backup.* server/.env

# 2. 重启服务
pm2 restart kec-server

# 3. 如果数据库有问题，重新应用迁移
cd server && npx prisma migrate deploy
pm2 restart kec-server
```

## 📞 获取帮助

如果遇到问题无法解决：
1. 查看 PM2 日志：`pm2 logs kec-server`
2. 查看 Nginx 日志：`tail -f /var/log/nginx/error.log`
3. 提交 Issue：https://gitee.com/shub77/kec-manager/issues
