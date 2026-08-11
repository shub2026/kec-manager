# 第一阶段：构建前端
FROM node:20-alpine AS frontend-builder

WORKDIR /app/client

# 配置国内 npm 镜像（加速依赖下载，特别是 esbuild 平台二进制）
RUN npm config set registry https://registry.npmmirror.com && \
    npm config set esbuild_binary_host https://registry.npmmirror.com/-/binary/esbuild/

# 复制前端依赖配置
COPY client/package*.json ./

# 安装前端依赖
RUN npm ci --no-fund --no-audit

# 复制前端源码
COPY client/ ./

# 构建生产版本
RUN npm run build

# 第二阶段：构建后端依赖（包含 Prisma Client 生成）
FROM node:20-alpine AS backend-builder

WORKDIR /app/server

# 配置国内 npm 镜像
RUN npm config set registry https://registry.npmmirror.com

# 复制后端依赖配置
COPY server/package*.json ./
COPY server/prisma ./prisma/

# 安装全部依赖（包括 devDependencies 中的 prisma CLI）
RUN npm ci --no-fund --no-audit

# 生成 Prisma Client
RUN npx prisma generate

# 第三阶段：生产运行镜像
FROM node:20-alpine AS production

WORKDIR /app

# 安装 SQLite、wget（健康检查）和 curl（调试用）、su-exec（权限切换）
RUN apk add --no-cache sqlite wget curl su-exec

# 复制后端代码
COPY server/ ./server/

# 关键修复：复制 Prisma schema 和 migrations（prisma migrate deploy 需要）
COPY server/prisma ./server/prisma/

# 从构建阶段复制 node_modules（包含 Prisma Client）
COPY --from=backend-builder /app/server/node_modules ./server/node_modules

# 复制前端构建产物
COPY --from=frontend-builder /app/client/dist ./client/dist

# 复制根目录配置（可选，用于版本信息）
COPY package*.json ./

# 创建必要目录
RUN mkdir -p /app/server/logs /app/server/uploads

# 设置工作目录
WORKDIR /app/server

# 创建非 root 用户（安全最佳实践）
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# 复制启动脚本
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 暴露端口
EXPOSE 3000

# 使用 entrypoint 处理权限问题
ENTRYPOINT ["docker-entrypoint.sh"]

# 启动脚本：先执行迁移和种子，再启动服务
CMD ["sh", "-c", "npx prisma migrate deploy && npm run db:seed && npm run init:settings && node src/server.js"]
