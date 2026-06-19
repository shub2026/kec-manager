import { AuthService } from '../services/auth.service.js'
import { prisma } from '../lib/prisma.js'
import { log } from '../utils/logger.js' // L1修复：使用winston logger

// 用户状态缓存：短期内复用查询结果，避免每个请求都查库（TTL 30s）
const userStatusCache = new Map()
const USER_STATUS_TTL = 30 * 1000

async function getActiveUserStatus(userId) {
  const now = Date.now()
  const cached = userStatusCache.get(userId)
  if (cached && cached.expireAt > now) {
    return cached
  }
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, role: true, is_active: true },
  })
  const result = user ? { role: user.role, is_active: user.is_active } : null
  userStatusCache.set(userId, { ...result, expireAt: now + USER_STATUS_TTL })
  return result
}

export function authMiddleware(req, res, next) {
  let token = null

  // 从 Authorization 头获取
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7)
  }
  // 备选：从查询参数获取短期下载令牌（用于 window.open 等场景，有效期60秒）
  else if (req.query.downloadToken) {
    const decoded = AuthService.verifyDownloadToken(req.query.downloadToken)
    if (decoded) {
      req.user = decoded
      return next()
    }
    return res.status(401).json({
      success: false,
      message: '下载令牌无效或已过期'
    })
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: '未授权，请先登录'
    })
  }

  const decoded = AuthService.verifyToken(token)

  if (!decoded) {
    return res.status(401).json({
      success: false,
      message: 'Token无效或已过期'
    })
  }

  // 校验用户是否仍存在且处于激活状态，并获取最新角色（防止降级/禁用后旧 token 仍生效）
  getActiveUserStatus(decoded.id).then(status => {
    if (!status || !status.is_active) {
      return res.status(401).json({
        success: false,
        message: '账号不存在或已被禁用，请重新登录'
      })
    }
    // 使用数据库中的最新角色，避免旧 token 中的角色信息过期
    req.user = { ...decoded, role: status.role }
    next()
  }).catch(err => {
    log.error('用户状态校验失败', { message: err.message })
    next(err)
  })
}

export function roleMiddleware(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      })
    }

    if (!allowedRoles.includes(req.user.role)) {
      log.warn('用户尝试访问受限资源', { username: req.user.username, role: req.user.role });

      return res.status(403).json({
        success: false,
        message: '权限不足，无法执行此操作'
      })
    }

    next()
  }
}
