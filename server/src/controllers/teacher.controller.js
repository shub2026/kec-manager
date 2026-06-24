import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import {
  autoFixSortOrder,
  invalidateSortOrderCache,
  getNextSortOrder,
  buildUpdateData,
} from '../utils/sort.js';

/**
 * 获取教师列表（含关联的课程和学院）
 */
export async function listTeachers(req, res, next) {
  try {
    await autoFixSortOrder('teachers');
    const teachers = await prisma.teachers.findMany({
      include: {
        affiliated_college: { select: { id: true, name: true } },
        courses: {
          include: { course: { select: { id: true, name: true, code: true, type: true } } },
        },
        scheduling_colleges: {
          include: { college: { select: { id: true, name: true } } },
        },
        scheduling_levels: {
          include: { training_level: { select: { id: true, name: true } } },
        },
        _count: { select: { assignments: true } },
      },
      orderBy: { sort_order: 'asc' },
    });

    // viewer 角色脱敏教师 PII（出生年月），仅 admin/super_admin 可见
    const canViewPII = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    const formatted = teachers.map((t) => ({
      ...t,
      birth_date: canViewPII ? (t.birth_date ? String(t.birth_date).substring(0, 7) : null) : null,
      affiliatedCollege: t.affiliated_college,
      courseList: t.courses.map((tc) => tc.course),
      collegeList: t.scheduling_colleges.map((sc) => sc.college),
      trainingLevelList: t.scheduling_levels.map((sl) => sl.training_level),
      assignmentCount: t._count?.assignments || 0,
    }));

    success(res, formatted);
  } catch (e) {
    next(e);
  }
}

/**
 * 创建教师
 */
export async function createTeacher(req, res, next) {
  try {
    const {
      name,
      gender,
      birth_date,
      personnel_type,
      qualification_type,
      default_weekly_hours,
      affiliated_college_id,
      course_ids,
      college_ids,
      training_level_ids,
      status,
    } = req.body;
    if (!name) return fail(res, '教师姓名不能为空');

    const newSortOrder = await getNextSortOrder(prisma, 'teachers');

    const teacher = await prisma.teachers.create({
      data: {
        name,
        gender: gender || null,
        birth_date: birth_date || null,
        personnel_type: personnel_type || 'full_time',
        qualification_type: qualification_type || null,
        default_weekly_hours: default_weekly_hours != null ? Number(default_weekly_hours) : null,
        affiliated_college_id: affiliated_college_id != null ? Number(affiliated_college_id) : null,
        status: status === 'disabled' ? 'disabled' : 'active',
        sort_order: newSortOrder,
        courses: course_ids?.length
          ? { create: course_ids.map((cid) => ({ course_id: Number(cid) })) }
          : undefined,
        scheduling_colleges: college_ids?.length
          ? { create: college_ids.map((cid) => ({ college_id: Number(cid) })) }
          : undefined,
        scheduling_levels: training_level_ids?.length
          ? { create: training_level_ids.map((lid) => ({ training_level_id: Number(lid) })) }
          : undefined,
      },
      include: {
        affiliated_college: { select: { id: true, name: true } },
        courses: { include: { course: { select: { id: true, name: true } } } },
        scheduling_colleges: { include: { college: { select: { id: true, name: true } } } },
        scheduling_levels: { include: { training_level: { select: { id: true, name: true } } } },
      },
    });

    await createAuditLog({
      action: 'create',
      module: 'teacher',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: teacher.id, name, personnel_type },
      result: 'success',
      message: `创建教师：${name}`,
    });

    invalidateSortOrderCache('teachers');
    success(
      res,
      {
        ...teacher,
        affiliatedCollege: teacher.affiliated_college,
        courseList: teacher.courses.map((tc) => tc.course),
        collegeList: teacher.scheduling_colleges.map((sc) => sc.college),
        trainingLevelList: teacher.scheduling_levels.map((sl) => sl.training_level),
      },
      '创建成功'
    );
  } catch (e) {
    await createAuditLog({
      action: 'create',
      module: 'teacher',
      userId: req.user?.id,
      ip: req.ip,
      details: { name: req.body.name, error: e.message },
      result: 'failed',
      message: `创建教师失败：${e.message}`,
    });
    next(e);
  }
}

/**
 * 更新教师
 */
export async function updateTeacher(req, res, next) {
  try {
    const { id } = req.params;
    const { course_ids, college_ids, training_level_ids, affiliated_college_id, ...rest } =
      req.body;
    const data = buildUpdateData(rest, [
      'name',
      'gender',
      'birth_date',
      'personnel_type',
      'qualification_type',
      'default_weekly_hours',
      'sort_order',
      'status',
    ]);

    // 处理 affiliated_college_id
    if (affiliated_college_id !== undefined) {
      data.affiliated_college_id =
        affiliated_college_id != null && affiliated_college_id !== ''
          ? Number(affiliated_college_id)
          : null;
    }

    // 处理 default_weekly_hours 的 null 值
    if (
      rest.default_weekly_hours === null ||
      rest.default_weekly_hours === undefined ||
      rest.default_weekly_hours === ''
    ) {
      data.default_weekly_hours = null;
    } else if (rest.default_weekly_hours != null) {
      data.default_weekly_hours = Number(rest.default_weekly_hours);
    }

    try {
      // 关联表重建与主表更新置于同一事务，避免中途失败导致关联丢失
      const updated = await prisma.$transaction(async (tx) => {
        // 更新主表
        const teacher = await tx.teachers.update({
          where: { id: Number(id) },
          data,
        });

        // 更新课程关联
        if (course_ids !== undefined) {
          await tx.teacher_courses.deleteMany({ where: { teacher_id: Number(id) } });
          if (course_ids.length > 0) {
            await tx.teacher_courses.createMany({
              data: course_ids.map((cid) => ({ teacher_id: Number(id), course_id: Number(cid) })),
            });
          }
        }

        // 更新学院关联
        if (college_ids !== undefined) {
          await tx.teacher_scheduling_colleges.deleteMany({ where: { teacher_id: Number(id) } });
          if (college_ids.length > 0) {
            await tx.teacher_scheduling_colleges.createMany({
              data: college_ids.map((cid) => ({ teacher_id: Number(id), college_id: Number(cid) })),
            });
          }
        }

        // 更新任课层次关联
        if (training_level_ids !== undefined) {
          await tx.teacher_training_levels.deleteMany({ where: { teacher_id: Number(id) } });
          if (training_level_ids.length > 0) {
            await tx.teacher_training_levels.createMany({
              data: training_level_ids.map((lid) => ({
                teacher_id: Number(id),
                training_level_id: Number(lid),
              })),
            });
          }
        }

        // 重新查询含关联
        return tx.teachers.findUnique({
          where: { id: Number(id) },
          include: {
            affiliated_college: { select: { id: true, name: true } },
            courses: { include: { course: { select: { id: true, name: true } } } },
            scheduling_colleges: { include: { college: { select: { id: true, name: true } } } },
            scheduling_levels: {
              include: { training_level: { select: { id: true, name: true } } },
            },
            _count: { select: { assignments: true } },
          },
        });
      });

      await createAuditLog({
        action: 'update',
        module: 'teacher',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: updated.id, name: data.name || updated.name },
        result: 'success',
        message: `更新教师：${data.name || updated.name}`,
      });

      invalidateSortOrderCache('teachers');
      success(
        res,
        {
          ...updated,
          affiliatedCollege: updated.affiliated_college,
          courseList: updated.courses.map((tc) => tc.course),
          collegeList: updated.scheduling_colleges.map((sc) => sc.college),
          trainingLevelList: updated.scheduling_levels.map((sl) => sl.training_level),
          assignmentCount: updated._count?.assignments || 0,
        },
        '更新成功'
      );
    } catch (e) {
      await createAuditLog({
        action: 'update',
        module: 'teacher',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id), name: req.body.name, error: e.message },
        result: 'failed',
        message: `更新教师失败：${e.message}`,
      });
      if (e.code === 'P2025') return fail(res, '教师不存在', 404);
      throw e;
    }
  } catch (e) {
    next(e);
  }
}

/**
 * 删除教师
 */
export async function deleteTeacher(req, res, next) {
  try {
    const { id } = req.params;

    // 检查是否有教学安排
    const assignmentCount = await prisma.teaching_assignments.count({
      where: { teacher_id: Number(id) },
    });
    if (assignmentCount > 0) return fail(res, '该教师存在教学安排，无法删除');

    try {
      const teacher = await prisma.teachers.findUnique({ where: { id: Number(id) } });
      await prisma.teachers.delete({ where: { id: Number(id) } });

      await createAuditLog({
        action: 'delete',
        module: 'teacher',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id), name: teacher?.name },
        result: 'success',
        message: `删除教师：${teacher?.name}`,
      });

      invalidateSortOrderCache('teachers');
      success(res, null, '删除成功');
    } catch (e) {
      await createAuditLog({
        action: 'delete',
        module: 'teacher',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id) },
        result: 'failed',
        message: `删除教师失败：${e.message}`,
      });
      if (e.code === 'P2025') return fail(res, '教师不存在', 404);
      throw e;
    }
  } catch (e) {
    next(e);
  }
}

/**
 * 批量修改特定周课时
 */
export async function batchUpdateDefaultHours(req, res, next) {
  try {
    const { teacher_ids, default_weekly_hours } = req.body;
    if (!teacher_ids?.length) return fail(res, '请选择要修改的教师');

    const hours =
      default_weekly_hours != null && default_weekly_hours !== ''
        ? Number(default_weekly_hours)
        : null;

    await prisma.teachers.updateMany({
      where: { id: { in: teacher_ids.map(Number) } },
      data: { default_weekly_hours: hours },
    });

    await createAuditLog({
      action: 'update',
      module: 'teacher',
      userId: req.user?.id,
      ip: req.ip,
      details: { teacher_ids, default_weekly_hours: hours },
      result: 'success',
      message: `批量修改${teacher_ids.length}名教师的特定周课时为${hours ?? '空'}`,
    });

    invalidateSortOrderCache('teachers');
    success(res, null, `已修改${teacher_ids.length}名教师的特定周课时`);
  } catch (e) {
    next(e);
  }
}

/**
 * 切换教师启用/禁用状态
 */
export async function toggleTeacherStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'disabled'].includes(status)) {
      return fail(res, '状态值无效，应为 active 或 disabled');
    }

    const teacher = await prisma.teachers.findUnique({ where: { id: Number(id) } });
    if (!teacher) return fail(res, '教师不存在', 404);

    await prisma.teachers.update({
      where: { id: Number(id) },
      data: { status },
    });

    const statusLabel = status === 'active' ? '启用' : '禁用';

    await createAuditLog({
      action: 'update',
      module: 'teacher',
      userId: req.user?.id,
      ip: req.ip,
      details: { id: Number(id), name: teacher.name, status },
      result: 'success',
      message: `${statusLabel}教师：${teacher.name}`,
    });

    invalidateSortOrderCache('teachers');
    success(res, { id: Number(id), status }, `${statusLabel}成功`);
  } catch (e) {
    next(e);
  }
}
