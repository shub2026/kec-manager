#!/usr/bin/env bash
# =============================================================
# kec-manager 自动更新脚本
# 功能：拉取 Gitee 仓库 -> 检测代码变化 -> 有变化才重新构建容器
# 用法：
#   首次执行：bash update.sh            （目录为空时自动 clone）
#   定时执行：crontab -e 添加
#     0 3 * * * /www/kec-manager/update.sh >> /www/kec-manager/logs/update.log 2>&1
# =============================================================

set -euo pipefail

APP_DIR="/www/kec-manager"
REPO_URL="https://gitee.com/shub77/kec-manager.git"
BRANCH="main"
LOCK_FILE="/tmp/kec-manager-update.lock"
LOCK_FD=200

log() { echo "[$(date '+%F %T')] $*"; }

# ---------- 并发保护：防止 cron 叠加执行 ----------
exec 200>"$LOCK_FILE"
if ! flock -n $LOCK_FD; then
    log "已有更新任务在运行，本次退出"
    exit 0
fi

# ---------- 基础检查 ----------
command -v docker >/dev/null 2>&1 || { log "错误：未安装 docker"; exit 1; }
if ! docker compose version >/dev/null 2>&1; then
    log "错误：docker compose 插件不可用"; exit 1
fi

cd "$APP_DIR"

# ---------- 首次执行：目录还没有代码则直接 clone ----------
if [ ! -d .git ]; then
    log "未发现 git 仓库，开始 clone..."
    git clone -b "$BRANCH" "$REPO_URL" . || { log "clone 失败"; exit 1; }
fi

# ---------- 获取远端最新版本 ----------
git fetch origin "$BRANCH" --quiet || { log "git fetch 失败，请检查网络"; exit 1; }

LOCAL_COMMIT=$(git rev-parse HEAD)
REMOTE_COMMIT=$(git rev-parse "origin/$BRANCH")

log "本地版本: ${LOCAL_COMMIT:0:10}"
log "远端版本: ${REMOTE_COMMIT:0:10}"

if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
    log "无更新，退出"
    exit 0
fi

# ---------- 有更新：显示变更内容并更新代码 ----------
log "检测到更新，开始部署..."
git log --oneline "${LOCAL_COMMIT}..${REMOTE_COMMIT}" | head -20 || true

# 关键：先停容器，避免 git 操作（reset/clean）期间数据库仍在被写入。
# 防止 git clean 误删运行中的 SQLite WAL/SHM 热文件导致库损坏（曾引发反复 502）。
docker compose stop kec-manager 2>/dev/null || true

git reset --hard "origin/$BRANCH"
# -e data：即便 .gitignore 漏配，也绝不清理数据目录（双保险）
git clean -fd -e data

# ---------- 环境变量文件检查 ----------
if [ ! -f .env ]; then
    log "警告：未找到 .env，从 .env.docker 复制模板，请检查其中的密钥配置"
    cp .env.docker .env
fi

# ---------- 重新构建并重启容器 ----------
log "开始构建镜像..."
if ! docker compose build; then
    log "镜像构建失败！服务保持原版本运行，请人工排查"
    exit 1
fi

docker compose up -d --remove-orphans
log "构建完成，容器已重启"

# ---------- 健康检查 ----------
log "等待服务启动..."
sleep 10
if docker compose ps --format json 2>/dev/null | grep -q '"Health":"healthy"'; then
    log "健康检查通过"
else
    STATUS=$(docker inspect -f '{{.State.Health.Status}}' kec-manager 2>/dev/null || echo "unknown")
    log "当前健康状态: $STATUS（如为 starting 请稍后手动确认）"
fi

log "更新完成: ${LOCAL_COMMIT:0:10} -> ${REMOTE_COMMIT:0:10}"
