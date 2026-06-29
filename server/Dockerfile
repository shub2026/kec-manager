# 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 使用淘宝镜像加速依赖安装
RUN npm config set registry https://registry.npmmirror.com

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

# 使用淘宝镜像加速依赖安装
RUN npm config set registry https://registry.npmmirror.com

# 复制 package.json 并安装生产依赖
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 复制 Prisma schema 和迁移工具
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/prisma ./prisma
COPY src ./src

# 创建数据目录和上传目录
RUN mkdir -p data uploads

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# 启动服务（首次启动时自动同步数据库 Schema）
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node src/server.js"]
