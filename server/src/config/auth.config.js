// ES Module 求值顺序修复：auth.config.js 会在 server.js 的 dotenv.config() 之前被求值
// （因为 import 声明的模块先于当前模块代码执行），必须在此处独立加载 dotenv
import dotenv from 'dotenv'
dotenv.config()

// JWT密钥必须通过环境变量配置，生产环境禁止使用默认值
import { log } from '../utils/logger.js'; // L1修复：使用winston logger

const jwtSecret = process.env.JWT_SECRET

if (!jwtSecret) {
  log.error('错误: JWT_SECRET 环境变量未配置！');
  log.error('请在 .env 文件中设置 JWT_SECRET，例如：JWT_SECRET=your-super-secret-key-here');
  log.error('生成随机密钥示例：node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
  throw new Error('JWT_SECRET 环境变量未配置')
}

// M9修复：bcrypt密码哈希迭代次数配置化
const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10)

// M10修复：Token密钥分离 - Access/Refresh/Download使用不同密钥
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || jwtSecret + '_refresh'
const jwtDownloadSecret = process.env.JWT_DOWNLOAD_SECRET || jwtSecret + '_download'

// 警告：生产环境应使用独立的JWT_REFRESH_SECRET和JWT_DOWNLOAD_SECRET
if (jwtRefreshSecret === jwtSecret + '_refresh' || jwtDownloadSecret === jwtSecret + '_download') {
  log.warn('M10警告: Refresh或Download Token使用派生密钥，建议在生产环境设置独立密钥');
  log.warn('请在.env中添加: JWT_REFRESH_SECRET 和 JWT_DOWNLOAD_SECRET');
}

export const authConfig = {
  jwtSecret,              // Access Token密钥
  jwtRefreshSecret,       // M10修复: Refresh Token密钥
  jwtDownloadSecret,      // M10修复: Download Token密钥
  jwtExpiresIn: '15m',    // 安全修复: 缩短为15分钟
  jwtRefreshExpiresIn: '7d',
  jwtDownloadExpiresIn: '30s', // Download Token短期有效（缩短降低日志/Referer泄露风险）
  bcryptRounds,           // M9修复：从环境变量读取，默认12次迭代
}
