/**
 * 排课优化服务 - 跨课程全局禁忌搜索优化
 * 对当前学期所有已排课的教师进行全局优化，提升排课质量
 */

import { prisma } from '../../lib/prisma.js';
import logger from '../../utils/logger.js';
import {
  DEFAULT_HOUR_SETTINGS,
  HOUR_SETTINGS_PREFIX,
  TABU_SEARCH,
  INHERENT_CLASS,
} from '../../constants/index.js';
import { tabuOptimize } from './tabu-search.js';
import { calcMatchScore } from './auto-arrange.js';
import { getClassesWithCourse } from './queries.js';
import { createAuditLog } from '../../services/audit.service.js';
import { getPreviousSemester } from '../semester.service.js';

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
 */
function calculateMetrics(allAssignments, teacherConstraints, classMap, mode) {
  const teacherMap = new Map(teacherConstraints.map((t) => [t.id, t]));

  // 1. 计算教师负载状态
  const teacherStates = new Map();
  for (const t of teacherConstraints) {
    teacherStates.set(t.id, {
      assignedHours: 0,
      textbooks: new Set(),
      colleges: new Set(),
      classes: [],
    });
  }

  // 计算总匹配分数
  let totalMatchScore = 0;
  let matchCount = 0;

  for (const a of allAssignments) {
    const state = teacherStates.get(a.teacher_id);
    const cls = classMap.get(a.class_id);
    if (state) {
      state.assignedHours += a.weekly_hours || 0;
      state.classes.push(a.class_id);
      if (cls) {
        for (const tid of cls.textbookIds || []) state.textbooks.add(tid);
        if (cls.collegeId != null) state.colleges.add(cls.collegeId);
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

  // 2. 计算负载均衡度
  const loadRates = [];
  for (const t of teacherConstraints) {
    const state = teacherStates.get(t.id);
    if (!state) continue;
    const cap = mode === 'standard' ? t.standardCap : t.fullCap;
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
  for (const [tid, state] of teacherStates) {
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

  // 欠分配惩罚：每位教师低于 cap 的课时缺口 × α
  let underAssignmentPenalty = 0;
  for (const t of teacherConstraints) {
    const state = teacherStates.get(t.id);
    if (!state) continue;
    const cap = mode === 'standard' ? t.standardCap : t.fullCap;
    if (cap > 0) {
      const gap = Math.max(0, cap - state.assignedHours);
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
    totalAssignments: allAssignments.length,
    affectedTeachers: teacherConstraints.length,
  };
}

/**
 * 构建教师约束对象 - 与 auto-arrange.js 的 buildTeacherConstraints 对齐
 * 确保包含 calcMatchScore、canAccept、buildTeacherStates 所需的全部字段
 * @param {Array} allAssignments - 可优化记录 + 基线记录（手动/锁定），基线仅参与约束统计
 * @param {Map} courseTextbookMap - courseId → Map(classId → textbookIds[])
 * @param {object} hourSettings - 课时配置（系统设置优先，回退 DEFAULT_HOUR_SETTINGS）
 */
function buildTeacherConstraints(teachers, allAssignments, courseTextbookMap, hourSettings) {
  // 构建教师现有分配统计
  const teacherHoursMap = new Map();
  const teacherTextbookMap = new Map();
  const teacherCollegeMap = new Map();

  for (const a of allAssignments) {
    const tid = a.teacher_id;
    teacherHoursMap.set(tid, (teacherHoursMap.get(tid) || 0) + (a.weekly_hours || 0));

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
    const teacherHourCap =
      t.default_weekly_hours != null ? Math.max(0, t.default_weekly_hours - existingHours) : null;
    const rawStandardCap =
      teacherHourCap != null
        ? Math.min(teacherHourCap, Math.max(0, setting.standard - existingHours))
        : Math.max(0, setting.standard - existingHours);
    const rawFullCap =
      teacherHourCap != null
        ? Math.min(teacherHourCap, Math.max(0, setting.max - existingHours))
        : Math.max(0, setting.max - existingHours);

    const standardCap = Math.floor(rawStandardCap);
    const fullCap = Math.floor(rawFullCap);

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
  const progress = (phase, message, percent) => {
    if (onProgress) {
      onProgress({ phase, message, percent });
    }
    logger.info(`[Optimize] ${message}`);
  };

  const semesterStr = `${semesterId}`;

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
        class: { select: { id: true, college_id: true } },
      },
    });

    // 4. 加载教师完整信息（含 scheduling_colleges、scheduling_levels、courses）
    // Schema 对齐修复：teachers 模型无 teacher_textbook_preferences 关系
    // courses 用于按课程筛选合格教师，防止 tabuOptimize 跨学科变更
    const teachers = await prisma.teachers.findMany({
      where: { id: { in: [...allTeacherIds] } },
      include: {
        scheduling_colleges: { select: { college_id: true } },
        scheduling_levels: {
          include: { training_level: { select: { id: true, name: true } } },
        },
        courses: { select: { course_id: true } },
      },
    });

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

    // 6. 构建全局班级映射（含 textbookIds 数组）
    // Schema 对齐修复：class_name → name，weekly_hours 取自 assignments，textbookIds 取自 courseTextbookMap
    const globalClassMap = new Map();
    for (const a of currentAssignments) {
      if (globalClassMap.has(a.class_id)) continue;
      const cls = a.class;
      const tbIds = courseTextbookMap.get(a.course_id)?.get(a.class_id) || [];
      globalClassMap.set(a.class_id, {
        classId: a.class_id,
        className: cls?.name || `班级${a.class_id}`,
        weeklyHours: a.weekly_hours || 0,
        textbookIds: tbIds,
        collegeId: cls?.college_id,
        trainingLevelId: cls?.training_level_id,
      });
    }

    // 7. 构建全局教师约束（含完整字段；OL1：基线记录一并计入约束统计）
    const teacherConstraints = buildTeacherConstraints(
      teachers,
      [...currentAssignments, ...baselineAssignments],
      courseTextbookMap,
      hourSettings
    );

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

    // 8. 计算优化前指标（使用 calcMatchScore）
    const beforeMetrics = calculateMetrics(
      currentAssignments.map((a) => ({
        teacher_id: a.teacher_id,
        class_id: a.class_id,
        weekly_hours: a.weekly_hours || 0,
      })),
      teacherConstraints,
      globalClassMap,
      mode
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

      // 构建该课程的班级映射
      const classMap = new Map();
      for (const classId of course.classIds) {
        const cls = globalClassMap.get(classId);
        if (cls) classMap.set(classId, cls);
      }

      // 构建该课程的 assignments 数组
      const courseAssignments = course.assignments.map((a) => ({
        teacher_id: a.teacher_id,
        teacher_name: a.teacher.name,
        class_id: a.class_id,
        class_name: a.class?.name || `班级${a.class_id}`,
        course_id: Number(courseId),
        semester: semesterStr,
        weekly_hours: a.weekly_hours || 0,
        is_auto: true,
        memberClassIds: null,
      }));

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
      const courseHoursMap = new Map();
      for (const a of courseAssignments) {
        courseHoursMap.set(
          a.teacher_id,
          (courseHoursMap.get(a.teacher_id) || 0) + (a.weekly_hours || 0)
        );
      }
      for (const t of courseTeacherConstraints) {
        const courseHours = courseHoursMap.get(t.id) || 0;
        const otherHours = t.effectiveTotal - courseHours;
        // OL6 修复：与 buildTeacherConstraints 口径一致，教师个人周课时上限
        // （default_weekly_hours）必须 min() 折入 standardCap/fullCap。
        // canAccept 只检查这两个 cap，不看 teacherHourCap，原实现重算时丢失折算，
        // 导致个人上限低于全局标准/上限的教师被加课超出个人约束
        t.teacherHourCap =
          t.defaultWeeklyHours != null ? Math.max(0, t.defaultWeeklyHours - otherHours) : null;
        const personalRemain = t.teacherHourCap != null ? t.teacherHourCap : Infinity;
        t.standardCap = Math.max(
          0,
          Math.floor(Math.min(t.standardHours - otherHours, personalRemain))
        );
        t.fullCap = Math.max(0, Math.floor(Math.min(t.maxHours - otherHours, personalRemain)));
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
        const optimizedTeacherByClass = new Map(
          courseAssignments.map((a) => [a.class_id, a.teacher_id])
        );
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
        const newCourseHoursMap = new Map();
        for (const a of course.assignments) {
          newCourseHoursMap.set(
            a.teacher_id,
            (newCourseHoursMap.get(a.teacher_id) || 0) + (a.weekly_hours || 0)
          );
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

    // 11. 构建优化后的全局排课方案
    const optimizedAssignments = [];
    for (const course of courseMap.values()) {
      for (const a of course.assignments) {
        optimizedAssignments.push({
          teacher_id: a.teacher_id,
          class_id: a.class_id,
          course_id: a.course_id,
          weekly_hours: a.weekly_hours || 0,
        });
      }
    }

    // 12. 计算优化后指标
    const afterMetrics = calculateMetrics(
      optimizedAssignments,
      teacherConstraints,
      globalClassMap,
      mode
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
    for (const original of currentAssignments) {
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
        totalClasses: currentAssignments.length,
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
  }
}

/**
 * 应用优化结果到数据库
 */
export async function applyOptimizeResult(semesterId, changes, userId) {
  const semesterStr = `${semesterId}`;
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
  }
}
