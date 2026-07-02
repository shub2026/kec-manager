# 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 使用淘宝镜像加速依赖安装和 Prisma 引擎下载
RUN npm config set registry https://registry.npmmirror.com
# PRISMA_ENGINES_MIRROR: schema-engine 等二进制文件镜像（国内服务器访问 binaries.prisma.sh 受限）
ENV PRISMA_ENGINES_MIRROR=https://prisma-binaries.npmmirror.com

# 复制 package.json 并安装依赖
COPY package*.json ./
RUN npm ci

# 复制 Prisma schema 并生成客户端
COPY prisma ./prisma/
RUN npx prisma generate

# 复制源代码
COPY . .

# 生产阶段
FROM node:20-alpine

WORKDIR /app

# 安装运行时依赖（SQLite 支持）
RUN apk add --no-cache sqlite-libs

# 使用淘宝镜像加速依赖安装和 Prisma 引擎下载
RUN npm config set registry https://registry.npmmirror.com
# PRISMA_ENGINES_MIRROR: schema-engine 等二进制文件镜像（国内服务器访问 binaries.prisma.sh 受限）
ENV PRISMA_ENGINES_MIRROR=https://prisma-binaries.npmmirror.com

# 复制 package.json 并安装生产依赖
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 复制 Prisma schema 和迁移工具
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/prisma ./prisma
COPY src ./src

# 创建非 root 用户运行应用
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# 创建数据/上传目录并确保 appuser 拥有所有权
# named volume 挂载到 /app/data 时会继承镜像中该目录的 owner:group
RUN mkdir -p /app/data /app/uploads && chown -R appuser:appgroup /app

# 暴露端口
EXPOSE 3000

# 健康检查（用 -O /dev/null 实际请求，避免 --spider 的 HEAD 误判）
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -q -O /dev/null --tries=1 --timeout=5 http://localhost:3000/api/health || exit 1

USER appuser

# 启动服务（应用迁移文件，确保 schema 变更可追溯、可回滚）
# 容器单进程运行，migrate deploy 在启动时执行，此时无并发连接，不会触发 SQLite 锁冲突
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
