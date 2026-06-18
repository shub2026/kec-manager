import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import {
  getClassesWithCourse,
  getTeachersForCourse,
  autoArrange,
  parseSemester,
} from '../services/teaching-arrange.service.js';

/**
 * GET /classes - 获取某课程在某学期下的班级列表（矩阵表数据）
 */
export async function getCourseClasses(req, res, next) {
  try {
    const { course_id, semester } = req.query;
    if (!course_id) return fail(res, '请选择课程');
    if (!semester) return fail(res, '请选择学期');

    const classes = await getClassesWithCourse(course_id, semester);

    // 查询已有的教学安排
    const assignments = await prisma.teaching_assignments.findMany({
      where: { course_id: Number(course_id), semester },
      include: {
        teacher: { select: { id: true, name: true, personnel_type: true } },
      },
    });
    const assignmentMap = new Map(assignments.map(a => [a.class_id, a]));

    // 合并安排信息到班级列表
    const classList = classes.map(c => ({
      ...c,
      assignment: assignmentMap.has(c.classId) ? {
        id: assignmentMap.get(c.classId).id,
        teacherId: assignmentMap.get(c.classId).teacher_id,
        teacherName: assignmentMap.get(c.classId).teacher?.name || null,
        teacherPersonnelType: assignmentMap.get(c.classId).teacher?.personnel_type || null,
        isAuto: assignmentMap.get(c.classId).is_auto,
      } : null,
    }));

    // 汇总统计
    const totalCourseHours = classList.reduce((sum, c) => sum + c.totalHours, 0);
    const assignedClasses = classList.filter(c => c.assignment);
    const assignedHours = assignedClasses.reduce((sum, c) => sum + c.totalHours, 0);

    success(res, {
      classes: classList,
      summary: {
        totalClasses: classList.length,
        assignedCount: assignedClasses.length,
        unassignedCount: classList.length - assignedClasses.length,
        totalCourseHours,
        assignedHours,
        remainingHours: totalCourseHours - assignedHours,
      },
    });
  } catch (e) { next(e); }
}

/**
 * GET /teachers - 获取某课程的教师列表（含课时统计）
 */
export async function getCourseTeachers(req, res, next) {
  try {
    const { course_id, semester } = req.query;
    if (!course_id) return fail(res, '请选择课程');
    if (!semester) return fail(res, '请选择学期');

    const teachers = await getTeachersForCourse(course_id, semester);
    success(res, teachers);
  } catch (e) { next(e); }
}

/**
 * POST /assign - 手动安排/更换教师
 */
export async function assignTeacher(req, res, next) {
  try {
    const { class_id, course_id, semester, teacher_id, weekly_hours } = req.body;
    if (!class_id || !course_id || !semester || !teacher_id) {
      return fail(res, '缺少必要参数');
    }

    const assignment = await prisma.teaching_assignments.upsert({
      where: {
        class_id_course_id_semester: {
          class_id: Number(class_id),
          course_id: Number(course_id),
          semester,
        },
      },
      update: {
        teacher_id: Number(teacher_id),
        weekly_hours: weekly_hours != null ? Number(weekly_hours) : 0,
        is_auto: false,
      },
      create: {
        teacher_id: Number(teacher_id),
        class_id: Number(class_id),
        course_id: Number(course_id),
        semester,
        weekly_hours: weekly_hours != null ? Number(weekly_hours) : 0,
        is_auto: false,
      },
      include: {
        teacher: { select: { id: true, name: true, personnel_type: true } },
        class: { select: { id: true, name: true } },
      },
    });

    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: { class_id, course_id, semester, teacher_id },
      result: 'success',
      message: `手动安排教师：${assignment.teacher?.name} → ${assignment.class?.name}`,
    });

    success(res, assignment, '安排成功');
  } catch (e) { next(e); }
}

/**
 * DELETE /assignments/:id - 删除教学安排
 */
export async function deleteAssignment(req, res, next) {
  try {
    const { id } = req.params;

    const assignment = await prisma.teaching_assignments.findUnique({
      where: { id: Number(id) },
      include: {
        teacher: { select: { name: true } },
        class: { select: { name: true } },
      },
    });

    if (!assignment) return fail(res, '安排记录不存在', 404);

    await prisma.teaching_assignments.delete({ where: { id: Number(id) } });

    await createAuditLog({
      action: 'delete',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: { id, teacher: assignment.teacher?.name, class: assignment.class?.name },
      result: 'success',
      message: `删除教学安排：${assignment.teacher?.name} ← ${assignment.class?.name}`,
    });

    success(res, null, '删除成功');
  } catch (e) { next(e); }
}

/**
 * POST /auto-arrange - 自动排课
 */
export async function runAutoArrange(req, res, next) {
  try {
    const { course_id, semester, mode, hour_settings, schedule_conditions } = req.body;
    if (!course_id || !semester) return fail(res, '缺少课程或学期参数');
    if (!['full', 'standard'].includes(mode)) return fail(res, '排课模式必须是full或standard');

    const defaultHourSettings = {
      full_time: { standard: 16, max: 20 },
      part_time: { standard: 12, max: 16 },
      external: { standard: 12, max: 16 },
    };
    const hourSettings = hour_settings || defaultHourSettings;
    const conditions = schedule_conditions || [];

    const result = await autoArrange(course_id, semester, mode, hourSettings, conditions);

    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: {
        course_id,
        semester,
        mode,
        autoCount: result.autoCount,
        unassignedCount: result.unassignedCount,
      },
      result: 'success',
      message: `自动排课(${mode === 'full' ? '全量' : '标准'})：安排${result.autoCount}个班级，${result.unassignedCount}个未安排`,
    });

    success(res, result, `自动排课完成：安排${result.autoCount}个班级`);
  } catch (e) {
    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: req.body,
      result: 'failed',
      message: `自动排课失败：${e.message}`,
    });
    next(e);
  }
}

/**
 * POST /reset - 重置自动安排（只删除 is_auto=true 的记录）
 */
export async function resetAutoAssignments(req, res, next) {
  try {
    const { course_id, semester } = req.body;
    if (!course_id || !semester) return fail(res, '缺少课程或学期参数');

    const result = await prisma.teaching_assignments.deleteMany({
      where: {
        course_id: Number(course_id),
        semester,
        is_auto: true,
      },
    });

    await createAuditLog({
      action: 'delete',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: { course_id, semester, deletedCount: result.count },
      result: 'success',
      message: `重置自动安排：删除${result.count}条自动安排记录`,
    });

    success(res, { deletedCount: result.count }, `已重置${result.count}条自动安排`);
  } catch (e) { next(e); }
}

/**
 * GET /statistics - 课时统计
 */
export async function getStatistics(req, res, next) {
  try {
    const { semester } = req.query;
    if (!semester) return fail(res, '请选择学期');

    // 按教师聚合统计
    const stats = await prisma.teaching_assignments.groupBy({
      by: ['teacher_id'],
      where: { semester },
      _sum: { weekly_hours: true },
      _count: { id: true },
    });

    // 获取教师详细信息
    const teacherIds = stats.map(s => s.teacher_id);
    const teachers = await prisma.teachers.findMany({
      where: { id: { in: teacherIds } },
      include: {
        courses: { include: { course: { select: { id: true, name: true } } } },
        scheduling_colleges: { include: { college: { select: { id: true, name: true } } } },
      },
    });
    const teacherMap = new Map(teachers.map(t => [t.id, t]));

    // 获取每个教师的安排明细
    const allAssignments = await prisma.teaching_assignments.findMany({
      where: { semester, teacher_id: { in: teacherIds } },
      include: {
        class: { select: { id: true, name: true } },
        course: { select: { id: true, name: true } },
      },
      orderBy: [{ teacher_id: 'asc' }, { course_id: 'asc' }],
    });

    // 按教师分组
    const assignmentsByTeacher = new Map();
    for (const a of allAssignments) {
      if (!assignmentsByTeacher.has(a.teacher_id)) {
        assignmentsByTeacher.set(a.teacher_id, []);
      }
      assignmentsByTeacher.get(a.teacher_id).push(a);
    }

    const result = stats.map(s => {
      const teacher = teacherMap.get(s.teacher_id);
      const assignments = assignmentsByTeacher.get(s.teacher_id) || [];

      // 按课程分组
      const byCourse = new Map();
      for (const a of assignments) {
        if (!byCourse.has(a.course_id)) {
          byCourse.set(a.course_id, {
            course: a.course,
            classes: [],
            weeklyHours: 0,
          });
        }
        const group = byCourse.get(a.course_id);
        group.classes.push({
          classId: a.class.id,
          className: a.class.name,
          weeklyHours: a.weekly_hours,
          isAuto: a.is_auto,
        });
        group.weeklyHours += a.weekly_hours;
      }

      return {
        teacherId: s.teacher_id,
        teacherName: teacher?.name || '未知',
        personnelType: teacher?.personnel_type || null,
        collegeList: teacher?.scheduling_colleges.map(sc => sc.college) || [],
        courseList: teacher?.courses.map(tc => tc.course) || [],
        totalWeeklyHours: s._sum.weekly_hours || 0,
        totalClassCount: s._count.id || 0,
        details: Array.from(byCourse.values()),
      };
    });

    // 按总课时降序排列
    result.sort((a, b) => b.totalWeeklyHours - a.totalWeeklyHours);

    success(res, {
      semester,
      teachers: result,
      summary: {
        totalTeachers: result.length,
        totalWeeklyHours: result.reduce((sum, t) => sum + t.totalWeeklyHours, 0),
        totalClasses: result.reduce((sum, t) => sum + t.totalClassCount, 0),
      },
    });
  } catch (e) { next(e); }
}

const HOUR_SETTINGS_PREFIX = 'teaching_hour_settings';

/**
 * GET /hour-settings - 获取课时要求设置（按课程）
 */
export async function getHourSettings(req, res, next) {
  try {
    const { course_id } = req.query;
    const key = course_id ? `${HOUR_SETTINGS_PREFIX}_${course_id}` : HOUR_SETTINGS_PREFIX;
    const record = await prisma.system_settings.findUnique({ where: { key } });
    if (record) {
      success(res, JSON.parse(record.value));
    } else {
      success(res, null);
    }
  } catch (e) { next(e); }
}

/**
 * PUT /hour-settings - 保存课时要求设置（按课程）
 */
export async function saveHourSettings(req, res, next) {
  try {
    const { hour_settings, course_id } = req.body;
    if (!hour_settings) return fail(res, '缺少课时设置数据');

    const key = course_id ? `${HOUR_SETTINGS_PREFIX}_${course_id}` : HOUR_SETTINGS_PREFIX;
    const description = course_id ? `课程${course_id}课时要求设置` : '教学安排课时要求设置';

    await prisma.system_settings.upsert({
      where: { key },
      update: { value: JSON.stringify(hour_settings) },
      create: { key, value: JSON.stringify(hour_settings), description },
    });

    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: { course_id, hour_settings },
      result: 'success',
      message: course_id ? `保存课程${course_id}课时要求` : '保存课时要求设置',
    });

    success(res, null, '保存成功');
  } catch (e) { next(e); }
}
