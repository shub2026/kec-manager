#!/bin/bash

# ==================== KEC 自动部署脚本 ====================
# 放在服务器上自动执行，拉取最新代码并部署
# 用法：
#   手动执行：bash /opt/1panel/www/sites/kec/index/kec-manager/auto-deploy.sh
#   定时执行：crontab -e 添加：
#     0 3 * * * /opt/1panel/www/sites/kec/index/kec-manager/auto-deploy.sh >> /var/log/kec-deploy.log 2>&1

set -e

PROJECT_DIR="/opt/1panel/www/sites/kec/index/kec-manager"
LOG_PREFIX="[KEC-DEPLOY $(date '+%Y-%m-%d %H:%M:%S')]"

echo "$LOG_PREFIX 开始自动部署..."

# 1. 进入项目目录
cd "$PROJECT_DIR"
echo "$LOG_PREFIX 进入项目目录: $PROJECT_DIR"

# 2. 备份数据库
if [ -f "$PROJECT_DIR/server/data/kec.db" ]; then
    mkdir -p "$PROJECT_DIR/backups"
    BACKUP_FILE="$PROJECT_DIR/backups/kec_backup_$(date +%Y%m%d_%H%M%S).db"
    cp "$PROJECT_DIR/server/data/kec.db" "$BACKUP_FILE"
    echo "$LOG_PREFIX 数据库已备份: $BACKUP_FILE"
    # 保留最近10个备份
    cd "$PROJECT_DIR/backups" && ls -t kec_backup_*.db | tail -n +11 | xargs rm -f 2>/dev/null || true
    cd "$PROJECT_DIR"
fi

# 3. 拉取最新代码
BEFORE=$(git rev-parse HEAD)
git fetch origin
git reset --hard origin/main
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
    echo "$LOG_PREFIX 代码已是最新版本，无需更新"
    exit 0
fi

echo "$LOG_PREFIX 代码已更新: $BEFORE -> $AFTER"
git log "$BEFORE".."$AFTER" --oneline | while read line; do
    echo "$LOG_PREFIX   $line"
done

# 4. 安装依赖
echo "$LOG_PREFIX 安装依赖..."
cd "$PROJECT_DIR" && npm install --production --silent 2>/dev/null || true
cd "$PROJECT_DIR/server" && npm install --production --silent 2>/dev/null || true

# 5. 数据库迁移
echo "$LOG_PREFIX 执行数据库迁移..."
cd "$PROJECT_DIR/server"
npx prisma migrate deploy 2>/dev/null || true
npx prisma generate 2>/dev/null || true

# 6. 构建前端
echo "$LOG_PREFIX 构建前端..."
cd "$PROJECT_DIR/client"
npm install --silent 2>/dev/null || true
npm run build 2>/dev/null
npm prune --production 2>/dev/null || true

# 7. 重启服务
echo "$LOG_PREFIX 重启服务..."
cd "$PROJECT_DIR/server"
pm2 restart kec-server

# 8. 健康检查
sleep 3
HEALTH=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health 2>/dev/null || echo '000')
if [ "$HEALTH" = "200" ]; then
    echo "$LOG_PREFIX 部署成功，健康检查通过 (HTTP $HEALTH)"
else
    echo "$LOG_PREFIX 警告：健康检查未通过 (HTTP $HEALTH)，请检查日志"
    pm2 logs kec-server --lines 20 --nostream
fi

echo "$LOG_PREFIX 自动部署完成"
