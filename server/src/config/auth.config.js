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

// JWT 密钥强度校验：生产环境强制拒绝弱密钥与占位符，开发环境仅告警
const PLACEHOLDER_SECRETS = new Set([
  'your-jwt-secret-here',
  'your-jwt-refresh-secret-here',
  'your-jwt-download-secret-here',
  'change-me',
  'secret',
]);

function validateSecretStrength(name, value) {
  if (value === undefined) return; // 未显式配置的密钥走派生逻辑，跳过
  if (value.length < 32 || PLACEHOLDER_SECRETS.has(value)) {
    if (isProduction) {
      throw new Error('生产环境 JWT 密钥必须至少 32 字符且不能使用占位符');
    } else {
      log.warn(`安全警告: ${name} 强度不足（少于32字符或为占位符），生产环境将拒绝启动`);
    }
  }
}

validateSecretStrength('JWT_SECRET', jwtSecret);
validateSecretStrength('JWT_REFRESH_SECRET', jwtRefreshSecret);
validateSecretStrength('JWT_DOWNLOAD_SECRET', jwtDownloadSecret);

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
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  jwtDownloadExpiresIn: process.env.JWT_DOWNLOAD_EXPIRES_IN || '30s',
  bcryptRounds, // M9修复：从环境变量读取，默认12次迭代
};
