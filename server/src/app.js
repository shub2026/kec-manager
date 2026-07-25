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
import { validateCsrf } from './middleware/csrf.js';
import { auditMiddleware } from './middleware/audit.middleware.js'; // BIZ-H1修复：审计中间件兜底
import { log } from './utils/logger.js'; // L1修复：使用winston logger
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const app = express();

// 信任代理（Nginx 反向代理需要）
app.set('trust proxy', 1);

// 安全修复：添加helmet安全响应头
app.use(
  helmet({
    contentSecurityPolicy: {
      // 纯 JSON API 服务：默认拒绝所有资源加载与框架嵌入
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    crossOriginEmbedderPolicy: true, // L-1: 启用 COEP，要求跨域资源使用 CORS/CORP 正确声明，防止跨域信息泄露
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
      // H-5修复：开发环境允许无 origin 请求
      // 生产环境也放行无 origin 请求（来自 curl、健康检查、监控、移动端等非浏览器客户端）
      // CORS 是浏览器安全机制，非浏览器请求不受其约束，服务端无需拒绝
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
// S-05 修复：JSON body 限制降至 1MB（文件上传由 multer 独立处理，不受此限制）
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  // S-07修复：日志中脱敏下载令牌
  const logQuery = req.query.download_token
    ? { ...req.query, download_token: '[REDACTED]' }
    : req.query;
  log.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    query: Object.keys(logQuery).length > 0 ? logQuery : undefined,
  });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// H4修复：全局 API 速率限制，防止无限制调用导致 DoS 或数据爬取
// S1 修复：限流绕过纵深防御。app.set('trust proxy', 1) 时 express-rate-limit 默认用 req.ip
// （XFF 最左受信跳）；若前置 Nginx 仅"追加"而非"覆盖"客户端传入的 X-Forwarded-For，
// 攻击者可伪造 XFF 任意变换 req.ip 绕过限流。这里取 XFF 链中"最后一个"IP 作为限流 key
// （Nginx 反向代理会把真实客户端追加到 XFF 末尾），即便请求头前置伪造值，真实客户端仍在末尾，
// 限流归因更稳。权威修复仍依赖运维侧 Nginx 用 `proxy_set_header X-Forwarded-For $remote_addr;` 覆盖而非追加。
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 120, // 每 IP 每分钟最多 120 次
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health', // 健康检查不限流
  keyGenerator: (req, res, options) => {
    const ips = req.ips && req.ips.length ? req.ips : null;
    // 取 XFF 链末尾真实客户端 IP（S1 纵深防御）；降级调用 ipKeyGenerator 以正确处理 IPv6 校验
    return ips ? ips[ips.length - 1] : ipKeyGenerator(req, res, options);
  },
  message: { success: false, message: '请求过于频繁，请稍后再试' },
});
app.use('/api', apiLimiter);

// #25修复：注册命名转换中间件（在所有路由之前）
app.use(convertRequestNaming); // 请求：camelCase → snake_case
app.use(convertResponseNaming); // 响应：snake_case → camelCase
// H-4修复：全局应用 body XSS 清洗（密码类字段在中间件内自动跳过）
app.use(sanitizeBody);
app.use(sanitizeQuery); // 查询参数 XSS 过滤

// S-04修复：CSRF Token 验证（在所有安全中间件之后，路由之前）
app.use(validateCsrf);

// BIZ-H1修复：审计中间件兜底，对所有写操作自动记录（req.user 可能为空，记录为匿名）
// 挂载在 CSRF 之后、路由之前，确保所有写操作都被审计
app.use(auditMiddleware);

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

// 用户管理 - 仅super_admin可访问（系统管理模块整体收归超级管理员）
app.use('/api/users', authMiddleware, roleMiddleware('super_admin'), userRoutes);

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

// 404 catch-all：未匹配的路由返回 JSON（在 errorHandler 之前）
app.use((req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' });
});

app.use(errorHandler);

export default app;
