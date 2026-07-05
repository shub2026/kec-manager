import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { AuthService } from '../services/auth.service.js';
import { log } from '../utils/logger.js';
import { DEFAULT_SEMESTER } from '../constants/index.js';
import { invalidateDurationCache } from '../services/class.service.js';
import { parseSemesterString, invalidateSemesterCache } from '../services/settings.service.js';

const DEFAULT_SETTINGS = {
  current_semester: { value: DEFAULT_SEMESTER, description: '当前学期' },
  organization_name: { value: '欢迎回来', description: '系统标识' },
};

/**
 * 可选认证：识别请求是否携带有效 token，有则返回用户信息，无则返回 null
 * 用于 settings GET 接口（登录页匿名访问 + 登录用户访问需区分返回内容）
 * 会查询数据库验证用户是否仍处于激活状态，避免被禁用的用户通过有效 JWT 绕过检查
 */
async function tryGetAuthUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  const decoded = AuthService.verifyToken(token);
  if (!decoded) return null;
  const user = await prisma.users.findUnique({
    where: { id: decoded.id },
    select: { id: true, role: true, is_active: true },
  });
  if (!user || !user.is_active) return null;
  return { ...decoded, role: user.role };
}

export async function getSettings(req, res, next) {
  try {
    const settings = await prisma.system_settings.findMany();
    const map = {};
    settings.forEach((s) => {
      map[s.key] = { value: s.value, description: s.description };
    });

    for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
      if (!map[key]) {
        map[key] = { value: def.value, description: def.description, isDefault: true };
      }
    }

    // 尝试识别登录用户：无有效 token（匿名，登录页）只返回非敏感的系统标识
    const authUser = await tryGetAuthUser(req);
    if (!authUser) {
      const publicMap = {};
      if (map.organization_name) publicMap.organization_name = map.organization_name;
      return success(res, publicMap);
    }

    // 登录用户返回全部设置
    req.user = authUser;
    success(res, map);
  } catch (e) {
    log.error('Settings GET Error', { error: e.message, stack: e.stack });
    const defaultMap = {};
    for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
      defaultMap[key] = { value: def.value, description: def.description, isDefault: true };
    }
    // M-6: 不再在 catch 中重复调用 tryGetAuthUser，直接使用默认值降级
    // 未认证请求也返回完整默认设置，前端按权限展示
    return success(res, defaultMap, '使用默认设置');
  }
}

export async function updateSettings(req, res, next) {
  try {
    const updates = req.body;
    const allowedKeys = Object.keys(DEFAULT_SETTINGS);
    const invalidKeys = Object.keys(updates).filter((key) => !allowedKeys.includes(key));

    if (invalidKeys.length > 0) {
      return fail(res, `不允许的设置项: ${invalidKeys.join(', ')}`, 400);
    }

    // H-1修复：用 parseSemesterString 统一校验，与读取/查询路径一致
    // 原正则 /^\d{4}-\d{4}-[12]$/ 允许 0000-0001-1、2025-2027-2 等非法值入库
    // P2-1: 用显式 != null 判空替代真值判断，避免空串 '' 被跳过校验后写入 DB
    if (updates.current_semester != null) {
      if (updates.current_semester === '') {
        return fail(res, '当前学期不能为空', 400);
      }
      const semResult = parseSemesterString(String(updates.current_semester));
      if (!semResult.success) {
        // P2-2: 返回更友好的错误信息，明确格式、年份范围与结束年份规则
        return fail(
          res,
          '当前学期格式错误，应为 YYYY-YYYY-N（如 2025-2026-1）；起始年份应在 2000-2099 之间，结束年份自动为起始+1，N 为 1（秋季）或 2（春季）',
          400
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(updates)) {
        await tx.system_settings.upsert({
          where: { key },
          update: { value: String(value) },
          create: {
            key,
            value: String(value),
            description: DEFAULT_SETTINGS[key]?.description || '',
          },
        });
      }
    });
    // M3 修复：更新设置后清除学期缓存，确保下次读取获取新值
    invalidateSemesterCache();
    invalidateDurationCache();
    await createAuditLog({
      action: 'update',
      module: 'system',
      userId: req.user?.id,
      ip: req.ip,
      details: { keys: Object.keys(updates) },
      result: 'success',
      message: `更新系统设置：${Object.keys(updates).join(', ')}`,
    });
    success(res, null, '设置已更新');
  } catch (e) {
    await createAuditLog({
      action: 'update',
      module: 'system',
      userId: req.user?.id,
      ip: req.ip,
      details: { keys: Object.keys(req.body) },
      result: 'failed',
      message: `更新系统设置失败: ${e.message}`,
    });
    next(e);
  }
}

export async function initializeSettings(req, res, next) {
  try {
    const initialized = [];
    for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
      const existing = await prisma.system_settings.findUnique({ where: { key } });
      if (!existing) {
        await prisma.system_settings.create({
          data: { key, value: def.value, description: def.description },
        });
        initialized.push(key);
      }
    }

    await createAuditLog({
      action: 'initialize',
      module: 'system',
      userId: req.user?.id,
      ip: req.ip,
      details: { initializedKeys: initialized },
      result: 'success',
      message: `初始化系统设置：${initialized.join(', ') || '无新增'}`,
    });

    success(
      res,
      { initialized },
      initialized.length > 0 ? `已初始化 ${initialized.length} 项设置` : '所有设置已存在'
    );
  } catch (e) {
    await createAuditLog({
      action: 'initialize',
      module: 'system',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: `初始化系统设置失败: ${e.message}`,
    });
    next(e);
  }
}

export async function resetSystem(req, res, next) {
  const reason = req.body.reason || null;
  try {
    await prisma.$transaction(async (tx) => {
      // 1. 先删所有子表/关联表（依赖其他表的外键的表）
      await tx.teaching_assignments.deleteMany();
      await tx.teacher_courses.deleteMany();
      await tx.teacher_scheduling_colleges.deleteMany();
      await tx.teacher_training_levels.deleteMany();
      await tx.plan_textbooks.deleteMany();
      await tx.plan_course_semesters.deleteMany();
      await tx.plan_courses.deleteMany();

      // 2. 再删主表
      await tx.teachers.deleteMany();
      await tx.classes.deleteMany();
      invalidateDurationCache();
      await tx.training_plans.deleteMany();
      await tx.textbooks.deleteMany();
      await tx.courses.deleteMany();
      await tx.majors.deleteMany();
      await tx.colleges.deleteMany();
      await tx.training_levels.deleteMany();
      await tx.system_settings.deleteMany();

      // 3. 先清空审计日志，再在事务内重新写入本次重置记录，确保破坏性操作留痕
      // S-10修复：删除前记录快照数量
      const auditLogCount = await tx.audit_logs.count();
      await tx.audit_logs.deleteMany();
      await tx.audit_logs.create({
        data: {
          action: 'delete',
          module: 'system',
          operator_id: req.user?.id || null,
          ip: req.ip || null,
          details: JSON.stringify({
            type: 'system_reset',
            reason,
            archived_audit_count: auditLogCount,
          }),
          result: 'success',
          message:
            '执行系统重置' +
            (reason ? `，原因：${reason}` : '') +
            `（归档记录：删除前共${auditLogCount}条审计日志）`,
        },
      });
      await tx.token_blacklist.deleteMany();
    });
    success(res, null, '系统已重置，所有业务数据和教师信息已清空，用户账号已保留');
  } catch (e) {
    await createAuditLog({
      action: 'delete',
      module: 'system',
      userId: req.user?.id,
      ip: req.ip,
      details: { type: 'system_reset' },
      result: 'failed',
      message: `系统重置失败: ${e.message}`,
    });
    next(e);
  }
}

export async function resetAuditLogs(req, res, next) {
  try {
    await prisma.$transaction(async (tx) => {
      // S-10修复：删除前记录快照数量，确保操作可追溯
      const logCount = await tx.audit_logs.count();
      await tx.audit_logs.deleteMany();
      // 清空后立即写入本次清空操作记录，确保可追溯
      await tx.audit_logs.create({
        data: {
          action: 'delete',
          module: 'system',
          operator_id: req.user?.id || null,
          ip: req.ip || null,
          details: JSON.stringify({
            type: 'reset_audit_logs',
            archived_count: logCount,
            operator: req.user?.id,
            reason: req.body.reason || null,
          }),
          result: 'success',
          message: `清空操作日志（归档记录：删除前共${logCount}条）`,
        },
      });
    });
    success(res, null, '操作日志已清空');
  } catch (e) {
    await createAuditLog({
      action: 'delete',
      module: 'system',
      userId: req.user?.id,
      ip: req.ip,
      details: { type: 'reset_audit_logs' },
      result: 'failed',
      message: `清空操作日志失败: ${e.message}`,
    });
    next(e);
  }
}
