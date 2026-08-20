import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { createAuditLog } from '../services/audit.service.js';
import { log } from '../utils/logger.js';
import { DEFAULT_HOUR_SETTINGS, HOUR_SETTINGS_PREFIX } from '../constants/index.js';
import { findBestMatchPlan } from '../services/plan.service.js';
import {
  getClassesWithCourse,
  getTeachersForCourse,
  getCourseOverviewAggregate,
  autoArrange,
  batchAutoArrange,
  parseSemester,
  validateHourSettings,
} from '../services/teaching-arrange.service.js';
import { calcClassSemester } from '../services/semester.service.js';
import {
  dedupeTeachingUnits,
  dedupeClassUnits,
  isCombinedUnit,
  resolveClassCourseTextbooks,
} from '../services/teaching-statistics.service.js';
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
 * 读取系统设置中的"自定义课时硬保障"开关（默认关闭）
 * 读取失败时降级为关闭，不阻断排课流程
 */
async function getCustomHoursGuarantee() {
  try {
    const setting = await prisma.system_settings.findUnique({
      where: { key: 'custom_hours_hard_guarantee' },
    });
    return setting?.value === 'true';
  } catch (_e) {
    return false;
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
              isLocked: a.is_locked,
              isInherent: a.is_inherent,
            }
          : null,
      };
    });

    // 汇总统计（基于周课时）
    // 合班去重：合班成员班逐班展开且各带一份课时，课时聚合按逻辑教学单元只计 1 次；
    // 班级计数字段维持逐班口径，与矩阵表逐班呈现一致
    const { units, classUnitMap } = dedupeClassUnits(classList);
    const totalCourseHours = units.reduce((sum, u) => sum + u.weeklyHours, 0);
    const assignedClasses = classList.filter((c) => c.assignment);
    const assignedUnitKeys = new Set(
      assignedClasses.map((c) => classUnitMap.get(c.classId)).filter(Boolean)
    );
    const assignedHours = units
      .filter((u) => assignedUnitKeys.has(u.key))
      .reduce((sum, u) => sum + u.weeklyHours, 0);
    const lockedCount = classList.filter((c) => c.assignment && c.assignment.isLocked).length;
    const inherentCount = classList.filter((c) => c.assignment && c.assignment.isInherent).length;

    success(res, {
      classes: classList,
      summary: {
        totalClasses: classList.length,
        assignedCount: assignedClasses.length,
        unassignedCount: classList.length - assignedClasses.length,
        lockedCount,
        inherentCount,
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
 * GET /course-overview - 全部课程的教学安排概览（卡片聚合视图）
 * 一次请求返回本学期每门课程的班级数/已安排/已锁定/课时汇总，供概览卡片渲染
 *
 * 聚合逻辑收敛于 getCourseOverviewAggregate（arrange/queries.js），
 * 与首页课时概览 courseStats 共用同一口径
 */
export async function getCourseOverview(req, res, next) {
  try {
    const { semester } = req.query;
    if (!semester) return fail(res, '请选择学期');

    const overview = await getCourseOverviewAggregate(semester);
    success(res, overview);
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
      select: { id: true, combination_id: true },
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

    // 只带一本教材开关：手动指派引入第 2 本教材时拦截（硬约束口径与自动排课一致）
    if (teacher.single_textbook_only) {
      const [courseTeachers, courseClasses] = await Promise.all([
        getTeachersForCourse(course_id, semester),
        getClassesWithCourse(course_id, semester),
      ]);
      const me = courseTeachers.find((t) => t.id === Number(teacher_id));
      const targetCls = courseClasses.find((c) => c.classId === Number(class_id));
      const heldTextbooks = me?.assignedTextbooks || [];
      const heldIdSet = new Set(heldTextbooks.map((tb) => tb.id));
      const clsTextbooks = targetCls?.textbooks || [];
      const newOnes = clsTextbooks.filter((tb) => !heldIdSet.has(tb.id));
      if (newOnes.length > 0 && heldIdSet.size + newOnes.length > 1) {
        const heldNames = heldTextbooks.map((tb) => `《${tb.title}》`).join('、') || '无教材';
        const clsNames = newOnes.map((tb) => `《${tb.title}》`).join('、');
        return fail(
          res,
          `该教师已开启“只带一本教材”，当前持有 ${heldNames}，该班级需要 ${clsNames}，无法安排`,
          400
        );
      }
    }

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
        // is_active：禁用课程不参与周课时推导
        where: { course_id: Number(course_id), is_active: true },
        include: {
          plan_course_semesters: true,
          training_plans: {
            select: {
              id: true,
              major_id: true,
              training_level_id: true,
              // 供 findBestMatchPlan 按班级入学年份过滤同维度多版本方案
              apply_from_year: true,
              apply_to_year: true,
            },
          },
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

    // 目标课时值：显式传入用传入值，否则用上面推导值（已保证 >0）
    const targetWeeklyHours =
      weekly_hours != null && weekly_hours !== '' ? Number(weekly_hours) : createWeeklyHours;
    // 显式传入路径校验：拦截 0/负数/非数值，防止绕过上面推导值 >0 守卫
    if (!Number.isFinite(targetWeeklyHours) || targetWeeklyHours <= 0 || targetWeeklyHours > 40) {
      return fail(res, '周课时必须为大于 0 且不超过 40 的数值', 400);
    }

    // 合班联动：找出同样开设该课程的合班伙伴，准备同步同一教师
    let partnerClassIds = [];
    if (classExists.combination_id != null) {
      const courseClassIds = new Set(
        (await getClassesWithCourse(course_id, semester)).map((c) => c.classId)
      );
      const partners = await prisma.classes.findMany({
        where: { combination_id: classExists.combination_id, id: { not: Number(class_id) } },
        select: { id: true },
      });
      // 仅同步真正开设该课程的伙伴，避免为不开此课的成员造出错误安排
      partnerClassIds = partners.map((p) => p.id).filter((id) => courseClassIds.has(id));
    }

    // 事务内写入：主班级 + 合班伙伴同步同一教师（保证合班成员班教师一致）
    const assignment = await prisma.$transaction(async (tx) => {
      const main = await tx.teaching_assignments.upsert({
        where: {
          class_id_course_id_semester: {
            class_id: Number(class_id),
            course_id: Number(course_id),
            semester,
          },
        },
        update: {
          teacher_id: Number(teacher_id),
          is_auto: false,
          is_inherent: false, // 手动安排覆盖自动延续分配，清除延续标记
          ...(weekly_hours != null && weekly_hours !== ''
            ? { weekly_hours: Number(weekly_hours) }
            : {}),
        },
        create: {
          teacher_id: Number(teacher_id),
          class_id: Number(class_id),
          course_id: Number(course_id),
          semester,
          weekly_hours: targetWeeklyHours,
          is_auto: false,
          is_inherent: false,
        },
        include: {
          teacher: { select: { id: true, name: true, personnel_type: true } },
          class: { select: { id: true, name: true } },
        },
      });
      for (const pid of partnerClassIds) {
        await tx.teaching_assignments.upsert({
          where: {
            class_id_course_id_semester: {
              class_id: pid,
              course_id: Number(course_id),
              semester,
            },
          },
          update: { teacher_id: Number(teacher_id), is_auto: false, is_inherent: false },
          create: {
            teacher_id: Number(teacher_id),
            class_id: pid,
            course_id: Number(course_id),
            semester,
            weekly_hours: targetWeeklyHours,
            is_auto: false,
            is_inherent: false,
          },
        });
      }
      return main;
    });

    // M5 修复：非阻塞工作量警告——检查教师当前学期总课时是否超阈值
    // 优化5：使用 dedupeTeachingUnits 合班去重后再聚合，与 getTeachersForCourse / getStatistics 口径对齐，
    // 避免合班教学时同一节课被重复计数导致误报超限。
    let workloadWarning = null;
    try {
      const teacherAssignments = await prisma.teaching_assignments.findMany({
        where: { semester, teacher_id: Number(teacher_id) },
        select: {
          teacher_id: true,
          course_id: true,
          weekly_hours: true,
          class_id: true,
          class: { select: { combination_id: true } },
        },
      });
      const dedupedUnits = dedupeTeachingUnits(teacherAssignments);
      const totalHours = dedupedUnits.reduce((sum, u) => sum + (u.weeklyHours || 0), 0);
      // 审计修复：预警口径与前端 TeacherSelectDialog 对齐——
      // 教师个人标准课时 default_weekly_hours 优先，其次全局课时配置的 standard，
      // 最后回退 DEFAULT_HOUR_SETTINGS（配置读取与 getHourSettings 同源）
      const personnelType = assignment.teacher?.personnel_type || 'full_time';
      const globalSettings = await prisma.system_settings.findUnique({
        where: { key: HOUR_SETTINGS_PREFIX },
      });
      const configuredSettings = globalSettings
        ? safeParseJSON(globalSettings.value, DEFAULT_HOUR_SETTINGS)
        : DEFAULT_HOUR_SETTINGS;
      const hourLimit =
        teacher.default_weekly_hours ??
        configuredSettings[personnelType]?.standard ??
        DEFAULT_HOUR_SETTINGS[personnelType]?.standard ??
        DEFAULT_HOUR_SETTINGS.full_time.standard;
      if (totalHours > hourLimit) {
        workloadWarning = `该教师当前学期周课时已达 ${totalHours}，超过标准课时上限 ${hourLimit}`;
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
 * POST /swap-teachers - 一键交换两位教师在本课程学期内的全部班级安排
 * 锁定记录跳过并在结果中报告；单教材开关教师交换后将持多本教材时硬拦截
 */
export async function swapTeacherAssignments(req, res, next) {
  try {
    const { course_id, semester, teacher_id_a, teacher_id_b } = req.body;
    const courseId = Number(course_id);
    const tidA = Number(teacher_id_a);
    const tidB = Number(teacher_id_b);

    // 1. 两教师存在且启用
    const [teacherA, teacherB] = await Promise.all([
      prisma.teachers.findUnique({ where: { id: tidA } }),
      prisma.teachers.findUnique({ where: { id: tidB } }),
    ]);
    if (!teacherA || !teacherB) return fail(res, '教师不存在', 404);
    if (teacherA.status === 'disabled' || teacherB.status === 'disabled') {
      return fail(res, '其中存在已禁用的教师，无法交换', 400);
    }

    // 2. 双方均已关联本课程
    const [canTeachA, canTeachB] = await Promise.all([
      prisma.teacher_courses.findUnique({
        where: { teacher_id_course_id: { teacher_id: tidA, course_id: courseId } },
      }),
      prisma.teacher_courses.findUnique({
        where: { teacher_id_course_id: { teacher_id: tidB, course_id: courseId } },
      }),
    ]);
    if (!canTeachA || !canTeachB) {
      return fail(res, '其中存在未关联此课程的教师，无法交换', 400);
    }

    // 3. 查询双方在本课程学期内的全部安排；锁定记录不参与交换
    const assignments = await prisma.teaching_assignments.findMany({
      where: { course_id: courseId, semester, teacher_id: { in: [tidA, tidB] } },
      include: { class: { select: { id: true, name: true } } },
    });
    const ownA = assignments.filter((a) => a.teacher_id === tidA);
    const ownB = assignments.filter((a) => a.teacher_id === tidB);
    const swapA = ownA.filter((a) => !a.is_locked);
    const swapB = ownB.filter((a) => !a.is_locked);
    const skippedLocked = assignments
      .filter((a) => a.is_locked)
      .map((a) => ({ classId: a.class_id, className: a.class?.name }));

    // 4. 单教材开关硬拦截（与 assignTeacher 口径一致）：
    // 交换后某方在本课程持有的教材集合（本人锁定保留的班 + 未锁定的班换出 + 对方换入）> 1 本 → 拒绝
    if (teacherA.single_textbook_only || teacherB.single_textbook_only) {
      const courseClasses = await getClassesWithCourse(courseId, semester);
      const clsTextbookIds = new Map(
        courseClasses.map((c) => [c.classId, (c.textbooks || []).map((tb) => tb.id)])
      );
      const tbTitleById = new Map();
      for (const c of courseClasses) {
        for (const tb of c.textbooks || []) tbTitleById.set(tb.id, tb.title);
      }
      const checkOne = (teacher, mineKept, incoming) => {
        if (!teacher.single_textbook_only) return null;
        const heldIds = new Set();
        for (const a of [...mineKept, ...incoming]) {
          for (const tid of clsTextbookIds.get(a.class_id) || []) heldIds.add(tid);
        }
        // 未锁定的班已全部换出，最终集合 = 锁定保留的班 + 换入的班；> 1 本即拦截
        if (heldIds.size > 1) {
          const titles = [...heldIds].map((id) => `《${tbTitleById.get(id) || `教材${id}`}》`).join('、');
          return `教师${teacher.name}已开启“只带一本教材”，交换后将持有 ${titles}，无法交换`;
        }
        return null;
      };
      const errA = checkOne(teacherA, ownA.filter((a) => a.is_locked), swapB);
      if (errA) return fail(res, errA, 400);
      const errB = checkOne(teacherB, ownB.filter((a) => a.is_locked), swapA);
      if (errB) return fail(res, errB, 400);
    }

    // 5. 事务内按记录 id 双向互换（先收集 ids，避免顺序 update 互相命中）；
    // 交换后视为手动安排：is_auto/is_inherent 归零
    const idsA = swapA.map((a) => a.id);
    const idsB = swapB.map((a) => a.id);
    await prisma.$transaction(async (tx) => {
      if (idsA.length > 0) {
        await tx.teaching_assignments.updateMany({
          where: { id: { in: idsA } },
          data: { teacher_id: tidB, is_auto: false, is_inherent: false },
        });
      }
      if (idsB.length > 0) {
        await tx.teaching_assignments.updateMany({
          where: { id: { in: idsB } },
          data: { teacher_id: tidA, is_auto: false, is_inherent: false },
        });
      }
    });

    // 6. 交换后工作量软警告（口径与 assignTeacher M5 一致：合班去重 + 自定义课时优先）
    const warnings = [];
    try {
      const globalSettings = await prisma.system_settings.findUnique({
        where: { key: HOUR_SETTINGS_PREFIX },
      });
      const configuredSettings = globalSettings
        ? safeParseJSON(globalSettings.value, DEFAULT_HOUR_SETTINGS)
        : DEFAULT_HOUR_SETTINGS;
      for (const teacher of [teacherA, teacherB]) {
        const teacherAssignments = await prisma.teaching_assignments.findMany({
          where: { semester, teacher_id: teacher.id },
          select: {
            teacher_id: true,
            course_id: true,
            weekly_hours: true,
            class_id: true,
            class: { select: { combination_id: true } },
          },
        });
        const totalHours = dedupeTeachingUnits(teacherAssignments).reduce(
          (sum, u) => sum + (u.weeklyHours || 0),
          0
        );
        const personnelType = teacher.personnel_type || 'full_time';
        const hourLimit =
          teacher.default_weekly_hours ??
          configuredSettings[personnelType]?.standard ??
          DEFAULT_HOUR_SETTINGS[personnelType]?.standard ??
          DEFAULT_HOUR_SETTINGS.full_time.standard;
        if (totalHours > hourLimit) {
          warnings.push(
            `教师${teacher.name}当前学期周课时已达 ${totalHours}，超过标准课时上限 ${hourLimit}`
          );
        }
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
        course_id: courseId,
        semester,
        teacher_id_a: tidA,
        teacher_id_b: tidB,
        swappedA: idsA.length,
        swappedB: idsB.length,
        skippedLocked: skippedLocked.length,
      },
      result: 'success',
      message: `交换教师班级：${teacherA.name}(${idsA.length}班) ↔ ${teacherB.name}(${idsB.length}班)`,
    });

    success(
      res,
      {
        swappedCountA: idsA.length,
        swappedCountB: idsB.length,
        skippedLocked,
        warnings,
      },
      '交换成功'
    );
  } catch (e) {
    const {
      course_id: _cid,
      semester: _sem,
      teacher_id_a: _ta,
      teacher_id_b: _tb,
    } = req.body || {};
    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: {
        course_id: _cid != null ? Number(_cid) : undefined,
        semester: _sem,
        teacher_id_a: _ta != null ? Number(_ta) : undefined,
        teacher_id_b: _tb != null ? Number(_tb) : undefined,
        error: e.message,
      },
      result: 'failed',
      message: `交换教师班级失败：${e.message}`,
    }).catch(() => {});
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
        class: { select: { name: true, combination_id: true } },
      },
    });

    if (!assignment) return fail(res, '安排记录不存在', 404);

    // 合班级联：若该班级属合班，同步删除所有成员班同课程的安排，保持合班教师一致
    const combId = assignment.class?.combination_id;
    const delHint = combId != null ? '（含合班伙伴一同解除）' : '';

    await prisma.$transaction(async (tx) => {
      await tx.teaching_assignments.delete({ where: { id: Number(id) } });
      if (combId != null) {
        const memberIds = await tx.classes.findMany({
          where: { combination_id: combId },
          select: { id: true },
        });
        const ids = memberIds.map((m) => m.id);
        if (ids.length) {
          await tx.teaching_assignments.deleteMany({
            where: {
              course_id: assignment.course_id,
              semester: assignment.semester,
              class_id: { in: ids },
              id: { not: Number(id) },
            },
          });
        }
      }
    });

    // 自动安排被删除后提示重新排课（M-8 修复）
    const hint = (assignment.is_auto ? '（该班级自动安排已删除，建议重新排课）' : '') + delHint;

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

    const customHoursGuarantee = await getCustomHoursGuarantee();

    // SSE 模式：初始化流式响应，通过 onProgress 回调推送五阶段进度
    if (useSSE) {
      initSSE(res);
      // 客户端断开连接时清理（避免继续写已关闭的流）
      const onClose = () => {
        res.writableEnded || res.end();
      };
      req.on('close', onClose);

      try {
        // preview 为算法内部 dry-run 选项（F8 补漏轮评估用），API 层不再暴露，默认直接落库
        const result = await autoArrange(courseId, semester, mode, finalHourSettings, conditions, {
          onProgress: (progress) => {
            sendSSEEvent(res, 'progress', progress);
          },
          customHoursGuarantee,
        });

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

        sendSSEEvent(res, 'complete', {
          success: true,
          data: result,
          message: `自动排课完成：安排${result.autoCount}个班级`,
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
      customHoursGuarantee,
    });

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

    success(res, result, `自动排课完成：安排${result.autoCount}个班级`);
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

    const where = { semester, is_auto: true, is_locked: false };
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

    // ── 合班去重：将成员班行归并为"逻辑教学单元"，避免课时/班级数虚高 ──
    // 预取本学期全部相关安排（含班级 combination_id），用于按单元归并
    const rawAssignments = await prisma.teaching_assignments.findMany({
      where: {
        semester,
        teacher: { status: 'active' },
        weekly_hours: { gt: 0 }, // 排除历史遗留的 0 课时安排
      },
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
            combination_id: true,
            colleges: { select: { id: true, name: true } },
          },
        },
        course: { select: { id: true, name: true } },
      },
      orderBy: [{ teacher_id: 'asc' }, { course_id: 'asc' }],
    });

    // 归并为逻辑教学单元（同组合 + 同课程 + 同教师 → 1 个单元，课时仅计 1 次）
    const allUnits = dedupeTeachingUnits(rawAssignments);

    // 涉及的教师（按单元代表行去重）
    const teacherIds = [...new Set(allUnits.map((u) => u.representative.teacher_id))];

    // 获取教师详细信息
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

    // 按教师分组单元
    const unitsByTeacher = new Map();
    for (const u of allUnits) {
      const tid = u.representative.teacher_id;
      if (!unitsByTeacher.has(tid)) unitsByTeacher.set(tid, []);
      unitsByTeacher.get(tid).push(u);
    }

    // H-7: 预加载所有授课层次，消除 N+1 查询
    const allLevelIds = new Set();
    for (const u of allUnits) {
      const tl = u.representative.class.training_level_id;
      if (tl) allLevelIds.add(tl);
    }
    let globalLevelMap = new Map();
    if (allLevelIds.size > 0) {
      const allLevels = await prisma.training_levels.findMany({
        where: { id: { in: [...allLevelIds] } },
        select: { id: true, name: true },
      });
      globalLevelMap = new Map(allLevels.map((l) => [l.id, l]));
    }

    // 教材解析：批量查询培养方案教材（共享函数，与课时统计导出同一链路，避免 N+1）
    const semesterInfo = parseSemester(semester);
    const { idsMap: classCourseTextbookMap, titleMap: textbookTitleMap } =
      await resolveClassCourseTextbooks(rawAssignments, semesterInfo);

    // 将 textbookId 列表转为可读名称字符串
    const classCourseTextbookNameMap = new Map();
    for (const [key, ids] of classCourseTextbookMap) {
      const names = ids.map((id) => textbookTitleMap.get(id)).filter(Boolean);
      classCourseTextbookNameMap.set(key, names.join('、'));
    }

    const result = teacherIds.map((tid) => {
      const teacher = teacherMap.get(tid);
      const units = unitsByTeacher.get(tid) || [];

      // 从实际授课班级中提取任课学院（去重）
      const collegeMap = new Map();
      for (const u of units) {
        const c = u.representative.class;
        if (c.colleges && !collegeMap.has(c.colleges.id)) {
          collegeMap.set(c.colleges.id, c.colleges);
        }
      }
      const collegeList = [...collegeMap.values()];

      // 从实际授课班级中提取任课层次（去重）
      const levelIdSet = new Set();
      for (const u of units) {
        const tl = u.representative.class.training_level_id;
        if (tl) levelIdSet.add(tl);
      }

      // 优先使用实际授课层次，如果为空则使用意向设置
      let trainingLevelList;
      if (levelIdSet.size > 0) {
        trainingLevelList = [...levelIdSet].map((lid) => globalLevelMap.get(lid)).filter(Boolean);
      } else {
        trainingLevelList = teacher?.scheduling_levels?.map((sl) => sl.training_level) ?? [];
      }

      // 按课程分组（合班单元课时仅计 1 次）
      const byCourse = new Map();
      let totalWeeklyHours = 0;
      let totalClassCount = 0;
      // 教材去重统计：汇总该教师所有教学单元解析出的教材（合班取代表班，与"当前教材"列口径一致）
      const textbookIdSet = new Set();
      for (const u of units) {
        totalWeeklyHours += u.weeklyHours;
        totalClassCount += 1; // 合班=1 个逻辑教学班；非合班=1 个班级

        const unitTextbookIds =
          classCourseTextbookMap.get(
            `${u.representative.class_id}:${u.representative.course_id}`
          ) || [];
        for (const tid of unitTextbookIds) textbookIdSet.add(tid);

        if (!byCourse.has(u.representative.course_id)) {
          byCourse.set(u.representative.course_id, {
            course: u.representative.course,
            classes: [],
            weeklyHours: 0,
          });
        }
        const group = byCourse.get(u.representative.course_id);
        const combined = isCombinedUnit(u);
        group.classes.push({
          unitKey: u.key,
          classId: u.representative.class_id,
          className: combined
            ? u.memberClasses
                .map((c) => c?.name)
                .filter(Boolean)
                .join('、')
            : u.representative.class.name,
          isCombined: combined,
          memberClassIds: u.memberClassIds,
          collegeName: u.representative.class.colleges?.name || null,
          trainingLevelName:
            globalLevelMap.get(u.representative.class.training_level_id)?.name || null,
          weeklyHours: u.weeklyHours,
          isAuto: u.representative.is_auto,
          textbookName:
            classCourseTextbookNameMap.get(
              `${u.representative.class_id}:${u.representative.course_id}`
            ) || null,
        });
        group.weeklyHours += u.weeklyHours;
      }

      return {
        teacherId: tid,
        teacherName: teacher?.name || '未知',
        personnelType: teacher?.personnel_type || null,
        affiliatedCollege: teacher?.affiliated_college || null,
        remark: teacher?.remark ?? null,
        collegeList,
        trainingLevelList,
        courseList: teacher?.courses?.map((tc) => tc.course) ?? [],
        totalWeeklyHours,
        totalClassCount,
        textbookCount: textbookIdSet.size,
        textbookNames: [...textbookIdSet].map((id) => textbookTitleMap.get(id)).filter(Boolean),
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
 * PATCH /assignments/:id/lock - 锁定/解锁单条教学安排
 *   Body: { locked: boolean }
 *   锁定后的分配在自动排课和重置时不会被覆盖/删除
 */
export async function toggleLock(req, res, next) {
  try {
    const { id } = req.params;
    const { locked } = req.body;
    if (typeof locked !== 'boolean') return fail(res, 'locked 参数必须是布尔值');

    const existing = await prisma.teaching_assignments.findUnique({
      where: { id: Number(id) },
      include: {
        teacher: { select: { name: true } },
        class: { select: { name: true, combination_id: true } },
        course: { select: { name: true } },
      },
    });
    if (!existing) return fail(res, '安排记录不存在', 404);

    // 合班联动：锁定/解锁同步到所有合班成员
    const targetIds = [Number(id)];
    const combId = existing.class?.combination_id;
    if (combId != null) {
      const members = await prisma.classes.findMany({
        where: { combination_id: combId },
        select: { id: true },
      });
      const memberIds = members.map((m) => m.id);
      const partnerAssignments = await prisma.teaching_assignments.findMany({
        where: {
          course_id: existing.course_id,
          semester: existing.semester,
          class_id: { in: memberIds },
          id: { not: Number(id) },
        },
        select: { id: true },
      });
      targetIds.push(...partnerAssignments.map((a) => a.id));
    }

    await prisma.teaching_assignments.updateMany({
      where: { id: { in: targetIds } },
      data: { is_locked: locked },
    });

    const action = locked ? '锁定' : '解锁';
    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: {
        id: Number(id),
        locked,
        affectedCount: targetIds.length,
        teacher: existing.teacher?.name,
        class: existing.class?.name,
      },
      result: 'success',
      message: `${action}教学安排：${existing.teacher?.name} → ${existing.class?.name}（含合班共${targetIds.length}条）`,
    });

    success(res, { locked, affectedCount: targetIds.length }, `${action}成功`);
  } catch (e) {
    next(e);
  }
}

/**
 * POST /lock-batch - 批量锁定/解锁教学安排
 *   Body: { semester, courseId?, locked: boolean }
 *   courseId 可选：传则只操作该科目，不传则操作整个学期
 *   仅作用于 is_auto=true 的记录（手动安排无需锁定）
 */
export async function batchLock(req, res, next) {
  try {
    const { semester, course_id, locked } = req.body;
    if (!semester) return fail(res, '缺少学期参数');
    if (typeof locked !== 'boolean') return fail(res, 'locked 参数必须是布尔值');

    const where = { semester, is_auto: true };
    if (course_id) where.course_id = Number(course_id);

    const result = await prisma.teaching_assignments.updateMany({
      where,
      data: { is_locked: locked },
    });

    const action = locked ? '锁定' : '解锁';
    const scope = course_id ? `课程${course_id}` : '全部课程';
    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: { semester, course_id: course_id || null, locked, updatedCount: result.count },
      result: 'success',
      message: `批量${action}：${scope} ${result.count}条自动安排`,
    });

    success(res, { updatedCount: result.count }, `已${action}${result.count}条安排`);
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

    const customHoursGuarantee = await getCustomHoursGuarantee();

    // SSE 模式：初始化流式响应，通过 onProgress 回调推送每门课程进度
    if (useSSE) {
      initSSE(res);
      const onClose = () => {
        res.writableEnded || res.end();
      };
      req.on('close', onClose);

      try {
        // preview 为算法内部 dry-run 选项（F8 补漏轮评估用），API 层不再暴露，默认直接落库
        const result = await batchAutoArrange(semester, mode, finalHourSettings, conditions, {
          onProgress: (progress) => {
            sendSSEEvent(res, 'progress', progress);
          },
          customHoursGuarantee,
        });

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

        sendSSEEvent(res, 'complete', {
          success: true,
          data: result,
          message: `批量排课完成：安排${result.summary.totalAssigned}个班级`,
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
      customHoursGuarantee,
    });

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

    success(res, result, `批量排课完成：安排${result.summary.totalAssigned}个班级`);
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

/**
 * POST /optimize-schedule - 排课优化（预览模式）
 * 对当前学期所有已排课的教师进行全局优化，返回优化前后对比
 */
export async function runOptimizeSchedule(req, res, next) {
  const useSSE = isSSERequest(req);
  try {
    const semester = req.body.semester;
    const mode = req.body.mode || 'standard';

    if (!semester) return fail(res, '缺少学期参数');
    if (!['full', 'standard'].includes(mode)) return fail(res, '排课模式必须是full或standard');

    const customHoursGuarantee = await getCustomHoursGuarantee();

    // SSE 模式：初始化流式响应，通过 onProgress 回调推送优化进度
    if (useSSE) {
      initSSE(res);
      const onClose = () => {
        res.writableEnded || res.end();
      };
      req.on('close', onClose);

      try {
        const { runOptimizeSchedule } = await import('../services/arrange/optimize.js');
        const result = await runOptimizeSchedule(semester, mode, {
          onProgress: (progress) => {
            sendSSEEvent(res, 'progress', progress);
          },
          customHoursGuarantee,
        });

        sendSSEEvent(res, 'complete', {
          success: true,
          data: result,
          message: `优化分析完成：${result.summary.changedClasses}个班级可优化`,
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
    const { runOptimizeSchedule } = await import('../services/arrange/optimize.js');
    const result = await runOptimizeSchedule(semester, mode, { customHoursGuarantee });

    success(res, result, `优化分析完成：${result.summary.changedClasses}个班级可优化`);
  } catch (e) {
    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: { semester: req.body.semester, mode: req.body.mode, error: e.message },
      result: 'failed',
      message: `排课优化失败：${e.message}`,
    }).catch(() => {});
    next(e);
  }
}

/**
 * POST /apply-optimize - 应用优化结果
 * 将预览阶段确认的优化方案写入数据库
 */
export async function applyOptimizeResult(req, res, next) {
  try {
    const { semester, changes, mode } = req.body;

    if (!semester) return fail(res, '缺少学期参数');
    if (!Array.isArray(changes) || changes.length === 0) {
      return fail(res, '缺少变更数据或无变更需要应用');
    }
    // 应用前校验需要与预览一致的容量口径（standard/full）
    const applyMode = mode || 'standard';
    if (!['full', 'standard'].includes(applyMode)) {
      return fail(res, '排课模式必须是full或standard');
    }

    const { applyOptimizeResult } = await import('../services/arrange/optimize.js');
    const result = await applyOptimizeResult(semester, changes, req.user?.id, applyMode);

    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: {
        semester,
        changesCount: changes.length,
        appliedChanges: result.appliedChanges,
      },
      result: 'success',
      message: `应用排课优化：变更${result.appliedChanges}个班级`,
    });

    success(res, result, `优化已应用：变更${changes.length}个班级`);
  } catch (e) {
    await createAuditLog({
      action: 'update',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: { semester: req.body.semester, error: e.message },
      result: 'failed',
      message: `应用优化结果失败：${e.message}`,
    }).catch(() => {});
    next(e);
  }
}
