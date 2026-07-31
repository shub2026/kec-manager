import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import {
  autoFixSortOrder,
  invalidateSortOrderCache,
  getNextSortOrder,
  buildUpdateData,
} from '../utils/sort.js';

export async function listColleges(req, res, next) {
  try {
    await autoFixSortOrder('colleges');
    const colleges = await prisma.colleges.findMany({
      include: {
        _count: {
          select: {
            classes: true,
            training_plans: true,
            teacher_scheduling_colleges: true,
            affiliated_teachers: true,
          },
        },
      },
      orderBy: { sort_order: 'asc' },
    });

    const formattedColleges = colleges.map((college) => ({
      ...college,
      classCount: college._count?.classes || 0,
      planCount: college._count?.training_plans || 0,
      schedulingCount: college._count?.teacher_scheduling_colleges || 0,
      affiliatedCount: college._count?.affiliated_teachers || 0,
    }));
    success(res, formattedColleges);
  } catch (e) {
    next(e);
  }
}

export async function createCollege(req, res, next) {
  try {
    const { name, code, description, sort_order } = req.body;
    if (!name) return fail(res, '学院名称不能为空');
    const newSortOrder = await getNextSortOrder('colleges');
    const finalSortOrder = sort_order !== undefined ? Number(sort_order) : newSortOrder;
    const college = await prisma.colleges.create({
      data: { name, code, description, sort_order: finalSortOrder },
    });

    await createAuditLog({
      action: 'create',
      module: 'college',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: college.id, name, code },
      result: 'success',
      message: `创建学院：${name}`,
    });

    invalidateSortOrderCache('colleges');
    success(res, college, '创建成功');
  } catch (e) {
    await createAuditLog({
      action: 'create',
      module: 'college',
      userId: req.user?.id,
      ip: req.ip,
      details: req.body,
      result: 'failed',
      message: `创建学院失败：${e.message}`,
    });
    if (e.code === 'P2002') return fail(res, '该学院名称已存在');
    next(e);
  }
}

export async function updateCollege(req, res, next) {
  try {
    const { id } = req.params;
    const data = buildUpdateData(req.body, ['name', 'code', 'description', 'sort_order']);
    try {
      const college = await prisma.colleges.update({ where: { id: Number(id) }, data });

      await createAuditLog({
        action: 'update',
        module: 'college',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: college.id, name: data.name || college.name, code: data.code },
        result: 'success',
        message: `更新学院：${data.name || college.name}`,
      });

      invalidateSortOrderCache('colleges');
      success(res, college, '更新成功');
    } catch (e) {
      await createAuditLog({
        action: 'update',
        module: 'college',
        userId: req.user?.id,
        ip: req.ip,
        details: { id, ...req.body },
        result: 'failed',
        message: `更新学院失败：${e.message}`,
      });
      if (e.code === 'P2025') return fail(res, '学院不存在', 404);
      if (e.code === 'P2002') return fail(res, '该学院名称已存在');
      throw e;
    }
  } catch (e) {
    next(e);
  }
}

export async function getCollegeLevelMapping(req, res, next) {
  try {
    const classes = await prisma.classes.findMany({
      select: { college_id: true, training_level_id: true },
      where: {
        college_id: { not: null },
        training_level_id: { not: null },
      },
    });

    // collegeId -> [trainingLevelId, ...]
    const collegeToLevels = {};
    // trainingLevelId -> [collegeId, ...]
    const levelToColleges = {};

    for (const c of classes) {
      const cid = c.college_id;
      const lid = c.training_level_id;
      if (!collegeToLevels[cid]) collegeToLevels[cid] = new Set();
      collegeToLevels[cid].add(lid);
      if (!levelToColleges[lid]) levelToColleges[lid] = new Set();
      levelToColleges[lid].add(cid);
    }

    // Convert sets to arrays
    const mapping = {
      collegeToLevels: Object.fromEntries(
        Object.entries(collegeToLevels).map(([k, v]) => [k, [...v]])
      ),
      levelToColleges: Object.fromEntries(
        Object.entries(levelToColleges).map(([k, v]) => [k, [...v]])
      ),
    };

    success(res, mapping);
  } catch (e) {
    next(e);
  }
}

export async function deleteCollege(req, res, next) {
  try {
    const { id } = req.params;
    const numId = Number(id);

    try {
      // TOCTOU 修复：前置检查与删除包入同一事务，避免检查后并发插入班级/方案
      // 穿透检查触发 onDelete:SetNull 静默置空，产生"无学院班级"准孤儿数据
      const result = await prisma.$transaction(async (tx) => {
        // 前置检查：班级
        const classCount = await tx.classes.count({ where: { college_id: numId } });
        if (classCount > 0) return { blocked: '该学院下存在班级，无法删除' };

        // S-01 修复：检查教师排课偏好、培养方案、教师所属学院关联，防止级联静默清除
        const [schedulingCount, planCount, affiliatedCount] = await Promise.all([
          tx.teacher_scheduling_colleges.count({ where: { college_id: numId } }),
          tx.training_plans.count({ where: { college_id: numId } }),
          tx.teachers.count({ where: { affiliated_college_id: numId } }),
        ]);
        if (schedulingCount > 0 || planCount > 0 || affiliatedCount > 0) {
          const parts = [];
          if (schedulingCount > 0) parts.push(`${schedulingCount}位教师排课偏好`);
          if (planCount > 0) parts.push(`${planCount}个培养方案`);
          if (affiliatedCount > 0) parts.push(`${affiliatedCount}位教师所属`);
          return { blocked: `该学院仍被引用（${parts.join('、')}），请先解除关联` };
        }

        const deleted = await tx.colleges.delete({ where: { id: numId } });
        return { deleted };
      });
      if (result.blocked) return fail(res, result.blocked);
      const deleted = result.deleted;

      await createAuditLog({
        action: 'delete',
        module: 'college',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id), name: deleted.name },
        result: 'success',
        message: `删除学院：${deleted.name}`,
      });

      invalidateSortOrderCache('colleges');
      success(res, null, '删除成功');
    } catch (e) {
      await createAuditLog({
        action: 'delete',
        module: 'college',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id) },
        result: 'failed',
        message: `删除学院失败：${e.message}`,
      });
      if (e.code === 'P2025') return fail(res, '学院不存在', 404);
      throw e;
    }
  } catch (e) {
    next(e);
  }
}
