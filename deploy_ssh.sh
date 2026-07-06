#!/bin/bash

# ==================== KEC 课程管理平台 - SSH远程部署脚本 ====================
# 使用方法：bash deploy_ssh.sh <server-ip> [options]
# 示例：
#   bash deploy_ssh.sh root@192.168.1.100                    # 完整部署
#   bash deploy_ssh.sh root@192.168.1.100 --update-only      # 仅更新代码
#   bash deploy_ssh.sh root@192.168.1.100 --backup-only      # 仅备份数据库

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目部署目录
PROJECT_DIR="/opt/www/sites/kec/index/kec-manager"

# SSH配置
SSH_USER=""
SSH_HOST=""
SSH_PORT="22"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

# 部署模式
DEPLOY_MODE="full"  # full, update-only, backup-only

# 显示使用说明
show_usage() {
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}KEC 课程管理平台 - SSH远程部署脚本${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${YELLOW}使用方法：${NC}"
    echo "  bash deploy_ssh.sh <user@host> [options]"
    echo ""
    echo -e "${YELLOW}选项：${NC}"
    echo "  --port <port>       SSH端口号（默认22）"
    echo "  --update-only       仅更新代码和重启服务（不修改依赖和环境）"
    echo "  --backup-only       仅备份数据库"
    echo "  --skip-backup       跳过数据库备份（不推荐）"
    echo "  --help              显示此帮助信息"
    echo ""
    echo -e "${YELLOW}示例：${NC}"
    echo "  bash deploy_ssh.sh root@192.168.1.100"
    echo "  bash deploy_ssh.sh root@192.168.1.100 --port 2222"
    echo "  bash deploy_ssh.sh root@192.168.1.100 --update-only"
    echo "  bash deploy_ssh.sh root@192.168.1.100 --backup-only"
    echo ""
    exit 0
}

# 解析命令行参数
parse_args() {
    if [ $# -eq 0 ]; then
        show_usage
    fi

    SERVER="$1"
    shift

    # 解析SSH地址
    if [[ "$SERVER" == *"@"* ]]; then
        SSH_USER="${SERVER%%@*}"
        SSH_HOST="${SERVER##*@}"
    else
        SSH_HOST="$SERVER"
        SSH_USER="root"
    fi

    # 解析选项
    while [[ $# -gt 0 ]]; do
        case $1 in
            --port)
                SSH_PORT="$2"
                shift 2
                ;;
            --update-only)
                DEPLOY_MODE="update-only"
                shift
                ;;
            --backup-only)
                DEPLOY_MODE="backup-only"
                shift
                ;;
            --skip-backup)
                SKIP_BACKUP=true
                shift
                ;;
            --help)
                show_usage
                ;;
            *)
                echo -e "${RED}未知选项: $1${NC}"
                show_usage
                ;;
        esac
    done

    SSH_CMD="ssh ${SSH_OPTS} -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST}"
    SCP_CMD="scp ${SSH_OPTS} -P ${SSH_PORT}"
}

# 在远程服务器执行命令
execute() {
    local cmd="$1"
    local show_output="${2:-true}"

    if [ "$show_output" = "true" ]; then
        ${SSH_CMD} "$cmd"
    else
        ${SSH_CMD} "$cmd" > /dev/null 2>&1
    fi
}

# 复制文件到远程服务器
copy_to_remote() {
    local src="$1"
    local dst="$2"
    ${SCP_CMD} "$src" "${SSH_USER}@${SSH_HOST}:$dst"
}

# 从远程服务器复制文件
copy_from_remote() {
    local src="$1"
    local dst="$2"
    ${SCP_CMD} "${SSH_USER}@${SSH_HOST}:$src" "$dst"
}

# 检查SSH连接
check_ssh_connection() {
    echo -e "${GREEN}[0/10] 检查SSH连接...${NC}"
    if ${SSH_CMD} "echo '连接成功'" > /dev/null 2>&1; then
        echo -e "✓ SSH连接正常 (${SSH_USER}@${SSH_HOST}:${SSH_PORT})"
    else
        echo -e "${RED}✗ SSH连接失败，请检查：${NC}"
        echo "  1. 服务器地址是否正确: ${SSH_HOST}"
        echo "  2. SSH端口是否正确: ${SSH_PORT}"
        echo "  3. SSH密钥是否配置正确"
        echo "  4. 防火墙是否允许SSH连接"
        echo ""
        echo -e "${YELLOW}测试命令：${NC}"
        echo "  ssh -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST}"
        exit 1
    fi
    echo ""
}

# 备份数据库
backup_database() {
    echo -e "${GREEN}[1/10] 备份数据库...${NC}"

    # 检查数据库文件是否存在
    if ! execute "test -f ${PROJECT_DIR}/server/data/kec.db" false; then
        echo -e "${YELLOW}⚠  数据库文件不存在，跳过备份${NC}"
        return 0
    fi

    # 创建备份目录
    execute "mkdir -p ${PROJECT_DIR}/backups"

    # 生成备份文件名（带时间戳）
    BACKUP_FILE="${PROJECT_DIR}/backups/kec_backup_$(date +%Y%m%d_%H%M%S).db"

    # 执行备份
    echo "正在备份数据库..."
    execute "cp ${PROJECT_DIR}/server/data/kec.db ${BACKUP_FILE}"

    # 验证备份
    if execute "test -f ${BACKUP_FILE}" false; then
        BACKUP_SIZE=$(execute "du -h ${BACKUP_FILE} | cut -f1")
        echo -e "✓ 数据库备份完成: ${BACKUP_FILE} (${BACKUP_SIZE})"

        # 保留最近10个备份，删除旧的
        execute "cd ${PROJECT_DIR}/backups && ls -t kec_backup_*.db | tail -n +11 | xargs rm -f 2>/dev/null || true"
        echo -e "${YELLOW}ℹ  已清理旧备份，保留最近10个${NC}"
    else
        echo -e "${RED}✗ 数据库备份失败${NC}"
        exit 1
    fi
    echo ""
}

# 拉取最新代码
pull_code() {
    echo -e "${GREEN}[2/10] 拉取最新代码...${NC}"

    # 检查是否是git仓库
    if execute "test -d ${PROJECT_DIR}/.git" false; then
        echo "更新现有代码..."

        # 先fetch查看是否有更新
        CURRENT_COMMIT=$(execute "cd ${PROJECT_DIR} && git rev-parse HEAD" false)
        execute "cd ${PROJECT_DIR} && git fetch"

        REMOTE_COMMIT=$(execute "cd ${PROJECT_DIR} && git rev-parse origin/main" false)

        if [ "$CURRENT_COMMIT" = "$REMOTE_COMMIT" ]; then
            echo -e "${YELLOW}⚠  代码已是最新版本${NC}"
        else
            echo "检测到新版本，正在更新..."
            execute "cd ${PROJECT_DIR} && git pull"

            # 显示更新内容
            echo ""
            echo -e "${BLUE}本次更新：${NC}"
            execute "cd ${PROJECT_DIR} && git log HEAD~3..HEAD --oneline"
            echo ""
        fi
    else
        echo -e "${RED}✗ 项目目录不是git仓库${NC}"
        echo "首次部署请使用 deploy.sh 脚本"
        exit 1
    fi
    echo ""
}

# 安装依赖
install_dependencies() {
    echo -e "${GREEN}[3/10] 安装依赖...${NC}"

    # 检查Node.js版本
    NODE_VERSION=$(execute "node -v" false)
    echo "Node.js 版本: ${NODE_VERSION}"

    # 安装根目录依赖
    echo "安装根目录依赖..."
    execute "cd ${PROJECT_DIR} && npm install --production" false

    # 安装后端依赖
    echo "安装后端依赖..."
    execute "cd ${PROJECT_DIR}/server && npm install --production"

    # 安装前端依赖
    echo "安装前端依赖..."
    execute "cd ${PROJECT_DIR}/client && npm install" false

    echo "✓ 依赖安装完成"
    echo ""
}

# 数据库迁移
database_migration() {
    echo -e "${GREEN}[4/10] 数据库迁移...${NC}"

    # P0修复：迁移前自动备份生产库，防止迁移异常导致数据丢失
    # 仅在数据库文件已存在（非首次部署）且未显式跳过时执行
    if [ "$SKIP_BACKUP" != "true" ]; then
        if execute "test -f ${PROJECT_DIR}/server/data/kec.db" false; then
            backup_database
        fi
    fi

    # 执行Prisma迁移
    echo "执行 Prisma 迁移..."
    if execute "cd ${PROJECT_DIR}/server && npx prisma migrate deploy" false; then
        echo "✓ 数据库迁移成功"
    else
        # P0修复：迁移失败一律停止并保留现场，交由人工介入
        # 严禁自动 migrate reset / db push --force-reset —— 会清空生产数据
        echo -e "${RED}✗ Prisma 迁移失败，已停止部署以保护生产数据${NC}"
        echo -e "${YELLOW}    排查步骤：${NC}"
        echo -e "${YELLOW}    1. 检查迁移状态：cd ${PROJECT_DIR}/server && npx prisma migrate status${NC}"
        echo -e "${YELLOW}    2. 查看迁移错误：cd ${PROJECT_DIR}/server && npx prisma migrate deploy${NC}"
        echo -e "${YELLOW}    3. 已存在的历史备份位于：${PROJECT_DIR}/backups/${NC}"
        echo -e "${YELLOW}    人工确认无误后再重新执行部署脚本${NC}"
        exit 1
    fi

    # 生成Prisma Client
    echo "生成 Prisma Client..."
    execute "cd ${PROJECT_DIR}/server && npx prisma generate" false

    # 初始化种子数据
    echo "初始化种子数据..."
    execute "cd ${PROJECT_DIR}/server && npm run db:seed" false

    # 验证数据库
    echo "验证数据库完整性..."
    USER_COUNT=$(execute "sqlite3 ${PROJECT_DIR}/server/data/kec.db \"SELECT count(*) FROM users;\"" false)
    if [ "$USER_COUNT" -ge "1" ] 2>/dev/null; then
        echo "✓ 数据库初始化完成（${USER_COUNT} 个用户）"
    else
        echo -e "${YELLOW}⚠️  数据库验证未通过${NC}"
    fi
    echo ""
}

# 构建前端
build_frontend() {
    echo -e "${GREEN}[5/10] 构建前端...${NC}"

    # 执行构建
    execute "cd ${PROJECT_DIR}/client && npm run build"

    echo "✓ 前端构建完成"
    echo ""
}

# 重启服务
restart_service() {
    echo -e "${GREEN}[6/10] 重启服务...${NC}"

    # 检查PM2是否安装
    if ! execute "command -v pm2" false; then
        echo "安装 PM2..."
        execute "npm install -g pm2"
    fi

    # 停止旧服务
    echo "停止旧服务..."
    execute "pm2 stop kec-server 2>/dev/null || true" false
    execute "pm2 delete kec-server 2>/dev/null || true" false

    # 启动新服务
    echo "启动新服务..."
    execute "cd ${PROJECT_DIR}/server && pm2 start src/server.js --name kec-server"

    # 保存PM2配置
    execute "pm2 save" false

    echo "✓ 服务启动完成"
    echo ""
}

# 等待服务启动
wait_for_service() {
    echo -e "${GREEN}[7/10] 等待服务启动...${NC}"
    sleep 5
    echo "✓ 等待完成"
    echo ""
}

# 健康检查
health_check() {
    echo -e "${GREEN}[8/10] 健康检查...${NC}"

    # 测试健康检查接口
    HEALTH=$(execute "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health" false)
    if [ "$HEALTH" = "200" ]; then
        echo -e "✓ 健康检查通过 (HTTP ${HEALTH})"
    else
        echo -e "${RED}✗ 健康检查失败 (HTTP ${HEALTH})${NC}"
        echo -e "${YELLOW}查看日志：pm2 logs kec-server --lines 50${NC}"
        return 1
    fi

    # 测试settings接口
    SETTINGS=$(execute "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/settings" false)
    if [ "$SETTINGS" = "200" ]; then
        echo -e "✓ Settings 接口正常 (HTTP ${SETTINGS})"
    else
        echo -e "${RED}✗ Settings 接口异常 (HTTP ${SETTINGS})${NC}"
        return 1
    fi
    echo ""
}

# 显示服务状态
show_status() {
    echo -e "${GREEN}[9/10] 服务状态...${NC}"
    execute "pm2 status"
    echo ""

    echo -e "${GREEN}[10/10] 磁盘使用情况...${NC}"
    execute "du -sh ${PROJECT_DIR}"
    execute "df -h ${PROJECT_DIR}"
    echo ""
}

# 显示部署总结
show_summary() {
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}部署完成！${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${GREEN}服务器信息：${NC}"
    echo "  SSH: ${SSH_USER}@${SSH_HOST}:${SSH_PORT}"
    echo "  项目目录: ${PROJECT_DIR}"
    echo ""
    echo -e "${GREEN}常用命令：${NC}"
    echo "  查看日志:     ssh ${SSH_USER}@${SSH_HOST} 'pm2 logs kec-server'"
    echo "  查看状态:     ssh ${SSH_USER}@${SSH_HOST} 'pm2 status'"
    echo "  重启服务:     ssh ${SSH_USER}@${SSH_HOST} 'pm2 restart kec-server'"
    echo "  查看备份:     ssh ${SSH_USER}@${SSH_HOST} 'ls -lh ${PROJECT_DIR}/backups/'"
    echo ""
    echo -e "${YELLOW}后续步骤：${NC}"
    echo "  1. 测试访问: https://kec.sntip.cn"
    echo "  2. 检查功能是否正常"
    echo "  3. 查看应用日志确认无错误"
    echo ""
    echo -e "${GREEN}默认管理员账号：${NC}"
    echo "  用户名: admin"
    echo "  密码: admin@123456"
    echo -e "${YELLOW}⚠  请立即修改默认密码！${NC}"
    echo ""
}

# 主函数
main() {
    parse_args "$@"

    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}KEC 课程管理平台 - SSH远程部署${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${BLUE}部署目标：${SSH_USER}@${SSH_HOST}:${SSH_PORT}${NC}"
    echo -e "${BLUE}部署模式：${DEPLOY_MODE}${NC}"
    echo -e "${BLUE}项目目录：${PROJECT_DIR}${NC}"
    echo ""

    # 检查SSH连接
    check_ssh_connection

    # 根据模式执行不同流程
    case $DEPLOY_MODE in
        backup-only)
            # 仅备份模式
            backup_database
            echo -e "${GREEN}✓ 备份完成${NC}"
            exit 0
            ;;

        update-only)
            # 仅更新模式
            pull_code
            restart_service
            wait_for_service
            health_check || true
            show_status
            show_summary
            exit 0
            ;;

        full)
            # 完整部署模式
            if [ "$SKIP_BACKUP" != "true" ]; then
                backup_database
            fi

            pull_code
            install_dependencies
            database_migration
            build_frontend
            restart_service
            wait_for_service
            health_check || true
            show_status
            show_summary
            ;;
    esac
}

# 执行主函数
main "$@"
