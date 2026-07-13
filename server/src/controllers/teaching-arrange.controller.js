import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { log } from '../utils/logger.js';
import { DEFAULT_HOUR_SETTINGS, HOUR_SETTINGS_PREFIX } from '../constants/index.js';
import { findBestMatchPlan } from '../services/plan.service.js';
import {
  getClassesWithCourse,
  getTeachersForCourse,
  autoArrange,
  batchAutoArrange,
  parseSemester,
  validateHourSettings,
} from '../services/teaching-arrange.service.js';
import { calcClassSemester } from '../services/semester.service.js';
import { initSSE, sendSSEEvent, isSSERequest } from '../utils/sse.js';
import {
  buildCombinationMemberMap,
  formatPartnerNames,
} from '../services/class-combination.service.js';

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

    // 预加载合班成员映射，用于展示合班伙伴
    const combinationIds = classes.map((c) => c.combinationId).filter((id) => id != null);
    const combinationMemberMap = await buildCombinationMemberMap(combinationIds);

    // 合并安排信息到班级列表
    const classList = classes.map((c) => {
      const a = assignmentMap.get(c.classId);
      const members = combinationMemberMap.get(c.combinationId) || [];
      const partnerClasses = members.filter((m) => m.id !== c.classId);
      return {
        ...c,
        isCombinedClass: c.combinationId != null,
        partnerClassNames: formatPartnerNames(partnerClasses),
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

    // P1-8 修复：校验班级存在且未离校
    const classExists = await prisma.classes.findFirst({
      where: { id: Number(class_id), is_left_school: false },
    });
    if (!classExists) return fail(res, '班级不存在或已离校', 400);

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

      // 解析学期字符串，计算班级当前程序学期号（复用统一 calcClassSemester，含越界检查）
      const semInfo = parseSemester(semester);
      let currentSemesterNum = null;
      if (cls && semInfo) {
        const calc = calcClassSemester(cls, semInfo);
        if (calc) {
          currentSemesterNum = calc.currentSemesterNum;
        }
      }

      // 查询包含该课程的所有方案课程记录（含学期明细和方案信息）
      // P1-6 修复：补 orderBy（training_plans.sort_order + id），保证多方案匹配时取值确定、可复现
      const planCourses = await prisma.plan_courses.findMany({
        where: { course_id: Number(course_id) },
        include: {
          plan_course_semesters: true,
          training_plans: { select: { id: true, major_id: true, training_level_id: true } },
        },
        orderBy: [{ training_plans: { sort_order: 'asc' } }, { id: 'asc' }],
      });

      createWeeklyHours = 0;
      // H1 修复：使用 findBestMatchPlan 选定最佳方案（major > level 优先级，与排课算法一致）
      const candidatePlans = planCourses.map((pc) => pc.training_plans).filter(Boolean);
      const planCourseByPlanId = new Map(planCourses.map((pc) => [pc.training_plans?.id, pc]));

      // P1-1 修复：构建 classPlanMap 并显式传给 findBestMatchPlan，与 getClassesWithCourse 口径一致
      const classPlanMap = new Map();
      if (cls?.custom_plan_id) {
        const customPlan = candidatePlans.find((p) => p.id === cls.custom_plan_id);
        if (customPlan) classPlanMap.set(cls.id, customPlan);
      }

      const bestPlan = findBestMatchPlan(cls, candidatePlans, classPlanMap);
      if (bestPlan) {
        const pc = planCourseByPlanId.get(bestPlan.id);
        if (pc) {
          if (currentSemesterNum !== null) {
            // P1-5 修复：semRecord 查找加 start/end_semester 范围校验
            const semRecord = pc.plan_course_semesters.find(
              (s) =>
                s.semester === currentSemesterNum &&
                s.semester >= pc.start_semester &&
                s.semester <= pc.end_semester
            );
            createWeeklyHours = semRecord?.weekly_hours ?? pc.weekly_hours ?? 0;
          } else {
            createWeeklyHours = pc.weekly_hours ?? 0;
          }
        }
      }

      // P1-2-派生修复 + 0课时过滤：无论 bestPlan 是否存在，周课时为 0 均拒绝创建
      if (createWeeklyHours <= 0) {
        const reason = !bestPlan
          ? '该班级的培养方案未包含此课程，无法推导周课时'
          : '该课程在本学期周课时为 0（本学期暂不开课），无需安排教师';
        return fail(res, reason, 400);
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

    // M5 修复：非阻塞工作量警告——检查教师当前学期总课时是否超阈值
    let workloadWarning = null;
    try {
      const totalWorkload = await prisma.teaching_assignments.groupBy({
        by: ['teacher_id'],
        where: { semester, teacher_id: Number(teacher_id) },
        _sum: { weekly_hours: true },
      });
      const totalHours = totalWorkload[0]?._sum?.weekly_hours || 0;
      // H-4 修复：从 DEFAULT_HOUR_SETTINGS 读取人员类别对应的 max 课时，替代硬编码 20
      const personnelType = assignment.teacher?.personnel_type || 'full_time';
      const hourLimit = DEFAULT_HOUR_SETTINGS[personnelType]?.max || 20;
      if (totalHours > hourLimit) {
        workloadWarning = `该教师当前学期周课时已达 ${totalHours}，超过建议上限 ${hourLimit}`;
      }
    } catch (_e) {
      // 工作量查询失败不阻塞主流程
    }

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

    success(res, { ...assignment, workloadWarning }, '安排成功');
  } catch (e) {
    // P1-13 修复：补失败审计日志（catch 块重新从 req 提取参数，避免引用 try 内变量）
    const { class_id: _cid, course_id: _coid, semester: _sem, teacher_id: _tid } = req.body || {};
    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: {
        class_id: _cid != null ? Number(_cid) : undefined,
        course_id: _coid != null ? Number(_coid) : undefined,
        semester: _sem,
        teacher_id: _tid != null ? Number(_tid) : undefined,
        error: e.message,
      },
      result: 'failed',
      message: `手动安排教师失败：${e.message}`,
    }).catch(() => {}); // 审计日志失败不阻塞主流程
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
    // P1-13 修复：补失败审计日志（catch 块重新从 req 提取参数）
    const _id = req.params?.id;
    await createAuditLog({
      action: 'delete',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: {
        id: _id != null ? Number(_id) : undefined,
        error: e.message,
      },
      result: 'failed',
      message: `删除教学安排失败：${e.message}`,
    }).catch(() => {}); // 审计日志失败不阻塞主流程
    next(e);
  }
}

/**
 * POST /auto-arrange - 自动排课
 */
export async function runAutoArrange(req, res, next) {
  const useSSE = isSSERequest(req);
  try {
    const courseId = req.body.course_id;
    const semester = req.body.semester;
    const mode = req.body.mode;
    const hourSettings = req.body.hour_settings;
    const scheduleConditions = req.body.schedule_conditions;
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

    // P1-9 修复：scheduleConditions 暂未实现，显式拒绝非空值避免用户配置被静默忽略
    if (
      (Array.isArray(conditions) && conditions.length > 0) ||
      (scheduleConditions && !Array.isArray(scheduleConditions))
    ) {
      return fail(res, '排课条件功能暂未实现，请联系管理员');
    }

    // SSE 模式：初始化流式响应，通过 onProgress 回调推送五阶段进度
    if (useSSE) {
      initSSE(res);
      // 客户端断开连接时清理（避免继续写已关闭的流）
      const onClose = () => {
        res.writableEnded || res.end();
      };
      req.on('close', onClose);

      try {
        const result = await autoArrange(courseId, semester, mode, finalHourSettings, conditions, {
          preview: !!preview,
          onProgress: (progress) => {
            sendSSEEvent(res, 'progress', progress);
          },
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

        sendSSEEvent(res, 'complete', {
          success: true,
          data: result,
          message: preview ? '预览完成（未写入）' : `自动排课完成：安排${result.autoCount}个班级`,
        });
        res.end();
      } catch (e) {
        sendSSEEvent(res, 'error', { message: e.message });
        res.end();
      } finally {
        req.off('close', onClose);
      }
      return;
    }

    // 非 SSE 模式：保持原有 JSON 响应
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
    // P1-13 修复：补失败审计日志（catch 块重新从 req 提取参数）
    const _courseId = req.body?.course_id;
    const _semester = req.body?.semester;
    const _mode = req.body?.mode;
    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: { course_id: _courseId, semester: _semester, mode: _mode, error: e.message },
      result: 'failed',
      message: `自动排课失败：${e.message}`,
    }).catch(() => {});
    next(e);
  }
}

/**
 * POST /reset - 重置自动安排（只删除 is_auto=true 的记录）
 *   - 传 course_id：重置指定科目的自动安排
 *   - 不传 course_id：重置当前学期全部科目的自动安排
 */
export async function resetAutoAssignments(req, res, next) {
  try {
    const { course_id, semester } = req.body;
    if (!semester) return fail(res, '缺少学期参数');

    const where = { semester, is_auto: true };
    if (course_id) where.course_id = Number(course_id);

    const result = await prisma.teaching_assignments.deleteMany({ where });

    const scope = course_id ? `课程${course_id}` : '全部课程';
    await createAuditLog({
      action: 'delete',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: { course_id: course_id || null, semester, deletedCount: result.count },
      result: 'success',
      message: `重置自动安排：${scope} 删除${result.count}条自动安排记录`,
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

    // 按教师聚合统计（P1-4 双保险：仅统计在职教师，避免禁用教师历史排课污染）
    const stats = await prisma.teaching_assignments.groupBy({
      by: ['teacher_id'],
      where: {
        semester,
        teacher: { status: 'active' },
        weekly_hours: { gt: 0 }, // 排除历史遗留的 0 课时安排
      },
      _sum: { weekly_hours: true },
      _count: { id: true },
    });

    // 获取教师详细信息
    const teacherIds = stats.map((s) => s.teacher_id);
    const teachers = await prisma.teachers.findMany({
      where: { id: { in: teacherIds }, status: 'active' },
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
      where: { semester, teacher_id: { in: teacherIds }, weekly_hours: { gt: 0 } },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            college_id: true,
            training_level_id: true,
            custom_plan_id: true,
            major_id: true,
            enrollment_year: true,
            duration_years: true,
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

    // 教材解析：批量查询培养方案教材，避免 N+1
    const semesterInfo = parseSemester(semester);
    const uniqueCourseIds = [...new Set(allAssignments.map((a) => a.course_id))];

    // 一次查询：所有相关 plan_courses + 方案 + 学期 + 教材
    const allPlanCourses = await prisma.plan_courses.findMany({
      where: { course_id: { in: uniqueCourseIds } },
      include: {
        training_plans: { select: { id: true, major_id: true, training_level_id: true } },
        plan_course_semesters: {
          include: {
            plan_textbooks: { select: { textbook_id: true } },
          },
        },
      },
      orderBy: [{ training_plans: { sort_order: 'asc' } }, { id: 'asc' }],
    });

    const planCoursesByCourse = new Map();
    for (const pc of allPlanCourses) {
      if (!planCoursesByCourse.has(pc.course_id)) {
        planCoursesByCourse.set(pc.course_id, []);
      }
      planCoursesByCourse.get(pc.course_id).push(pc);
    }

    // 按 (class_id, course_id) 对匹配教材
    const classInfoMap = new Map(allAssignments.map((a) => [a.class.id, a.class]));
    const classCourseTextbookMap = new Map();
    const allTextbookIds = new Set();

    for (const a of allAssignments) {
      const key = `${a.class_id}:${a.course_id}`;
      if (classCourseTextbookMap.has(key)) continue;

      const cls = classInfoMap.get(a.class_id);
      if (!cls) {
        classCourseTextbookMap.set(key, []);
        continue;
      }

      const pcs = planCoursesByCourse.get(a.course_id) || [];
      if (!pcs.length) {
        classCourseTextbookMap.set(key, []);
        continue;
      }

      const candidatePlans = pcs.map((pc) => pc.training_plans).filter(Boolean);
      const bestPlan = findBestMatchPlan(cls, candidatePlans);
      if (!bestPlan) {
        classCourseTextbookMap.set(key, []);
        continue;
      }

      const semCalc = calcClassSemester(cls, semesterInfo);
      if (!semCalc) {
        classCourseTextbookMap.set(key, []);
        continue;
      }

      const textbookIds = new Set();
      for (const pc of pcs) {
        if (pc.training_plans.id !== bestPlan.id) continue;
        for (const sem of pc.plan_course_semesters) {
          if (sem.semester !== semCalc.currentSemesterNum) continue;
          for (const pt of sem.plan_textbooks) {
            textbookIds.add(pt.textbook_id);
          }
        }
      }

      const ids = [...textbookIds];
      ids.forEach((id) => allTextbookIds.add(id));
      classCourseTextbookMap.set(key, ids);
    }

    // 批量查教材标题
    const textbookTitleMap = new Map();
    if (allTextbookIds.size > 0) {
      const textbookRows = await prisma.textbooks.findMany({
        where: { id: { in: [...allTextbookIds] } },
        select: { id: true, title: true },
      });
      for (const t of textbookRows) {
        textbookTitleMap.set(t.id, t.title);
      }
    }

    // 将 textbookId 列表转为可读名称字符串
    const classCourseTextbookNameMap = new Map();
    for (const [key, ids] of classCourseTextbookMap) {
      const names = ids.map((id) => textbookTitleMap.get(id)).filter(Boolean);
      classCourseTextbookNameMap.set(key, names.join('、'));
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
          collegeName: a.class.colleges?.name || null,
          trainingLevelName: globalLevelMap.get(a.class.training_level_id)?.name || null,
          weeklyHours: a.weekly_hours,
          isAuto: a.is_auto,
          textbookName: classCourseTextbookNameMap.get(`${a.class_id}:${a.course_id}`) || null,
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
  const useSSE = isSSERequest(req);
  try {
    const semester = req.body.semester;
    const mode = req.body.mode;
    const hourSettings = req.body.hour_settings;
    const scheduleConditions = req.body.schedule_conditions;
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

    // P1-9 修复：scheduleConditions 暂未实现，显式拒绝非空值避免用户配置被静默忽略
    if (
      (Array.isArray(conditions) && conditions.length > 0) ||
      (scheduleConditions && !Array.isArray(scheduleConditions))
    ) {
      return fail(res, '排课条件功能暂未实现，请联系管理员');
    }

    // SSE 模式：初始化流式响应，通过 onProgress 回调推送每门课程进度
    if (useSSE) {
      initSSE(res);
      const onClose = () => {
        res.writableEnded || res.end();
      };
      req.on('close', onClose);

      try {
        const result = await batchAutoArrange(semester, mode, finalHourSettings, conditions, {
          preview: !!preview,
          onProgress: (progress) => {
            sendSSEEvent(res, 'progress', progress);
          },
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

        sendSSEEvent(res, 'complete', {
          success: true,
          data: result,
          message: preview
            ? '批量预览完成（未写入）'
            : `批量排课完成：安排${result.summary.totalAssigned}个班级`,
        });
        res.end();
      } catch (e) {
        sendSSEEvent(res, 'error', { message: e.message });
        res.end();
      } finally {
        req.off('close', onClose);
      }
      return;
    }

    // 非 SSE 模式：保持原有 JSON 响应
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
    // H-2 修复：补 .catch(() => {})，与其他端点（assignTeacher/deleteAssignment/runAutoArrange）保持一致
    // 避免审计日志写入失败时覆盖原始排课错误信息
    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: { semester: req.body.semester, mode: req.body.mode, error: e.message },
      result: 'failed',
      message: `批量排课失败：${e.message}`,
    }).catch(() => {});
    next(e);
  }
}
