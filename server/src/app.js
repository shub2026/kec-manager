import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { prisma } from './lib/prisma.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import majorRoutes from './routes/major.routes.js';
import courseRoutes from './routes/course.routes.js';
import textbookRoutes from './routes/textbook.routes.js';
import classRoutes from './routes/class.routes.js';
import planRoutes from './routes/plan.routes.js';
import queryRoutes from './routes/query.routes.js';
import importRoutes from './routes/import.routes.js';
import exportRoutes from './routes/export.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import trainingLevelRoutes from './routes/trainingLevel.routes.js';
import collegeRoutes from './routes/college.routes.js';
import auditRoutes from './routes/audit.routes.js';
import teacherRoutes from './routes/teacher.routes.js';
import teachingArrangeRoutes from './routes/teaching-arrange.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import { authMiddleware, roleMiddleware } from './middleware/auth.middleware.js';
import { errorHandler } from './middleware/error.js';
import { convertResponseNaming, convertRequestNaming } from './middleware/naming.middleware.js';
import { sanitizeBody, sanitizeQuery } from './middleware/xss.js';
import { log } from './utils/logger.js'; // L1修复：使用winston logger

const app = express();

// 信任代理（Nginx 反向代理需要）
app.set('trust proxy', 1);

// 安全修复：添加helmet安全响应头
app.use(
  helmet({
    contentSecurityPolicy: false, // 禁用CSP以避免与前端资源冲突
    crossOriginEmbedderPolicy: false, // 允许跨域嵌入资源
  })
);

// CORS 配置：生产环境使用白名单，开发环境允许 localhost
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:5176',
      'http://localhost:5177',
      'http://localhost:3000',
    ];

// 开发环境允许所有localhost端口
const isDev = process.env.NODE_ENV !== 'production';

app.use(
  cors({
    origin: function (origin, callback) {
      // 允许无 origin 的请求（如移动应用、Postman）
      if (!origin) return callback(null, true);

      // 开发环境：允许所有 localhost 端口
      if (isDev && origin.startsWith('http://localhost:')) {
        return callback(null, true);
      }

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        log.warn('CORS blocked request from origin', { origin });
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  log.info(`${req.method} ${req.path}`, { ip: req.ip });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// #25修复：注册命名转换中间件（在所有路由之前）
app.use(convertRequestNaming); // 请求：camelCase → snake_case
app.use(convertResponseNaming); // 响应：snake_case → camelCase
// H-4修复：全局应用 body XSS 清洗（密码类字段在中间件内自动跳过）
app.use(sanitizeBody);
app.use(sanitizeQuery); // 查询参数 XSS 过滤

// 公开路由（无需认证）
app.use('/api/auth', authRoutes);

// 健康检查接口 - 增强版
app.get('/api/health', async (req, res) => {
  try {
    // 检查数据库连接
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
    });
  } catch (e) {
    // #23修复：健康检查错误不泄露数据库内部详情
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
    });
  }
});

// 查询接口 - 所有登录用户可访问
app.use('/api/query', authMiddleware, queryRoutes);

// 导出接口 - 所有登录用户可访问
app.use('/api/export', authMiddleware, exportRoutes);

// 用户管理 - admin和super_admin可访问（admin只能管理访客）
app.use('/api/users', authMiddleware, roleMiddleware('admin', 'super_admin'), userRoutes);

// 基础数据管理 - 所有登录用户GET可访问，修改需要admin权限（在路由文件中控制）
app.use('/api/majors', authMiddleware, majorRoutes);
app.use('/api/colleges', authMiddleware, collegeRoutes);
app.use('/api/training-levels', authMiddleware, trainingLevelRoutes);
app.use('/api/courses', authMiddleware, courseRoutes);
app.use('/api/textbooks', authMiddleware, textbookRoutes);

// 班级管理 - 所有登录用户GET可访问，修改需要admin权限
app.use('/api/classes', authMiddleware, classRoutes);

// 培养方案管理 - 所有登录用户GET可访问，修改需要admin权限
app.use('/api/plans', authMiddleware, planRoutes);

// 导入接口 - admin和super_admin可访问
app.use('/api/import', authMiddleware, roleMiddleware('admin', 'super_admin'), importRoutes);

// 系统设置 - GET公开访问（登录页需要），其他操作需要super_admin权限
app.use('/api/settings', settingsRoutes);

// 教师管理 - 所有登录用户GET可访问，修改需要admin权限
app.use('/api/teachers', authMiddleware, teacherRoutes);

// 教学安排 - 所有登录用户GET可访问，修改需要admin权限
app.use('/api/teaching-arrange', authMiddleware, teachingArrangeRoutes);

// 审计日志 - 仅超级管理员可访问
app.use('/api/audit', authMiddleware, roleMiddleware('super_admin'), auditRoutes);

// 首页概览 - 所有登录用户可访问
app.use('/api/dashboard', authMiddleware, dashboardRoutes);

app.use(errorHandler);

export default app;
