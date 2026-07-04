import { prisma } from '../../lib/prisma.js';
import {
  DEFAULT_HOUR_SETTINGS,
  WORKLOAD_BALANCE,
  TEXTBOOK_COHESION,
} from '../../constants/index.js';
import logger from '../../utils/logger.js';
import { validateHourSettings } from './validate.js';
import {
  getClassesWithCourse,
  getTeachersForCourse,
  isTextbookMatch,
  isCollegeEligible,
  isLevelEligible,
} from './queries.js';

// C-2: 并发锁，防止同一课程被并发排课
// S-09 注意：此锁为进程内存级别，仅适用于单进程部署（如 PM2 fork 模式）。
// 若切换为 PM2 cluster 模式或负载均衡多实例部署，需改用 Redis 分布式锁或数据库行级锁。
const arrangeLocks = new Set();

// M-12 / P1-12: 批量排课并发锁（按学期维度），防止单课程排课与批量排课并发
// 批量进行中，对同 semester 的单课程 autoArrange 调用直接拒绝，
// 避免该课程的 arrangeLock 阻止批量到达时被 catch 吞掉、静默跳过
// S-09 注意：进程内存级别，仅适用于单进程部署。多实例部署需改用分布式锁。
export const batchLocks = new Set();

/**
 * 计算教师-班级匹配分数（优先级 + 教材内聚）
 * 权重由 TEXTBOOK_COHESION 配置：
 *   学院匹配 +COLLEGE_WEIGHT, 层次匹配 +LEVEL_WEIGHT,
 *   本轮已分配教材 +ASSIGNED_WEIGHT, 固有教材 +INHERENT_WEIGHT,
 *   新增教材惩罚 -PENALTY_PER_NEW × N（修复3，强制内聚）
 */
function calcMatchScore(teacher, classInfo) {
  let score = 0;

  const cw = TEXTBOOK_COHESION.COLLEGE_WEIGHT;
  const lw = TEXTBOOK_COHESION.LEVEL_WEIGHT;
  const aw = TEXTBOOK_COHESION.ASSIGNED_WEIGHT;
  const iw = TEXTBOOK_COHESION.INHERENT_WEIGHT;
  const penalty = TEXTBOOK_COHESION.PENALTY_PER_NEW;

  if (teacher.schedulingCollegeIds && teacher.schedulingCollegeIds.length > 0) {
    if (teacher.schedulingCollegeIds.includes(classInfo.collegeId)) {
      score += cw;
    }
  }

  // 同学院内聚奖励：教师已接过该学院班级，优先再接同学院班级
  if (teacher.assignedCollegeIds && teacher.assignedCollegeIds.has(classInfo.collegeId)) {
    score += 3;
  }

  if (teacher.schedulingLevelIds && teacher.schedulingLevelIds.length > 0) {
    if (
      classInfo.trainingLevelId &&
      teacher.schedulingLevelIds.includes(classInfo.trainingLevelId)
    ) {
      score += lw;
    }
  }

  if (classInfo.textbookIds && classInfo.textbookIds.length > 0 && teacher.assignedTextbookIds) {
    const hasAssigned = classInfo.textbookIds.some((tid) => teacher.assignedTextbookIds.has(tid));
    if (hasAssigned) {
      score += aw;
    }
  }

  if (isTextbookMatch(teacher, classInfo)) {
    score += iw;
  }

  // 修复3：教材内聚惩罚
  // 教师接此班级需新增 N 本教材时，每本扣 PENALTY_PER_NEW 分
  // 使"零新增教材"的候选教师在评分上优先
  if (
    TEXTBOOK_COHESION.ENABLED &&
    penalty > 0 &&
    classInfo.textbookIds &&
    classInfo.textbookIds.length > 0 &&
    teacher.assignedTextbookIds
  ) {
    const newTextbookCount = classInfo.textbookIds.filter(
      (tid) => !teacher.assignedTextbookIds.has(tid)
    ).length;
    score -= newTextbookCount * penalty;
  }

  // 二轮优化：教材数量分级奖惩，根治 +6 雪球效应
  // B-04修复：增加 maxTb > 0 守卫，MAX_TEXTBOOKS=0 时不执行惩罚逻辑
  const maxTb = TEXTBOOK_COHESION.MAX_TEXTBOOKS_PER_TEACHER || 2;
  if (TEXTBOOK_COHESION.ENABLED && maxTb > 0) {
    const tbCount = teacher.assignedTextbookIds?.size ?? 0;

    if (tbCount >= maxTb) {
      if (classInfo.textbookIds && classInfo.textbookIds.length > 0) {
        const newCount = classInfo.textbookIds.filter(
          (tid) => !teacher.assignedTextbookIds.has(tid)
        ).length;
        if (newCount > 0) {
          return score - 10000;
        }
      }
    } else if (tbCount === 0) {
      score += TEXTBOOK_COHESION.ZERO_TEXTBOOK_BONUS;
    } else if (tbCount === 1 && classInfo.textbookIds?.length > 0) {
      const newCount = classInfo.textbookIds.filter(
        (tid) => !teacher.assignedTextbookIds.has(tid)
      ).length;
      if (newCount === 0) {
        score += 10;
      } else {
        return score - 10000;
      }
      // 注意：以下分支依赖 maxTb 的值。当前 MAX_TEXTBOOKS_PER_TEACHER=2 时，
      // tbCount >= maxTb（即 >=2）已在上方捕获，下方 tbCount>=3 / >=2 分支不可达。
      // 若将 MAX_TEXTBOOKS_PER_TEACHER 调高至 3+，这些分支将生效，
      // 实现分级惩罚：2 本扣 TEXTBOOK_COUNT_PENALTY_2，3+ 本扣 TEXTBOOK_COUNT_PENALTY_3PLUS。
    } else if (tbCount >= 3) {
      score -= TEXTBOOK_COHESION.TEXTBOOK_COUNT_PENALTY_3PLUS;
    } else if (tbCount >= 2) {
      score -= TEXTBOOK_COHESION.TEXTBOOK_COUNT_PENALTY_2;
    }
  }

  return score;
}

function isTeacherEligible(t, cls, mode) {
  const cap = mode === 'standard' ? t.standardCap : t.fullCap;
  // 全局容量检查（已包含 defaultWeeklyHours 天花板）
  if (t.assignedHours + cls.weeklyHours > cap) return false;
  if (
    t.schedulingCollegeIds &&
    t.schedulingCollegeIds.length > 0 &&
    !t.schedulingCollegeIds.includes(cls.collegeId)
  ) {
    return false;
  }
  if (
    t.schedulingLevelIds &&
    t.schedulingLevelIds.length > 0 &&
    cls.trainingLevelId &&
    !t.schedulingLevelIds.includes(cls.trainingLevelId)
  ) {
    return false;
  }
  // B-03修复：与isLevelEligible保持一致，班级无trainingLevelId时不允许有层次约束的教师
  if (!cls.trainingLevelId && t.schedulingLevelIds && t.schedulingLevelIds.length > 0) {
    return false;
  }
  // 二轮优化：教材硬上限检查
  // 教师已有教材数 + 接此班新增教材数 > MAX → 不可选
  const maxTb = TEXTBOOK_COHESION.MAX_TEXTBOOKS_PER_TEACHER;
  if (TEXTBOOK_COHESION.ENABLED && maxTb > 0 && cls.textbookIds?.length > 0) {
    const newTbCount = cls.textbookIds.filter((tid) => !t.assignedTextbookIds.has(tid)).length;
    if (t.assignedTextbookIds.size + newTbCount > maxTb) return false;
  }
  return true;
}

function buildTeacherConstraints(
  teachers,
  hourSettings,
  autoHoursMap,
  mode,
  extraTeacherHours = null
) {
  return teachers.map((t) => {
    const personnelType = t.personnelType || 'full_time';
    const setting =
      hourSettings[personnelType] ||
      DEFAULT_HOUR_SETTINGS[personnelType] ||
      DEFAULT_HOUR_SETTINGS.full_time;
    const autoHoursForCourse = autoHoursMap.get(t.id) || 0;
    // 批量预览时叠加前序课程的虚拟分配课时，保证容量计算累积（H-11 修复）
    const extraHours = extraTeacherHours?.get(t.id) || 0;
    const effectiveTotal = t.totalWeeklyHours - autoHoursForCourse + extraHours;
    const courseExistingHours = t.courseHours - autoHoursForCourse;

    // 教师特定周课时上限：覆盖系统课时设置，标准/最大模式均以此为天花板
    const teacherHourCap =
      t.defaultWeeklyHours != null ? Math.max(0, t.defaultWeeklyHours - effectiveTotal) : null;

    return {
      ...t,
      standardHours: setting.standard,
      maxHours: setting.max,
      effectiveTotal,
      courseExistingHours,
      standardCap:
        teacherHourCap != null
          ? Math.min(teacherHourCap, Math.max(0, setting.standard - effectiveTotal))
          : Math.max(0, setting.standard - effectiveTotal),
      fullCap:
        teacherHourCap != null
          ? Math.min(teacherHourCap, Math.max(0, setting.max - effectiveTotal))
          : Math.max(0, setting.max - effectiveTotal),
      teacherHourCap,
      assignedHours: 0,
      // P1-A 修复：固化固有教材快照，运行时累加不污染匹配判断
      inherentTextbookIds: [...(t.textbookIds || [])],
    };
  });
}

function diagnoseFailure(cls, teacherConstraints, mode) {
  const allTeachers = teacherConstraints;
  if (allTeachers.length === 0) {
    return { reason: '没有可教此课程的教师', details: null };
  }

  const capFullTeachers = allTeachers.filter((t) => {
    const cap = mode === 'standard' ? t.standardCap : t.fullCap;
    return t.assignedHours + cls.weeklyHours > cap;
  });

  if (capFullTeachers.length === allTeachers.length) {
    return {
      reason: '所有候选教师课时容量已满',
      details: capFullTeachers.slice(0, 5).map((t) => ({
        teacherName: t.name,
        assignedHours: t.effectiveTotal + t.assignedHours,
        cap: mode === 'standard' ? t.standardHours : t.maxHours,
      })),
    };
  }

  // P1-11 修复：defaultWeeklyHours 语义统一为"教师总周课时上限"（与 buildTeacherConstraints 一致）
  // buildTeacherConstraints 用 effectiveTotal = totalWeeklyHours - autoHoursForCourse + extraHours（全学期）
  // 此处诊断：教师本学期总周课时 + 本课程新增课时 > defaultWeeklyHours
  // 原逻辑误用 courseExistingHours（仅本课程），与 buildTeacherConstraints 语义不一致，会误导运维
  const totalHourCapTeachers = allTeachers.filter(
    (t) =>
      t.defaultWeeklyHours != null &&
      t.effectiveTotal + t.assignedHours + cls.weeklyHours > t.defaultWeeklyHours
  );

  if (totalHourCapTeachers.length === allTeachers.length) {
    return {
      reason: '所有候选教师总周课时已达上限',
      details: totalHourCapTeachers.slice(0, 5).map((t) => ({
        teacherName: t.name,
        totalHours: t.effectiveTotal + t.assignedHours,
        limit: t.defaultWeeklyHours,
      })),
    };
  }

  // P1-2 修复（P2-4）：教材上限诊断
  // 所有教师已达教材硬上限且无法接纳新教材时，给出明确诊断
  const diagMaxTb = TEXTBOOK_COHESION.MAX_TEXTBOOKS_PER_TEACHER;
  if (TEXTBOOK_COHESION.ENABLED && diagMaxTb > 0 && cls.textbookIds?.length > 0) {
    const textbookFullTeachers = allTeachers.filter((t) => {
      if (!t.assignedTextbookIds) return false;
      const newTbCount = cls.textbookIds.filter((tid) => !t.assignedTextbookIds.has(tid)).length;
      return t.assignedTextbookIds.size + newTbCount > diagMaxTb;
    });
    if (textbookFullTeachers.length === allTeachers.length) {
      return {
        reason: '所有候选教师教材上限已满',
        details: textbookFullTeachers.slice(0, 5).map((t) => ({
          teacherName: t.name,
          textbookCount: t.assignedTextbookIds.size,
          max: diagMaxTb,
        })),
      };
    }
  }

  const eligibleTeachers = allTeachers.filter((t) => isTeacherEligible(t, cls, mode));
  if (eligibleTeachers.length > 0) {
    const afterCapacity = eligibleTeachers.filter((t) => {
      const cap = mode === 'standard' ? t.standardCap : t.fullCap;
      return t.assignedHours + cls.weeklyHours <= cap;
    });
    if (afterCapacity.length === 0) {
      return {
        reason: '有资格的教师课时容量已满',
        details: eligibleTeachers.slice(0, 5).map((t) => ({
          teacherName: t.name,
          assignedHours: t.effectiveTotal + t.assignedHours,
          cap: mode === 'standard' ? t.standardHours : t.maxHours,
        })),
      };
    }
  }

  return {
    reason: '无匹配的教师（学院/层次偏好筛选后无候选）',
    details: {
      totalTeachers: allTeachers.length,
      collegeMatchCount: allTeachers.filter((t) => t.schedulingCollegeIds?.includes(cls.collegeId))
        .length,
      levelMatchCount: allTeachers.filter((t) =>
        t.schedulingLevelIds?.includes(cls.trainingLevelId)
      ).length,
      textbookMatchCount: allTeachers.filter((t) => isTextbookMatch(t, cls)).length,
    },
  };
}

/**
 * 选择最佳教师（综合评分制）
 * 综合考虑：优先级分数（高优）+ 负载率（低优）
 * @param {Array} candidates - 候选教师数组，每个元素含 { teacher, score, loadRate, cls }
 * @returns {object} 排序后的最优候选
 */
function selectBestTeacher(candidates) {
  const sorted = [...candidates].sort((a, b) => {
    // 1. 分数差异大于阈值，按分数降序
    if (Math.abs(b.score - a.score) >= WORKLOAD_BALANCE.SCORE_THRESHOLD) {
      return b.score - a.score;
    }
    // 2. 负载率差异大于阈值，按负载率升序（低负载优先）
    if (Math.abs(a.loadRate - b.loadRate) > WORKLOAD_BALANCE.LOAD_RATE_THRESHOLD) {
      return a.loadRate - b.loadRate;
    }
    // 3. 综合排序：分数降序 > 负载率升序
    return b.score - a.score || a.loadRate - b.loadRate;
  });

  return sorted[0];
}

/**
 * 单次遍历计算所有匹配率（学院/教材/层次）+ 教材内聚度统计（修复4）
 */
function calcAllMatchRates(assignments, classes, teacherMap) {
  const classMap = new Map(classes.map((c) => [c.classId, c]));
  let collegeMatched = 0;
  let textbookMatched = 0;
  let levelMatched = 0;

  // 内聚度统计所需数据
  const teacherTextbookSet = new Map(); // teacherId → Set<textbookId>
  const teacherClassCount = new Map(); // teacherId → 班级数

  for (const a of assignments) {
    const teacher = teacherMap.get(a.teacher_id);
    const cls = classMap.get(a.class_id);
    if (!teacher || !cls) continue;

    if (teacher.schedulingCollegeIds?.includes(cls.collegeId)) collegeMatched++;
    if (isTextbookMatch(teacher, cls)) textbookMatched++;
    if (teacher.schedulingLevelIds?.includes(cls.trainingLevelId)) levelMatched++;

    // 累积教师教材集合与班级计数
    if (!teacherTextbookSet.has(a.teacher_id)) teacherTextbookSet.set(a.teacher_id, new Set());
    const tbSet = teacherTextbookSet.get(a.teacher_id);
    for (const tid of cls.textbookIds || []) tbSet.add(tid);
    teacherClassCount.set(a.teacher_id, (teacherClassCount.get(a.teacher_id) || 0) + 1);
  }

  const total = assignments.length || 1;

  // 内聚度计算：每位教师 cohesion = 1 - (教材数 - 1) / 班级数，clamp [0,1]
  // 教材数=1 或 班级数=0 时 cohesion=1（最内聚）
  let cohesionSum = 0;
  let teacherCount = 0;
  let totalTextbookCount = 0;
  let scatteredCount = 0;
  const scatteredThreshold = TEXTBOOK_COHESION.SCATTERED_THRESHOLD;
  for (const [tid, tbSet] of teacherTextbookSet) {
    const classCount = teacherClassCount.get(tid) || 1;
    const tbSize = tbSet.size;
    const cohesion = classCount > 0 ? Math.max(0, 1 - (tbSize - 1) / classCount) : 1;
    cohesionSum += cohesion;
    teacherCount++;
    totalTextbookCount += tbSize;
    if (tbSize >= scatteredThreshold) scatteredCount++;
  }

  return {
    collegeMatchRate: Math.round((collegeMatched / total) * 100),
    textbookMatchRate: Math.round((textbookMatched / total) * 100),
    levelMatchRate: Math.round((levelMatched / total) * 100),
    // 修复4：教材内聚度统计
    textbookCohesionRate: teacherCount > 0 ? Math.round((cohesionSum / teacherCount) * 100) : 100,
    avgTextbookPerTeacher: teacherCount > 0 ? +(totalTextbookCount / teacherCount).toFixed(2) : 0,
    scatteredTeacherCount: scatteredCount,
    involvedTeacherCount: teacherCount,
  };
}

function buildResult(
  assignments,
  unassigned,
  classesToAssign,
  manualCount,
  message,
  preview,
  warnings,
  teacherConstraints,
  mode
) {
  const result = {
    assigned: assignments,
    unassigned: unassigned.map((c) => {
      const diagnosis = teacherConstraints
        ? diagnoseFailure(c, teacherConstraints, mode || 'standard')
        : null;
      return {
        classId: c.classId,
        className: c.className,
        weeklyHours: c.weeklyHours,
        reason: diagnosis?.reason || '未知原因',
        details: diagnosis?.details || null,
      };
    }),
    totalClasses: classesToAssign?.length || 0,
    manualCount,
    autoCount: assignments.length,
    unassignedCount: unassigned.length,
    preview: !!preview,
    warnings: warnings || [],
  };

  if (preview && teacherConstraints && assignments.length > 0) {
    const teacherMap = new Map(teacherConstraints.map((t) => [t.id, t]));

    // 预构建教师班级计数，避免 O(T*A) 嵌套
    const classCountByTeacher = new Map();
    for (const a of assignments) {
      classCountByTeacher.set(a.teacher_id, (classCountByTeacher.get(a.teacher_id) || 0) + 1);
    }

    result.statistics = {
      teacherWorkload: teacherConstraints
        .filter((t) => t.assignedHours > 0 || t.effectiveTotal > 0)
        .map((t) => {
          const cap = mode === 'standard' ? t.standardCap : t.fullCap;
          return {
            teacherId: t.id,
            teacherName: t.name,
            personnelType: t.personnelType,
            totalHours: t.effectiveTotal + t.assignedHours,
            newAssignedHours: t.assignedHours,
            cap: cap + t.effectiveTotal,
            loadRate: Math.round(
              ((t.effectiveTotal + t.assignedHours) / Math.max(1, cap + t.effectiveTotal)) * 100
            ),
            classCount: classCountByTeacher.get(t.id) || 0,
          };
        })
        .sort((a, b) => b.totalHours - a.totalHours),

      ...calcAllMatchRates(assignments, classesToAssign, teacherMap),
    };
  }

  if (message) result.message = message;
  return result;
}

/**
 * P2 修复：置换回溯
 * 对未分配班级尝试置换已分配教师，腾出容量接纳未分配班级，提升全局分配率
 * 单轮置换（不递归），复杂度 O(U × T × A)，U=未分配数，T=教师数，A=分配数
 */
function trySwapUnassigned(
  unassigned,
  assignments,
  teacherConstraints,
  mode,
  courseId,
  semesterStr,
  classTextbookMap,
  classInfoMap
) {
  if (!unassigned.length || !assignments.length) return;

  const teacherMap = new Map(teacherConstraints.map((t) => [t.id, t]));
  // 按教师分组已分配记录，便于查找可置换的班级
  const assignmentsByTeacher = new Map();
  for (const a of assignments) {
    if (!assignmentsByTeacher.has(a.teacher_id)) assignmentsByTeacher.set(a.teacher_id, []);
    assignmentsByTeacher.get(a.teacher_id).push(a);
  }

  const stillUnassigned = [];
  for (const u of unassigned) {
    if (
      trySwapOne(
        u,
        assignments,
        assignmentsByTeacher,
        teacherMap,
        teacherConstraints,
        mode,
        courseId,
        semesterStr,
        classTextbookMap,
        classInfoMap
      )
    ) {
      // 置换成功，u 已移入 assignments，不加入 stillUnassigned
    } else {
      stillUnassigned.push(u);
    }
  }

  // 用剩余未分配替换原 unassigned
  unassigned.length = 0;
  unassigned.push(...stillUnassigned);
}

/**
 * 尝试为单个未分配班级 U 执行一次置换
 * @param {Map} classTextbookMap - classId → textbookIds[]
 * @returns {boolean} 是否置换成功
 */
function trySwapOne(
  u,
  assignments,
  assignmentsByTeacher,
  teacherMap,
  teacherConstraints,
  mode,
  courseId,
  semesterStr,
  classTextbookMap,
  classInfoMap
) {
  // P1-10 修复：无效课时班级（weeklyHours <= 0）不参与置换，避免破坏已合理分配
  // 这类班级已被主算法标记为未分配（课时配置异常），置换会塞入 0 课时废记录
  if (!u.weeklyHours || u.weeklyHours <= 0) return false;

  const uHours = u.weeklyHours;
  const maxTb = TEXTBOOK_COHESION.MAX_TEXTBOOKS_PER_TEACHER;

  // 遍历所有教师 T（含已满的），找能教 U 且置换后可容纳的场景
  for (const t of teacherConstraints) {
    // S-02 修复：校验 T 对 U（待分配班级）的学院/层次资格
    if (classInfoMap) {
      const uInfo = classInfoMap.get(u.classId);
      if (uInfo) {
        // L-1 修复：添加可选链守卫，防止 trySwapOne 外部调用传入不完整 teacher 对象时 TypeError
        if (t.schedulingCollegeIds?.length > 0 && !t.schedulingCollegeIds.includes(uInfo.collegeId))
          continue;
        if (
          t.schedulingLevelIds?.length > 0 &&
          uInfo.trainingLevelId &&
          !t.schedulingLevelIds.includes(uInfo.trainingLevelId)
        )
          continue;
      }
    }

    // T 当前已分配的班级记录
    const tAssignments = assignmentsByTeacher.get(t.id) || [];
    if (!tAssignments.length) continue;

    const tCurrentNew = t.assignedHours;

    // 遍历 T 的已分配班级 V，找能被其他教师 T'' 接管的
    for (const vAssign of tAssignments) {
      const vHours = vAssign.weekly_hours;
      const vTextbookIds = classTextbookMap.get(vAssign.class_id) || [];
      const tAfterRemove = tCurrentNew - vHours;
      const tAfterAdd = tAfterRemove + uHours;
      const tCap = mode === 'standard' ? t.standardCap : t.fullCap;
      if (tAfterAdd > tCap) continue;

      let vUniqueToT = []; // 初始化变量，用于存储V独有教材

      // 找接管 V 的教师 T''
      for (const t2 of teacherConstraints) {
        if (t2.id === t.id) continue;
        const t2Cap = mode === 'standard' ? t2.standardCap : t2.fullCap;
        if (t2.assignedHours + vHours > t2Cap) continue;

        // S-02 修复：校验 T2 对 V（被接管班级）的学院/层次资格
        if (classInfoMap) {
          const vInfo = classInfoMap.get(vAssign.class_id);
          if (vInfo) {
            if (
              t2.schedulingCollegeIds.length > 0 &&
              !t2.schedulingCollegeIds.includes(vInfo.collegeId)
            )
              continue;
            if (
              t2.schedulingLevelIds.length > 0 &&
              vInfo.trainingLevelId &&
              !t2.schedulingLevelIds.includes(vInfo.trainingLevelId)
            )
              continue;
          }
        }

        // 修复：教材上限检查（防止置换越狱）
        // 必须计算 V 的教材对 T 是否"独有"（T 的其他班级不再使用），置换后需清理
        if (TEXTBOOK_COHESION.ENABLED && maxTb > 0) {
          // 计算 V 的教材中哪些是 T 独有的（T 的其他分配不再用到）
          vUniqueToT = vTextbookIds.filter((tid) => {
            return !tAssignments.some((a) => {
              if (a === vAssign) return false;
              const aTbs = classTextbookMap.get(a.class_id) || [];
              return aTbs.includes(tid);
            });
          });
          // C-2 修复：先计算 T 移除 V 独有教材后的集合，再基于该集合计算 U 的新增教材
          // 旧代码直接基于移除前集合计算 uNewForT，导致被移除的教材仍被视为"已有"，少算新增
          const tAfterRemoveSet = new Set(t.assignedTextbookIds);
          for (const tid of vUniqueToT) tAfterRemoveSet.delete(tid);
          const uNewForT = (u.textbookIds || []).filter((tid) => !tAfterRemoveSet.has(tid));
          // T 置换后教材数 = 移除后集合大小 + U新增
          const afterSwapTSize = tAfterRemoveSet.size + uNewForT.length;
          if (afterSwapTSize > maxTb) continue;

          // T'' 接管 V 后教材数
          const vNewForT2 = vTextbookIds.filter((tid) => !t2.assignedTextbookIds.has(tid));
          const afterSwapT2Size = t2.assignedTextbookIds.size + vNewForT2.length;
          if (afterSwapT2Size > maxTb) continue;
        }

        // === 执行置换 ===
        // 1. T 减 V、加 U
        t.assignedHours = tAfterAdd;
        // 2. T'' 加 V
        t2.assignedHours += vHours;
        // 3. 更新 assignments：V 的 teacher_id 改为 T''
        vAssign.teacher_id = t2.id;
        vAssign.teacher_name = t2.name;
        // 4. 维护教材追踪：T 不再教 V，清理 V 独有教材；加 U 教材
        for (const tid of vUniqueToT) t.assignedTextbookIds.delete(tid);
        for (const tid of u.textbookIds || []) t.assignedTextbookIds.add(tid);
        for (const tid of vTextbookIds) t2.assignedTextbookIds.add(tid);
        // 5. 维护 assignmentsByTeacher
        assignmentsByTeacher.set(
          t.id,
          tAssignments.filter((a) => a !== vAssign)
        );
        if (!assignmentsByTeacher.has(t2.id)) assignmentsByTeacher.set(t2.id, []);
        assignmentsByTeacher.get(t2.id).push(vAssign);
        // 6. U 移入 assignments
        assignments.push({
          teacher_id: t.id,
          teacher_name: t.name,
          class_id: u.classId,
          class_name: u.className,
          course_id: Number(courseId),
          semester: semesterStr,
          weekly_hours: uHours,
          is_auto: true,
        });
        if (!assignmentsByTeacher.has(t.id)) assignmentsByTeacher.set(t.id, []);
        assignmentsByTeacher.get(t.id).push(assignments[assignments.length - 1]);

        return true;
      }
    }
  }
  return false;
}

/**
 * 自动排课核心算法
 * @param {number} courseId - 课程ID
 * @param {string} semesterStr - 学期字符串
 * @param {string} mode - 'full' | 'standard'
 * @param {object} hourSettings - { full_time: { standard, max }, part_time: { standard, max }, external: { standard, max } }
 * @param {string[]} scheduleConditions - 排课条件（预留扩展）
 * @param {object} [options] - 可选参数
 * @param {boolean} [options.preview=false] - 预览模式（只计算不写库）
 */
export async function autoArrange(
  courseId,
  semesterStr,
  mode,
  hourSettings,
  scheduleConditions,
  options = {}
) {
  const { preview = false, extraTeacherHours = null, globalTextbookMap = null } = options;

  validateHourSettings(hourSettings);

  // P1-12 修复：批量排课进行中拒绝单课程排课
  // 否则该课程的 arrangeLock 会阻止批量到达时被 catch 吞掉、静默跳过
  // 批量内部调用通过 options.skipBatchLockCheck=true 绕过此检查
  if (!options.skipBatchLockCheck && batchLocks.has(semesterStr)) {
    throw new Error(`学期 ${semesterStr} 批量排课进行中，请稍后再试`);
  }

  // C-2: 并发保护——同一课程+学期不允许并发排课
  const lockKey = `${courseId}:${semesterStr}`;
  if (arrangeLocks.has(lockKey)) {
    throw new Error('该课程正在排课中，请稍后重试');
  }
  arrangeLocks.add(lockKey);

  try {
    const teachers = await getTeachersForCourse(courseId, semesterStr);
    if (!teachers.length) {
      // 提前返回前查询手动安排数，避免 manualCount 误报为 0（M-1 修复）
      const manualCount = await prisma.teaching_assignments.count({
        where: { course_id: Number(courseId), semester: semesterStr, is_auto: false },
      });
      return buildResult([], [], [], manualCount, '该课程没有可用教师', preview);
    }

    const classes = await getClassesWithCourse(courseId, semesterStr);
    if (!classes.length) {
      const manualCount = await prisma.teaching_assignments.count({
        where: { course_id: Number(courseId), semester: semesterStr, is_auto: false },
      });
      return buildResult([], [], [], manualCount, '当前学期没有开设该课程的班级', preview);
    }

    const manualAssignments = await prisma.teaching_assignments.findMany({
      where: { course_id: Number(courseId), semester: semesterStr, is_auto: false },
    });
    const manualClassIds = new Set(manualAssignments.map((a) => a.class_id));

    const currentAutoHours = await prisma.teaching_assignments.groupBy({
      by: ['teacher_id'],
      where: { course_id: Number(courseId), semester: semesterStr, is_auto: true },
      _sum: { weekly_hours: true },
    });
    const autoHoursMap = new Map(
      currentAutoHours.map((w) => [w.teacher_id, w._sum.weekly_hours || 0])
    );

    const classesToAssign = classes
      .filter((c) => !manualClassIds.has(c.classId))
      .map((c) => ({ ...c, textbookIds: (c.textbooks || []).map((tb) => tb.id) }));

    const assignments = [];
    const unassigned = [];

    // 校验周课时合法性：0 或负数的班级不参与排课，避免污染容量统计（M-10 修复）
    const invalidHourClasses = classesToAssign.filter((c) => !c.weeklyHours || c.weeklyHours <= 0);
    for (const c of invalidHourClasses) {
      unassigned.push({
        classId: c.classId,
        className: c.className,
        weeklyHours: c.weeklyHours,
        reason: '课时配置异常（周课时为0或负数）',
      });
    }
    const validClassesToAssign = classesToAssign.filter((c) => c.weeklyHours && c.weeklyHours > 0);

    const teacherConstraints = buildTeacherConstraints(
      teachers,
      hourSettings,
      autoHoursMap,
      mode,
      extraTeacherHours
    );

    // S-13 修复：预览模式下从前序课程累计教材负载
    if (globalTextbookMap) {
      for (const t of teacherConstraints) {
        const prevTbs = globalTextbookMap.get(t.id);
        if (prevTbs && prevTbs.size > 0) {
          t.assignedTextbookIds = new Set(prevTbs);
        }
      }
    }

    // === 版本标记：验证代码已加载 ===
    logger.debug(
      `[TEXTBOOK_COHESION] v2024-06-20-REWRITE autoArrange 入口 courseId=${courseId} semester=${semesterStr} mode=${mode}`
    );

    // === 诊断日志（八轮：定位"全员2本"根因）===
    if (TEXTBOOK_COHESION.ENABLED) {
      logger.debug(`\n========== 排课诊断 ==========`);
      logger.debug(`课程ID=${courseId} 学期=${semesterStr} 模式=${mode}`);
      logger.debug(`教师数=${teacherConstraints.length} 班级数=${validClassesToAssign.length}`);
      // 班级教材分布
      const tbDist = new Map();
      for (const cls of validClassesToAssign) {
        const sig = (cls.textbookIds || []).slice().sort().join(',') || '(无教材)';
        if (!tbDist.has(sig)) tbDist.set(sig, []);
        tbDist.get(sig).push(cls.className);
      }
      logger.debug('--- 班级教材分布 ---');
      for (const [sig, names] of tbDist) {
        logger.debug(`  教材[${sig}]: ${names.length}个班 → ${names.join(', ')}`);
      }
      // 教师初始状态
      logger.debug('--- 教师初始状态 ---');
      for (const t of teacherConstraints) {
        const inherent = t.inherentTextbookIds?.length ? t.inherentTextbookIds.join(',') : '(空)';
        logger.debug(
          `  ${t.name}: inherentTextbookIds=[${inherent}] effectiveTotal=${t.effectiveTotal} standardCap=${t.standardCap} fullCap=${t.fullCap} defaultWeeklyHours=${t.defaultWeeklyHours}`
        );
      }
      logger.debug('================================\n');
    }

    const totalClassHours = validClassesToAssign.reduce((s, c) => s + c.weeklyHours, 0);
    const totalTeacherCapacity = teacherConstraints.reduce(
      (s, t) => s + (mode === 'standard' ? t.standardCap : t.fullCap),
      0
    );
    const warnings = [];
    if (totalClassHours > totalTeacherCapacity) {
      warnings.push(
        `班级总课时(${totalClassHours})超过教师总容量(${totalTeacherCapacity})，部分班级可能无法分配`
      );
    }

    // 预计算每个班级的"学院+教材"和"层次+教材"匹配教师数量，优化二次筛选
    const collegeTextbookMatchCount = new Map();
    const levelTextbookMatchCount = new Map();

    for (const cls of validClassesToAssign) {
      let collegeTextbookCount = 0;
      let levelTextbookCount = 0;
      for (const t of teacherConstraints) {
        if (isCollegeEligible(t, cls) && isTextbookMatch(t, cls)) collegeTextbookCount++;
        if (isLevelEligible(t, cls) && isTextbookMatch(t, cls)) levelTextbookCount++;
      }
      collegeTextbookMatchCount.set(cls.classId, collegeTextbookCount);
      levelTextbookMatchCount.set(cls.classId, levelTextbookCount);
    }

    /**
     * 选择最佳教师（综合评分制）
     * 综合考虑：优先级分数（高优）+ 负载率（低优）
     * 委托给模块级 selectBestTeacher 函数
     */
    function selectBestTeacherLocal(candidates) {
      return selectBestTeacher(candidates);
    }

    function countEligibleTeachers(cls, eligibilityFilter) {
      return teacherConstraints.filter((t) => {
        if (eligibilityFilter && !eligibilityFilter(t, cls)) return false;
        return isTeacherEligible(t, cls, mode);
      }).length;
    }

    function assignRound(classList, eligibilityFilter = null, preserveOrder = false) {
      const textbookSignature = (cls) =>
        cls.textbookIds && cls.textbookIds.length > 0
          ? cls.textbookIds.slice().sort().join(',')
          : '';
      const sorted = preserveOrder
        ? [...classList]
        : [...classList].sort((a, b) => {
            const ea = countEligibleTeachers(a, eligibilityFilter);
            const eb = countEligibleTeachers(b, eligibilityFilter);
            if (ea !== eb) return ea - eb;
            return textbookSignature(a).localeCompare(textbookSignature(b));
          });

      const remaining = [];
      for (const cls of sorted) {
        const maxCap = mode === 'standard' ? (t) => t.standardCap : (t) => t.fullCap;

        const candidates = teacherConstraints
          .filter((t) => {
            if (eligibilityFilter && !eligibilityFilter(t, cls)) return false;
            if (!isTeacherEligible(t, cls, mode)) return false;

            // 硬上限检查：已达教材上限的教师，只能接已持有教材的班级
            if (TEXTBOOK_COHESION.ENABLED && TEXTBOOK_COHESION.MAX_TEXTBOOKS_PER_TEACHER > 0) {
              const tbCount = t.assignedTextbookIds?.size ?? 0;
              const maxTb = TEXTBOOK_COHESION.MAX_TEXTBOOKS_PER_TEACHER;
              if (tbCount >= maxTb && cls.textbookIds && cls.textbookIds.length > 0) {
                const hasSame = cls.textbookIds.some((tid) => t.assignedTextbookIds.has(tid));
                if (!hasSame) return false; // 已达上限且是新教材，排除
              }
            }

            return true;
          })
          .map((t) => ({
            teacher: t,
            score: calcMatchScore(t, cls),
            loadRate:
              (t.effectiveTotal + t.assignedHours) / Math.max(1, maxCap(t) + t.effectiveTotal),
            cls,
          }));

        if (candidates.length === 0) {
          remaining.push(cls);
          continue;
        }

        const selected = selectBestTeacherLocal(candidates).teacher;
        selected.assignedHours += cls.weeklyHours;
        selected.assignedCollegeIds.add(cls.collegeId);

        for (const tid of cls.textbookIds || []) {
          if (!selected.textbookIds.includes(tid)) {
            selected.textbookIds.push(tid);
          }
          selected.assignedTextbookIds.add(tid);
        }

        assignments.push({
          teacher_id: selected.id,
          teacher_name: selected.name,
          class_id: cls.classId,
          class_name: cls.className,
          course_id: Number(courseId),
          semester: semesterStr,
          weekly_hours: cls.weeklyHours,
          is_auto: true,
        });
      }
      return remaining;
    }

    const hasCollegePref = (t) => t.schedulingCollegeIds && t.schedulingCollegeIds.length > 0;
    const hasLevelPref = (t) => t.schedulingLevelIds && t.schedulingLevelIds.length > 0;
    const hasAnyPref = (t) => hasCollegePref(t) || hasLevelPref(t);

    const hasAssignedTextbook = (t, cls) =>
      cls.textbookIds?.length > 0 &&
      t.assignedTextbookIds &&
      cls.textbookIds.some((tid) => t.assignedTextbookIds.has(tid));

    const prefMatch = (t, cls) => {
      if (hasCollegePref(t) && !t.schedulingCollegeIds.includes(cls.collegeId)) return false;
      if (
        hasLevelPref(t) &&
        cls.trainingLevelId &&
        !t.schedulingLevelIds.includes(cls.trainingLevelId)
      )
        return false;
      return true;
    };

    // ================================================================
    // 全新分配算法：教师拿教材方式（彻底重写 v2）
    // ================================================================
    // 核心策略（严格按照用户需求）：
    //   1. 所有教师先拿完第一本教材，再拿第二本
    //   2. 优先拿完一个学院的班级，再拿其他学院
    //   3. 有指定意向学院/层次的教师，必须严格按意向分配
    //   4. 无指定的教师，按课时容量去拿
    //   5. 手动排课的教材和课时需要追踪
    // ================================================================

    const maxCapFn = mode === 'standard' ? (t) => t.standardCap : (t) => t.fullCap;

    // --- 手动排课教材追踪 ---
    // 手动排课的班级虽然不参与自动排课，但教师已分配的教材和课时需要计入
    const allClassMap = new Map(classes.map((c) => [c.classId, c]));
    for (const ma of manualAssignments) {
      const teacher = teacherConstraints.find((t) => t.id === ma.teacher_id);
      if (!teacher) continue;
      const cls = allClassMap.get(ma.class_id);
      if (!cls) continue;
      // 教材追踪
      for (const tid of (cls.textbooks || []).map((tb) => tb.id)) {
        teacher.assignedTextbookIds.add(tid);
        if (!teacher.textbookIds.includes(tid)) {
          teacher.textbookIds.push(tid);
        }
      }
      // 学院追踪
      teacher.assignedCollegeIds.add(cls.collegeId);
      // 课时已通过 effectiveTotal 计入，不重复加
    }
    logger.debug(`[手动排课追踪] ${manualAssignments.length} 条手动排课，教师教材已更新`);

    // --- 辅助函数：检查教师意向是否匹配某个班级（严格约束）---
    function isPrefMatch(teacher, cls) {
      // 有指定意向学院的教师，只能拿匹配的学院
      if (
        teacher.schedulingCollegeIds?.length > 0 &&
        !teacher.schedulingCollegeIds.includes(cls.collegeId)
      ) {
        return false;
      }
      // 有指定意向层次的教师，只能拿匹配的层次
      if (
        teacher.schedulingLevelIds?.length > 0 &&
        cls.trainingLevelId &&
        !teacher.schedulingLevelIds.includes(cls.trainingLevelId)
      ) {
        return false;
      }
      return true;
    }

    // --- 辅助函数：记录分配 ---
    function recordAssignment(teacher, cls) {
      teacher.assignedHours += cls.weeklyHours;
      teacher.assignedCollegeIds.add(cls.collegeId);
      for (const tid of cls.textbookIds || []) {
        if (!teacher.textbookIds.includes(tid)) {
          teacher.textbookIds.push(tid);
        }
        teacher.assignedTextbookIds.add(tid);
      }
      assignments.push({
        teacher_id: teacher.id,
        teacher_name: teacher.name,
        class_id: cls.classId,
        class_name: cls.className,
        course_id: Number(courseId),
        semester: semesterStr,
        weekly_hours: cls.weeklyHours,
        is_auto: true,
      });
    }

    // --- 辅助函数：教师从可用班级中拿取，直到课时满 ---
    function takeClassesForTeacher(teacher, availableClasses, strictPrefCheck = true) {
      const cap = maxCapFn(teacher);
      const remainingCap = cap - teacher.assignedHours;
      if (remainingCap <= 0) return [];

      const taken = [];
      let usedHours = 0;

      // P1-2 修复：追踪"假设拿取后"的教材集合，防止累计超限
      const takeMaxTb = TEXTBOOK_COHESION.MAX_TEXTBOOKS_PER_TEACHER;
      const useTbLimit = TEXTBOOK_COHESION.ENABLED && takeMaxTb > 0;
      const projectedTextbooks = useTbLimit ? new Set(teacher.assignedTextbookIds) : null;

      // 按学院排序：教师已分配的学院优先，然后按学院ID排序
      const sorted = [...availableClasses].sort((a, b) => {
        const aHasCollege = teacher.assignedCollegeIds?.has(a.collegeId) ? 0 : 1;
        const bHasCollege = teacher.assignedCollegeIds?.has(b.collegeId) ? 0 : 1;
        if (aHasCollege !== bHasCollege) return aHasCollege - bHasCollege;
        if (a.collegeId !== b.collegeId) return a.collegeId - b.collegeId;
        return a.classId - b.classId;
      });

      for (const cls of sorted) {
        if (usedHours + cls.weeklyHours > remainingCap) continue;

        // 意向约束检查（严格）：有意向的教师只能拿匹配的班级
        if (strictPrefCheck && !isPrefMatch(teacher, cls)) continue;

        // P1-2 修复：教材上限校验 - 假设拿取此班级后教材总数不能超过上限
        if (useTbLimit && cls.textbookIds?.length > 0) {
          const newTbs = cls.textbookIds.filter((tid) => !projectedTextbooks.has(tid));
          if (projectedTextbooks.size + newTbs.length > takeMaxTb) continue;
          for (const tid of newTbs) projectedTextbooks.add(tid);
        }

        taken.push(cls);
        usedHours += cls.weeklyHours;
      }

      return taken;
    }

    // --- 步骤1：按教材分组 ---
    const textbookGroups = new Map();
    for (const cls of validClassesToAssign) {
      const key =
        cls.textbookIds && cls.textbookIds.length > 0
          ? cls.textbookIds.slice().sort().join(',')
          : '__no_textbook__';
      if (!textbookGroups.has(key)) textbookGroups.set(key, []);
      textbookGroups.get(key).push(cls);
    }

    // 每组内按学院排序（保证同教材内优先拿完一个学院）
    for (const [key, group] of textbookGroups) {
      group.sort((a, b) => {
        if (a.collegeId !== b.collegeId) return a.collegeId - b.collegeId;
        return a.classId - b.classId;
      });
    }

    logger.debug(`[新分配算法v2] 共 ${textbookGroups.size} 个教材组，开始分配...`);
    for (const [key, group] of textbookGroups) {
      logger.debug(`  教材组 ${key}: ${group.length} 个班级`);
    }

    // 跟踪每个教材组的可用班级（可变数组）
    const groupAvailable = new Map();
    for (const [key, group] of textbookGroups) {
      groupAvailable.set(key, [...group]);
    }

    // ================================================================
    // 第一阶段：处理有指定意向的教师（严格按意向分配）
    // ================================================================
    logger.info('[阶段1] 有指定意向的教师拿第一本教材');

    const teachersWithPref = teacherConstraints.filter(
      (t) => t.schedulingCollegeIds?.length > 0 || t.schedulingLevelIds?.length > 0
    );

    // 按教材组顺序处理：所有教师先拿完第一本教材
    for (const [tbKey, available] of groupAvailable) {
      if (available.length === 0) continue;

      const textbookIds = tbKey === '__no_textbook__' ? [] : tbKey.split(',').map(Number);

      // 筛选：有指定意向且能教此教材的教师
      const eligibleTeachers = teachersWithPref
        .filter((t) => {
          // 关键修复：只看本轮已分配的教材，不看固有教材
          // 如果教师已经有分配的教材，必须包含当前教材组的教材
          if (t.assignedTextbookIds.size > 0) {
            return textbookIds.some((tid) => t.assignedTextbookIds.has(tid));
          }
          // 0本教师：只能拿当前教材组（第一本）
          return true;
        })
        .sort((a, b) => {
          // 优先选剩余容量大的教师
          return maxCapFn(b) - b.assignedHours - (maxCapFn(a) - a.assignedHours);
        });

      for (const teacher of eligibleTeachers) {
        if (available.length === 0) break;

        // 严格意向检查：只拿匹配的班级
        const matchingClasses = available.filter((cls) => isPrefMatch(teacher, cls));
        if (matchingClasses.length === 0) continue;

        const taken = takeClassesForTeacher(teacher, matchingClasses, true);
        for (const cls of taken) {
          recordAssignment(teacher, cls);
          const idx = available.findIndex((c) => c.classId === cls.classId);
          if (idx >= 0) available.splice(idx, 1);
        }
      }

      logger.debug(`  [阶段1] 教材组 ${tbKey}: 剩余 ${available.length} 个班级`);
    }

    // ================================================================
    // 第二阶段：处理无指定意向的教师（按课时容量去拿）
    // ================================================================
    logger.info('[阶段2] 无指定意向的教师拿第一本教材');

    const teachersWithoutPref = teacherConstraints.filter(
      (t) => !t.schedulingCollegeIds?.length && !t.schedulingLevelIds?.length
    );

    // 同样按教材组顺序处理
    for (const [tbKey, available] of groupAvailable) {
      if (available.length === 0) continue;

      const textbookIds = tbKey === '__no_textbook__' ? [] : tbKey.split(',').map(Number);

      // 筛选：无指定意向且能教此教材的教师
      const eligibleTeachers = teachersWithoutPref
        .filter((t) => {
          // 必须是0本或已有此教材的教师
          if (t.assignedTextbookIds.size > 0) {
            return textbookIds.some((tid) => t.assignedTextbookIds.has(tid));
          }
          return true; // 0本教师可以拿任何教材
        })
        .sort((a, b) => {
          // 优先选剩余容量大的教师
          return maxCapFn(b) - b.assignedHours - (maxCapFn(a) - a.assignedHours);
        });

      for (const teacher of eligibleTeachers) {
        if (available.length === 0) break;

        const taken = takeClassesForTeacher(teacher, available, false); // 无指定意向，不严格检查
        for (const cls of taken) {
          recordAssignment(teacher, cls);
          const idx = available.findIndex((c) => c.classId === cls.classId);
          if (idx >= 0) available.splice(idx, 1);
        }
      }

      logger.debug(`  [阶段2] 教材组 ${tbKey}: 剩余 ${available.length} 个班级`);
    }

    // ================================================================
    // 第三阶段：所有教师追加同教材班级（不增加教材数）
    // ================================================================
    logger.info('[阶段3] 所有教师追加同教材班级');

    for (const [tbKey, available] of groupAvailable) {
      if (available.length === 0) continue;

      const textbookIds = tbKey === '__no_textbook__' ? [] : tbKey.split(',').map(Number);

      // 所有已持有此教材的教师
      const teachers = [...teacherConstraints]
        .filter(
          (t) =>
            textbookIds.length === 0 || textbookIds.some((tid) => t.assignedTextbookIds.has(tid))
        )
        .sort((a, b) => maxCapFn(b) - b.assignedHours - (maxCapFn(a) - a.assignedHours));

      for (const teacher of teachers) {
        if (available.length === 0) break;

        const matchingClasses = available.filter((cls) => isPrefMatch(teacher, cls));
        if (matchingClasses.length === 0) continue;

        const taken = takeClassesForTeacher(teacher, matchingClasses, true);
        for (const cls of taken) {
          recordAssignment(teacher, cls);
          const idx = available.findIndex((c) => c.classId === cls.classId);
          if (idx >= 0) available.splice(idx, 1);
        }
      }

      logger.debug(`  [阶段3] 教材组 ${tbKey}: 剩余 ${available.length} 个班级`);
    }

    // ================================================================
    // 第四阶段：所有教师拿第二本教材（如果还有容量）
    // ================================================================
    logger.info('[阶段4] 所有教师拿第二本教材');

    for (const [tbKey, available] of groupAvailable) {
      if (available.length === 0) continue;

      const textbookIds = tbKey === '__no_textbook__' ? [] : tbKey.split(',').map(Number);

      // 筛选：未持有此教材且有容量的教师
      const eligibleTeachers = [...teacherConstraints]
        .filter((t) => {
          // 跳过已持有此教材的教师（已在阶段3处理）
          if (textbookIds.some((tid) => t.assignedTextbookIds.has(tid))) return false;
          // 检查是否有剩余容量
          if (maxCapFn(t) - t.assignedHours <= 0) return false;
          // P1-2 修复：教材硬上限校验
          // 阶段4教师未持有此组任何教材（上方 filter 已保证），新增教材数 = textbookIds.length
          if (
            TEXTBOOK_COHESION.ENABLED &&
            TEXTBOOK_COHESION.MAX_TEXTBOOKS_PER_TEACHER > 0 &&
            textbookIds.length > 0 &&
            t.assignedTextbookIds.size + textbookIds.length >
              TEXTBOOK_COHESION.MAX_TEXTBOOKS_PER_TEACHER
          ) {
            return false;
          }
          return true;
        })
        .sort((a, b) => maxCapFn(b) - b.assignedHours - (maxCapFn(a) - a.assignedHours));

      for (const teacher of eligibleTeachers) {
        if (available.length === 0) break;

        const matchingClasses = available.filter((cls) => isPrefMatch(teacher, cls));
        if (matchingClasses.length === 0) continue;

        const taken = takeClassesForTeacher(teacher, matchingClasses, true);
        for (const cls of taken) {
          recordAssignment(teacher, cls);
          const idx = available.findIndex((c) => c.classId === cls.classId);
          if (idx >= 0) available.splice(idx, 1);
        }
      }

      logger.debug(`  [阶段4] 教材组 ${tbKey}: 剩余 ${available.length} 个班级`);
    }

    // ================================================================
    // 第五阶段：兜底（剩余班级用 assignRound 放宽约束）
    // ================================================================
    let allRemaining = [];
    for (const [, available] of groupAvailable) {
      allRemaining.push(...available);
    }

    if (allRemaining.length > 0) {
      logger.debug(`[兜底] 剩余 ${allRemaining.length} 个班级，用 assignRound 放宽约束`);
      const fallbackRemaining = assignRound(allRemaining);
      unassigned.push(...fallbackRemaining);
      logger.debug(`[兜底] 累计分配 ${assignments.length}，未分配 ${fallbackRemaining.length}`);
    }

    logger.info(`[新分配算法v2] 完成，总分配 ${assignments.length}，未分配 ${unassigned.length}`);

    // P2 修复：阶段4 后置换回溯
    // 对未分配班级尝试"置换"：若某教师 T 已满，但 T 当前某班级 V 能被其他教师 T'' 接管，
    // 且 T 腾出容量后能容纳未分配班级 U，则执行置换，提升全局分配率
    // 预构建班级教材查找表，供置换时做教材上限检查
    const classTextbookMap = new Map();
    // S-02 修复：预构建班级信息查找表，供置换时做学院/层次资格校验
    const classInfoMap = new Map();
    for (const cls of validClassesToAssign) {
      classTextbookMap.set(cls.classId, cls.textbookIds || []);
      classInfoMap.set(cls.classId, {
        collegeId: cls.collegeId,
        trainingLevelId: cls.trainingLevelId,
      });
    }
    trySwapUnassigned(
      unassigned,
      assignments,
      teacherConstraints,
      mode,
      courseId,
      semesterStr,
      classTextbookMap,
      classInfoMap
    );

    // === 诊断日志：最终教材分布 ===
    if (TEXTBOOK_COHESION.ENABLED) {
      logger.debug('\n--- 最终教师教材分布 ---');
      const tbCountStats = new Map(); // size → count
      for (const t of teacherConstraints) {
        const tbSize = t.assignedTextbookIds.size;
        const tbs = [...t.assignedTextbookIds].join(',') || '(无)';
        logger.debug(
          `  ${t.name}: ${tbSize}本 [${tbs}] 班级数=${assignments.filter((a) => a.teacher_id === t.id).length}`
        );
        tbCountStats.set(tbSize, (tbCountStats.get(tbSize) || 0) + 1);
      }
      logger.debug('--- 教材数统计 ---');
      for (const [size, count] of [...tbCountStats].sort((a, b) => a[0] - b[0])) {
        logger.debug(`  ${size}本教材: ${count}位教师`);
      }
      logger.debug('========== 诊断结束 ==========\n');
    }

    if (preview) {
      const previewResult = buildResult(
        assignments,
        unassigned,
        classesToAssign,
        manualAssignments.length,
        null,
        true,
        warnings,
        teacherConstraints,
        mode
      );
      // S-13 修复：附带 classTextbookMap 供批量排课跨课程累计教材
      previewResult.classTextbookMap = classTextbookMap;
      return previewResult;
    }

    // 非预览模式：删除旧自动安排 + 写入新安排，统一在事务内执行
    // 无论是否有新分配都执行 deleteMany，保证"全量替换"语义与幂等性（C-3 修复）
    // 事务内重新校验教师实际课时，避免并发排课导致超载（C-2 修复）
    await prisma.$transaction(async (tx) => {
      // 事务内重新查询教师当前学期实际总课时（扣除即将删除的本课程自动安排）
      await tx.teaching_assignments.deleteMany({
        where: { course_id: Number(courseId), semester: semesterStr, is_auto: true },
      });

      if (assignments.length > 0) {
        // 重新聚合各教师当前实际总课时（已扣除本课程旧自动安排）
        const reassigned = await tx.teaching_assignments.groupBy({
          by: ['teacher_id'],
          where: { semester: semesterStr },
          _sum: { weekly_hours: true },
        });
        const reassignedMap = new Map(
          reassigned.map((r) => [r.teacher_id, r._sum.weekly_hours || 0])
        );

        // 容量二次校验：超载的分配降级跳过，写入通过校验的部分
        const safeAssignments = [];
        const overloadSkipped = [];
        const constraintMap = new Map(teacherConstraints.map((t) => [t.id, t]));
        // M-5: 用 Map 累加每位教师已写入课时，避免 O(A²) 的 filter+reduce
        const writtenMap = new Map();
        // P1-2 修复：事务内教材上限二次校验
        // baseline = assignedTextbookIds ∩ inherentTextbookIds（pre-existing 快照），
        // 即教师写入前的教材集合；written 累加已通过校验的本次安排新增教材
        const txMaxTb = TEXTBOOK_COHESION.MAX_TEXTBOOKS_PER_TEACHER;
        const useTxTbLimit = TEXTBOOK_COHESION.ENABLED && txMaxTb > 0;
        const baselineTextbooks = new Map();
        const writtenTextbooks = new Map();
        if (useTxTbLimit) {
          for (const t of teacherConstraints) {
            const inherentSet = new Set(t.inherentTextbookIds || []);
            const baseline = new Set();
            for (const tid of t.assignedTextbookIds) {
              if (inherentSet.has(tid)) baseline.add(tid);
            }
            baselineTextbooks.set(t.id, baseline);
            writtenTextbooks.set(t.id, new Set());
          }
        }
        for (const a of assignments) {
          const t = constraintMap.get(a.teacher_id);
          if (!t) {
            overloadSkipped.push(a);
            continue;
          }
          const currentTotal = reassignedMap.get(a.teacher_id) || 0;
          const cap = mode === 'standard' ? t.standardCap : t.fullCap;
          // currentTotal 已扣除旧自动安排，加上本课程其他已写入的新安排
          const alreadyWritten = writtenMap.get(a.teacher_id) || 0;
          if (currentTotal + alreadyWritten + a.weekly_hours > cap + t.effectiveTotal) {
            // 超载，跳过该分配（并发导致容量已变）
            overloadSkipped.push(a);
            continue;
          }
          // P1-2 修复：教材上限二次校验，违规的不写入 DB
          if (useTxTbLimit) {
            const baseline = baselineTextbooks.get(a.teacher_id);
            const written = writtenTextbooks.get(a.teacher_id);
            const tbIds = classTextbookMap.get(a.class_id) || [];
            if (baseline && written && tbIds.length > 0) {
              const projected = new Set(baseline);
              for (const tid of written) projected.add(tid);
              for (const tid of tbIds) projected.add(tid);
              if (projected.size > txMaxTb) {
                overloadSkipped.push(a);
                continue;
              }
              for (const tid of tbIds) written.add(tid);
            }
          }
          safeAssignments.push(a);
          writtenMap.set(a.teacher_id, alreadyWritten + a.weekly_hours);
        }

        if (safeAssignments.length > 0) {
          await tx.teaching_assignments.createMany({
            data: safeAssignments.map((a) => ({
              teacher_id: a.teacher_id,
              class_id: a.class_id,
              course_id: a.course_id,
              semester: a.semester,
              weekly_hours: a.weekly_hours,
              is_auto: true,
            })),
          });
        }

        // 超载跳过的班级归入 unassigned
        for (const a of overloadSkipped) {
          unassigned.push({
            classId: a.class_id,
            className: a.class_name,
            weeklyHours: a.weekly_hours,
            reason: '并发排课导致教师容量已满，已跳过',
          });
        }
        // 更新 assignments 为实际写入的部分，保证返回结果准确
        assignments.length = 0;
        assignments.push(...safeAssignments);
      }
    });

    return buildResult(
      assignments,
      unassigned,
      classesToAssign,
      manualAssignments.length,
      null,
      false,
      warnings,
      teacherConstraints,
      mode
    );
  } finally {
    // C-2: 无论成功或异常，始终释放锁
    arrangeLocks.delete(lockKey);
  }
}

// ── 测试专用导出（不对生产代码产生影响）──
// 这些函数在生产代码中被内部调用，导出仅为支持单元测试直接验证核心逻辑
export {
  calcMatchScore,
  isTeacherEligible,
  calcAllMatchRates,
  diagnoseFailure,
  selectBestTeacher,
  trySwapOne,
};
