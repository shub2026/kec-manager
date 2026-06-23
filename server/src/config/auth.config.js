import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import { log } from '../utils/logger.js';

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  log.error('错误: JWT_SECRET 环境变量未配置！');
  log.error('请在 .env 文件中设置 JWT_SECRET，例如：JWT_SECRET=your-super-secret-key-here');
  log.error(
    "生成随机密钥示例：node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
  );
  throw new Error('JWT_SECRET 环境变量未配置');
}

const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
const jwtDownloadSecret = process.env.JWT_DOWNLOAD_SECRET;

const isProduction = process.env.NODE_ENV === 'production';
const usingDerivedRefresh = !jwtRefreshSecret;
const usingDerivedDownload = !jwtDownloadSecret;

if (usingDerivedRefresh || usingDerivedDownload) {
  const msg =
    '安全警告: JWT_REFRESH_SECRET 或 JWT_DOWNLOAD_SECRET 未独立配置，当前使用 HKDF 派生密钥';
  if (isProduction) {
    log.error(msg);
    log.error('生产环境必须设置独立的 JWT_REFRESH_SECRET 和 JWT_DOWNLOAD_SECRET');
  } else {
    log.warn(msg);
    log.warn('请在.env中添加: JWT_REFRESH_SECRET 和 JWT_DOWNLOAD_SECRET');
  }
}

/**
 * 使用 HKDF 从主密钥派生子密钥，替代简单字符串拼接
 */
function deriveKey(secret, info) {
  return crypto.hkdfSync('sha256', secret, '', info, 64).toString('hex');
}

const finalRefreshSecret = jwtRefreshSecret || deriveKey(jwtSecret, 'jwt-refresh-token');
const finalDownloadSecret = jwtDownloadSecret || deriveKey(jwtSecret, 'jwt-download-token');

export const authConfig = {
  jwtSecret, // Access Token密钥
  jwtRefreshSecret: finalRefreshSecret, // M10修复: Refresh Token密钥
  jwtDownloadSecret: finalDownloadSecret, // M10修复: Download Token密钥
  jwtExpiresIn: '15m', // 安全修复: 缩短为15分钟
  jwtRefreshExpiresIn: '7d',
  jwtDownloadExpiresIn: '30s', // Download Token短期有效（缩短降低日志/Referer泄露风险）
  bcryptRounds, // M9修复：从环境变量读取，默认12次迭代
};
