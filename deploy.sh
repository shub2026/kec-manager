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

# 项目部署目录（可通过环境变量 PROJECT_DIR 自定义）
# 默认值为 1Panel 标准路径，也支持任意自定义路径
PROJECT_DIR="${PROJECT_DIR:-/opt/www/sites/kec/index/kec-manager}"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}KEC 课程管理平台 - 生产环境部署脚本${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}部署目录: ${PROJECT_DIR}${NC}"
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
        # 使用 -tt 强制分配 TTY，确保输出实时显示，避免长时间命令看似卡住
        ssh -tt "$SERVER" "$1"
    fi
}

# 函数：在本地或远程执行命令并捕获输出（不分配 TTY）
# 注意：所有 $(...) 捕获输出的场景必须用本函数，
# execute 的 ssh -tt 会在输出行尾混入 \r，导致字符串比较、git 参数解析出错
execute_silent() {
    if [ -z "$SERVER" ]; then
        bash -c "$1" 2>/dev/null
    else
        ssh "$SERVER" "$1" 2>/dev/null
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
# 前置检查必须在部署目标机器上执行（本地部署=本机，远程部署=服务器）
if execute "command -v git &> /dev/null"; then
    echo "✓ Git 已安装"
else
    echo -e "${RED}✗ 请先在部署目标机器安装 Git${NC}"
    exit 1
fi

if execute "command -v node &> /dev/null"; then
    NODE_VERSION=$(execute_silent "node -v" | tr -d '[:space:]')
    NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
    echo "✓ Node.js 版本: $NODE_VERSION"
    if [ "$NODE_MAJOR" -lt "20" ] 2>/dev/null; then
        echo -e "${RED}✗ Node.js 版本过低，需要 20+，当前为 ${NODE_VERSION}${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ 请先在部署目标机器安装 Node.js 20+${NC}"
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
execute "mkdir -p ${PROJECT_DIR}/logs"
echo "✓ 目录创建完成"

echo ""
echo -e "${GREEN}[3/10] 克隆/更新代码...${NC}"
NEEDS_INSTALL=false
if execute "test -d ${PROJECT_DIR}/.git"; then
    echo "更新现有代码..."
    # 记录更新前的 commit，用于 [4/10] 检测依赖是否变化
    PREV_COMMIT=$(execute_silent "cd ${PROJECT_DIR} && git rev-parse HEAD 2>/dev/null || echo ''")
    # 强制丢弃本地修改（package-lock.json 等由 npm install 产生，应以远程为准）
    execute "cd ${PROJECT_DIR} && git fetch origin && git reset --hard origin/main"
    # 检测 dependencies/devDependencies 是否变化（忽略 version 字段变化）
    # 版本号递增会改动 package.json 但不影响依赖，不应触发重新安装
    if [ -n "$PREV_COMMIT" ]; then
        # git diff 输出 +/- 开头的变更行，过滤掉文件头(++)、version 行、空行
        # 若过滤后仍有内容，说明依赖相关字段变化
        DEPS_DIFF=$(execute_silent "cd ${PROJECT_DIR} && git diff ${PREV_COMMIT} HEAD -- server/package.json client/package.json | grep -E '^[+-][^+-]' | grep -vE '\"version\"|^$' || echo ''")
        if [ -n "$DEPS_DIFF" ]; then
            NEEDS_INSTALL=true
        fi
    else
        # 无法获取前一次 commit（如浅克隆），保守地触发安装
        NEEDS_INSTALL=true
    fi
else
    echo "首次克隆代码..."
    execute "mkdir -p $(dirname ${PROJECT_DIR})"
    execute "git clone https://gitee.com/shub77/kec-manager.git ${PROJECT_DIR}"
    NEEDS_INSTALL=true
fi
echo "✓ 代码准备完成"

echo ""
echo -e "${GREEN}[4/10] 安装依赖...${NC}"
# 配置国内 npm 镜像（加速依赖下载，特别是 esbuild/rollup 平台二进制）
# 同时配置 esbuild 二进制下载源为国内镜像
NPM_REGISTRY="https://registry.npmmirror.com"
ESBUILD_MIRROR="https://registry.npmmirror.com/-/binary/esbuild/"
execute "npm config set registry ${NPM_REGISTRY} 2>/dev/null || true"
# esbuild install script 通过 npm_config_..._binary_host 环境变量识别镜像
# 写入 .npmrc 确保 install script 也能从镜像下载平台二进制
execute "echo 'registry=${NPM_REGISTRY}' > ~/.npmrc && echo 'esbuild_binary_host=${ESBUILD_MIRROR}' >> ~/.npmrc"
# 智能跳过：仅在 dependencies/devDependencies 变化或首次部署时安装
# 版本号递增(2.20.2 → 2.20.3)不会触发重新安装
# 常规更新（仅业务代码变化）跳过此步，从 ~60s 降到 ~0s
if [ "$NEEDS_INSTALL" = "true" ]; then
    if [ -n "$PREV_COMMIT" ]; then
        echo "检测到依赖变化，重新安装..."
        if [ -n "$DEPS_DIFF" ]; then
            echo -e "${YELLOW}    变更内容:${NC}"
            echo "$DEPS_DIFF" | head -5 | sed 's/^/    /'
        fi
    else
        echo "首次部署，安装依赖..."
    fi
    # npm ci 基于 lockfile 严格安装，比 npm install 更快且可靠
    # --no-fund --no-audit 跳过资助提示和安全审计，加速安装
    # server: 需要全部依赖（含 devDependencies 中的 prisma CLI 用于迁移）
    execute "cd ${PROJECT_DIR}/server && npm ci --no-fund --no-audit"
    # client: 构建前端需要 devDependencies 中的 vite/esbuild 等
    # 使用 --cache /tmp/npm-cache 避免重复下载
    execute "cd ${PROJECT_DIR}/client && npm ci --no-fund --no-audit --cache /tmp/npm-cache"
    echo "✓ 依赖安装完成"
else
    # 兜底：验证 node_modules 完整性（防止被误删或被历史 npm prune 破坏）
    # 旧版部署脚本曾用 npm prune --production 删除 devDependencies，
    # 导致 esbuild（devDependency）被删，前端构建失败
    if ! execute "test -d ${PROJECT_DIR}/server/node_modules && test -d ${PROJECT_DIR}/client/node_modules"; then
        echo -e "${YELLOW}⚠  node_modules 缺失，执行完整安装...${NC}"
        execute "cd ${PROJECT_DIR}/server && npm ci --no-fund --no-audit"
        execute "cd ${PROJECT_DIR}/client && npm ci --no-fund --no-audit --cache /tmp/npm-cache"
    elif ! execute "test -f ${PROJECT_DIR}/client/node_modules/.bin/esbuild"; then
        # 关键依赖缺失（通常是历史 prune 遗留），需要重装
        echo -e "${YELLOW}⚠  检测到关键依赖缺失（esbuild），执行完整安装...${NC}"
        execute "cd ${PROJECT_DIR}/client && npm ci --no-fund --no-audit --cache /tmp/npm-cache"
    else
        echo "✓ 依赖未变化，跳过安装"
    fi
fi

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
    JWT_SECRET=$(execute_silent "node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"")
    JWT_REFRESH_SECRET=$(execute_silent "node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"")
    JWT_DOWNLOAD_SECRET=$(execute_silent "node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"")

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
CORS_ORIGINS=https://kec.sntip.cn

# 日志级别
LOG_LEVEL=info

# 文件上传大小限制（MB，数据导入接口）
MAX_FILE_SIZE=10

# 文档资料单文件大小上限（MB）
DOCUMENT_MAX_SIZE=50

# 上传目录：文档资料存于该目录的 documents/ 子目录，指向站点内持久化路径
UPLOAD_DIR=${PROJECT_DIR}/server/uploads
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
# migrate deploy 会自动运行 prisma generate，无需重复执行
# 此时服务已停，无并发连接，不会触发 "database is locked"
if ! execute "cd ${PROJECT_DIR}/server && npx prisma migrate deploy"; then
    echo -e "${RED}✗ Prisma 迁移失败，请手动检查迁移状态${NC}"
    echo -e "${YELLOW}    可运行：cd ${PROJECT_DIR}/server && npx prisma migrate status${NC}"
    echo -e "${YELLOW}    常见原因：数据库文件损坏 / 磁盘空间不足${NC}"
    # 迁移失败不继续启动，避免脏数据状态
    exit 1
fi
echo "✓ Prisma 迁移成功"

# 关键：始终重新生成 Prisma Client，确保与最新 schema 同步
# migrate deploy 仅在有新迁移时才自动 generate，若仅代码变更（无新迁移）则不会触发
echo "生成 Prisma Client..."
if ! execute "cd ${PROJECT_DIR}/server && npx prisma generate"; then
    echo -e "${RED}✗ Prisma Client 生成失败${NC}"
    echo -e "${YELLOW}    常见原因：DLL 文件被占用（确认服务已停止后重试）${NC}"
    exit 1
fi
echo "✓ Prisma Client 生成完成"

echo "初始化种子数据..."
# seed.js 已做幂等保护：admin 已存在则跳过，生产环境跳过 DEV_SEEDS
execute "cd ${PROJECT_DIR}/server && npm run db:seed"

# 验证迁移状态：查询 _prisma_migrations 表中是否有未完成的迁移
echo "验证迁移完整性..."
if execute "command -v sqlite3 &> /dev/null"; then
    PENDING_MIGRATIONS=$(execute_silent "sqlite3 ${PROJECT_DIR}/server/data/kec.db \"SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;\" 2>/dev/null || echo 'unknown'")
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
TABLE_COUNT=$(execute_silent "sqlite3 ${PROJECT_DIR}/server/data/kec.db \"SELECT count(*) FROM sqlite_master WHERE type='table' AND name='system_settings';\" 2>/dev/null || echo '0'")
USER_COUNT=$(execute_silent "sqlite3 ${PROJECT_DIR}/server/data/kec.db \"SELECT count(*) FROM users;\" 2>/dev/null || echo '0'")
if [ "$TABLE_COUNT" = "1" ] && [ "$USER_COUNT" -ge "1" ] 2>/dev/null; then
    echo "✓ 数据库初始化完成（${USER_COUNT} 个用户已创建）"
else
    echo -e "${YELLOW}⚠️  数据库验证未通过，尝试补充初始化...${NC}"
    # 路径与上方验证一致，使用绝对路径避免 cwd 不对导致找不到 SQL 文件
    execute "sqlite3 ${PROJECT_DIR}/server/data/kec.db < ${PROJECT_DIR}/server/prisma/manual_create_settings.sql 2>/dev/null || true"
fi

echo ""
echo -e "${GREEN}[8/10] 初始化系统设置...${NC}"
execute "cd ${PROJECT_DIR}/server && npm run init:settings || true"
echo "✓ 系统设置初始化完成"

echo ""
echo -e "${GREEN}[9/10] 构建前端...${NC}"
# 直接构建，不预检测 esbuild（预检测命令通过 SSH 执行时容易因引号/路径问题误判）
# 如果构建失败，自动重装依赖后重试一次
if ! execute "cd ${PROJECT_DIR}/client && npm run build"; then
    echo -e "${YELLOW}⚠  构建失败，可能是依赖损坏，尝试重装后重试...${NC}"
    execute "cd ${PROJECT_DIR}/client && npm ci --no-fund --no-audit --cache /tmp/npm-cache"
    if ! execute "cd ${PROJECT_DIR}/client && npm run build"; then
        echo -e "${RED}✗ 前端构建失败${NC}"
        echo -e "${YELLOW}  可能原因：${NC}"
        echo -e "${YELLOW}  1. 服务器 glibc 版本过低（esbuild 需要 glibc 2.28+）${NC}"
        echo -e "${YELLOW}  2. 内存不足（构建需要约 1GB 可用内存）${NC}"
        echo -e "${YELLOW}  3. Node.js 版本不兼容${NC}"
        echo -e "${YELLOW}  诊断信息：${NC}"
        execute "node -v && npm -v"
        execute "uname -a"
        execute "free -h 2>/dev/null || echo '无法获取内存信息'"
        exit 1
    fi
fi
echo "✓ 前端构建完成"
# 清理 .br 文件：1Panel OpenResty 默认不支持 brotli，
# .br 文件残留会导致 gzip_static 异常、部分客户端白屏
execute "find ${PROJECT_DIR}/client/dist -name '*.br' -delete 2>/dev/null || true"
echo "✓ 已清理 .br 预压缩文件"
# 不再执行 npm prune --production：保留 devDependencies 以便下次部署直接构建
# 下次更新若 package*.json 未变化，可跳过 npm ci，从 ~60s 降到 ~0s
# 代价：磁盘多占约 200MB，换来显著的部署加速

echo ""
echo -e "${GREEN}[10/10] 启动服务...${NC}"
# 检查 PM2 是否安装
if ! execute "command -v pm2 &> /dev/null"; then
    echo "安装 PM2..."
    execute "npm install -g pm2"
fi

# 启动新服务（旧服务已在 [5/10] 停止，此处无需再清理）
# 使用根目录 ecosystem.config.cjs 启动，统一运行时配置（内存上限、重启退避等）
echo "启动服务..."
execute "cd ${PROJECT_DIR} && pm2 start ecosystem.config.cjs"
execute "pm2 save"
execute "pm2 startup"

echo "✓ 服务启动完成"

# 等待服务启动并验证
echo ""
echo "等待服务启动..."
sleep 5

# 从 .env 读取 PORT（与服务器实际监听端口一致，避免硬编码 3000）
APP_PORT=$(execute_silent "grep -E '^PORT=' ${PROJECT_DIR}/server/.env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || echo '3000'")
if [ -z "$APP_PORT" ]; then APP_PORT="3000"; fi

# 验证部署结果
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}部署验证...${NC}"
echo -e "${GREEN}========================================${NC}"

# 验证失败标记：任一接口异常时置为 true，脚本以非零退出码结束
VERIFY_FAILED=false

# 测试健康检查
HEALTH=$(execute_silent "curl -s -o /dev/null -w '%{http_code}' http://localhost:${APP_PORT}/api/health 2>/dev/null || echo '000'")
if [ "$HEALTH" = "200" ]; then
    echo -e "✓ 健康检查通过 (HTTP ${HEALTH})"
else
    echo -e "${RED}✗ 健康检查失败 (HTTP ${HEALTH})${NC}"
    echo -e "${YELLOW}    查看日志：pm2 logs kec-server --lines 50${NC}"
    VERIFY_FAILED=true
fi

# 测试 settings 接口
SETTINGS=$(execute_silent "curl -s -o /dev/null -w '%{http_code}' http://localhost:${APP_PORT}/api/settings 2>/dev/null || echo '000'")
if [ "$SETTINGS" = "200" ]; then
    echo -e "✓ Settings 接口正常 (HTTP ${SETTINGS})"
else
    echo -e "${RED}✗ Settings 接口异常 (HTTP ${SETTINGS})${NC}"
    VERIFY_FAILED=true
fi

# 验证未通过：如实报告失败并以非零退出码结束（避免 CI/自动化误判部署成功）
if [ "$VERIFY_FAILED" = "true" ]; then
    echo ""
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}部署已执行完毕，但接口验证未通过！${NC}"
    echo -e "${RED}========================================${NC}"
    echo ""
    echo -e "${GREEN}服务状态：${NC}"
    execute "pm2 status"
    echo ""
    echo -e "${YELLOW}排查步骤：${NC}"
    echo "  1. 查看日志：pm2 logs kec-server --lines 50"
    echo "  2. 确认 ${PROJECT_DIR}/server/.env 配置正确"
    echo "  3. 修复后重新运行部署脚本"
    exit 1
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
echo "2. 配置 Nginx 反向代理（将 443 转发到 localhost:${APP_PORT}）"
echo "3. 设置 HTTPS 证书（推荐 Let's Encrypt）"
echo "4. 配置备份脚本"
echo "5. 测试访问：https://kec.sntip.cn"
echo ""
echo -e "${GREEN}默认管理员账号：${NC}"
echo "  用户名: admin"
echo "  密码: 请查看 server/.env 中 ADMIN_INITIAL_PASSWORD 配置"
echo -e "${YELLOW}⚠  请立即修改默认密码！${NC}"
