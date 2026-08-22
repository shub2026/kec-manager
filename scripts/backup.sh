#!/bin/bash
# ============================================================
# KEC 课程管理平台 — SQLite 数据库定时备份脚本（合并版）
#
# 部署：服务器任意位置（建议 /www/kec-manager/backup.sh），chmod +x
# 1panel 计划任务：Shell 脚本 → bash /www/kec-manager/backup.sh
#
# 数据库（宿主机）：/www/kec-manager/data/kec.db
# 备份输出：       /opt/backup/kec-back/kec_YYYYMMDD_HHMMSS.db
#
# 功能：
#   1. WAL checkpoint(TRUNCATE)：合并 wal 日志并截断，保证主库文件完整一致
#   2. 在线备份（.backup API）：备份期间不阻塞业务写入
#   3. integrity_check 完整性校验：失败即删除损坏备份并以非零码退出
#      （1panel 计划任务据此标记失败，坏备份不会静默留存）
#   4. 滚动清理超期备份 + 运行日志
# ============================================================

set -euo pipefail

# ───── 配置区（按需调整） ─────
CONTAINER_NAME="kec-manager"              # docker-compose.yml 中的 container_name
DATA_DIR="/www/kec-manager/data"          # 宿主机数据目录
BACKUP_DIR="/opt/backup/kec-back"         # 备份输出目录
CONTAINER_DB="/app/server/data/kec.db"    # 容器内数据库路径
KEEP_DAYS=30                              # 备份保留天数
BUSY_TIMEOUT_MS=10000                     # checkpoint 等待写锁超时（毫秒）
# ─────────────────────────────

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/kec_${TIMESTAMP}.db"
LOG_FILE="${BACKUP_DIR}/backup.log"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG_FILE"; }

mkdir -p "$BACKUP_DIR"

# 判断应用容器是否在运行
CONTAINER_RUNNING="no"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER_NAME"; then
  CONTAINER_RUNNING="yes"
fi

if [ "$CONTAINER_RUNNING" = "yes" ]; then
  # ── 应用运行中：容器内执行（镜像已内置 sqlite3）──

  # 1. WAL checkpoint：合并 wal 日志并截断为 0 字节
  #    busy_timeout：业务正在写时等待写锁而非立即失败
  log "执行 WAL checkpoint(TRUNCATE)..."
  if ! docker exec "$CONTAINER_NAME" sqlite3 "$CONTAINER_DB" \
      "PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}; PRAGMA wal_checkpoint(TRUNCATE);" 2>>"$LOG_FILE"; then
    log "错误：WAL checkpoint 失败，终止本次备份（见日志）"
    exit 1
  fi
  log "WAL checkpoint 完成"

  # 2. 在线备份（.backup 走 SQLite Online Backup API，备份期间业务照常读写）
  #    落盘路径：容器 /tmp（docker exec 默认 root 可写；数据卷内无 backup 目录且应用用户无权创建），
  #    校验通过后 docker cp 拷出到宿主机备份目录，再清理容器临时文件
  log "执行在线备份..."
  TMP_DB="/tmp/kec_backup_${TIMESTAMP}.db"
  docker exec "$CONTAINER_NAME" sqlite3 "$CONTAINER_DB" ".backup '${TMP_DB}'"

  # 容器内校验（拷出之前，保证落袋文件已验证）
  VERIFY=$(docker exec "$CONTAINER_NAME" sqlite3 "$TMP_DB" "PRAGMA integrity_check;" 2>&1)
  if [ "$VERIFY" != "ok" ]; then
    docker exec "$CONTAINER_NAME" rm -f "$TMP_DB"
    log "错误：备份文件校验失败（${VERIFY}），已清理容器临时文件"
    exit 1
  fi
  log "完整性校验通过 (integrity_check: ok)"

  docker cp "$CONTAINER_NAME:${TMP_DB}" "$BACKUP_FILE"
  docker exec "$CONTAINER_NAME" rm -f "$TMP_DB"
  VERIFIED=1
else
  # ── 容器未运行：主库即静止状态 ──
  log "警告：容器 ${CONTAINER_NAME} 未运行，走离线备份路径"

  if [ ! -f "${DATA_DIR}/kec.db" ]; then
    log "错误：未找到数据库文件 ${DATA_DIR}/kec.db"
    exit 1
  fi

  DB_SIZE=$(stat -c%s "${DATA_DIR}/kec.db" 2>/dev/null || echo 0)
  if [ "$DB_SIZE" -eq 0 ]; then
    log "错误：数据库文件大小为 0 字节，跳过备份"
    exit 1
  fi

  # 宿主机装有 sqlite3 则 checkpoint 兜底（wal 可能有残留日志）+ 在线备份
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "${DATA_DIR}/kec.db" \
      "PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}; PRAGMA wal_checkpoint(TRUNCATE);" >>"$LOG_FILE" 2>&1 || true
    sqlite3 "${DATA_DIR}/kec.db" ".backup '${BACKUP_FILE}'"
  else
    # 宿主机无 sqlite3：无法 checkpoint，连带 WAL 文件一起备份，
    # 恢复时需将同名三个文件一起还原到 data 目录（SQLite 启动时自动重放 wal）
    log "宿主机无 sqlite3，连同 WAL 文件一起备份（恢复时三个文件需一起还原）"
    cp -p "${DATA_DIR}/kec.db" "$BACKUP_FILE"
    [ -f "${DATA_DIR}/kec.db-wal" ] && cp -p "${DATA_DIR}/kec.db-wal" "${BACKUP_FILE}-wal"
    [ -f "${DATA_DIR}/kec.db-shm" ] && cp -p "${DATA_DIR}/kec.db-shm" "${BACKUP_FILE}-shm"
  fi
fi

# 3. 完整性校验：失败即删除损坏备份并退出（1panel 标记任务失败）
#    （在线路径已在容器内校验过，此处仅覆盖离线路径）
if [ "${VERIFIED:-0}" != "1" ]; then
  log "校验备份完整性..."
  VERIFY="unverified"
  if command -v sqlite3 >/dev/null 2>&1; then
    VERIFY=$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" 2>&1)
  fi
  if [ "$VERIFY" = "ok" ]; then
    log "完整性校验通过 (integrity_check: ok)"
  elif [ "$VERIFY" = "unverified" ]; then
    log "警告：宿主机无 sqlite3，跳过校验"
  else
    log "错误：备份文件校验失败（${VERIFY}），删除损坏备份"
    rm -f "$BACKUP_FILE" "${BACKUP_FILE}-wal" "${BACKUP_FILE}-shm"
    exit 1
  fi
fi

# 4. 滚动清理超期备份
DELETED=$(find "$BACKUP_DIR" -name 'kec_*.db*' -type f -mtime "+${KEEP_DAYS}" -print -delete 2>/dev/null | wc -l)
[ "$DELETED" -gt 0 ] && log "已清理 ${DELETED} 个超过 ${KEEP_DAYS} 天的旧备份"

# 5. 结果摘要
SIZE=$(du -h "$BACKUP_FILE" 2>/dev/null | cut -f1)
TOTAL=$(find "$BACKUP_DIR" -name 'kec_*.db*' -type f | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
log "备份完成: ${BACKUP_FILE}（${SIZE}）| 当前共 ${TOTAL} 个备份文件，总占用 ${TOTAL_SIZE}"
log "---"
