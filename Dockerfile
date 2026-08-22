# 基础镜像地址（可在 docker-compose.yml 中通过 build.args.NODE_IMAGE 覆盖）
# 国内环境使用镜像源加速，如：docker.m.daocloud.io/library/node:20-alpine
ARG NODE_IMAGE=node:20-alpine
# 应用版本标签（由 docker-compose.yml 的 build.args.APP_VERSION 注入，未配置默认 dev）
ARG APP_VERSION=dev

# 第一阶段：构建前端
FROM ${NODE_IMAGE} AS frontend-builder

WORKDIR /app/client

# 配置国内 npm 镜像（加速依赖下载，特别是 esbuild 平台二进制）
ENV npm_config_registry=https://registry.npmmirror.com
ENV npm_config_esbuild_binary_host=https://registry.npmmirror.com/-/binary/esbuild/

# 复制前端依赖配置
COPY client/package*.json ./

# 安装前端依赖（--mount 缓存 npm tarball：版本号变更导致层缓存失效时仍可复用，避免重新下载）
RUN --mount=type=cache,target=/root/.npm npm ci --no-fund --no-audit

# 复制前端源码
COPY client/ ./

# 复制根目录 package.json（vite.config.js 中 import pkg from '../package.json' 需要）
COPY package.json /app/package.json

# 构建生产版本
RUN npm run build

# 第二阶段：构建后端依赖（包含 Prisma Client 生成）
FROM ${NODE_IMAGE} AS backend-builder

WORKDIR /app/server

# 配置国内 npm 镜像
ENV npm_config_registry=https://registry.npmmirror.com
# Prisma 引擎二进制走国内镜像（默认从 binaries.prisma.sh 下载，国内偏慢）
ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma

# 复制后端依赖配置
COPY server/package*.json ./
COPY server/prisma ./prisma/

# 安装全部依赖（包括 devDependencies 中的 prisma CLI；npm 缓存挂载同上）
RUN --mount=type=cache,target=/root/.npm npm ci --no-fund --no-audit

# 生成 Prisma Client
RUN npx prisma generate

# 第三阶段：生产运行镜像
FROM ${NODE_IMAGE} AS production

# 重新声明 ARG（多阶段构建中 FROM 开启新作用域，需再次声明才能引用全局 APP_VERSION）
ARG APP_VERSION

WORKDIR /app

# 安装 SQLite、wget（健康检查）和 curl（调试用）、su-exec（权限切换）
RUN apk add --no-cache sqlite wget curl su-exec

# 复制后端代码（server/ 已包含 prisma schema 和 migrations，migrate deploy 所需）
COPY server/ ./server/

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

# 镜像元数据（OCI 标准标签，便于按版本追溯与回滚）
LABEL org.opencontainers.image.title="kec-manager" \
      org.opencontainers.image.version="${APP_VERSION}"

# 使用 entrypoint 处理权限问题
ENTRYPOINT ["docker-entrypoint.sh"]

# 启动脚本：先执行迁移和种子，再启动服务
CMD ["sh", "-c", "npx prisma migrate deploy && npm run db:seed && npm run init:settings && node src/server.js"]
