/**
 * 排课优化服务 - 跨课程全局禁忌搜索优化
 * 对当前学期所有已排课的教师进行全局优化，提升排课质量
 */

import { prisma } from '../../lib/prisma.js';
import logger from '../../utils/logger.js';
import { AppError } from '../../utils/error.js';
import {
  DEFAULT_HOUR_SETTINGS,
  HOUR_SETTINGS_PREFIX,
  TABU_SEARCH,
  TEXTBOOK_COHESION,
  INHERENT_CLASS,
} from '../../constants/index.js';
import { tabuOptimize } from './tabu-search.js';
import { calcMatchScore, batchLocks } from './auto-arrange.js';
import { getClassesWithCourse } from './queries.js';
import { createAuditLog } from '../../services/audit.service.js';
import { getPreviousSemester } from '../semester.service.js';
import { dedupeTeachingUnits } from '../teaching-statistics.service.js';
import { acquireLock, releaseLock } from './lock.js';

/**
 * 检查是否满足最小改进阈值
 * P2 修复：原 && 关系导致 2 个班级的有效 Swap 被丢弃，改为加权判定
 * - scoreImprovement > 5% 即可（不论变更数）
 * - 或 changesCount >= 3 且 scoreImprovement > 2%（小改进但多变更）
 * 注意：新目标函数含惩罚项，before.score 可能为负数，
 * 需用 !== 0 而非 > 0 守卫，否则负分→正分的巨大改进会被误判为 0%。
 */
function meetsMinimumThreshold(before, after) {
  const changesCount = after.changesCount || 0;
  const scoreImprovement =
    before.score !== 0 ? ((after.score - before.score) / Math.abs(before.score)) * 100 : 0;

  return scoreImprovement > 5 || (changesCount >= 3 && scoreImprovement > 2);
}

/**
 * 计算排课质量指标 - 使用 calcMatchScore 统一评分
 * P2 修复：指标口径与真实业务语义对齐——
 * - 教师负载含基线（手动/锁定）课时，容量用"个人自定义或类别标准/上限"原始值，
 *   不再用逐课程容量修正后的 standardCap/fullCap（该值在课程循环中仅对单课有效，
 *   挂在共享约束上会被后续课程反复改写，用于全局指标必然失真）
 * - 教材按 (course_id, class_id) 精确取值，杜绝同班多课程的教材串味
 * - 输入为 dedupeTeachingUnits 归并后的教学单元，合班课时只计 1 次
 * @param {Array} assignmentUnits - dedupeTeachingUnits 输出的教学单元列表
 * @param {Array} teacherConstraints - 教师约束
 * @param {Map} classMap - classId → 班级基础信息（className/collegeId/trainingLevelId）
 * @param {string} mode - 排课模式
 * @param {Map} courseTextbookMap - courseId → Map(classId → textbookIds[])
 * @param {Map} baselineHoursByTeacher - 教师基线（手动/锁定）课时
 */
function calculateMetrics(
  assignmentUnits,
  teacherConstraints,
  classMap,
  mode,
  courseTextbookMap,
  baselineHoursByTeacher
) {
  const teacherMap = new Map(teacherConstraints.map((t) => [t.id, t]));

  // 1. 计算教师负载状态（含基线课时）
  const teacherStates = new Map();
  for (const t of teacherConstraints) {
    teacherStates.set(t.id, {
      assignedHours: baselineHoursByTeacher.get(t.id) || 0,
      textbooks: new Set(),
      colleges: new Set(),
      classes: [],
    });
  }

  // 计算总匹配分数
  let totalMatchScore = 0;
  let matchCount = 0;

  for (const unit of assignmentUnits) {
    const a = unit.representative;
    const state = teacherStates.get(a.teacher_id);
    const baseCls = classMap.get(a.class_id);
    // 教材按 (course, class) 精确取值：同一班级在不同课程的教材不同
    const textbookIds = courseTextbookMap.get(a.course_id)?.get(a.class_id) || [];
    const cls = baseCls ? { ...baseCls, textbookIds } : null;
    if (state) {
      state.assignedHours += unit.weeklyHours || 0;
      state.classes.push(a.class_id);
      if (baseCls) {
        for (const tid of textbookIds) state.textbooks.add(tid);
        if (baseCls.collegeId != null) state.colleges.add(baseCls.collegeId);
      }
    }

    // 使用 calcMatchScore 计算实际匹配分数
    const teacher = teacherMap.get(a.teacher_id);
    if (teacher && cls) {
      const proxy = {
        ...teacher,
        assignedTextbookIds: state?.textbooks || new Set(),
        assignedCollegeIds: state?.colleges || new Set(),
        assignedHours: state?.assignedHours || 0,
      };
      totalMatchScore += calcMatchScore(proxy, cls);
      matchCount++;
    }
  }

  // 2. 容量口径：个人自定义课时优先；负载率用 mode 对应的类别容量
  const capOf = (t) =>
    t.defaultWeeklyHours != null
      ? t.defaultWeeklyHours
      : mode === 'standard'
        ? t.standardHours
        : t.maxHours;
  // 欠分配达标口径：自定义与类别标准取严（guarantee 语义，与 computeObjective 对齐）
  const guaranteeOf = (t) => Math.min(t.defaultWeeklyHours ?? Infinity, t.standardHours);

  // 计算负载均衡度
  const loadRates = [];
  for (const t of teacherConstraints) {
    const state = teacherStates.get(t.id);
    if (!state) continue;
    const cap = capOf(t);
    if (cap > 0) {
      loadRates.push(state.assignedHours / cap);
    }
  }

  const avgLoadRate =
    loadRates.length > 0 ? loadRates.reduce((s, r) => s + r, 0) / loadRates.length : 0;

  const loadVariance =
    loadRates.length > 1
      ? loadRates.reduce((s, r) => s + (r - avgLoadRate) ** 2, 0) / loadRates.length
      : 0;

  // 3. 计算教材内聚度
  let cohesionSum = 0;
  let teacherCount = 0;
  for (const state of teacherStates.values()) {
    if (state.classes.length === 0) continue;
    const tbSize = state.textbooks.size;
    const classCount = state.classes.length;
    const cohesion = classCount > 0 ? Math.max(0, 1 - (tbSize - 1) / classCount) : 1;
    cohesionSum += cohesion;
    teacherCount++;
  }

  const textbookCohesionRate =
    teacherCount > 0 ? Math.round((cohesionSum / teacherCount) * 100) : 100;

  // 4. 综合评分 = 总匹配分数 - 欠分配惩罚 - 负载方差惩罚
  // P1 修复：与 tabu-search.js 的 computeObjective 对齐，避免 UI 显示与算法结果矛盾
  const alpha = TABU_SEARCH.UNDER_ASSIGNMENT_PENALTY || 0;
  const beta = TABU_SEARCH.LOAD_VARIANCE_WEIGHT || 0;

  // 欠分配惩罚：每位教师低于达标线（guarantee）的课时缺口 × α
  let underAssignmentPenalty = 0;
  for (const t of teacherConstraints) {
    const state = teacherStates.get(t.id);
    if (!state) continue;
    const target = guaranteeOf(t);
    if (target > 0) {
      const gap = Math.max(0, target - state.assignedHours);
      underAssignmentPenalty += alpha * gap;
    }
  }

  // 负载方差惩罚：β × loadVariance × 100（与 computeObjective 的量级对齐）
  const loadVariancePenalty = beta * loadVariance * 100;

  const score =
    Math.round((totalMatchScore - underAssignmentPenalty - loadVariancePenalty) * 100) / 100;

  return {
    score,
    avgMatchScore: matchCount > 0 ? Math.round((totalMatchScore / matchCount) * 100) / 100 : 0,
    loadVariance: Math.round(loadVariance * 10000) / 10000,
    avgLoadRate: Math.round(avgLoadRate * 100) / 100,
    textbookCohesionRate,
    totalAssignments: assignmentUnits.length,
    affectedTeachers: teacherConstraints.length,
  };
}

/**
 * 构建教师约束对象 - 与 auto-arrange.js 的 buildTeacherConstraints 对齐
 * 确保包含 calcMatchScore、canAccept、buildTeacherStates 所需的全部字段
 * @param {Array} allAssignments - 可优化记录 + 基线记录（手动/锁定），基线仅参与约束统计
 * @param {Map} courseTextbookMap - courseId → Map(classId → textbookIds[])
 * @param {object} hourSettings - 课时配置（系统设置优先，回退 DEFAULT_HOUR_SETTINGS）
 * @param {boolean} customHoursGuarantee - 自定义课时硬保障开关：开启后已设自定义的教师保障目标取自定义剩余课时
 */
function buildTeacherConstraints(
  teachers,
  allAssignments,
  courseTextbookMap,
  hourSettings,
  customHoursGuarantee = false
) {
  // 构建教师现有分配统计
  const teacherHoursMap = new Map();
  const teacherTextbookMap = new Map();
  const teacherCollegeMap = new Map();

  // P1 修复：合班课时去重——同一 (combination, course, teacher) 的多行记录只计 1 次课时。
  // teaching_assignments 中合班每个成员班各存一行，直接按行累加会把同一节课记 N 倍，
  // 导致 effectiveTotal 虚高 → 容量被过度压缩 → 欠分配；与全系统 dedupeTeachingUnits 口径对齐
  for (const unit of dedupeTeachingUnits(allAssignments)) {
    const tid = unit.representative.teacher_id;
    teacherHoursMap.set(tid, (teacherHoursMap.get(tid) || 0) + (unit.weeklyHours || 0));
  }

  for (const a of allAssignments) {
    const tid = a.teacher_id;

    // OL2 修复：教材按 (course_id, class_id) 精确取值，
    // 修正原 classMap 按 class_id 首课程覆盖导致同班多课程教材漏计的问题
    if (!teacherTextbookMap.has(tid)) teacherTextbookMap.set(tid, new Set());
    for (const tbId of courseTextbookMap.get(a.course_id)?.get(a.class_id) || []) {
      teacherTextbookMap.get(tid).add(tbId);
    }
    if (!teacherCollegeMap.has(tid)) teacherCollegeMap.set(tid, new Set());
    if (a.class?.college_id != null) teacherCollegeMap.get(tid).add(a.class.college_id);
  }

  return teachers.map((t) => {
    const personnelType = t.personnel_type || 'full_time';
    // OL3 修复：优先使用系统设置的课时配置（与自动排课 controller 路径同源）
    const setting =
      hourSettings?.[personnelType] || hourSettings?.full_time || DEFAULT_HOUR_SETTINGS.full_time;

    const existingHours = teacherHoursMap.get(t.id) || 0;

    // 容量计算：与 auto-arrange 对齐
    // 自定义课时最高优先级：设置后完全替代类别 standard/max（既能收紧也能放宽）；
    // guaranteeCap 默认保留"自定义与类别标准取严"口径，供 α 欠分配惩罚使用；
    // 硬保障开关开启时已设自定义的教师保障目标提升为自定义剩余课时
    const teacherHourCap =
      t.default_weekly_hours != null ? Math.max(0, t.default_weekly_hours - existingHours) : null;
    const rawStandardCap =
      teacherHourCap != null ? teacherHourCap : Math.max(0, setting.standard - existingHours);
    const rawFullCap =
      teacherHourCap != null ? teacherHourCap : Math.max(0, setting.max - existingHours);
    const rawGuaranteeCap =
      customHoursGuarantee && teacherHourCap != null
        ? teacherHourCap
        : Math.min(teacherHourCap ?? Infinity, Math.max(0, setting.standard - existingHours));

    const standardCap = Math.floor(rawStandardCap);
    const fullCap = Math.floor(rawFullCap);
    const guaranteeCap = Math.floor(rawGuaranteeCap);

    // 提取 schedulingCollegeIds 和 schedulingLevelIds
    const schedulingCollegeIds = (t.scheduling_colleges || []).map((sc) => sc.college_id);
    const schedulingLevelIds = (t.scheduling_levels || [])
      .map((sl) => sl.training_level?.id)
      .filter(Boolean);

    // 已分配教材和学院（从现有排课记录）
    const assignedTextbookIds = teacherTextbookMap.get(t.id) || new Set();
    const assignedCollegeIds = teacherCollegeMap.get(t.id) || new Set();

    // 固有教材快照（与 auto-arrange 的 P1-A 修复对齐）
    const inherentTextbookIds = [...assignedTextbookIds];

    return {
      // 展开保留所有教师字段（与 auto-arrange 一致）
      id: t.id,
      name: t.name,
      personnelType,
      defaultWeeklyHours: t.default_weekly_hours,
      gender: t.gender,
      courses: t.courses || [], // 授课资格关联，用于按课程筛选合格教师

      // 意向约束 - 关键字段
      schedulingCollegeIds,
      schedulingLevelIds,

      // 只带一本教材开关（个人维度硬约束，供 tabu-search canAccept/swap 覆写教材上限）
      singleTextbookOnly: !!t.single_textbook_only,

      // 教材相关 - 关键字段
      inherentTextbookIds,
      textbookIds: [...inherentTextbookIds],
      assignedTextbookIds: new Set(assignedTextbookIds),
      assignedCollegeIds: new Set(assignedCollegeIds),

      // 容量
      standardHours: setting.standard,
      maxHours: setting.max,
      standardCap,
      fullCap,
      guaranteeCap,
      teacherHourCap,
      effectiveTotal: existingHours,
      assignedHours: 0, // tabuOptimize 会从 assignments 重建

      // 偏好
      // Schema 对齐修复：teachers 模型无 teacher_textbook_preferences 关系，
      // 教材偏好已通过 plan_textbooks 体现到 classMap.textbookIds，此处留空 Map 保持字段存在
      preferences: new Map(),
    };
  });
}

/**
 * 运行排课优化（预览模式）
 */
export async function runOptimizeSchedule(semesterId, mode = 'standard', options = {}) {
  const onProgress = options.onProgress || null;
  // 自定义课时硬保障开关（系统设置透传）：影响保障目标 guaranteeCap 口径
  const customHoursGuarantee = !!options.customHoursGuarantee;
  const progress = (phase, message, percent) => {
    if (onProgress) {
      onProgress({ phase, message, percent });
    }
    logger.info(`[Optimize] ${message}`);
  };

  const semesterStr = `${semesterId}`;

  // P1 修复：并发保护——批量排课进行中拒绝优化（与 auto-arrange 的 batchLocks 同源）；
  // 同学期优化用数据库锁互斥（支持多实例部署）
  if (batchLocks.has(semesterStr)) {
    throw new AppError(`学期 ${semesterStr} 批量排课进行中，请稍后再试`, 409);
  }
  const dbLockKey = `optimize:${semesterStr}`;
  const dbLocked = await acquireLock(dbLockKey);
  if (!dbLocked) {
    throw new AppError('该学期正在排课优化中，请稍后重试', 409);
  }

  try {
    progress('init', '正在加载当前排课数据...', 5);

    // 1. 加载学期内所有未锁定的自动排课记录
    // Schema 对齐修复：teaching_assignments 用 semester（非 semester_id），
    // 关系为 class/teacher/course（非 course_classes/teachers）
    const currentAssignments = await prisma.teaching_assignments.findMany({
      where: {
        semester: semesterStr,
        is_locked: false,
        is_auto: true,
      },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            college_id: true,
            training_level_id: true,
            combination_id: true,
          },
        },
        teacher: {
          select: {
            id: true,
            name: true,
            personnel_type: true,
            default_weekly_hours: true,
          },
        },
      },
    });

    if (currentAssignments.length === 0) {
      throw new Error('没有可优化的自动排课记录');
    }

    progress('init', `已加载${currentAssignments.length}条排课记录`, 10);

    // 2. 按课程分组（course_id 直接在 teaching_assignments 上）
    const courseMap = new Map();
    for (const a of currentAssignments) {
      const courseId = a.course_id;
      if (!courseMap.has(courseId)) {
        courseMap.set(courseId, {
          courseId,
          assignments: [],
          classIds: new Set(),
          teacherIds: new Set(),
        });
      }
      const course = courseMap.get(courseId);
      course.assignments.push(a);
      course.classIds.add(a.class_id);
      course.teacherIds.add(a.teacher_id);
    }

    progress('init', `涉及${courseMap.size}门课程`, 15);

    // 3. 收集所有涉及的教师
    const allTeacherIds = new Set();
    for (const course of courseMap.values()) {
      for (const tid of course.teacherIds) allTeacherIds.add(tid);
    }

    // 3.5 OL1 修复：加载手动排课与锁定记录作为约束基线。
    // 这些记录不参与优化，但其课时与教材必须计入教师约束，
    // 否则容量与全学期教材硬上限（MAX_TEXTBOOKS_PER_TEACHER）基于错误基线，
    // 应用优化后可能导致教师超课时上限或超 2 本教材。
    const baselineAssignments = await prisma.teaching_assignments.findMany({
      where: {
        semester: semesterStr,
        teacher_id: { in: [...allTeacherIds] },
        OR: [{ is_auto: false }, { is_locked: true }],
      },
      select: {
        teacher_id: true,
        class_id: true,
        course_id: true,
        weekly_hours: true,
        class: { select: { id: true, college_id: true, combination_id: true } },
      },
    });

    // 4. 加载教师完整信息（含 scheduling_colleges、scheduling_levels、courses）
    // Schema 对齐修复：teachers 模型无 teacher_textbook_preferences 关系
    // courses 用于按课程筛选合格教师，防止 tabuOptimize 跨学科变更
    // P1 修复：过滤停用教师（与 auto-arrange 的 getTeachersForCourse status:'active' 口径对齐），
    // 停用教师名下的排课记录保持现状，不参与优化、不接收新班级
    const teachers = await prisma.teachers.findMany({
      where: { id: { in: [...allTeacherIds] }, status: 'active' },
      include: {
        scheduling_colleges: { select: { college_id: true } },
        scheduling_levels: {
          include: { training_level: { select: { id: true, name: true } } },
        },
        courses: { select: { course_id: true } },
      },
    });

    // P1 修复：从可优化集合中剔除停用教师的记录，保持其现状
    const activeTeacherIds = new Set(teachers.map((t) => t.id));
    let optimizableCount = 0;
    for (const [cid, course] of courseMap) {
      course.assignments = course.assignments.filter((a) => activeTeacherIds.has(a.teacher_id));
      if (course.assignments.length === 0) {
        courseMap.delete(cid);
        continue;
      }
      course.classIds = new Set(course.assignments.map((a) => a.class_id));
      course.teacherIds = new Set(course.assignments.map((a) => a.teacher_id));
      optimizableCount += course.assignments.length;
    }
    if (optimizableCount === 0) {
      throw new AppError('没有可优化的自动排课记录（教师均已停用）', 400);
    }
    const optimizableAssignments = [];
    for (const course of courseMap.values()) {
      for (const a of course.assignments) optimizableAssignments.push(a);
    }

    // 4.5 OL3 修复：读取系统设置的全局课时配置（key 与 controller 的 getHourSettings 同源），
    // 跨课程全局优化统一取全局配置（不做逐课程覆盖），解析失败回退默认值
    let hourSettings = DEFAULT_HOUR_SETTINGS;
    try {
      const globalSettings = await prisma.system_settings.findUnique({
        where: { key: HOUR_SETTINGS_PREFIX },
      });
      if (globalSettings?.value) {
        hourSettings = JSON.parse(globalSettings.value) || DEFAULT_HOUR_SETTINGS;
      }
    } catch (_e) {
      hourSettings = DEFAULT_HOUR_SETTINGS;
    }

    // 5. 教材推导：OL2 修复——复用 getClassesWithCourse 的真实口径
    // （findBestMatchPlan + custom_plan_id 优先 + 学期号与 start/end_semester 范围校验），
    // 替代原 major/level OR 简化匹配 + flatMap 全部学期的漂移实现。
    // 覆盖可优化课程与基线记录课程，保证基线教材同样计入教师约束。
    const allCourseIds = new Set(courseMap.keys());
    for (const a of baselineAssignments) allCourseIds.add(a.course_id);

    const courseTextbookMap = new Map(); // courseId → Map(classId → textbookIds[])
    for (const courseId of allCourseIds) {
      const classTbMap = new Map();
      try {
        const courseClasses = await getClassesWithCourse(courseId, semesterStr);
        for (const c of courseClasses) {
          classTbMap.set(c.classId, (c.textbooks || []).map((tb) => tb?.id).filter(Boolean));
        }
      } catch (tbErr) {
        // 推导失败按无教材处理（与原实现的空数组回退一致），不阻塞整体优化
        logger.warn(`[Optimize] 课程${courseId}教材推导失败，按无教材处理: ${tbErr.message}`);
      }
      courseTextbookMap.set(courseId, classTbMap);
    }

    progress('prepare', '正在构建约束条件...', 25);

    // 6. 构建全局班级映射（仅班级级属性：名称/学院/层次）
    // P0-1/P0-3 修复：weekly_hours 与 textbookIds 是课程维度属性，
    // 同一班级在不同课程取值不同，按 class_id 摊平必然"首条记录污染"其余课程。
    // 课程维度的取值改在课程循环内按本课程安排行单独构建，此处不再携带。
    const globalClassMap = new Map();
    for (const a of optimizableAssignments) {
      if (globalClassMap.has(a.class_id)) continue;
      const cls = a.class;
      globalClassMap.set(a.class_id, {
        classId: a.class_id,
        className: cls?.name || `班级${a.class_id}`,
        collegeId: cls?.college_id,
        trainingLevelId: cls?.training_level_id,
      });
    }

    // 7. 构建全局教师约束（含完整字段；OL1：基线记录一并计入约束统计）
    const teacherConstraints = buildTeacherConstraints(
      teachers,
      [...optimizableAssignments, ...baselineAssignments],
      courseTextbookMap,
      hourSettings,
      customHoursGuarantee
    );

    // 基线（手动/锁定）课时按教师累计（合班去重），供指标计算计入教师真实负载
    const baselineHoursByTeacher = new Map();
    for (const unit of dedupeTeachingUnits(baselineAssignments)) {
      const tid = unit.representative.teacher_id;
      baselineHoursByTeacher.set(
        tid,
        (baselineHoursByTeacher.get(tid) || 0) + (unit.weeklyHours || 0)
      );
    }

    // 固有班级延续：与 autoArrange 同源——开关读取一次，预加载上学期快照
    // 结构：courseId → Map(teacherId → Set(classId))，逐课程挂载到教师约束副本，
    // 使优化层的目标函数尊重延续分配，避免"排课优化"把延续关系拆掉
    let inherentClassMap = null;
    {
      let inherentClassEnabled = INHERENT_CLASS.ENABLED;
      if (!inherentClassEnabled) {
        try {
          const icSetting = await prisma.system_settings.findUnique({
            where: { key: 'inherent_class_enabled' },
          });
          if (icSetting?.value === 'true') inherentClassEnabled = true;
        } catch (_) {
          /* DB 查询失败保持默认关闭 */
        }
      }
      const prevSemester = inherentClassEnabled ? getPreviousSemester(semesterStr) : null;
      if (prevSemester) {
        try {
          const prevRows = await prisma.teaching_assignments.findMany({
            where: { semester: prevSemester },
            select: { course_id: true, teacher_id: true, class_id: true },
          });
          inherentClassMap = new Map();
          for (const row of prevRows) {
            if (!inherentClassMap.has(row.course_id)) inherentClassMap.set(row.course_id, new Map());
            const teacherMap = inherentClassMap.get(row.course_id);
            if (!teacherMap.has(row.teacher_id)) teacherMap.set(row.teacher_id, new Set());
            teacherMap.get(row.teacher_id).add(row.class_id);
          }
        } catch (_) {
          inherentClassMap = null; // 查询失败静默降级，行为退化为现状
        }
      }
    }

    // 8. 计算优化前指标（使用 calcMatchScore；合班课时去重后按教学单元统计）
    const beforeUnits = dedupeTeachingUnits(optimizableAssignments);
    const beforeMetrics = calculateMetrics(
      beforeUnits,
      teacherConstraints,
      globalClassMap,
      mode,
      courseTextbookMap,
      baselineHoursByTeacher
    );
    beforeMetrics.changesCount = 0;

    // 9. 逐课程运行禁忌搜索（共享教师约束）
    progress('optimize', '正在运行全局优化算法...', 35);

    let totalIterations = 0;
    let improvedCourses = 0;
    const courseResults = [];

    const courseEntries = [...courseMap.entries()];
    const totalCourses = courseEntries.length;

    for (let i = 0; i < courseEntries.length; i++) {
      const [courseId, course] = courseEntries[i];
      const progressPercent = 35 + Math.floor((i / totalCourses) * 40);
      progress('optimize', `正在优化课程 ${i + 1}/${totalCourses}...`, progressPercent);

      // P0-2 修复：合班归并——同 combination 的成员班合并为 1 个教学单元统一分配，
      // 禁忌搜索只能整组移动，杜绝优化过程把合班拆给不同教师。
      // 含手动/锁定成员的组合整体钉住（保持现状）：既尊重手动排课，
      // 也避免成员班被移到与手动教师不同的教师造成新的不一致
      const pinnedCombinations = new Set();
      for (const b of baselineAssignments) {
        if (Number(b.course_id) === Number(courseId) && b.class?.combination_id != null) {
          pinnedCombinations.add(b.class.combination_id);
        }
      }

      const byComb = new Map();
      const soloRows = [];
      for (const a of course.assignments) {
        const combId = a.class?.combination_id;
        if (combId != null) {
          if (!byComb.has(combId)) byComb.set(combId, []);
          byComb.get(combId).push(a);
        } else {
          soloRows.push(a);
        }
      }
      const units = [];
      for (const a of soloRows) {
        units.push({ rows: [a], combined: false, pinned: false });
      }
      for (const [combId, rows] of byComb) {
        units.push({
          rows,
          combined: rows.length > 1,
          pinned: pinnedCombinations.has(combId),
        });
      }

      // P0-1/P0-3 修复：本课程班级映射按课程口径构建——
      // weekly_hours 取本课程安排行、textbookIds 按 (course, class) 精确推导（合班取成员并集），
      // 不再复用按 class_id 摊平的 globalClassMap（首条记录会污染其他课程口径，
      // 曾导致搜索内部课时记账偏小 → 教师被加课超容量、教材上限失守）
      const classMap = new Map();
      for (const unit of units) {
        const rep = unit.rows[0];
        const memberIds = unit.combined ? unit.rows.map((r) => r.class_id) : [rep.class_id];
        const tbIds = new Set();
        for (const cid of memberIds) {
          for (const tid of courseTextbookMap.get(Number(courseId))?.get(cid) || []) {
            tbIds.add(tid);
          }
        }
        classMap.set(rep.class_id, {
          classId: rep.class_id,
          className: rep.class?.name || `班级${rep.class_id}`,
          weeklyHours: rep.weekly_hours || 0,
          textbookIds: [...tbIds],
          collegeId: rep.class?.college_id,
          trainingLevelId: rep.class?.training_level_id,
          memberClassIds: unit.combined ? memberIds : null,
        });
      }

      // 构建该课程的 assignments 数组（钉住的组合单元不参与优化，保持现状）
      const courseAssignments = [];
      for (const unit of units) {
        if (unit.pinned) continue;
        const rep = unit.rows[0];
        courseAssignments.push({
          teacher_id: rep.teacher_id,
          teacher_name: rep.teacher.name,
          class_id: rep.class_id,
          class_name: rep.class?.name || `班级${rep.class_id}`,
          course_id: Number(courseId),
          semester: semesterStr,
          weekly_hours: rep.weekly_hours || 0,
          is_auto: true,
          memberClassIds: unit.combined ? unit.rows.map((r) => r.class_id) : null,
        });
      }

      const courseUnassigned = [];

      // 筛选具备本课程授课资格的教师（teacher_courses 关联包含该 courseId）
      // 防止 tabuOptimize 将班级 Shift/Swap 到非本课教师名下，导致跨学科变更
      const qualifiedTeachers = teacherConstraints.filter((t) =>
        (t.courses || []).some((tc) => tc.course_id === Number(courseId))
      );

      // 为每门课创建独立的教师约束副本，防止 tabuOptimize 写回污染共享状态
      // （writeback 会修改 assignedTextbookIds/assignedCollegeIds Set 和 assignedHours）
      const courseTeacherConstraints = qualifiedTeachers.map((t) => {
        // 固有班级延续：按课程挂载上学期快照（全局约束上无此字段，须按课程维度注入，
        // 避免教师在其他课程教过的班级被误判为本课程延续）
        const prevClassIds = inherentClassMap?.get(Number(courseId))?.get(t.id);
        return {
          ...t,
          assignedTextbookIds: new Set(t.assignedTextbookIds),
          assignedCollegeIds: new Set(t.assignedCollegeIds),
          preferences: new Map(t.preferences),
          ...(prevClassIds?.size > 0 ? { inherentClassIds: new Set(prevClassIds) } : {}),
        };
      });

      // 容量修正：buildTeacherConstraints 的 standardCap/fullCap 用的是全局 existingHours（含所有课程），
      // 但 tabu-search 的 buildTeacherStates 仅从当前课程 assignments 初始化 assignedHours。
      // 两者语义不匹配会导致 canAccept 系统性拒绝几乎所有移动：
      //   standardCap = standard - globalHours（很小）
      //   assignedHours = courseHours（已经接近 standardCap）
      //   canAccept: courseHours + newHours > standardCap → REJECTED
      // 修正：将 standardCap/fullCap 重算为 "排除本课后" 的可用容量，
      // 与 auto-arrange.js 的 effectiveTotal = totalWeeklyHours - autoHoursForCourse 思路对齐
      // P1 修复：本课程课时按 (combination, teacher) 去重统计（含钉住单元），
      // 合班多行只计 1 次，否则 otherHours 虚高 → cap 偏低 → 欠分配
      const courseHoursMap = new Map();
      {
        const seen = new Set();
        for (const a of course.assignments) {
          const combId = a.class?.combination_id;
          const key = combId != null ? `comb:${combId}:${a.teacher_id}` : `cls:${a.class_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          courseHoursMap.set(
            a.teacher_id,
            (courseHoursMap.get(a.teacher_id) || 0) + (a.weekly_hours || 0)
          );
        }
      }
      for (const t of courseTeacherConstraints) {
        const courseHours = courseHoursMap.get(t.id) || 0;
        const otherHours = t.effectiveTotal - courseHours;
        // OL6 修复：与 buildTeacherConstraints 口径一致，教师个人周课时上限
        // （default_weekly_hours）必须折入 standardCap/fullCap。
        // canAccept 只检查这两个 cap，不看 teacherHourCap，原实现重算时丢失折算，
        // 导致个人上限低于全局标准/上限的教师被加课超出个人约束。
        // 自定义课时优先：设置后完全替代类别 standard/max（与 auto-arrange 同口径），
        // guaranteeCap 默认保留"自定义与类别标准取严"供 α 惩罚使用；
        // 硬保障开关开启时已设自定义的教师保障目标提升为自定义剩余课时
        t.teacherHourCap =
          t.defaultWeeklyHours != null ? Math.max(0, t.defaultWeeklyHours - otherHours) : null;
        const personalRemain = t.teacherHourCap != null ? t.teacherHourCap : Infinity;
        t.standardCap =
          t.teacherHourCap != null
            ? Math.max(0, t.teacherHourCap)
            : Math.max(0, Math.floor(t.standardHours - otherHours));
        t.fullCap =
          t.teacherHourCap != null
            ? Math.max(0, t.teacherHourCap)
            : Math.max(0, Math.floor(t.maxHours - otherHours));
        t.guaranteeCap =
          customHoursGuarantee && t.teacherHourCap != null
            ? Math.max(0, Math.floor(t.teacherHourCap))
            : Math.max(0, Math.floor(Math.min(t.standardHours - otherHours, personalRemain)));
      }

      try {
        const tsResult = tabuOptimize(
          courseAssignments,
          courseUnassigned,
          courseTeacherConstraints,
          mode,
          classMap,
          courseId,
          semesterStr
        );

        totalIterations += tsResult.iterations;

        if (tsResult.improved) {
          improvedCourses++;
          courseResults.push({
            courseId,
            improved: true,
            scoreBefore: tsResult.scoreBefore,
            scoreAfter: tsResult.scoreAfter,
            delta: tsResult.delta,
            iterations: tsResult.iterations,
          });

          logger.info(
            `[Optimize] 课程${courseId}优化成功: 评分 ${tsResult.scoreBefore}→${tsResult.scoreAfter} ` +
              `(+${tsResult.delta}), 迭代 ${tsResult.iterations}次, 耗时 ${tsResult.elapsed}ms`
          );
        }

        // 将优化后的 assignments 写回 course.assignments
        // 用 class_id 匹配而非位置索引：tabuOptimize 可能在 best-solution 还原时
        // 改变 assignments 数组顺序（Map 迭代序不确定），位置匹配会导致 teacher_id 错位
        // P0-2 修复：合班单元展开——同一组合的全部成员班共享单元教师，保证整组一致；
        // 不在 map 中的班级（钉住单元/非合格教师单元）保持原教师
        const optimizedTeacherByClass = new Map();
        for (const a of courseAssignments) {
          const memberIds = a.memberClassIds?.length ? a.memberClassIds : [a.class_id];
          for (const cid of memberIds) {
            optimizedTeacherByClass.set(cid, a.teacher_id);
          }
        }
        course.assignments = course.assignments.map((orig) => ({
          ...orig,
          teacher_id: optimizedTeacherByClass.get(orig.class_id) ?? orig.teacher_id,
        }));

        // P0 修复：跨课程状态同步
        // tabuOptimize 的 writeback 已把状态写到 courseTeacherConstraints（副本），
        // 但共享的 teacherConstraints 未被更新，导致后续课程基于陈旧状态评估。
        // 将 courseTeacherConstraints 的增量状态同步回 teacherConstraints：
        // - assignedTextbookIds：用 courseTeacherConstraints 的最终值替换
        // - assignedCollegeIds：只增不减（保守策略，与 tabu-search writeback 一致）
        // - assignedHours：由 calculateMetrics 从 assignments 重建，无需同步
        // - standardCap/fullCap/teacherHourCap：基于 effectiveTotal 重算，下轮循环会重新修正
        const courseConstraintMap = new Map(courseTeacherConstraints.map((t) => [t.id, t]));
        for (const sharedT of qualifiedTeachers) {
          const courseT = courseConstraintMap.get(sharedT.id);
          if (!courseT) continue;
          // 教材集合：直接替换为优化后的值
          sharedT.assignedTextbookIds = new Set(courseT.assignedTextbookIds);
          // 学院集合：只增不减
          for (const cid of courseT.assignedCollegeIds) {
            sharedT.assignedCollegeIds.add(cid);
          }
        }

        // OL5 修复：跨课程课时基线同步。
        // effectiveTotal 在 buildTeacherConstraints 时按初始全课程课时算定，此后固定不变，
        // 但每门课优化会在教师间重新分配课时。若不同步，后续课程的容量修正
        //   otherHours = effectiveTotal - 本课课时；cap = 标准/上限课时 - otherHours
        // 会基于陈旧的 effectiveTotal：本轮增课的教师 otherHours 偏低 → cap 偏高 →
        // 被后续课程继续加课直至超课时；本轮减课的教师 otherHours 偏高 → cap 偏低 →
        // 后续课程拿不到课直至欠课时。这正是"部分教师超课时、部分教师欠课时"的根因。
        // 修正：用本课优化前后的课时差增量更新 effectiveTotal，
        // 使下一门课的容量修正基于真实剩余量（standardCap/fullCap 在下轮循环开头据此重算）。
        // P1 修复：去重口径与 courseHoursMap 一致（合班多行只计 1 次），
        // 否则成员班在优化中被换教师时差值重复计算，effectiveTotal 漂移
        const newCourseHoursMap = new Map();
        {
          const seen = new Set();
          for (const a of course.assignments) {
            const combId = a.class?.combination_id;
            const key = combId != null ? `comb:${combId}:${a.teacher_id}` : `cls:${a.class_id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            newCourseHoursMap.set(
              a.teacher_id,
              (newCourseHoursMap.get(a.teacher_id) || 0) + (a.weekly_hours || 0)
            );
          }
        }
        for (const sharedT of qualifiedTeachers) {
          const beforeHours = courseHoursMap.get(sharedT.id) || 0;
          const afterHours = newCourseHoursMap.get(sharedT.id) || 0;
          if (beforeHours !== afterHours) {
            sharedT.effectiveTotal += afterHours - beforeHours;
          }
        }
      } catch (tsErr) {
        logger.warn(`[Optimize] 课程${courseId}优化异常，已跳过: ${tsErr.message}`);
      }
    }

    progress('validate', '正在验证优化结果...', 80);

    // 11. 构建优化后的全局排课方案（course.assignments 已写回优化后的教师，
    // 保留原始行结构以便 dedupeTeachingUnits 读取 class.combination_id）
    const optimizedAssignments = [];
    for (const course of courseMap.values()) {
      for (const a of course.assignments) {
        optimizedAssignments.push(a);
      }
    }

    // 12. 计算优化后指标（合班课时去重后按教学单元统计）
    const afterUnits = dedupeTeachingUnits(optimizedAssignments);
    const afterMetrics = calculateMetrics(
      afterUnits,
      teacherConstraints,
      globalClassMap,
      mode,
      courseTextbookMap,
      baselineHoursByTeacher
    );

    // 13. 构建变更详情（先于阈值判定，changesCount 需基于真实变更数）
    // Schema 对齐修复：courseId 取自 original.course_id（非 original.course_classes.course_id）
    // 匹配同时校验 class_id + course_id，避免跨课程误配（teaching_assignments 唯一约束为 [class_id, course_id, semester]）
    // P3 修复：构建 teacherId → name 的 Map，避免 O(T) 线性查找
    const teacherNameMap = new Map(teachers.map((t) => [t.id, t.name]));
    // OP2 修复：按 (class_id, course_id) 建索引，替代嵌套 find 的 O(N²) 查找
    const optimizedByKey = new Map(
      optimizedAssignments.map((a) => [`${a.class_id}:${a.course_id}`, a])
    );
    const changes = [];
    for (const original of optimizableAssignments) {
      const optimized = optimizedByKey.get(`${original.class_id}:${original.course_id}`);
      if (optimized && optimized.teacher_id !== original.teacher_id) {
        const clsInfo = globalClassMap.get(original.class_id);
        changes.push({
          classId: original.class_id,
          courseId: original.course_id,
          className: clsInfo?.className || original.class?.name || `班级${original.class_id}`,
          fromTeacher: {
            id: original.teacher_id,
            name: original.teacher.name,
          },
          toTeacher: {
            id: optimized.teacher_id,
            name: teacherNameMap.get(optimized.teacher_id) || '未知',
          },
        });
      }
    }
    afterMetrics.changesCount = changes.length;

    // 14. 计算改进幅度
    const improvements = {
      scoreImprovement:
        beforeMetrics.score !== 0
          ? Math.round(
              ((afterMetrics.score - beforeMetrics.score) / Math.abs(beforeMetrics.score)) * 10000
            ) / 100
          : 0,
      loadVarianceImprovement:
        beforeMetrics.loadVariance > 0
          ? Math.round(
              ((beforeMetrics.loadVariance - afterMetrics.loadVariance) /
                beforeMetrics.loadVariance) *
                10000
            ) / 100
          : 0,
      cohesionImprovement:
        beforeMetrics.textbookCohesionRate > 0
          ? Math.round(
              ((afterMetrics.textbookCohesionRate - beforeMetrics.textbookCohesionRate) /
                beforeMetrics.textbookCohesionRate) *
                10000
            ) / 100
          : 0,
    };

    // 15. 检查是否满足最小改进阈值
    const meetsThreshold = meetsMinimumThreshold(beforeMetrics, afterMetrics);

    progress('complete', '优化分析完成', 100);

    return {
      semesterId,
      mode,
      before: beforeMetrics,
      after: afterMetrics,
      improvements,
      meetsThreshold,
      changes,
      courseResults,
      summary: {
        totalClasses: optimizableAssignments.length,
        changedClasses: changes.length,
        affectedTeachers: teacherConstraints.length,
        affectedCourses: courseMap.size,
        improvedCourses,
        totalIterations,
      },
    };
  } catch (error) {
    logger.error('排课优化失败:', error);
    throw error;
  } finally {
    await releaseLock(dbLockKey);
  }
}

/**
 * 应用前校验（P2 修复：TOCTOU 防护）
 * 预览与应用之间排课数据可能已变动，仅靠 updateMany 的 from_teacher 匹配兜底
 * 无法防止"数据变动后变更仍部分生效并破坏硬约束"。此处基于当前数据库状态
 * 内存重放全部变更，校验合班一致性 / 教师容量 / 教材硬上限。
 * 只拦截"应用变更后新产生或恶化"的违例，预存违例不阻断修复型变更：
 * - 容量：应用后超上限 且 比应用前更满（数值更高）才拦截
 * - 教材：应用后超上限 且 数量比应用前更多才拦截
 * - 合班：应用前一致、应用后不一致的组合才拦截
 * @param {string} semesterStr - 学期标识
 * @param {Array} changes - 变更列表（snake_case：class_id/course_id/from_teacher/to_teacher）
 * @param {string} mode - 排课模式（standard/full），决定容量口径
 * @returns {Promise<string[]>} 违例描述列表（空数组 = 通过）
 */
async function validateApplyChanges(semesterStr, changes, mode) {
  const courseIds = [...new Set(changes.map((c) => Number(c.course_id)).filter(Number.isFinite))];
  const teacherIds = [
    ...new Set(changes.flatMap((c) => [Number(c.from_teacher?.id), Number(c.to_teacher?.id)])),
  ].filter(Number.isFinite);
  if (courseIds.length === 0 || teacherIds.length === 0) return [];

  // 1. 加载受影响课程与受影响教师的当前排课（含合班组合信息）
  const rows =
    (await prisma.teaching_assignments.findMany({
      where: {
        semester: semesterStr,
        OR: [{ course_id: { in: courseIds } }, { teacher_id: { in: teacherIds } }],
      },
      select: {
        teacher_id: true,
        class_id: true,
        course_id: true,
        weekly_hours: true,
        class: { select: { id: true, combination_id: true } },
      },
    })) || [];

  // 2. 内存重放变更 → after 状态（from_teacher 不匹配的行保持原教师，与 updateMany 行为一致）
  const changeByClassCourse = new Map();
  for (const c of changes) {
    changeByClassCourse.set(`${c.class_id}:${c.course_id}`, c);
  }
  const afterRows = rows.map((r) => {
    const c = changeByClassCourse.get(`${r.class_id}:${r.course_id}`);
    if (c && r.teacher_id === Number(c.from_teacher?.id)) {
      return { ...r, teacher_id: Number(c.to_teacher?.id) };
    }
    return r;
  });

  const violations = [];

  // 3. 合班一致性：同一 (course, combination) 的成员班必须同教师
  const collectCombTeachers = (list) => {
    const m = new Map();
    for (const r of list) {
      const combId = r.class?.combination_id;
      if (combId == null) continue;
      const key = `${r.course_id}:${combId}`;
      if (!m.has(key)) m.set(key, new Set());
      m.get(key).add(r.teacher_id);
    }
    return m;
  };
  const combBefore = collectCombTeachers(rows);
  const combAfter = collectCombTeachers(afterRows);
  for (const [key, teachers] of combAfter) {
    if (teachers.size > 1 && (combBefore.get(key)?.size ?? 0) <= 1) {
      const [cidStr, combIdStr] = key.split(':');
      violations.push(`合班被拆散：课程#${cidStr} 组合#${combIdStr} 将出现 ${teachers.size} 位教师`);
    }
  }

  // 4. 教师容量：应用后总课时（合班去重）不得超过容量上限，且不得比应用前更满
  const teachers =
    (await prisma.teachers.findMany({
      where: { id: { in: teacherIds } },
      select: {
        id: true,
        name: true,
        personnel_type: true,
        default_weekly_hours: true,
        single_textbook_only: true,
      },
    })) || [];

  let hourSettings = DEFAULT_HOUR_SETTINGS;
  try {
    const globalSettings = await prisma.system_settings.findUnique({
      where: { key: HOUR_SETTINGS_PREFIX },
    });
    if (globalSettings?.value) {
      hourSettings = JSON.parse(globalSettings.value) || DEFAULT_HOUR_SETTINGS;
    }
  } catch (_) {
    hourSettings = DEFAULT_HOUR_SETTINGS;
  }

  const hoursByTeacher = (list) => {
    const m = new Map();
    const seen = new Set();
    for (const r of list) {
      const combId = r.class?.combination_id;
      const key =
        combId != null
          ? `comb:${combId}:${r.course_id}:${r.teacher_id}`
          : `${r.class_id}:${r.course_id}:${r.teacher_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      m.set(r.teacher_id, (m.get(r.teacher_id) || 0) + (r.weekly_hours || 0));
    }
    return m;
  };
  const beforeHours = hoursByTeacher(rows);
  const afterHours = hoursByTeacher(afterRows);

  for (const t of teachers) {
    const setting =
      hourSettings?.[t.personnel_type || 'full_time'] ||
      hourSettings?.full_time ||
      DEFAULT_HOUR_SETTINGS.full_time;
    const cap =
      t.default_weekly_hours != null
        ? t.default_weekly_hours
        : mode === 'standard'
          ? setting.standard
          : setting.max;
    const after = afterHours.get(t.id) || 0;
    const before = beforeHours.get(t.id) || 0;
    if (cap > 0 && after > cap && after > before) {
      violations.push(
        `教师「${t.name || t.id}」应用后周课时 ${after}h 将超过容量上限 ${cap}h`
      );
    }
  }

  // 5. 教材硬上限：按 (course, class) 推导教师应用后教材集合
  const courseIdsInRows = [...new Set(afterRows.map((r) => Number(r.course_id)))];
  const courseTextbookMap = new Map();
  for (const cid of courseIdsInRows) {
    const classTbMap = new Map();
    try {
      const courseClasses = (await getClassesWithCourse(cid, semesterStr)) || [];
      for (const c of courseClasses) {
        classTbMap.set(c.classId, (c.textbooks || []).map((tb) => tb?.id).filter(Boolean));
      }
    } catch (_) {
      // 推导失败按无教材处理，不阻塞应用
    }
    courseTextbookMap.set(cid, classTbMap);
  }
  const textbooksByTeacher = (list) => {
    const m = new Map();
    for (const r of list) {
      if (!m.has(r.teacher_id)) m.set(r.teacher_id, new Set());
      for (const tb of courseTextbookMap.get(Number(r.course_id))?.get(r.class_id) || []) {
        m.get(r.teacher_id).add(tb);
      }
    }
    return m;
  };
  const beforeTbs = textbooksByTeacher(rows);
  const afterTbs = textbooksByTeacher(afterRows);
  for (const t of teachers) {
    const maxTb = t.single_textbook_only
      ? 1
      : TEXTBOOK_COHESION.ENABLED
        ? TEXTBOOK_COHESION.MAX_TEXTBOOKS_PER_TEACHER
        : 0;
    if (maxTb <= 0) continue;
    const after = afterTbs.get(t.id)?.size || 0;
    const before = beforeTbs.get(t.id)?.size || 0;
    if (after > maxTb && after > before) {
      violations.push(`教师「${t.name || t.id}」应用后教材数 ${after} 本将超过上限 ${maxTb} 本`);
    }
  }

  return violations;
}

/**
 * 应用优化结果到数据库
 * P1 修复：并发保护（批量排课互斥 + 同学期应用互斥）
 * P2 修复：应用前基于当前数据重放变更并校验硬约束（TOCTOU 防护）
 */
export async function applyOptimizeResult(semesterId, changes, userId, mode = 'standard') {
  const semesterStr = `${semesterId}`;

  if (batchLocks.has(semesterStr)) {
    throw new AppError(`学期 ${semesterStr} 批量排课进行中，请稍后再试`, 409);
  }
  const dbLockKey = `apply-optimize:${semesterStr}`;
  const dbLocked = await acquireLock(dbLockKey);
  if (!dbLocked) {
    throw new AppError('该学期正在应用优化结果，请稍后重试', 409);
  }

  // 应用前校验失败时直接拒绝（AppError 携带违例明细，不会被下方 catch 吞掉）
  let violations;
  try {
    violations = await validateApplyChanges(semesterStr, changes, mode);
  } catch (e) {
    await releaseLock(dbLockKey);
    throw new AppError(`应用前校验失败：${e.message}`, 500);
  }
  if (violations.length > 0) {
    await releaseLock(dbLockKey);
    throw new AppError(`应用优化结果将违反排课约束：${violations.join('；')}`, 409);
  }

  try {
    // 固有班级延续：教师被置换后原延续标记失效，需按上学期快照重算。
    // 开关打开：加载涉及课程的上学期快照，标记"新教师上学期是否教过该班"；
    // 开关关闭：变更行一律清 false（教师已变，且功能未启用不产生新延续）
    let inherentClassMap = null;
    try {
      const icSetting = await prisma.system_settings.findUnique({
        where: { key: 'inherent_class_enabled' },
      });
      const inherentClassEnabled = icSetting?.value === 'true';
      const prevSemester = inherentClassEnabled ? getPreviousSemester(semesterStr) : null;
      if (prevSemester && changes.length > 0) {
        const courseIds = [...new Set(changes.map((c) => Number(c.course_id)))];
        const prevRows = await prisma.teaching_assignments.findMany({
          where: { semester: prevSemester, course_id: { in: courseIds } },
          select: { course_id: true, teacher_id: true, class_id: true },
        });
        inherentClassMap = new Map();
        for (const row of prevRows) {
          if (!inherentClassMap.has(row.course_id)) inherentClassMap.set(row.course_id, new Map());
          const teacherMap = inherentClassMap.get(row.course_id);
          if (!teacherMap.has(row.teacher_id)) teacherMap.set(row.teacher_id, new Set());
          teacherMap.get(row.teacher_id).add(row.class_id);
        }
      }
    } catch (_) {
      inherentClassMap = null; // 快照加载失败降级：变更行统一清除标记
    }

    // OL4 修复：累计 updateMany 实际更新数。预览与应用之间数据被改动
    // （教师已变、记录被锁定/删除）时 where 匹配不到会静默 0 更新，
    // 需向调用方如实反馈实际应用数而非请求数
    let appliedCount = 0;
    await prisma.$transaction(async (tx) => {
      for (const change of changes) {
        // Schema 对齐修复：teaching_assignments 用 semester（非 semester_id）
        // where 同时匹配 class_id + course_id + semester，对齐唯一约束
        // 注意：全局 convertRequestNaming 中间件已将请求体 camelCase → snake_case，
        // 故此处用 class_id / course_id / from_teacher / to_teacher
        const stillInherent = !!inherentClassMap
          ?.get(Number(change.course_id))
          ?.get(change.to_teacher.id)
          ?.has(change.class_id);
        const res = await tx.teaching_assignments.updateMany({
          where: {
            semester: semesterStr,
            class_id: change.class_id,
            course_id: change.course_id,
            teacher_id: change.from_teacher.id,
            is_locked: false,
          },
          data: {
            teacher_id: change.to_teacher.id,
            is_inherent: stillInherent,
            updated_at: new Date(),
          },
        });
        appliedCount += res?.count || 0;
      }
    });

    if (appliedCount !== changes.length) {
      logger.warn(
        `[Optimize] 应用优化结果不完整：请求${changes.length}项变更，实际更新${appliedCount}条（预览后排课数据可能已变动）`
      );
    }

    await createAuditLog({
      userId,
      action: 'update',
      module: 'teachingArrange',
      details: { semester: semesterStr, changesCount: changes.length, appliedCount },
      result: 'success',
      message: `应用排课优化结果，变更${appliedCount}个班级的教师分配`,
    }).catch(() => {});

    logger.info(`[Optimize] 已应用优化结果，变更${appliedCount}/${changes.length}个班级`);

    return {
      success: true,
      appliedChanges: appliedCount,
      requestedChanges: changes.length,
    };
  } catch (error) {
    logger.error('应用优化结果失败:', error);
    throw new Error('应用优化结果失败', { cause: error });
  } finally {
    await releaseLock(dbLockKey);
  }
}
