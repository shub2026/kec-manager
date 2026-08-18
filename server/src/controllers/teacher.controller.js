import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { getCurrentSemesterInfo } from '../services/semester.service.js';
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
    const {
      page,
      page_size,
      name,
      course_id,
      personnel_type,
      college_id,
      training_level_id,
      affiliated_college_id,
      status,
      sort_by,
      sort_dir,
    } = req.query;
    const pageNum = page ? Number(page) : 1;
    const pageSizeNum = page_size ? Number(page_size) : 20;

    await autoFixSortOrder('teachers');

    // 服务端筛选：姓名模糊、人员类别、状态、归属学院、以及通过关联表过滤学科/意向学院/意向层次
    const where = {};
    if (name) where.name = { contains: name };
    if (personnel_type) where.personnel_type = personnel_type;
    if (status) where.status = status;
    if (affiliated_college_id) where.affiliated_college_id = Number(affiliated_college_id);
    if (course_id) where.courses = { some: { course_id: Number(course_id) } };
    if (college_id) where.scheduling_colleges = { some: { college_id: Number(college_id) } };
    if (training_level_id)
      where.scheduling_levels = { some: { training_level_id: Number(training_level_id) } };

    // 排序：默认按 sort_order 升序；支持指定列与方向（白名单防注入）
    const ALLOWED_SORT = [
      'name',
      'personnel_type',
      'status',
      'sort_order',
      'created_at',
      'updated_at',
    ];
    let orderBy = { sort_order: 'asc' };
    if (sort_by && ALLOWED_SORT.includes(sort_by)) {
      const dir = sort_dir === 'desc' ? 'desc' : 'asc';
      orderBy = { [sort_by]: dir };
    }

    const total = await prisma.teachers.count({ where });

    const teachers = await prisma.teachers.findMany({
      where,
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
      orderBy,
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
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

    success(res, { items: formatted, total });
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
      remark,
      default_weekly_hours,
      single_textbook_only,
      affiliated_college_id,
      course_ids,
      college_ids,
      training_level_ids,
      status,
    } = req.body;
    // 过渡兼容：旧版客户端仍可能发送 qualification_type，统一映射为 remark（下一版本移除）
    const finalRemark = remark ?? req.body.qualification_type;
    if (!name) return fail(res, '教师姓名不能为空');

    const newSortOrder = await getNextSortOrder('teachers');

    const teacher = await prisma.teachers.create({
      data: {
        name,
        gender: gender || null,
        birth_date: birth_date || null,
        personnel_type: personnel_type || 'full_time',
        remark: finalRemark || null,
        default_weekly_hours: default_weekly_hours != null ? Number(default_weekly_hours) : null,
        single_textbook_only: single_textbook_only === true || single_textbook_only === 'true',
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
    // 过渡兼容：旧版客户端仍可能发送 qualification_type，统一映射为 remark（下一版本移除）
    if (rest.remark === undefined && rest.qualification_type !== undefined) {
      rest.remark = rest.qualification_type;
    }
    const data = buildUpdateData(rest, [
      'name',
      'gender',
      'birth_date',
      'personnel_type',
      'remark',
      'default_weekly_hours',
      'single_textbook_only',
      'sort_order',
      'status',
    ]);

    // single_textbook_only 统一归一为布尔值（兼容字符串 'true'/'false'）
    if (data.single_textbook_only !== undefined) {
      data.single_textbook_only =
        data.single_textbook_only === true || data.single_textbook_only === 'true';
    }

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
        await tx.teachers.update({
          where: { id: Number(id) },
          data,
        });

        // 更新课程关联
        if (course_ids !== undefined) {
          // B-4修复：空 course_ids 安全守卫——清空课程关联将级联删除所有排课，需显式确认
          if (course_ids.length === 0) {
            const existingAssignments = await tx.teaching_assignments.count({
              where: { teacher_id: Number(id) },
            });
            if (existingAssignments > 0) {
              throw new Error(
                `该教师存在 ${existingAssignments} 条排课记录，清空课程关联将级联删除所有排课，请先手动删除排课后再操作`
              );
            }
          }

          // 找出被移除的课程关联，级联清理对应的 teaching_assignments 残留
          const newCourseIdSet = new Set(course_ids.map((cid) => Number(cid)));
          const existingTeacherCourses = await tx.teacher_courses.findMany({
            where: { teacher_id: Number(id) },
            select: { course_id: true },
          });
          const removedCourseIds = existingTeacherCourses
            .map((tc) => tc.course_id)
            .filter((cid) => !newCourseIdSet.has(cid));

          if (removedCourseIds.length > 0) {
            await tx.teaching_assignments.deleteMany({
              where: {
                teacher_id: Number(id),
                course_id: { in: removedCourseIds },
              },
            });
          }

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

    try {
      // TOCTOU 修复：前置检查与删除包入同一事务，防止检查后并发写入排课记录导致级联误删
      const result = await prisma.$transaction(async (tx) => {
        // 检查是否有教学安排
        const assignmentCount = await tx.teaching_assignments.count({
          where: { teacher_id: Number(id) },
        });
        if (assignmentCount > 0) return { blocked: '该教师存在教学安排，无法删除' };

        const deleted = await tx.teachers.delete({ where: { id: Number(id) } });
        return { deleted };
      });
      if (result.blocked) return fail(res, result.blocked);
      const deleted = result.deleted;

      await createAuditLog({
        action: 'delete',
        module: 'teacher',
        userId: req.user?.id,
        ip: req.ip,
        details: { id: Number(id), name: deleted.name },
        result: 'success',
        message: `删除教师：${deleted.name}`,
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
 * 批量修改自定义课时
 */
export async function batchUpdateDefaultHours(req, res, next) {
  try {
    const { teacher_ids, default_weekly_hours } = req.body;
    if (!teacher_ids?.length) return fail(res, '请选择要修改的教师');

    const hours =
      default_weekly_hours != null && default_weekly_hours !== ''
        ? Number(default_weekly_hours)
        : null;

    if (hours !== null && (isNaN(hours) || hours < 0 || hours > 40)) {
      return fail(res, '自定义课时必须在 0~40 之间');
    }

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
      message: `批量修改${teacher_ids.length}名教师的自定义课时为${hours ?? '空'}`,
    });

    invalidateSortOrderCache('teachers');
    success(res, null, `已修改${teacher_ids.length}名教师的自定义课时`);
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

    const teacherId = Number(id);

    // 预检查教师是否存在（保持原 404 响应语义）
    const existing = await prisma.teachers.findUnique({
      where: { id: teacherId },
      select: { id: true, name: true, status: true },
    });
    if (!existing) return fail(res, '教师不存在', 404);

    // M-2修复：禁用教师时不再级联删除历史排课记录，保留历史数据完整性
    // 查询端（dashboard/teaching-arrange）已通过 teacher.status='active' 过滤
    const willDisable = status === 'disabled' && existing.status !== 'disabled';

    // 禁用前置校验：当前学期存在有效课程安排（weekly_hours>0）时阻止禁用，
    // 避免历史排课记录被查询端静默过滤后从课时统计中消失。
    if (willDisable) {
      const semesterInfo = await getCurrentSemesterInfo();
      if (semesterInfo) {
        const activeCount = await prisma.teaching_assignments.count({
          where: {
            teacher_id: teacherId,
            semester: semesterInfo.raw,
            weekly_hours: { gt: 0 },
          },
        });
        if (activeCount > 0) {
          return fail(
            res,
            `该教师在当前学期（${semesterInfo.label}）有 ${activeCount} 条课程安排，无法禁用。请先清空或转移这些安排后再禁用。`,
            409
          );
        }
      }
    }

    await prisma.teachers.update({
      where: { id: teacherId },
      data: { status },
    });

    // 审计日志中记录状态变更（不再包含删除的排课详情）
    const teacherName = existing.name;
    const statusLabel = status === 'active' ? '启用' : '禁用';

    await createAuditLog({
      action: 'update',
      module: 'teacher',
      userId: req.user?.id,
      ip: req.ip,
      details: {
        id: teacherId,
        name: teacherName,
        status,
        willDisable,
      },
      result: 'success',
      message: `${statusLabel}教师：${teacherName}`,
    });

    invalidateSortOrderCache('teachers');
    success(res, { id: teacherId, status }, `${statusLabel}成功`);
  } catch (e) {
    next(e);
  }
}
