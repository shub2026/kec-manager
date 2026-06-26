#!/bin/bash

# ==================== KEC 数据库备份脚本 ====================
# 用法：
#   手动执行：bash /opt/1panel/www/sites/kec/index/kec-manager/backup-db.sh
#   定时执行：crontab -e 添加：
#     0 2 * * * /opt/1panel/www/sites/kec/index/kec-manager/backup-db.sh >> /var/log/kec-backup.log 2>&1

PROJECT_DIR="/opt/1panel/www/sites/kec/index/kec-manager"
DB_FILE="$PROJECT_DIR/server/data/kec.db"
BACKUP_DIR="$PROJECT_DIR/backups"
KEEP_COUNT=30  # 保留最近备份数量

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始备份数据库..."

# 检查数据库文件
if [ ! -f "$DB_FILE" ]; then
    echo "错误：数据库文件不存在: $DB_FILE"
    exit 1
fi

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 生成备份文件名（带时间戳）
BACKUP_FILE="$BACKUP_DIR/kec_$(date +%Y%m%d_%H%M%S).db"

# 使用 sqlite3 .backup 命令安全备份（避免复制时数据不一致）
if command -v sqlite3 &>/dev/null; then
    sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"
else
    cp "$DB_FILE" "$BACKUP_FILE"
fi

# 验证备份
if [ -f "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 备份成功: $BACKUP_FILE ($SIZE)"

    # 清理旧备份，保留最近 N 个
    cd "$BACKUP_DIR"
    TOTAL=$(ls -1 kec_*.db 2>/dev/null | wc -l)
    if [ "$TOTAL" -gt "$KEEP_COUNT" ]; then
        ls -t kec_*.db | tail -n +$((KEEP_COUNT + 1)) | xargs rm -f
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 已清理旧备份，保留最近 $KEEP_COUNT 个"
    fi
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 备份失败！"
    exit 1
fi
