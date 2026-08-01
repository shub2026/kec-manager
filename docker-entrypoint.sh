#!/bin/sh
set -e

# 确保挂载目录可写（volume 挂载后目录权限可能为 root，nodejs 用户无法写入）
# data: SQLite 数据库
# uploads: multer 上传临时文件
# logs: winston 日志
mkdir -p /app/server/data /app/server/uploads /app/server/logs
chown -R nodejs:nodejs /app/server/data /app/server/uploads /app/server/logs 2>/dev/null || true

# 切换到 nodejs 用户执行主进程，保留环境变量
exec su-exec nodejs "$@"
