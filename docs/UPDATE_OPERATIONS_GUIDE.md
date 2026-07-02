# KEC 课程管理平台 - 更新操作指南

**文档版本**: v2.17.1  
**最后更新**: 2026-07-02  
**适用版本**: v2.x+

---

## 📋 目录

- [快速开始](#快速开始)
- [更新方式对比](#更新方式对比)
- [方式一：SSH远程部署（推荐）](#方式一ssh远程部署推荐)
- [方式二：服务器本地部署](#方式二服务器本地部署)
- [方式三：手动更新](#方式三手动更新)
- [方式四：Docker 部署（容器化）](#方式四docker-部署容器化)
- [数据库备份与恢复](#数据库备份与恢复)
- [常见问题排查](#常见问题排查)
- [回滚操作](#回滚操作)
- [最佳实践](#最佳实践)

---

## 🚀 快速开始

### 最简单的更新方式（一行命令）

```bash
# SSH远程一键更新（推荐）
bash <(curl -s https://gitee.com/shub77/kec-manager/raw/main/deploy_ssh.sh) \
  root@your-server-ip
```

或者，如果已经下载了脚本：

```bash
bash deploy_ssh.sh root@your-server-ip
```

---

## 📊 更新方式对比

| 方式 | 适用场景 | 复杂度 | 风险 | 推荐度 |
|------|---------|--------|------|--------|
| **SSH远程部署** | 日常更新 | ⭐ 简单 | 低 | ⭐⭐⭐⭐ |
| **服务器本地部署** | 首次部署 | ⭐⭐ 中等 | 低 | ⭐⭐⭐⭐⭐ |
| **手动更新** | 故障排查 | ⭐⭐⭐ 复杂 | 中 | ⭐⭐⭐ |
| **Docker 部署** | 容器化环境 | ⭐⭐ 中等 | 低 | ⭐⭐⭐⭐ |

---

## 方式一：SSH远程部署（推荐）

### 前置条件

1. **SSH密钥配置**

```bash
# 检查是否已配置SSH密钥
ls -la ~/.ssh/id_*.pub

# 如果没有，生成密钥
ssh-keygen -t ed25519 -C "your_email@example.com"

# 复制公钥到服务器
ssh-copy-id -p 22 root@your-server-ip
```

2. **测试SSH连接**

```bash
ssh -p 22 root@your-server-ip
# 如果能成功登录，说明配置正确
```

### 使用步骤

#### 步骤1：下载部署脚本

```bash
# 方法A：直接执行（不保存文件）
curl -O https://gitee.com/shub77/kec-manager/raw/main/deploy_ssh.sh

# 方法B：保存到本地
wget https://gitee.com/shub77/kec-manager/raw/main/deploy_ssh.sh
chmod +x deploy_ssh.sh
```

> 📌 **代码仓库地址**：`https://gitee.com/shub77/kec-manager.git`（已从 GitHub 迁移至 Gitee，所有 raw 链接均使用 Gitee）

#### 步骤2：选择部署模式

**模式A：完整部署（推荐用于版本升级）**

```bash
# 适用于v2.16 → v2.17这样的版本更新
bash deploy_ssh.sh root@your-server-ip
```

> ⚠️ **重要提示（deploy_ssh.sh 与 deploy.sh 的迁移时序差异）**
>
> `deploy_ssh.sh` 为旧版远程脚本，其执行顺序为 **"先迁移后停服务"**：在旧 PM2 进程仍持有 SQLite 连接时执行 `prisma migrate deploy`，高并发下可能触发 `SQLITE_BUSY: database is locked` 错误。
>
> `deploy.sh`（服务器本地部署）的顺序为 **"先停服务后迁移"**：先 `pm2 delete` 释放连接，再执行迁移，安全性更高。
>
> **生产环境推荐使用 `deploy.sh`**；仅在不便登录服务器时使用 `deploy_ssh.sh`，并在低峰期执行。

执行流程：
```
[0/10] 检查SSH连接
[1/10] 备份数据库 ✓
[2/10] 拉取最新代码 ✓
[3/10] 安装依赖 ✓
[4/10] 数据库迁移 ✓
[5/10] 构建前端 ✓
[6/10] 重启服务 ✓
[7/10] 等待服务启动 ✓
[8/10] 健康检查 ✓
[9/10] 显示服务状态 ✓
[10/10] 显示磁盘使用情况 ✓
```

**模式B：仅更新代码（快速重启）**

```bash
# 适用于小bug修复，不需要重新构建前端
bash deploy_ssh.sh root@your-server-ip --update-only
```

执行流程：
```
[2/10] 拉取最新代码
[6/10] 重启服务
[7/10] 等待服务启动
[8/10] 健康检查
```

**模式C：仅备份数据库**

```bash
# 维护前手动备份
bash deploy_ssh.sh root@your-server-ip --backup-only
```

#### 步骤3：验证更新

```bash
# 查看服务状态
ssh root@your-server-ip "pm2 status"

# 查看实时日志
ssh root@your-server-ip "pm2 logs kec-server --lines 20"

# 测试健康检查
curl http://localhost:3000/api/health

# 检查版本
ssh root@your-server-ip "cd /opt/1panel/www/sites/kec/index/kec-manager && git log --oneline -3"
```

### 高级选项

```bash
# 自定义SSH端口
bash deploy_ssh.sh root@192.168.1.100 --port 2222

# 跳过备份（不推荐）
bash deploy_ssh.sh root@192.168.1.100 --skip-backup

# 查看帮助
bash deploy_ssh.sh --help
```

---

## 方式二：服务器本地部署

### 适用场景

- 首次部署
- SSH密钥未配置
- 需要在服务器上直接操作

### 使用步骤

#### 步骤1：登录服务器

```bash
ssh root@your-server-ip
```

#### 步骤2：进入项目目录

```bash
cd /opt/1panel/www/sites/kec/index/kec-manager
```

#### 步骤3：备份数据库（重要！）

```bash
# 创建备份
cp server/data/kec.db server/data/kec.db.backup.$(date +%Y%m%d_%H%M%S)

# 验证备份
ls -lh server/data/*.db*
```

#### 步骤4：拉取最新代码

```bash
# 查看更新内容
git fetch
git log HEAD..origin/main --oneline

# 确认无误后拉取
git pull
```

#### 步骤5：执行部署脚本

```bash
bash deploy.sh
```

#### 步骤6：验证部署

```bash
# 检查服务状态
pm2 status

# 查看日志
pm2 logs kec-server --lines 20

# 测试接口
curl http://localhost:3000/api/health
```

---

## 方式三：手动更新

### 适用场景

- 自动化脚本失败
- 需要精细控制每个步骤
- 故障排查和调试

### 详细步骤

#### 步骤1：备份

```bash
# 备份数据库
cp /opt/1panel/www/sites/kec/index/kec-manager/server/data/kec.db \
   /opt/1panel/www/sites/kec/index/kec-manager/server/data/kec.db.backup.$(date +%Y%m%d)

# 备份当前代码（可选）
cd /opt/1panel/www/sites/kec/index/kec-manager
git stash push "backup-before-update-$(date +%Y%m%d)"
```

#### 步骤2：拉取代码

```bash
cd /opt/1panel/www/sites/kec/index/kec-manager

# 查看更新
git fetch
git diff HEAD..origin/main --stat

# 拉取
git pull origin main
```

#### 步骤3：安装依赖

```bash
# 后端依赖
cd server
npm install --production

# 前端依赖
cd ../client
npm install
```

#### 步骤4：数据库迁移

```bash
cd server

# 执行迁移
npx prisma migrate deploy

# 生成Prisma Client
npx prisma generate

# 初始化种子数据（安全，可重复执行）
npm run db:seed
```

#### 步骤5：构建前端

```bash
cd client
npm run build
```

#### 步骤6：重启服务

```bash
# 停止旧服务
pm2 stop kec-server

# 删除旧进程
pm2 delete kec-server

# 启动新服务
cd /opt/1panel/www/sites/kec/index/kec-manager/server
pm2 start src/server.js --name kec-server

# 保存PM2配置
pm2 save
```

#### 步骤7：验证

```bash
# 等待服务启动
sleep 5

# 健康检查
curl http://localhost:3000/api/health

# 查看日志
pm2 logs kec-server --lines 50
```

---

## 方式四：Docker 部署（容器化）

### 适用场景

- 1Panel / 容器化环境
- 需要环境隔离、便于回滚
- 不希望直接在宿主机安装 Node.js / PM2

### 关键设计说明

| 要点 | 说明 |
|------|------|
| **named volume** | `docker-compose.yml` 中使用 `kec-data` / `kec-uploads` 命名卷（由 Docker 管理），而非 bind mount。原因是容器内 `appuser` 为非 root 用户，bind mount 的 `./data` 默认属主为 root，会导致 SQLite 无法写入。命名卷由 Docker 按容器用户初始化权限，可正常写入。 |
| **appuser** | `server/Dockerfile` 以非 root 用户 `appuser` 运行进程，符合容器安全最佳实践。 |
| **WAL 模式** | Prisma 连接 SQLite 时启用 `journal_mode = WAL`（见 `server/src/lib/prisma.js` / `schema.prisma`），提升并发读写性能，降低 `database is locked` 概率。备份时建议同时复制 `-wal` 和 `-shm` 文件，或先执行 `PRAGMA wal_checkpoint(FULL)`。 |
| **数据库路径** | 容器内为 `/app/data/kec.db`，对应命名卷 `kec-data`。宿主机数据位于 `docker volume inspect kec-data` 返回的 `Mountpoint`。 |

### 使用步骤

```bash
# 1. 进入项目目录
cd /opt/1panel/www/sites/kec/index/kec-manager

# 2. 拉取最新代码
git pull

# 3. 配置环境变量（首次需复制并修改 .env.docker）
cp .env.docker .env  # 仅首次

# 4. 重新构建并启动
docker compose up -d --build

# 5. 查看状态
docker compose ps
docker compose logs -f server --tail 50

# 6. 健康检查
curl http://localhost:3000/api/health
```

### 数据库备份（Docker 环境）

```bash
# 直接从命名卷备份
docker run --rm -v kec-data:/data -v $(pwd)/backups:/backup alpine \
  sh -c "cp /data/kec.db /backup/kec_backup_$(date +%Y%m%d_%H%M%S).db"
```

---

## 💾 数据库备份与恢复

### 自动备份（deploy_ssh.sh）

```bash
# 使用deploy_ssh.sh会自动备份
bash deploy_ssh.sh root@your-server-ip

# 备份位置
/opt/1panel/www/sites/kec/index/kec-manager/backups/
├── kec_backup_20260614_023000.db
├── kec_backup_20260614_010000.db
└── ... (自动保留最近10个)
```

### 手动备份

```bash
# 方法1：直接复制
cp server/data/kec.db server/data/kec.db.backup.$(date +%Y%m%d)

# 方法2：使用sqlite3导出
sqlite3 server/data/kec.db ".dump" > backup_$(date +%Y%m%d).sql

# 方法3：压缩备份
tar czf backup_$(date +%Y%m%d).tar.gz server/data/kec.db
```

### 恢复数据库

```bash
# 方法1：从.db文件恢复
cp backups/kec_backup_20260614_023000.db server/data/kec.db
pm2 restart kec-server

# 方法2：从.sql文件恢复
sqlite3 server/data/kec.db < backup_20260614.sql
pm2 restart kec-server

# 方法3：从压缩包恢复
tar xzf backup_20260614.tar.gz
pm2 restart kec-server
```

### 备份策略建议

| 频率 | 类型 | 保留时间 |
|------|------|---------|
| 每次更新前 | 自动备份 | 永久（手动清理） |
| 每天凌晨 | 定时备份 | 30天 |
| 每周日 | 完整备份 | 90天 |

**设置定时备份（crontab）：**

> ⚠️ 项目仓库 `scripts/` 目录下**并不存在** `backup.sh` 和 `full-backup.sh`。请使用下方的内联命令直接备份，或自行编写脚本后放入服务器任意目录。

```bash
# 编辑crontab
crontab -e

# 添加每日备份任务（每天凌晨2点，直接复制数据库文件）
0 2 * * * cp /opt/1panel/www/sites/kec/index/kec-manager/server/data/kec.db /opt/1panel/www/sites/kec/index/kec-manager/backups/kec_backup_$(date +\%Y\%m\%d).db

# 添加每周完整备份任务（每周日凌晨3点，导出 SQL 并压缩）
0 3 * * 0 sqlite3 /opt/1panel/www/sites/kec/index/kec-manager/server/data/kec.db ".dump" | gzip > /opt/1panel/www/sites/kec/index/kec-manager/backups/kec_full_$(date +\%Y\%m\%d).sql.gz
```

---

## 🔧 常见问题排查

### 问题1：SSH连接失败

**症状：**
```
✗ SSH连接失败，请检查：
  1. 服务器地址是否正确
  2. SSH端口是否正确
  3. SSH密钥是否配置正确
  4. 防火墙是否允许SSH连接
```

**解决方案：**

```bash
# 1. 测试基本连接
ping your-server-ip

# 2. 测试SSH端口
telnet your-server-ip 22

# 3. 检查SSH密钥
ls -la ~/.ssh/id_*.pub

# 4. 重新配置SSH密钥
ssh-copy-id -p 22 root@your-server-ip

# 5. 手动测试SSH
ssh -v -p 22 root@your-server-ip
```

---

### 问题2：数据库迁移失败

**症状：**
```
✗ 迁移失败，尝试重置数据库...
```

**解决方案：**

```bash
# 1. 查看错误详情
cd /opt/1panel/www/sites/kec/index/kec-manager/server
npx prisma migrate deploy --verbose

# 2. 检查数据库文件权限
ls -lh data/kec.db
chmod 644 data/kec.db

# 3. 检查SQLite版本
sqlite3 --version

# 4. 强制重置数据库（⚠️ 会丢失数据）
npx prisma migrate reset --force

# 5. 从备份恢复
cp backups/kec_backup_YYYYMMDD_HHMMSS.db data/kec.db
```

---

### 问题3：服务启动失败

**症状：**
```
✗ 健康检查失败 (HTTP 000)
```

**解决方案：**

```bash
# 1. 查看PM2日志
pm2 logs kec-server --lines 100

# 2. 检查端口占用
netstat -tlnp | grep 3000
lsof -i :3000

# 3. 检查.env配置
cat server/.env | grep PORT

# 4. 手动启动测试
cd server
node src/server.js

# 5. 检查Node.js版本
node -v  # 应该 >= 18.0

# 6. 重新安装依赖
rm -rf node_modules
npm install --production
```

---

### 问题4：前端构建失败

**症状：**
```
✗ 前端构建完成失败
```

**解决方案：**

```bash
# 1. 清理缓存
cd client
rm -rf node_modules/.vite
rm -rf dist

# 2. 重新安装依赖
npm install

# 3. 查看详细错误
npm run build -- --debug

# 4. 检查Node.js内存限制
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build

# 5. 检查磁盘空间
df -h
```

---

### 问题5：JWT Token过期太快

**症状：**
用户频繁需要重新登录

**原因：**
早期版本将JWT过期时间从24h改为15m

**解决方案：**

这是**预期的安全增强**，Refresh Token会自动刷新，用户应该无感知。

如果确实需要调整：

```bash
# 编辑.env文件
vim server/.env

# 修改过期时间（不推荐超过1h）
JWT_EXPIRES_IN=30m

# 重启服务
pm2 restart kec-server
```

---

## ↩️ 回滚操作

### 快速回滚（推荐）

```bash
# 1. 停止当前服务
pm2 stop kec-server

# 2. 恢复到上一个版本
cd /opt/1panel/www/sites/kec/index/kec-manager
git reset --hard HEAD~1

# 3. 恢复数据库（如果需要）
cp backups/kec_backup_YYYYMMDD_HHMMSS.db server/data/kec.db

# 4. 重新启动
pm2 start kec-server
pm2 save

# 5. 验证
curl http://localhost:3000/api/health
```

### 完整回滚

```bash
# 1. 停止服务
pm2 stop kec-server
pm2 delete kec-server

# 2. 恢复到指定版本
cd /opt/1panel/www/sites/kec/index/kec-manager
git log --oneline  # 找到要回滚的commit hash
git reset --hard 9f3e2a1  # 例如回滚到v2.16.0

# 3. 恢复依赖
cd server
rm -rf node_modules
npm install --production

cd ../client
rm -rf node_modules
npm install
npm run build

# 4. 恢复数据库
cp backups/kec_backup_20260613.db server/data/kec.db

# 5. 启动服务
cd ../server
pm2 start src/server.js --name kec-server
pm2 save

# 6. 验证
sleep 5
curl http://localhost:3000/api/health
pm2 logs kec-server --lines 20
```

---

## 🎯 最佳实践

### 1. 更新前检查清单

- [ ] 已备份数据库
- [ ] 已查看更新日志（git log）
- [ ] 已通知用户（如有必要）
- [ ] 选择在低峰期执行
- [ ] 已准备回滚方案

### 2. 更新时机选择

| 更新类型 | 推荐时间 | 理由 |
|---------|---------|------|
| 紧急bug修复 | 立即 | 影响用户体验 |
| 小功能更新 | 工作日晚上 | 用户较少 |
| 大版本升级 | 周末凌晨 | 最低峰期 |
| 数据库变更 | 周日凌晨 | 有充足时间回滚 |

### 3. 监控建议

**更新后24小时内监控：**

```bash
# 1. 监控服务状态（每小时）
watch -n 3600 'pm2 status'

# 2. 监控错误日志
tail -f /opt/1panel/www/sites/kec/index/log/kec-manager/error.log

# 3. 监控数据库大小
du -sh server/data/kec.db

# 4. 监控API响应时间
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3000/api/health
```

**curl-format.txt内容：**
```
    time_namelookup:  %{time_namelookup}\n
       time_connect:  %{time_connect}\n
    time_appconnect:  %{time_appconnect}\n
   time_pretransfer:  %{time_pretransfer}\n
      time_redirect:  %{time_redirect}\n
 time_starttransfer:  %{time_starttransfer}\n
                    ----------\n
         time_total:  %{time_total}\n
```

### 4. 自动化脚本

**创建更新脚本 `scripts/update.sh`：**

```bash
#!/bin/bash
set -e

echo "=========================================="
echo "KEC 课程管理平台 - 自动更新脚本"
echo "=========================================="

# 备份
echo "[1/5] 备份数据库..."
cp server/data/kec.db backups/kec_backup_$(date +%Y%m%d_%H%M%S).db

# 拉取代码
echo "[2/5] 拉取最新代码..."
git pull

# 安装依赖
echo "[3/5] 安装依赖..."
cd server && npm install --production
cd ../client && npm install && npm run build

# 数据库迁移
echo "[4/5] 数据库迁移..."
cd ../server && npx prisma migrate deploy && npx prisma generate

# 重启服务
echo "[5/5] 重启服务..."
pm2 restart kec-server

echo "✅ 更新完成！"
pm2 status
```

**使用方法：**

```bash
chmod +x scripts/update.sh
./scripts/update.sh
```

### 5. 文档记录

**每次更新后记录：**

```markdown
## 更新记录

### 2026-07-02 v2.17.1
- 更新内容：架构审计修复（13 项，含 H1-H4 高危、C1-C2 关键）
- 执行人：张三
- 更新时间：02:30-03:00
- 结果：成功
- 备注：用户无感知，性能提升明显

### 2026-06-28 v2.15.0
- 更新内容：学期计算 / 方案匹配一致性修复
- 执行人：李四
- 更新时间：23:00-23:30
- 结果：成功
- 备注：含 H2 学期年份连续性校验
```

### 6. 环境变量参考

部署/更新时需关注以下环境变量（详见 `server/.env.example` 与 `.env.docker`）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `JWT_SECRET` / `JWT_REFRESH_SECRET` / `JWT_DOWNLOAD_SECRET` | — | JWT 各类密钥，**生产必须设置** |
| `JWT_EXPIRES_IN` | `15m` | Access Token 过期时间，不建议超过 1h |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh Token 过期时间 |
| `BCRYPT_ROUNDS` | `10`（.env.example）/ `12`（Docker） | 密码哈希轮数，值越大越安全但越慢，建议 10–12 |
| `DEFAULT_SEMESTER` | `2025-2026-2` | 默认学期，用于未指定学期参数的查询，格式 `起始年-结束年-序号` |
| `CORS_ORIGINS` | — | 允许跨域的前端地址，多个用逗号分隔 |
| `DATABASE_URL` | `file:./data/kec.db` | SQLite 数据库文件路径（Docker 内为 `file:/app/data/kec.db`） |
| `LOG_LEVEL` | `info` | 日志级别（`debug`/`info`/`warn`/`error`） |

> 📌 升级到 v2.x 后请确认 `BCRYPT_ROUNDS` 与 `DEFAULT_SEMESTER` 已在 `.env` 中显式配置，否则将使用代码内默认值。

---

## 📞 获取帮助

### 官方文档

- [README.md](../README.md) - 项目概览
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - 部署指南
- [REFACTORING_GUIDE.md](REFACTORING_GUIDE.md) - 重构指南
- [CODE_AUDIT_REPORT_2026-06-14.md](CODE_AUDIT_REPORT_2026-06-14.md) - 代码审计报告

### 常用命令速查

```bash
# SSH远程更新
bash deploy_ssh.sh root@your-server-ip

# 查看服务状态
pm2 status

# 查看日志
pm2 logs kec-server --lines 50

# 重启服务
pm2 restart kec-server

# 备份数据库
cp server/data/kec.db backups/kec_backup_$(date +%Y%m%d).db

# 检查版本
git log --oneline -3

# 健康检查
curl http://localhost:3000/api/health
```

### 紧急联系

如遇紧急情况，请：

1. 立即回滚到上一版本
2. 恢复数据库备份
3. 查看详细日志排查问题
4. 提交Issue到Gitee（https://gitee.com/shub77/kec-manager/issues）

---

<div align="center">

**KEC 课程管理平台 - 更新操作指南** © 2026

持续改进 · 稳定运行

</div>
