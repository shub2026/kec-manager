#!/bin/bash

# ==================== KEC 课程管理平台 - 生产环境部署脚本 ====================
# 使用方法：bash deploy.sh [server-ip]
# 示例：bash deploy.sh root@your-server.com

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 项目部署目录
PROJECT_DIR="/opt/www/sites/kec/index/kec-manager"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}KEC 课程管理平台 - 生产环境部署脚本${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 检查参数
if [ -z "$1" ]; then
    echo -e "${YELLOW}提示：未指定服务器地址，将使用本地部署${NC}"
    SERVER=""
else
    SERVER="$1"
    echo -e "${GREEN}目标服务器: ${SERVER}${NC}"
fi

# 函数：在本地或远程执行命令
execute() {
    if [ -z "$SERVER" ]; then
        bash -c "$1"
    else
        ssh "$SERVER" "$1"
    fi
}

# 函数：复制文件到服务器
copy_file() {
    if [ -z "$SERVER" ]; then
        cp "$1" "$2"
    else
        scp "$1" "${SERVER}:$2"
    fi
}

echo -e "${GREEN}[1/10] 检查前置条件...${NC}"
if command -v git &> /dev/null; then
    echo "✓ Git 已安装"
else
    echo -e "${RED}✗ 请先安装 Git${NC}"
    exit 1
fi

if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
    echo "✓ Node.js 版本: $NODE_VERSION"
    if [ "$NODE_MAJOR" -lt "20" ] 2>/dev/null; then
        echo -e "${RED}✗ Node.js 版本过低，需要 20+，当前为 ${NODE_VERSION}${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ 请先安装 Node.js 20+${NC}"
    exit 1
fi

# sqlite3 命令用于数据库完整性验证（缺失则跳过验证，不阻塞部署）
if execute "command -v sqlite3 &> /dev/null"; then
    echo "✓ sqlite3 已安装"
else
    echo -e "${YELLOW}⚠  sqlite3 未安装，数据库验证步骤将跳过${NC}"
fi

echo ""
echo -e "${GREEN}[2/10] 创建部署目录...${NC}"
execute "mkdir -p ${PROJECT_DIR}/server/data"
execute "mkdir -p ${PROJECT_DIR}/client"
execute "mkdir -p /opt/www/sites/kec/index/log/kec-manager"
echo "✓ 目录创建完成"

echo ""
echo -e "${GREEN}[3/10] 克隆/更新代码...${NC}"
if execute "test -d ${PROJECT_DIR}/.git"; then
    echo "更新现有代码..."
    # 强制丢弃本地修改（package-lock.json 等由 npm install 产生，应以远程为准）
    execute "cd ${PROJECT_DIR} && git fetch origin && git reset --hard origin/main"
else
    echo "首次克隆代码..."
    execute "mkdir -p $(dirname ${PROJECT_DIR})"
    execute "git clone https://gitee.com/shub77/kec-manager.git ${PROJECT_DIR}"
fi
echo "✓ 代码准备完成"

echo ""
echo -e "${GREEN}[4/10] 安装依赖...${NC}"
# server: 需要安装全部依赖（含 devDependencies 中的 prisma CLI），构建阶段用完再清理
execute "cd ${PROJECT_DIR}/server && npm install"
# client: 构建前端需要 devDependencies 中的 vite/esbuild 等
# 使用 --cache /tmp/npm-cache 避免 npm 缓存中损坏的 esbuild 平台二进制
execute "cd ${PROJECT_DIR}/client && npm install --cache /tmp/npm-cache"
echo "✓ 依赖安装完成"

echo ""
echo -e "${GREEN}[5/10] 停止现有服务...${NC}"
# 关键：必须在 Prisma 迁移前停止旧服务进程，释放 SQLite 文件写锁
# 旧服务持有连接会导致 migrate deploy 报 "database is locked"
if execute "command -v pm2 &> /dev/null"; then
    echo "停止 PM2 中的旧服务进程..."
    execute "pm2 delete kec-api 2>/dev/null || true"
    execute "pm2 delete kec-server 2>/dev/null || true"
    execute "pm2 save 2>/dev/null || true"
    echo "✓ PM2 旧进程已清理"
else
    echo "PM2 未安装，跳过（首次部署无需停止）"
fi
# 兜底：杀掉可能残留的非 PM2 Node 进程
# 用 ^node 锚定只匹配 node 进程命令行，避免误杀执行 pkill 的 bash -c 子进程自身
# （pkill -f 会匹配完整命令行，若模式含 server/src/server.js，bash -c "pkill -f ..."
#  的命令行也包含该字符串，会杀掉自身导致脚本中断）
execute "pkill -f '^node.*server/src/server\\.js' 2>/dev/null || true"
# 等待端口释放（SQLite WAL checkpoint 也需要时间）
echo "等待 2 秒确保端口释放与 WAL checkpoint..."
sleep 2
echo "✓ 服务已停止"

echo ""
echo -e "${GREEN}[6/10] 配置环境变量...${NC}"
# 仅在 .env 不存在时生成（避免覆盖已有配置）
if execute "test -f ${PROJECT_DIR}/server/.env"; then
    echo -e "${YELLOW}⚠  .env 文件已存在，跳过环境变量配置${NC}"
    echo -e "${YELLOW}   如需重新生成，请先删除 ${PROJECT_DIR}/server/.env${NC}"
else
    echo "生成安全的 JWT 密钥..."
    JWT_SECRET=$(execute "node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"")
    JWT_REFRESH_SECRET=$(execute "node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"")
    JWT_DOWNLOAD_SECRET=$(execute "node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"")

    # 创建 .env 文件
    cat > /tmp/kec-env << EOF
# 环境变量
NODE_ENV=production

# 数据库配置
DATABASE_URL="file:${PROJECT_DIR}/server/data/kec.db"

# 服务器端口
PORT=3000

# JWT密钥
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_DOWNLOAD_SECRET=${JWT_DOWNLOAD_SECRET}

# JWT过期时间
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# CORS 配置（请修改为你的实际域名）
CORS_ORIGINS=https://kec.sntip.cn,http://localhost:3000

# 日志级别
LOG_LEVEL=info

# 文件上传大小限制（MB）
MAX_FILE_SIZE=10
EOF

    copy_file /tmp/kec-env "${PROJECT_DIR}/server/.env"
    rm -f /tmp/kec-env
    execute "chmod 600 ${PROJECT_DIR}/server/.env"
    echo "✓ 环境变量配置完成"
    echo -e "${YELLOW}⚠  重要：请编辑 ${PROJECT_DIR}/server/.env 修改 CORS_ORIGINS 为你的实际域名${NC}"
fi

echo ""
echo -e "${GREEN}[7/10] 初始化数据库...${NC}"
# 清理可能的 WAL/SHM 残留文件（服务已停，可安全删除）
echo "清理 SQLite WAL 残留文件（如有）..."
execute "cd ${PROJECT_DIR}/server/data && rm -f kec.db-wal kec.db-shm 2>/dev/null || true"

echo "执行 Prisma 迁移..."
# migrate deploy 安全应用已有迁移，不会清空数据
# 此时服务已停，无并发连接，不会触发 "database is locked"
if ! execute "cd ${PROJECT_DIR}/server && npx prisma migrate deploy"; then
    echo -e "${RED}✗ Prisma 迁移失败，请手动检查迁移状态${NC}"
    echo -e "${YELLOW}    可运行：cd ${PROJECT_DIR}/server && npx prisma migrate status${NC}"
    echo -e "${YELLOW}    常见原因：数据库文件损坏 / 磁盘空间不足${NC}"
    # 迁移失败不继续启动，避免脏数据状态
    exit 1
fi
echo "✓ Prisma 迁移成功"

echo "生成 Prisma Client..."
execute "cd ${PROJECT_DIR}/server && npx prisma generate"
echo "初始化种子数据..."
execute "cd ${PROJECT_DIR}/server && npm run db:seed"

# 验证迁移状态：查询 _prisma_migrations 表中是否有未完成的迁移
echo "验证迁移完整性..."
if execute "command -v sqlite3 &> /dev/null"; then
    PENDING_MIGRATIONS=$(execute "sqlite3 ${PROJECT_DIR}/server/data/kec.db \"SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;\" 2>/dev/null || echo 'unknown'")
    if [ "$PENDING_MIGRATIONS" = "0" ]; then
        echo "✓ 所有迁移已完成（无未完成/回滚记录）"
    elif [ "$PENDING_MIGRATIONS" = "unknown" ]; then
        echo -e "${YELLOW}⚠  无法读取迁移状态表，可能是首次部署${NC}"
    else
        echo -e "${YELLOW}⚠  发现 ${PENDING_MIGRATIONS} 条未完成/回滚的迁移，建议手动检查${NC}"
        echo -e "${YELLOW}    可运行：cd ${PROJECT_DIR}/server && npx prisma migrate status${NC}"
    fi
fi

# 验证关键表和数据
echo "验证数据库完整性..."
TABLE_COUNT=$(execute "sqlite3 ${PROJECT_DIR}/server/data/kec.db \"SELECT count(*) FROM sqlite_master WHERE type='table' AND name='system_settings';\" 2>/dev/null || echo '0'")
USER_COUNT=$(execute "sqlite3 ${PROJECT_DIR}/server/data/kec.db \"SELECT count(*) FROM users;\" 2>/dev/null || echo '0'")
if [ "$TABLE_COUNT" = "1" ] && [ "$USER_COUNT" -ge "1" ] 2>/dev/null; then
    echo "✓ 数据库初始化完成（${USER_COUNT} 个用户已创建）"
else
    echo -e "${YELLOW}⚠️  数据库验证未通过，尝试补充初始化...${NC}"
    execute "cd ${PROJECT_DIR}/server && sqlite3 data/kec.db < prisma/manual_create_settings.sql 2>/dev/null || true"
fi

echo ""
echo -e "${GREEN}[8/10] 初始化系统设置...${NC}"
execute "cd ${PROJECT_DIR}/server && npm run init:settings || true"
echo "✓ 系统设置初始化完成"

echo ""
echo -e "${GREEN}[9/10] 构建前端...${NC}"
# 验证 esbuild 平台二进制是否可用（Vite 依赖 esbuild，二进制缺失会导致构建崩溃）
if ! execute "cd ${PROJECT_DIR}/client && node -e \"require('esbuild').version\"" 2>/dev/null; then
    echo -e "${YELLOW}⚠  esbuild 二进制异常，尝试重新安装...${NC}"
    execute "cd ${PROJECT_DIR}/client && rm -rf node_modules/esbuild node_modules/@esbuild && npm install esbuild --cache /tmp/npm-cache"
fi
execute "cd ${PROJECT_DIR}/client && npm run build"
echo "✓ 前端构建完成"
# 前端构建完成后清理 client 的 devDependencies，减少生产环境体积
execute "cd ${PROJECT_DIR}/client && npm prune --production 2>/dev/null || true"
# server 的 devDependencies（prisma CLI）在迁移阶段已用完，清理
execute "cd ${PROJECT_DIR}/server && npm prune --production 2>/dev/null || true"
echo "✓ 清理开发依赖完成"

echo ""
echo -e "${GREEN}[10/10] 启动服务...${NC}"
# 检查 PM2 是否安装
if ! execute "command -v pm2 &> /dev/null"; then
    echo "安装 PM2..."
    execute "npm install -g pm2"
fi

# 启动新服务（旧服务已在 [5/10] 停止，此处无需再清理）
echo "启动服务..."
execute "cd ${PROJECT_DIR}/server && pm2 start src/server.js --name kec-server"
execute "pm2 save"
execute "pm2 startup"

echo "✓ 服务启动完成"

# 等待服务启动并验证
echo ""
echo "等待服务启动..."
sleep 5

# 验证部署结果
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}部署验证...${NC}"
echo -e "${GREEN}========================================${NC}"

# 测试健康检查
HEALTH=$(execute "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health 2>/dev/null || echo '000'")
if [ "$HEALTH" = "200" ]; then
    echo -e "✓ 健康检查通过 (HTTP ${HEALTH})"
else
    echo -e "${RED}✗ 健康检查失败 (HTTP ${HEALTH})${NC}"
    echo -e "${YELLOW}    查看日志：pm2 logs kec-server --lines 50${NC}"
fi

# 测试 settings 接口
SETTINGS=$(execute "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/settings 2>/dev/null || echo '000'")
if [ "$SETTINGS" = "200" ]; then
    echo -e "✓ Settings 接口正常 (HTTP ${SETTINGS})"
else
    echo -e "${RED}✗ Settings 接口异常 (HTTP ${SETTINGS})${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}部署完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}服务状态：${NC}"
execute "pm2 status"
echo ""
echo -e "${GREEN}查看日志：${NC}"
echo "  pm2 logs kec-server"
echo ""
echo -e "${YELLOW}后续步骤：${NC}"
echo "1. 编辑 ${PROJECT_DIR}/server/.env 修改 CORS_ORIGINS"
echo "2. 配置 Nginx（参考 docs/PRODUCTION_DEPLOYMENT.md）"
echo "3. 设置 HTTPS 证书（推荐 Let's Encrypt）"
echo "4. 配置备份脚本"
echo "5. 测试访问：https://kec.sntip.cn"
echo ""
echo -e "${GREEN}默认管理员账号：${NC}"
echo "  用户名: admin"
echo "  密码: admin@123456"
echo -e "${YELLOW}⚠  请立即修改默认密码！${NC}"
