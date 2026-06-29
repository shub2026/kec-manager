# 构建阶段（构建上下文为项目根目录）
FROM node:20-alpine AS builder

WORKDIR /app

# 使用淘宝镜像加速依赖安装
RUN npm config set registry https://registry.npmmirror.com

# 复制根 package.json（vite.config.js 通过 '../package.json' 引用版本号）
COPY package.json ./

# 复制客户端依赖清单并安装
COPY client/package*.json ./client/
WORKDIR /app/client
RUN npm ci

# 复制客户端源代码并构建
COPY client/ .
RUN npm run build

# 生产阶段 - 使用 Nginx 提供静态文件服务
FROM nginx:alpine

# 复制自定义 Nginx 配置
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

# 复制构建产物到 Nginx 目录
COPY --from=builder /app/client/dist /usr/share/nginx/html

# 暴露端口
EXPOSE 80

# 启动 Nginx
CMD ["nginx", "-g", "daemon off;"]
