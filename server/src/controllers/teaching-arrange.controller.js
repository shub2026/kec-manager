import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { log } from '../utils/logger.js';
import { DEFAULT_HOUR_SETTINGS, HOUR_SETTINGS_PREFIX } from '../constants/index.js';
import { isClassMatchPlan } from '../services/plan.service.js';
import {
  getClassesWithCourse,
  getTeachersForCourse,
  autoArrange,
  batchAutoArrange,
  parseSemester,
  validateHourSettings,
} from '../services/teaching-arrange.service.js';

/**
 * 安全解析 JSON 字符串，失败时返回 fallback 并记录告警
 */
function safeParseJSON(str, fallback = null) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    log.warn('system_settings 值 JSON 解析失败，回退到默认值', { error: e.message });
    return fallback;
  }
}

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
    const assignmentMap = new Map(assignments.map((a) => [a.class_id, a]));

    // 合并安排信息到班级列表
    const classList = classes.map((c) => {
      const a = assignmentMap.get(c.classId);
      return {
        ...c,
        assignment: a
          ? {
              id: a.id,
              teacherId: a.teacher_id,
              teacherName: a.teacher?.name || null,
              teacherPersonnelType: a.teacher?.personnel_type || null,
              isAuto: a.is_auto,
            }
          : null,
      };
    });

    // 汇总统计（基于周课时）
    const totalCourseHours = classList.reduce((sum, c) => sum + c.weeklyHours, 0);
    const assignedClasses = classList.filter((c) => c.assignment);
    const assignedHours = assignedClasses.reduce((sum, c) => sum + c.weeklyHours, 0);

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
  } catch (e) {
    next(e);
  }
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
  } catch (e) {
    next(e);
  }
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

    // 校验班级存在
    const classExists = await prisma.classes.findUnique({ where: { id: Number(class_id) } });
    if (!classExists) return fail(res, '班级不存在', 404);

    // 校验教师存在且处于启用状态
    const teacher = await prisma.teachers.findUnique({ where: { id: Number(teacher_id) } });
    if (!teacher) return fail(res, '教师不存在', 404);
    if (teacher.status === 'disabled') return fail(res, '该教师已禁用，无法安排');

    // 校验教师可教该课程（teacher_courses 关联存在）
    const canTeach = await prisma.teacher_courses.findUnique({
      where: {
        teacher_id_course_id: { teacher_id: Number(teacher_id), course_id: Number(course_id) },
      },
    });
    if (!canTeach) return fail(res, '该教师未关联此课程，无法安排');

    // update 分支：未传 weekly_hours 时保留原值，避免静默清零
    const updateData = { teacher_id: Number(teacher_id), is_auto: false };
    if (weekly_hours != null && weekly_hours !== '') {
      updateData.weekly_hours = Number(weekly_hours);
    }

    // create 分支：必须有 weekly_hours，缺失时从培养方案学期推导
    let createWeeklyHours =
      weekly_hours != null && weekly_hours !== '' ? Number(weekly_hours) : null;
    if (createWeeklyHours === null) {
      // 高-2修复：原实现仅查 custom_plan_id，非自定义方案班级周课时被设为 0
      // 新逻辑：统一使用 isClassMatchPlan 匹配方案（custom > major > level），再取对应学期的 weekly_hours
      const cls = await prisma.classes.findUnique({
        where: { id: Number(class_id) },
        include: {
          majors: { select: { id: true } },
          training_levels: { select: { id: true } },
        },
      });

      // 解析学期字符串，计算班级当前程序学期号
      const semInfo = parseSemester(semester);
      let currentSemesterNum = null;
      if (cls && semInfo) {
        const grade = semInfo.startYear - cls.enrollment_year + 1;
        if (grade >= 1 && grade <= cls.duration_years) {
          currentSemesterNum = (grade - 1) * 2 + semInfo.semesterIndex;
        }
      }

      // 查询包含该课程的所有方案课程记录（含学期明细和方案信息）
      const planCourses = await prisma.plan_courses.findMany({
        where: { course_id: Number(course_id) },
        include: {
          plan_course_semesters: true,
          training_plans: { select: { id: true, major_id: true, training_level_id: true } },
        },
      });

      createWeeklyHours = 0;
      for (const pc of planCourses) {
        const plan = pc.training_plans;
        if (!plan || !isClassMatchPlan(cls, plan)) continue;

        // 优先取当前学期的周课时，兜底取方案课程默认周课时
        if (currentSemesterNum !== null) {
          const semRecord = pc.plan_course_semesters.find((s) => s.semester === currentSemesterNum);
          if (semRecord) {
            createWeeklyHours = semRecord.weekly_hours ?? pc.weekly_hours ?? 0;
          } else {
            createWeeklyHours = pc.weekly_hours ?? 0;
          }
        } else {
          createWeeklyHours = pc.weekly_hours ?? 0;
        }
        break; // 取第一个匹配方案即可
      }
    }

    const assignment = await prisma.teaching_assignments.upsert({
      where: {
        class_id_course_id_semester: {
          class_id: Number(class_id),
          course_id: Number(course_id),
          semester,
        },
      },
      update: updateData,
      create: {
        teacher_id: Number(teacher_id),
        class_id: Number(class_id),
        course_id: Number(course_id),
        semester,
        weekly_hours: createWeeklyHours,
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
      details: {
        class_id: Number(class_id),
        course_id: Number(course_id),
        semester,
        teacher_id: Number(teacher_id),
        weekly_hours: assignment.weekly_hours,
      },
      result: 'success',
      message: `手动安排教师：${assignment.teacher?.name} → ${assignment.class?.name}`,
    });

    success(res, assignment, '安排成功');
  } catch (e) {
    next(e);
  }
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

    // 自动安排被删除后提示重新排课（M-8 修复）
    const hint = assignment.is_auto ? '（该班级自动安排已删除，建议重新排课）' : '';

    await createAuditLog({
      action: 'delete',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: {
        id: Number(id),
        teacher: assignment.teacher?.name,
        class: assignment.class?.name,
        is_auto: assignment.is_auto,
      },
      result: 'success',
      message: `删除教学安排：${assignment.teacher?.name} ← ${assignment.class?.name}${hint}`,
    });

    success(res, null, `删除成功${hint}`);
  } catch (e) {
    next(e);
  }
}

/**
 * POST /auto-arrange - 自动排课
 */
export async function runAutoArrange(req, res, next) {
  try {
    const courseId = req.body.course_id;
    const semester = req.body.semester;
    const mode = req.body.mode;
    const hourSettings = req.body.hour_settings || req.body.hourSettings;
    const scheduleConditions = req.body.schedule_conditions || req.body.scheduleConditions;
    const preview = req.body.preview;

    if (!courseId || !semester) return fail(res, '缺少课程或学期参数');
    if (!['full', 'standard'].includes(mode)) return fail(res, '排课模式必须是full或standard');

    let finalHourSettings = hourSettings;

    if (!finalHourSettings) {
      const courseSettings = await prisma.system_settings.findUnique({
        where: { key: `${HOUR_SETTINGS_PREFIX}_${courseId}` },
      });

      if (courseSettings) {
        finalHourSettings = safeParseJSON(courseSettings.value, DEFAULT_HOUR_SETTINGS);
      } else {
        const globalSettings = await prisma.system_settings.findUnique({
          where: { key: HOUR_SETTINGS_PREFIX },
        });
        finalHourSettings = globalSettings
          ? safeParseJSON(globalSettings.value, DEFAULT_HOUR_SETTINGS)
          : DEFAULT_HOUR_SETTINGS;
      }
    }

    const conditions = scheduleConditions || [];

    const result = await autoArrange(courseId, semester, mode, finalHourSettings, conditions, {
      preview: !!preview,
    });

    if (!preview) {
      await createAuditLog({
        action: 'update',
        module: 'teachingArrange',
        userId: req.user?.id,
        ip: req.ip,
        details: {
          course_id: courseId,
          semester,
          mode,
          autoCount: result.autoCount,
          unassignedCount: result.unassignedCount,
        },
        result: 'success',
        message: `自动排课(${mode === 'full' ? '全量' : '标准'})：安排${result.autoCount}个班级，${result.unassignedCount}个未安排`,
      });
    }

    success(
      res,
      result,
      preview ? '预览完成（未写入）' : `自动排课完成：安排${result.autoCount}个班级`
    );
  } catch (e) {
    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: { course_id: courseId, semester, mode, error: e.message },
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
  } catch (e) {
    next(e);
  }
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
    const teacherIds = stats.map((s) => s.teacher_id);
    const teachers = await prisma.teachers.findMany({
      where: { id: { in: teacherIds } },
      include: {
        affiliated_college: { select: { id: true, name: true } },
        courses: { include: { course: { select: { id: true, name: true } } } },
        scheduling_colleges: { include: { college: { select: { id: true, name: true } } } },
        scheduling_levels: { include: { training_level: { select: { id: true, name: true } } } },
      },
    });
    const teacherMap = new Map(teachers.map((t) => [t.id, t]));

    // 获取每个教师的安排明细
    const allAssignments = await prisma.teaching_assignments.findMany({
      where: { semester, teacher_id: { in: teacherIds } },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            college_id: true,
            training_level_id: true,
            colleges: { select: { id: true, name: true } },
          },
        },
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

    // H-7: 预加载所有授课层次，消除 N+1 查询
    const allLevelIds = new Set();
    for (const a of allAssignments) {
      if (a.class.training_level_id) {
        allLevelIds.add(a.class.training_level_id);
      }
    }
    let globalLevelMap = new Map();
    if (allLevelIds.size > 0) {
      const allLevels = await prisma.training_levels.findMany({
        where: { id: { in: [...allLevelIds] } },
        select: { id: true, name: true },
      });
      globalLevelMap = new Map(allLevels.map((l) => [l.id, l]));
    }

    const result = stats.map((s) => {
      const teacher = teacherMap.get(s.teacher_id);
      const assignments = assignmentsByTeacher.get(s.teacher_id) || [];

      // 从实际授课班级中提取任课学院（去重）
      const collegeMap = new Map();
      for (const a of assignments) {
        if (a.class.colleges && !collegeMap.has(a.class.colleges.id)) {
          collegeMap.set(a.class.colleges.id, a.class.colleges);
        }
      }
      const collegeList = [...collegeMap.values()];

      // 从实际授课班级中提取任课层次（去重）
      const levelIdSet = new Set();
      for (const a of assignments) {
        if (a.class.training_level_id) {
          levelIdSet.add(a.class.training_level_id);
        }
      }

      // 优先使用实际授课层次，如果为空则使用意向设置
      let trainingLevelList;
      if (levelIdSet.size > 0) {
        trainingLevelList = [...levelIdSet].map((lid) => globalLevelMap.get(lid)).filter(Boolean);
      } else {
        trainingLevelList = teacher?.scheduling_levels?.map((sl) => sl.training_level) ?? [];
      }

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
        affiliatedCollege: teacher?.affiliated_college || null,
        collegeList,
        trainingLevelList,
        courseList: teacher?.courses?.map((tc) => tc.course) ?? [],
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
  } catch (e) {
    next(e);
  }
}

/**
 * GET /hour-settings - 获取课时要求设置（按课程）
 */
export async function getHourSettings(req, res, next) {
  try {
    const { course_id } = req.query;
    const key = course_id ? `${HOUR_SETTINGS_PREFIX}_${course_id}` : HOUR_SETTINGS_PREFIX;
    const record = await prisma.system_settings.findUnique({ where: { key } });
    if (record) {
      success(res, safeParseJSON(record.value, null));
    } else {
      success(res, null);
    }
  } catch (e) {
    next(e);
  }
}

/**
 * PUT /hour-settings - 保存课时要求设置（按课程）
 */
export async function saveHourSettings(req, res, next) {
  try {
    const { hour_settings, course_id } = req.body;
    if (!hour_settings) return fail(res, '缺少课时设置数据');

    // 保存前校验，避免无效设置静默持久化
    try {
      validateHourSettings(hour_settings);
    } catch (ve) {
      return fail(res, ve.message);
    }

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
  } catch (e) {
    next(e);
  }
}

/**
 * POST /batch-auto-arrange - 批量自动排课（所有课程）
 */
export async function runBatchAutoArrange(req, res, next) {
  try {
    // 兼容驼峰和下划线命名
    const semester = req.body.semester;
    const mode = req.body.mode;
    const hourSettings = req.body.hour_settings || req.body.hourSettings;
    const scheduleConditions = req.body.schedule_conditions || req.body.scheduleConditions;
    const preview = req.body.preview;

    if (!semester) return fail(res, '缺少学期参数');
    if (!['full', 'standard'].includes(mode)) return fail(res, '排课模式必须是full或standard');

    let finalHourSettings = hourSettings;

    if (!finalHourSettings) {
      const globalSettings = await prisma.system_settings.findUnique({
        where: { key: HOUR_SETTINGS_PREFIX },
      });
      finalHourSettings = globalSettings
        ? safeParseJSON(globalSettings.value, DEFAULT_HOUR_SETTINGS)
        : DEFAULT_HOUR_SETTINGS;
    }

    const conditions = scheduleConditions || [];

    const result = await batchAutoArrange(semester, mode, finalHourSettings, conditions, {
      preview: !!preview,
    });

    if (!preview) {
      await createAuditLog({
        action: 'update',
        module: 'teachingArrange',
        userId: req.user?.id,
        ip: req.ip,
        details: {
          semester,
          mode,
          totalAssigned: result.summary.totalAssigned,
          totalUnassigned: result.summary.totalUnassigned,
        },
        result: 'success',
        message: `批量排课(${mode === 'full' ? '全量' : '标准'})：${result.summary.totalCourses}门课程，安排${result.summary.totalAssigned}个班级`,
      });
    }

    success(
      res,
      result,
      preview ? '批量预览完成（未写入）' : `批量排课完成：安排${result.summary.totalAssigned}个班级`
    );
  } catch (e) {
    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: { semester: req.body.semester, mode: req.body.mode, error: e.message },
      result: 'failed',
      message: `批量排课失败：${e.message}`,
    });
    next(e);
  }
}
