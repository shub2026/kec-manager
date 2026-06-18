import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { log } from '../utils/logger.js';

const DEFAULT_SETTINGS = {
  current_semester: { value: '2025-2026-2', description: '当前学期' },
  organization_name: { value: '欢迎回来', description: '系统标识' },
};

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
    
    success(res, map);
  } catch (e) { 
    log.error('Settings GET Error', { error: e.message, stack: e.stack });
    const defaultMap = {};
    for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
      defaultMap[key] = { value: def.value, description: def.description, isDefault: true };
    }
    return res.status(200).json({
      code: 200,
      message: '使用默认设置',
      data: defaultMap,
    });
  }
}

export async function updateSettings(req, res, next) {
  try {
    const updates = req.body;
    const allowedKeys = Object.keys(DEFAULT_SETTINGS);
    const invalidKeys = Object.keys(updates).filter(key => !allowedKeys.includes(key));
    
    if (invalidKeys.length > 0) {
      return fail(res, `不允许的设置项: ${invalidKeys.join(', ')}`, 400);
    }
    
    for (const [key, value] of Object.entries(updates)) {
      await prisma.system_settings.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value), description: DEFAULT_SETTINGS[key]?.description || '' },
      });
    }
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
    
    success(res, { initialized }, initialized.length > 0 ? `已初始化 ${initialized.length} 项设置` : '所有设置已存在');
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

async function resetData(type, transactionFn, req, res, next) {
  try {
    await prisma.$transaction(transactionFn);
    await createAuditLog({
      action: 'delete',
      module: 'system',
      userId: req.user?.id,
      ip: req.ip,
      details: { type },
      result: 'success',
      message: `清空${type}`,
    });
    success(res, null, `${type}已清空`);
  } catch (e) {
    await createAuditLog({
      action: 'delete',
      module: 'system',
      userId: req.user?.id,
      ip: req.ip,
      details: { type },
      result: 'failed',
      message: `清空${type}失败: ${e.message}`,
    });
    next(e);
  }
}

export async function resetBasic(req, res, next) {
  await resetData('basic', async (tx) => {
    await tx.plan_textbooks.deleteMany();
    await tx.plan_course_semesters.deleteMany();
    await tx.plan_courses.deleteMany();
    await tx.training_plans.deleteMany();
    await tx.classes.deleteMany();
    await tx.textbooks.deleteMany();
    await tx.courses.deleteMany();
    await tx.majors.deleteMany();
    await tx.colleges.deleteMany();
    await tx.training_levels.deleteMany();
  }, req, res, next);
}

export async function resetMajors(req, res, next) {
  const classCount = await prisma.classes.count();
  if (classCount > 0) {
    return fail(res, '系统中存在班级数据，请先清空班级后再清空专业');
  }
  await resetData('majors', async (tx) => {
    await tx.plan_textbooks.deleteMany();
    await tx.plan_course_semesters.deleteMany();
    await tx.plan_courses.deleteMany();
    await tx.training_plans.deleteMany();
    await tx.majors.deleteMany();
  }, req, res, next);
}

export async function resetColleges(req, res, next) {
  const classCount = await prisma.classes.count();
  if (classCount > 0) {
    return fail(res, '系统中存在班级数据，请先清空班级后再清空学院');
  }
  await resetData('colleges', async (tx) => {
    await tx.plan_textbooks.deleteMany();
    await tx.plan_course_semesters.deleteMany();
    await tx.plan_courses.deleteMany();
    await tx.training_plans.deleteMany();
    await tx.colleges.deleteMany();
  }, req, res, next);
}

export async function resetLevels(req, res, next) {
  const classCount = await prisma.classes.count();
  if (classCount > 0) {
    return fail(res, '系统中存在班级数据，请先清空班级后再清空层次');
  }
  await resetData('levels', async (tx) => {
    await tx.plan_textbooks.deleteMany();
    await tx.plan_course_semesters.deleteMany();
    await tx.plan_courses.deleteMany();
    await tx.training_plans.deleteMany();
    await tx.training_levels.deleteMany();
  }, req, res, next);
}

export async function resetCourses(req, res, next) {
  await resetData('courses', async (tx) => {
    await tx.plan_textbooks.deleteMany();
    await tx.plan_course_semesters.deleteMany();
    await tx.plan_courses.deleteMany();
    await tx.courses.deleteMany();
  }, req, res, next);
}

export async function resetTextbooks(req, res, next) {
  await resetData('textbooks', async (tx) => {
    await tx.plan_textbooks.deleteMany();
    await tx.textbooks.deleteMany();
  }, req, res, next);
}

export async function resetClasses(req, res, next) {
  await resetData('classes', async (tx) => {
    await tx.classes.deleteMany();
  }, req, res, next);
}

export async function resetTeachers(req, res, next) {
  await resetData('teachers', async (tx) => {
    await tx.teaching_assignments.deleteMany();
    await tx.teacher_courses.deleteMany();
    await tx.teacher_scheduling_colleges.deleteMany();
    await tx.teacher_training_levels.deleteMany();
    await tx.teachers.deleteMany();
  }, req, res, next);
}

export async function resetPlans(req, res, next) {
  await resetData('plans', async (tx) => {
    await tx.plan_textbooks.deleteMany();
    await tx.plan_course_semesters.deleteMany();
    await tx.plan_courses.deleteMany();
    await tx.training_plans.deleteMany();
  }, req, res, next);
}

export async function resetSystem(req, res, next) {
  await createAuditLog({
    action: 'delete',
    module: 'system',
    userId: req.user?.id,
    ip: req.ip,
    details: { type: 'system_reset' },
    result: 'success',
    message: '执行系统重置',
  });
  await prisma.$transaction(async (tx) => {
    await tx.audit_logs.deleteMany();
    await tx.classes.deleteMany();
    await tx.plan_textbooks.deleteMany();
    await tx.plan_course_semesters.deleteMany();
    await tx.plan_courses.deleteMany();
    await tx.training_plans.deleteMany();
    await tx.textbooks.deleteMany();
    await tx.courses.deleteMany();
    await tx.majors.deleteMany();
    await tx.colleges.deleteMany();
    await tx.training_levels.deleteMany();
    await tx.system_settings.deleteMany();
  });
  success(res, null, '系统已重置，所有业务数据已清空，用户账号已保留');
}

export async function resetAuditLogs(req, res, next) {
  await createAuditLog({
    action: 'delete',
    module: 'system',
    userId: req.user?.id,
    ip: req.ip,
    details: { type: 'reset_audit_logs' },
    result: 'success',
    message: '清空操作日志',
  });
  await prisma.audit_logs.deleteMany();
  success(res, null, '操作日志已清空');
}
