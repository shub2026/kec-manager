import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 生产环境静态文件托管中间件
 * 仅在 NODE_ENV=production 时启用，托管前端构建产物
 * Docker 部署时前端 dist 位于 /app/client/dist
 * PM2 部署时前端 dist 位于项目根目录的 client/dist
 */
export function serveStaticFiles(app) {
  if (process.env.NODE_ENV !== 'production') return;

  // 按优先级查找前端构建产物目录
  const candidates = [
    path.resolve(__dirname, '../../client/dist'), // 标准相对路径 (server/src → client/dist)
    path.resolve('/app/client/dist'),              // Docker 容器内路径
  ];

  let distPath = null;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      distPath = candidate;
      break;
    }
  }

  if (!distPath) return;

  // 静态资源缓存 1 年（Vite 构建产物带 hash）
  app.use(express.static(distPath, {
    maxAge: '1y',
    immutable: true,
    index: false,
  }));

  // SPA fallback：所有非 API 路由返回 index.html
  // Express 5 通配符必须使用命名参数格式
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
