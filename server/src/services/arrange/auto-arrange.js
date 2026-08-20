import { prisma } from '../../lib/prisma.js';
import {
  DEFAULT_HOUR_SETTINGS,
  WORKLOAD_BALANCE,
  TEXTBOOK_COHESION,
  TABU_SEARCH,
  SWAP_CONFIG,
  INHERENT_CLASS,
} from '../../constants/index.js';
import logger from '../../utils/logger.js';
import { validateHourSettings } from './validate.js';
import { dedupeTeachingUnits } from '../teaching-statistics.service.js';
import { getClassesWithCourse, getTeachersForCourse, isTextbookMatch } from './queries.js';
import { tabuOptimize } from './tabu-search.js';
// B-01 修复：基于数据库的排课并发锁，支持多进程/多实例部署
import { acquireLock, releaseLock } from './lock.js';
import { getPreviousSemester } from '../semester.service.js';

// C-2: 并发锁，防止同一课程被并发排课
// B-01 修复：保留进程内存 Set 作为单进程快速路径（防止同进程内重复进入），
// 跨进程互斥由 lock.js 数据库锁（acquireLock / releaseLock）保证
const arrangeLocks = new Set();

// L3 修复：选组学院内聚临界比例。同 tier 下两组可拿课时之比 ≥ 此值时视为"接近"，
// 此时优先选已分配学院课时更多的组（学院内聚软目标，不牺牲明显更大的可拿课时）
const GROUP_PROXIMITY_RATIO = 0.8;

// M-12 / P1-12: 批量排课并发锁（按学期维度），防止单课程排课与批量排课并发
// 批量进行中，对同 semester 的单课程 autoArrange 调用直接拒绝，
// 避免该课程的 arrangeLock 阻止批量到达时被 catch 吞掉、静默跳过
// B-01 修复：保留进程内存 Set 作为单进程快速路径，跨进程互斥由 lock.js 数据库锁保证
export const batchLocks = new Set();

/**
 * 计算教师-班级匹配分数（优先级 + 教材内聚）
 * 权重由 TEXTBOOK_COHESION 配置：
 *   学院匹配 +COLLEGE_WEIGHT, 层次匹配 +LEVEL_WEIGHT,
 *   本轮已分配教材 +ASSIGNED_WEIGHT, 固有教材 +INHERENT_WEIGHT,
 *   新增教材惩罚 -PENALTY_PER_NEW × N（修复3，强制内聚）
 * 固有班级延续（INHERENT_CLASS，可选）：
 *   教师上学期教过该班级 +CONTINUITY_WEIGHT
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

  // 固有班级延续奖励：教师上学期教过该班级（inherentClassIds 快照命中），
  // 优先回到上学期的班级。软性加分，不改变硬约束；教材强惩罚（-300）分支
  // 在后续 return 时已计入该加分，内聚原则依然占优。
  // 运行时门控为快照存在性：开关关闭时不构建快照，字段缺失即零开销退化
  if (teacher.inherentClassIds?.has(classInfo.classId)) {
    score += INHERENT_CLASS.CONTINUITY_WEIGHT;
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
          return score - TEXTBOOK_COHESION.TEXTBOOK_COUNT_PENALTY_1_NEW;
        }
      }
    } else if (tbCount === 0) {
      score += TEXTBOOK_COHESION.ZERO_TEXTBOOK_BONUS;
    } else if (tbCount === 1 && classInfo.textbookIds?.length > 0) {
      const newCount = classInfo.textbookIds.filter(
        (tid) => !teacher.assignedTextbookIds.has(tid)
      ).length;
      if (newCount === 0) {
        score += TEXTBOOK_COHESION.TEXTBOOK_COUNT_BONUS_1_SAME;
      } else {
        return score - TEXTBOOK_COHESION.TEXTBOOK_COUNT_PENALTY_1_NEW;
      }
      // 注意：以下分支依赖 maxTb 的值。当前 MAX_TEXTBOOKS_PER_TEACHER=2 时，
      // tbCount >= maxTb（即 >=2）已在上方的 `if (tbCount >= maxTb)` 分支捕获并 return，
      // 因此下方 tbCount>=3 / >=2 分支在当前配置下不可达。
      // 仅当 MAX_TEXTBOOKS_PER_TEACHER 调高至 3+ 时，tbCount===2 会落入此区域，
      // 届时 TEXTBOOK_COUNT_PENALTY_2 / TEXTBOOK_COUNT_PENALTY_3PLUS 才会生效。
    } else if (tbCount >= 3) {
      score -= TEXTBOOK_COHESION.TEXTBOOK_COUNT_PENALTY_3PLUS;
    } else if (tbCount >= 2) {
      score -= TEXTBOOK_COHESION.TEXTBOOK_COUNT_PENALTY_2;
    }
  }

  return score;
}

/**
 * 教师有效教材上限：个人开关「只带一本教材」优先（恒为 1，不受全局 ENABLED 影响），
 * 否则跟随 TEXTBOOK_COHESION 全局配置；返回 <=0 表示无教材约束
 */
export function teacherMaxTextbooks(t) {
  if (t?.singleTextbookOnly) return 1;
  return TEXTBOOK_COHESION.ENABLED ? TEXTBOOK_COHESION.MAX_TEXTBOOKS_PER_TEACHER : 0;
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
  // 二轮优化：教材硬上限检查（个人开关教师上限覆写为 1）
  // 教师已有教材数 + 接此班新增教材数 > MAX → 不可选
  const maxTb = teacherMaxTextbooks(t);
  if (maxTb > 0 && cls.textbookIds?.length > 0) {
    const newTbCount = cls.textbookIds.filter((tid) => !t.assignedTextbookIds.has(tid)).length;
    if (t.assignedTextbookIds.size + newTbCount > maxTb) return false;
  }
  return true;
}

/**
 * 检查教师意向是否匹配某个班级（严格约束，供五阶段主分配使用）
 * 导出以便单测覆盖 B-03 无层次班级守卫
 *
 * 注意：本函数仅检查学院意向和层次意向，不检查教材上限和容量约束。
 * 教材上限由 takeClassesForTeacher 内部的 useTbLimit 检查兜底，
 * 容量约束由 takeClassesForTeacher 的 remainingCap 检查兜底。
 * isTeacherEligible 是更完整的约束检查（含教材+容量），供 assignRound 兜底使用。
 */
export function isPrefMatch(teacher, cls) {
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
  // B-03 语义对齐：班级无培养层次时，有层次约束的教师不可拿取
  // 与 isTeacherEligible / tryPlaceClass / canAccept 保持一致，避免主阶段产生后续阶段视为非法的分配
  if (!cls.trainingLevelId && teacher.schedulingLevelIds?.length > 0) {
    return false;
  }
  return true;
}

/**
 * 构建教材组可用班级池（每组拷贝为可变数组）
 * 按组内总周课时降序排序：需求量大的教材组优先分配，
 * 使 0 本教师优先锁定大组，避免小组先占用教师导致大组供给不足
 */
function buildGroupAvailable(textbookGroups) {
  const groupDemand = (group) => group.reduce((sum, cls) => sum + (cls.weeklyHours || 0), 0);
  const sortedGroupEntries = [...textbookGroups.entries()].sort(
    (a, b) => groupDemand(b[1]) - groupDemand(a[1])
  );
  const groupAvailable = new Map();
  for (const [key, group] of sortedGroupEntries) {
    groupAvailable.set(key, [...group]);
  }
  return groupAvailable;
}

function buildTeacherConstraints(
  teachers,
  hourSettings,
  autoHoursMap,
  mode,
  extraTeacherHours = null,
  capacityReserveRatio = 1.0,
  reserveExemptTeacherIds = null,
  customHoursGuarantee = false
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
    // B-05 修复：防止手动分配被删除后 effectiveTotal 为负值，导致教师容量计算偏差
    const effectiveTotal = Math.max(0, t.totalWeeklyHours - autoHoursForCourse + extraHours);

    // ⚠️ 字段名误导（P2-11）：defaultWeeklyHours 实为"教师总周课时上限"
    // UI 已改名为"自定义课时"，但 DB/Prisma 字段名仍为 default_weekly_hours
    // 此处 teacherHourCap = 总上限 - 已排课时 = 剩余可排课时
    const teacherHourCap =
      t.defaultWeeklyHours != null ? Math.max(0, t.defaultWeeklyHours - effectiveTotal) : null;

    // P0-2 修复：capacityReserveRatio < 1 时缩减容量上限，为后续课程预留空间
    // 当前 BATCH_CONFIG.RESERVE_RATIO=1.0（不预留，批量已按供需比排序优先级），比例保留为可配置项
    // P0-2 深化：预留只对"后续课程还会用到该教师"时有意义，
    // reserveExemptTeacherIds 中的教师（无任何后续课程）不打折，避免容量未满却欠分配
    const effectiveRatio = reserveExemptTeacherIds?.has(t.id) ? 1.0 : capacityReserveRatio;
    // 自定义课时最高优先级：设置了自定义课时（default_weekly_hours）后，
    // 它完全替代类别 standard/max，不再受类别课时配置约束（既能收紧也能放宽）；
    // guaranteeCap 默认保留"自定义与类别标准取严"口径，仅作保障轮/α惩罚/欠课时告警目标，
    // 避免高自定义教师被保障轮膨胀为优先目标而挤占其他教师达标课时；
    // customHoursGuarantee（系统设置开关）开启后，已设自定义的教师的保障目标
    // 提升为自定义剩余课时（尽力强制满足），未设自定义的教师仍用类别标准
    const rawStandardCap =
      teacherHourCap != null ? teacherHourCap : Math.max(0, setting.standard - effectiveTotal);
    const rawFullCap =
      teacherHourCap != null ? teacherHourCap : Math.max(0, setting.max - effectiveTotal);
    const rawGuaranteeCap =
      customHoursGuarantee && teacherHourCap != null
        ? teacherHourCap
        : Math.min(teacherHourCap ?? Infinity, Math.max(0, setting.standard - effectiveTotal));

    return {
      ...t,
      standardHours: setting.standard,
      maxHours: setting.max,
      effectiveTotal,
      standardCap: Math.floor(rawStandardCap * effectiveRatio),
      fullCap: Math.floor(rawFullCap * effectiveRatio),
      guaranteeCap: Math.floor(rawGuaranteeCap * effectiveRatio),
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
        // 自定义课时优先：展示口径与实际约束一致（自定义已设时以自定义为准）
        cap: t.defaultWeeklyHours ?? (mode === 'standard' ? t.standardHours : t.maxHours),
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

  // P1-2 修复（P2-4）：教材上限诊断（含个人开关教师上限覆写）
  // 所有教师已达教材硬上限且无法接纳新教材时，给出明确诊断
  if (cls.textbookIds?.length > 0) {
    const textbookFullTeachers = allTeachers.filter((t) => {
      if (!t.assignedTextbookIds) return false;
      const diagMax = teacherMaxTextbooks(t);
      if (diagMax <= 0) return false;
      const newTbCount = cls.textbookIds.filter((tid) => !t.assignedTextbookIds.has(tid)).length;
      return t.assignedTextbookIds.size + newTbCount > diagMax;
    });
    if (textbookFullTeachers.length === allTeachers.length) {
      return {
        reason: '所有候选教师教材上限已满',
        details: textbookFullTeachers.slice(0, 5).map((t) => ({
          teacherName: t.name,
          textbookCount: t.assignedTextbookIds.size,
          max: teacherMaxTextbooks(t),
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
  // F5 修复：改为严格弱序比较器（分档 + 确定性兜底），
  // 消除原阈值分段导致的非传递性（a>b, b>c, c>a），
  // 保证 Array.prototype.sort 结果与引擎实现无关
  const st = WORKLOAD_BALANCE.SCORE_THRESHOLD;
  const lt = WORKLOAD_BALANCE.LOAD_RATE_THRESHOLD;
  const sorted = [...candidates].sort((a, b) => {
    // 1. 评分分档降序（同档内差异 < st 视为等价）
    const scoreBucketA = Math.floor(a.score / st);
    const scoreBucketB = Math.floor(b.score / st);
    if (scoreBucketA !== scoreBucketB) return scoreBucketB - scoreBucketA;
    // 2. 负载率分档升序（同档内差异 < lt 视为等价，低负载优先）
    const loadBucketA = Math.floor(a.loadRate / lt);
    const loadBucketB = Math.floor(b.loadRate / lt);
    if (loadBucketA !== loadBucketB) return loadBucketA - loadBucketB;
    // 3. 确定性兜底：原始评分降序 → 负载率升序 → 教师 ID 升序
    if (b.score !== a.score) return b.score - a.score;
    if (a.loadRate !== b.loadRate) return a.loadRate - b.loadRate;
    return (a.teacher?.id ?? 0) - (b.teacher?.id ?? 0);
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
  let validCount = 0; // 有效分配数（teacher 和 class 均在 map 中）
  // F17 修复：无教材班级不计入 textbookMatchRate 分母，
  // 避免 isTextbookMatch 对空 textbookIds 恒返回 false 导致比率系统性偏低
  let textbookDenominator = 0;

  // 内聚度统计所需数据
  const teacherTextbookSet = new Map(); // teacherId → Set<textbookId>
  const teacherClassCount = new Map(); // teacherId → 班级数

  for (const a of assignments) {
    const teacher = teacherMap.get(a.teacher_id);
    const cls = classMap.get(a.class_id);
    if (!teacher || !cls) continue;
    validCount++;

    if (teacher.schedulingCollegeIds?.includes(cls.collegeId)) collegeMatched++;
    if (cls.textbookIds?.length > 0) {
      textbookDenominator++;
      if (isTextbookMatch(teacher, cls)) textbookMatched++;
    }
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
    // F17 修复：分母仅计有教材班级，无教材班级视为"不适用"
    // 无有效分配时返回 0（无可评估对象）；有有效分配但无教材班级时返回 100（空真）
    textbookMatchRate:
      textbookDenominator > 0
        ? Math.round((textbookMatched / textbookDenominator) * 100)
        : validCount > 0
          ? 100
          : 0,
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

  // 固有班级延续统计：仅当开关启用（至少一位教师持有上学期快照）时输出，
  // 关闭时不产生该字段，前端/批量汇总无需感知
  const snapshotTeachers = (teacherConstraints || []).filter((t) => t.inherentClassIds?.size > 0);
  if (snapshotTeachers.length > 0 && assignments.length > 0) {
    const teacherMapForContinuity = new Map((teacherConstraints || []).map((t) => [t.id, t]));
    // 分母：已分配班级中"至少一位候选教师上学期教过"的班级（可延续对象）
    // 分子：实际分配给了上学期教过该班的教师的班级（实际延续）
    let candidateCount = 0;
    let continuedCount = 0;
    for (const a of assignments) {
      const assignedTeacher = teacherMapForContinuity.get(a.teacher_id);
      const isContinued = !!assignedTeacher?.inherentClassIds?.has(a.class_id);
      if (isContinued) {
        candidateCount++;
        continuedCount++;
        continue;
      }
      const anyTaught = snapshotTeachers.some((t) => t.inherentClassIds.has(a.class_id));
      if (anyTaught) candidateCount++;
    }
    result.inherentContinuity = {
      enabled: true,
      candidateCount,
      continuedCount,
      continuityRate: candidateCount > 0 ? Math.round((continuedCount / candidateCount) * 100) : null,
    };
  }

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
            // P2-8 注释：loadRate = 已排课时 / 可排上限（百分比）
            //   分子 = effectiveTotal（已排其他课程）+ assignedHours（本次排课）
            //   分母 = cap（本课程容量上限）+ effectiveTotal（其他课程已占）
            //        = 该教师在当前 mode 下的总可排课时
            //   Math.max(1, ...) 防止除零；×100 转百分比
            loadRate: Math.round(
              ((t.effectiveTotal + t.assignedHours) / Math.max(1, cap + t.effectiveTotal)) * 100
            ),
            classCount: classCountByTeacher.get(t.id) || 0,
          };
        })
        .sort((a, b) => b.totalHours - a.totalHours),

      ...calcAllMatchRates(assignments, classesToAssign, teacherMap),

      // F12 修复：意向教师达标率——意向教师中实际课时达到容量上限的比例
      prefTeacherFulfillment: (() => {
        const prefTeachers = teacherConstraints.filter(
          (t) => t.schedulingCollegeIds?.length > 0 || t.schedulingLevelIds?.length > 0
        );
        if (prefTeachers.length === 0) return 100;
        const fulfilled = prefTeachers.filter((t) => {
          const cap = mode === 'standard' ? t.standardCap : t.fullCap;
          return t.effectiveTotal + t.assignedHours >= cap;
        }).length;
        return Math.round((fulfilled / prefTeachers.length) * 100);
      })(),
    };
  }

  if (message) result.message = message;
  return result;
}

/**
 * 将逐班需求列表按合班（combinationId）合并为"合班教学单元"。
 *
 * 业务约定：合班成员班周课时相同，物理上合班一节 = 教师 1 个课时槽位。
 * 因此同 combinationId 的成员班合并为一个单元：
 *  - 仅代表班参与算法选择与容量计算（周课时只计 1 次，不放大容量压力）
 *  - memberClassIds 记录所有成员班，落库/返回时展开为 N 行（同教师、同课时）
 * 单成员组合退化为独立班（memberClassIds 不设置）。
 *
 * @param {Array<{classId:number, combinationId:number|null, [k:string]:any}>} classes
 * @returns {Array} 合并后的单元列表（合班单元带 memberClassIds / isCombinedDemand）
 */
export function mergeCombinedClasses(classes) {
  const byComb = new Map();
  const solos = [];
  for (const c of classes) {
    if (c.combinationId != null) {
      if (!byComb.has(c.combinationId)) byComb.set(c.combinationId, []);
      byComb.get(c.combinationId).push(c);
    } else {
      solos.push(c);
    }
  }
  const merged = [];
  for (const [combinationId, members] of byComb) {
    if (members.length === 1) {
      merged.push(members[0]);
      continue;
    }
    // F16 修复：校验合班成员一致性（学院/层次/课时/教材签名），
    // 不一致时拆散为独立班参与排课，避免代表班匹配对成员班失真
    const rep = members[0];
    const repTbSig = (rep.textbookIds || []).slice().sort().join(',');
    const isConsistent = members.every(
      (m) =>
        m.collegeId === rep.collegeId &&
        m.trainingLevelId === rep.trainingLevelId &&
        m.weeklyHours === rep.weeklyHours &&
        (m.textbookIds || []).slice().sort().join(',') === repTbSig
    );
    if (!isConsistent) {
      logger.warn(
        `[合班校验] combinationId=${combinationId} 成员班不一致（学院/层次/课时/教材），拆散为独立班参与排课`
      );
      merged.push(...members);
      continue;
    }
    merged.push({
      ...rep,
      memberClassIds: members.map((m) => m.classId),
      memberClasses: members,
      isCombinedDemand: true,
    });
  }
  return [...solos, ...merged];
}

/**
 * 将单元级安排（可能带 memberClassIds）展开为逐班安排行。
 * 每个单元展开为 N 行，所有行共享同一 teacher_id / course_id / semester / weekly_hours。
 * 合班一致性由"单元内同教师"保证：展开后所有成员班 teacher_id 必然相同。
 *
 * @param {Array<{teacher_id:number, class_id:number, course_id:number, semester:string, weekly_hours:number, memberClassIds?:number[]|null, is_auto?:boolean, [k:string]:any}>} assignments
 * @returns {Array} 逐班安排行
 */
export function expandCombinedAssignments(assignments) {
  const out = [];
  for (const a of assignments) {
    const memberIds = a.memberClassIds && a.memberClassIds.length ? a.memberClassIds : [a.class_id];
    for (const cid of memberIds) {
      out.push({
        teacher_id: a.teacher_id,
        class_id: cid,
        course_id: a.course_id,
        semester: a.semester,
        weekly_hours: a.weekly_hours,
        is_auto: a.is_auto,
        ...(a.is_inherent !== undefined ? { is_inherent: a.is_inherent } : {}),
      });
    }
  }
  return out;
}

/**
 * P2 修复：置换回溯
 * 对未分配班级尝试置换已分配教师，腾出容量接纳未分配班级，提升全局分配率
 * P0-1 修复：改为受限深度递归（maxDepth=3），支持 A→B→C 链式调整
 *   - 先尝试单轮置换（trySwapOne，depth=1 等价）
 *   - 失败后尝试递归链式置换（tryPlaceClass，depth≤3）
 *   - visited 集合防止环，MAX_UNASSIGNED 防止性能爆炸
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

  // P3 修复：大规模欠配时单轮置换同样跳过（trySwapOne 最坏 O(U×T×A×T)，性能保护）
  // ?? Infinity 兜底：旧配置/测试桩未定义该字段时保持原行为
  if (unassigned.length > (SWAP_CONFIG.MAX_SINGLE_SWAP ?? Infinity)) return;

  const teacherMap = new Map(teacherConstraints.map((t) => [t.id, t]));
  // 按教师分组已分配记录，便于查找可置换的班级
  const assignmentsByTeacher = new Map();
  for (const a of assignments) {
    if (!assignmentsByTeacher.has(a.teacher_id)) assignmentsByTeacher.set(a.teacher_id, []);
    assignmentsByTeacher.get(a.teacher_id).push(a);
  }

  // P0-1: 未分配数过多时仅用单轮置换（性能保护）
  const useRecursive = unassigned.length <= SWAP_CONFIG.MAX_UNASSIGNED;

  const stillUnassigned = [];
  for (const u of unassigned) {
    // 第一轮：单轮置换（原有逻辑，兼容 trySwapOne 测试）
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
      continue; // 置换成功
    }
    // 第二轮：递归链式置换（P0-1 新增，仅小规模时启用）
    if (useRecursive) {
      const clsTextbookIds = classTextbookMap.get(u.classId) || u.textbookIds || [];
      const clsInfo = classInfoMap?.get(u.classId);
      const cls = {
        classId: u.classId,
        className: u.className,
        weeklyHours: u.weeklyHours,
        textbookIds: clsTextbookIds,
        collegeId: clsInfo?.collegeId ?? u.collegeId ?? null,
        memberClassIds: u.memberClassIds || null,
      };
      if (
        tryPlaceClass(
          cls,
          assignments,
          assignmentsByTeacher,
          teacherConstraints,
          mode,
          courseId,
          semesterStr,
          classTextbookMap,
          classInfoMap,
          0,
          new Set()
        )
      ) {
        continue; // 链式置换成功
      }
    }
    stillUnassigned.push(u);
  }

  // 用剩余未分配替换原 unassigned
  unassigned.length = 0;
  unassigned.push(...stillUnassigned);
}

// ── P0-1 递归置换辅助函数 ──

/** 从教师 T 驱逐班级 V（乐观修改，失败时需 rollbackEviction 回滚） */
function evictFromTeacher(vAssign, t, assignmentsByTeacher, classTextbookMap) {
  t.assignedHours -= vAssign.weekly_hours;
  const tList = assignmentsByTeacher.get(t.id) || [];
  assignmentsByTeacher.set(
    t.id,
    tList.filter((a) => a !== vAssign)
  );
  // 清理 V 独有教材（T 的剩余分配不再使用）
  const vTextbookIds = classTextbookMap.get(vAssign.class_id) || [];
  const remaining = assignmentsByTeacher.get(t.id) || [];
  for (const tid of vTextbookIds) {
    const stillUsed = remaining.some((a) => {
      const aTbs = classTextbookMap.get(a.class_id) || [];
      return aTbs.includes(tid);
    });
    if (!stillUsed) t.assignedTextbookIds.delete(tid);
  }
}

/** 回滚驱逐：将 V 重新放回教师 T */
function rollbackEviction(vAssign, t, assignmentsByTeacher, classTextbookMap) {
  t.assignedHours += vAssign.weekly_hours;
  if (!assignmentsByTeacher.has(t.id)) assignmentsByTeacher.set(t.id, []);
  assignmentsByTeacher.get(t.id).push(vAssign);
  const vTextbookIds = classTextbookMap.get(vAssign.class_id) || [];
  for (const tid of vTextbookIds) t.assignedTextbookIds.add(tid);
}

/** 将班级 cls 放到教师 T 上（新建或更新分配记录） */
function placeClassOnTeacher(
  cls,
  t,
  assignments,
  assignmentsByTeacher,
  courseId,
  semesterStr,
  classTextbookMap
) {
  t.assignedHours += cls.weeklyHours;
  // F4 修复：维护 assignedCollegeIds，与 recordAssignment 保持一致，
  // 避免后续评分（+3 学院内聚奖励）和禁忌搜索初始状态失真
  if (cls.collegeId != null) t.assignedCollegeIds?.add(cls.collegeId);
  if (cls._existingAssign) {
    // 更新已有分配记录（驱逐场景：V 从 T 移到 T2）
    cls._existingAssign.teacher_id = t.id;
    cls._existingAssign.teacher_name = t.name;
    if (!assignmentsByTeacher.has(t.id)) assignmentsByTeacher.set(t.id, []);
    assignmentsByTeacher.get(t.id).push(cls._existingAssign);
  } else {
    // 新建分配记录（未分配班级场景）
    const newAssign = {
      teacher_id: t.id,
      teacher_name: t.name,
      class_id: cls.classId,
      class_name: cls.className,
      course_id: Number(courseId),
      semester: semesterStr,
      weekly_hours: cls.weeklyHours,
      is_auto: true,
      memberClassIds: cls.memberClassIds || null,
    };
    assignments.push(newAssign);
    if (!assignmentsByTeacher.has(t.id)) assignmentsByTeacher.set(t.id, []);
    assignmentsByTeacher.get(t.id).push(newAssign);
  }
  const clsTextbookIds = classTextbookMap.get(cls.classId) || cls.textbookIds || [];
  for (const tid of clsTextbookIds) t.assignedTextbookIds.add(tid);
}

/** 检查教师 T 添加 cls 后是否超出教材上限（个人开关教师上限覆写为 1） */
function checkTextbookAdd(t, clsTextbookIds) {
  const maxTb = teacherMaxTextbooks(t);
  if (maxTb <= 0 || !clsTextbookIds.length) return true;
  const newTextbooks = clsTextbookIds.filter((tid) => !t.assignedTextbookIds.has(tid));
  return t.assignedTextbookIds.size + newTextbooks.length <= maxTb;
}

/** 检查教师 T 移除 V 后添加 cls 是否超出教材上限 */
function checkTextbookSwap(
  t,
  vTextbookIds,
  clsTextbookIds,
  tAssignments,
  vAssign,
  classTextbookMap
) {
  const maxTb = teacherMaxTextbooks(t);
  if (maxTb <= 0) return true;
  const vUniqueToT = vTextbookIds.filter((tid) => {
    return !tAssignments.some((a) => {
      if (a === vAssign) return false;
      const aTbs = classTextbookMap.get(a.class_id) || [];
      return aTbs.includes(tid);
    });
  });
  const tAfterRemoveSet = new Set(t.assignedTextbookIds);
  for (const tid of vUniqueToT) tAfterRemoveSet.delete(tid);
  const clsNewForT = clsTextbookIds.filter((tid) => !tAfterRemoveSet.has(tid));
  return tAfterRemoveSet.size + clsNewForT.length <= maxTb;
}

/**
 * 受限深度递归放置班级（P0-1 核心函数）
 * 策略：为 cls 寻找教师 T。若 T 有直接容量则放置；否则驱逐 T 的某个分配 V，
 *       递归为 V 寻找新家，成功后放置 cls 于 T。
 * @param {object} cls - { classId, className, weeklyHours, textbookIds, _existingAssign? }
 * @param {number} depth - 当前递归深度
 * @param {Set} visited - 已访问的 (teacherId:classId) 对，防止环
 * @param {number|null} [excludeTeacherId] - 驱逐来源教师ID，递归时排除该教师防止"驱逐→放回"无效循环
 * @returns {boolean} 是否成功放置
 */
function tryPlaceClass(
  cls,
  assignments,
  assignmentsByTeacher,
  teacherConstraints,
  mode,
  courseId,
  semesterStr,
  classTextbookMap,
  classInfoMap,
  depth,
  visited,
  excludeTeacherId = null
) {
  const clsTextbookIds = classTextbookMap.get(cls.classId) || cls.textbookIds || [];

  // F3 修复：候选教师按评分降序排列（同分按剩余容量降序），
  // 使第一个可行解即为最优评分解，避免置换无声侵蚀内聚率与匹配率
  const clsInfo = classInfoMap?.get(cls.classId);
  const scoringCls = {
    collegeId: clsInfo?.collegeId ?? cls.collegeId,
    trainingLevelId: clsInfo?.trainingLevelId,
    textbookIds: clsTextbookIds,
  };
  // P2 性能修复：排序前预计算评分，避免比较器内 O(T log T) 次重复调用 calcMatchScore
  const scoreById = new Map(teacherConstraints.map((t) => [t.id, calcMatchScore(t, scoringCls)]));
  const sortedTeachers = [...teacherConstraints].sort((a, b) => {
    const sa = scoreById.get(a.id);
    const sb = scoreById.get(b.id);
    if (sb !== sa) return sb - sa;
    const capA = mode === 'standard' ? a.standardCap : a.fullCap;
    const capB = mode === 'standard' ? b.standardCap : b.fullCap;
    return capB - b.assignedHours - (capA - a.assignedHours);
  });

  for (const t of sortedTeachers) {
    // 驱逐来源教师跳过：防止被驱逐的班级放回原教师（无效循环）
    if (excludeTeacherId != null && t.id === excludeTeacherId) continue;
    // 资格校验
    if (clsInfo) {
      if (t.schedulingCollegeIds?.length > 0 && !t.schedulingCollegeIds.includes(clsInfo.collegeId))
        continue;
      if (
        t.schedulingLevelIds?.length > 0 &&
        clsInfo.trainingLevelId &&
        !t.schedulingLevelIds.includes(clsInfo.trainingLevelId)
      )
        continue;
      if (!clsInfo.trainingLevelId && t.schedulingLevelIds?.length > 0) continue;
    }

    const cap = mode === 'standard' ? t.standardCap : t.fullCap;

    // 直接放置（T 有容量）
    if (t.assignedHours + cls.weeklyHours <= cap) {
      if (checkTextbookAdd(t, clsTextbookIds)) {
        placeClassOnTeacher(
          cls,
          t,
          assignments,
          assignmentsByTeacher,
          courseId,
          semesterStr,
          classTextbookMap
        );
        return true;
      }
    }

    // 需要驱逐 T 的某个分配 V
    if (depth >= SWAP_CONFIG.MAX_DEPTH) continue;

    const tAssignments = assignmentsByTeacher.get(t.id) || [];
    for (const vAssign of tAssignments) {
      const key = `${t.id}:${vAssign.class_id}`;
      if (visited.has(key)) continue;

      const vHours = vAssign.weekly_hours;
      if (t.assignedHours - vHours + cls.weeklyHours > cap) continue;

      const vTextbookIds = classTextbookMap.get(vAssign.class_id) || [];
      if (
        !checkTextbookSwap(t, vTextbookIds, clsTextbookIds, tAssignments, vAssign, classTextbookMap)
      )
        continue;

      // 乐观驱逐 V
      visited.add(key);
      evictFromTeacher(vAssign, t, assignmentsByTeacher, classTextbookMap);

      // 递归为 V 寻找新家
      const vClsInfo = classInfoMap?.get(vAssign.class_id);
      const vCls = {
        classId: vAssign.class_id,
        className: vAssign.class_name,
        weeklyHours: vAssign.weekly_hours,
        textbookIds: vTextbookIds,
        collegeId: vClsInfo?.collegeId ?? null,
        _existingAssign: vAssign,
      };
      if (
        tryPlaceClass(
          vCls,
          assignments,
          assignmentsByTeacher,
          teacherConstraints,
          mode,
          courseId,
          semesterStr,
          classTextbookMap,
          classInfoMap,
          depth + 1,
          visited,
          t.id
        )
      ) {
        // V 找到新家，将 cls 放入 T
        placeClassOnTeacher(
          cls,
          t,
          assignments,
          assignmentsByTeacher,
          courseId,
          semesterStr,
          classTextbookMap
        );
        visited.delete(key);
        return true;
      }

      // 回滚：将 V 重新放回 T
      rollbackEviction(vAssign, t, assignmentsByTeacher, classTextbookMap);
      visited.delete(key);
    }
  }
  return false;
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
        // B-03 语义对齐：班级无培养层次时，有层次约束的教师不可接管 U（与下方 V 班级的守卫对称）
        if (!uInfo.trainingLevelId && t.schedulingLevelIds?.length > 0) continue;
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

      // F3 修复：T'' 候选按评分降序排列，使被驱逐班级 V 去最优教师
      const vInfo = classInfoMap?.get(vAssign.class_id);
      const scoringV = {
        collegeId: vInfo?.collegeId,
        trainingLevelId: vInfo?.trainingLevelId,
        textbookIds: vTextbookIds,
      };
      // P2 性能修复：排序前预计算评分，避免比较器内重复调用 calcMatchScore
      const scoreV = new Map(teacherConstraints.map((tc) => [tc.id, calcMatchScore(tc, scoringV)]));
      const sortedT2 = [...teacherConstraints].sort((a, b) => {
        if (a.id === t.id) return 1;
        if (b.id === t.id) return -1;
        return scoreV.get(b.id) - scoreV.get(a.id);
      });

      // 找接管 V 的教师 T''
      for (const t2 of sortedT2) {
        if (t2.id === t.id) continue;
        const t2Cap = mode === 'standard' ? t2.standardCap : t2.fullCap;
        if (t2.assignedHours + vHours > t2Cap) continue;

        // S-02 修复：校验 T2 对 V（被接管班级）的学院/层次资格
        // P1-5 修复：补齐可选链，与 L543/L546 保持一致，防止外部调用传入不完整 teacher 对象时 TypeError
        if (vInfo) {
          if (
            t2.schedulingCollegeIds?.length > 0 &&
            !t2.schedulingCollegeIds.includes(vInfo.collegeId)
          )
            continue;
          if (
            t2.schedulingLevelIds?.length > 0 &&
            vInfo.trainingLevelId &&
            !t2.schedulingLevelIds.includes(vInfo.trainingLevelId)
          )
            continue;
          // 审计修复：班级无培养层次时，有层次约束的教师不可接管
          if (!vInfo.trainingLevelId && t2.schedulingLevelIds?.length > 0) continue;
        }

        // 修复：教材上限检查（防止置换越狱，个人开关教师上限覆写为 1）
        // 必须计算 V 的教材对 T 是否“独有”（T 的其他班级不再使用），置换后需清理
        const maxTbT = teacherMaxTextbooks(t);
        const maxTbT2 = teacherMaxTextbooks(t2);
        if (maxTbT > 0 || maxTbT2 > 0) {
          // 计算 V 的教材中哪些是 T 独有的（T 的其他分配不再用到）
          vUniqueToT = vTextbookIds.filter((tid) => {
            return !tAssignments.some((a) => {
              if (a === vAssign) return false;
              const aTbs = classTextbookMap.get(a.class_id) || [];
              return aTbs.includes(tid);
            });
          });
          // C-2 修复：先计算 T 移除 V 独有教材后的集合，再基于该集合计算 U 的新增教材
          // 旧代码直接基于移除前集合计算 uNewForT，导致被移除的教材仍被视为“已有”，少算新增
          const tAfterRemoveSet = new Set(t.assignedTextbookIds);
          for (const tid of vUniqueToT) tAfterRemoveSet.delete(tid);
          const uNewForT = (u.textbookIds || []).filter((tid) => !tAfterRemoveSet.has(tid));
          // T 置换后教材数 = 移除后集合大小 + U新增
          const afterSwapTSize = tAfterRemoveSet.size + uNewForT.length;
          if (maxTbT > 0 && afterSwapTSize > maxTbT) continue;

          // T'' 接管 V 后教材数
          const vNewForT2 = vTextbookIds.filter((tid) => !t2.assignedTextbookIds.has(tid));
          const afterSwapT2Size = t2.assignedTextbookIds.size + vNewForT2.length;
          if (maxTbT2 > 0 && afterSwapT2Size > maxTbT2) continue;
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
        // F4 修复：维护学院内聚追踪。T 接管 U、T'' 接管 V 后，需将对应学院加入各自集合，
        // 否则后续 calcMatchScore 的 +3 学院内聚奖励与 takeClassesForTeacher 的学院排序失真。
        // （placeClassOnTeacher/recordAssignment 已维护，但 trySwapOne 直接操作状态，此前遗漏）
        // 可选链守卫：外部调用（如测试）可能传入不完整 teacher 对象，与 L1015/L1067 风格一致
        const uInfoForCollege = classInfoMap?.get(u.classId);
        if (uInfoForCollege?.collegeId != null)
          t.assignedCollegeIds?.add(uInfoForCollege.collegeId);
        if (vInfo?.collegeId != null) t2.assignedCollegeIds?.add(vInfo.collegeId);
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
          memberClassIds: u.memberClassIds || null,
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
 * @param {string[]} scheduleConditions - ⚠️ 已废弃（P2-10）：控制器层已拒绝非空值，保留参数仅为向后兼容
 * @param {object} [options] - 可选参数
 * @param {boolean} [options.preview=false] - 预览模式（只计算不写库）
 * @param {number} [options.capacityReserveRatio=1.0] - 容量预留比例（批量排课传入 <1 为后续课程预留空间）
 * @param {Set<number>} [options.reserveExemptTeacherIds] - 免预留的教师 ID 集合（批量中无后续课程的教师）
 * @param {boolean} [options.customHoursGuarantee=false] - 自定义课时硬保障开关（系统设置）：开启后保障目标取自定义课时值而非与类别标准取严
 */
export async function autoArrange(
  courseId,
  semesterStr,
  mode,
  hourSettings,
  scheduleConditions,
  options = {}
) {
  const {
    preview = false,
    extraTeacherHours = null,
    globalTextbookMap = null,
    capacityReserveRatio = 1.0,
    reserveExemptTeacherIds = null,
    customHoursGuarantee = false,
  } = options;
  const onProgress = options.onProgress;
  const _arrangeStart = Date.now();

  validateHourSettings(hourSettings);

  // P1-12 修复：批量排课进行中拒绝单课程排课
  // 批量内部调用通过 options.skipBatchLockCheck=true 绕过此检查
  if (!options.skipBatchLockCheck && batchLocks.has(semesterStr)) {
    throw new Error(`学期 ${semesterStr} 批量排课进行中，请稍后再试`);
  }

  // C-2: 并发保护——同一课程+学期不允许并发排课
  const lockKey = `${courseId}:${semesterStr}`;
  if (arrangeLocks.has(lockKey)) {
    throw new Error('该课程正在排课中，请稍后重试');
  }
  // B-01 修复：在进程内存锁之外，额外获取数据库锁以支持多实例部署
  const dbLockKey = `arrange:${lockKey}`;
  const dbLocked = await acquireLock(dbLockKey);
  if (!dbLocked) {
    throw new Error('该课程正在排课中（其他实例），请稍后重试');
  }
  arrangeLocks.add(lockKey);

  try {
    const teachers = await getTeachersForCourse(courseId, semesterStr);
    if (!teachers.length) {
      // 提前返回前查询手动安排数，避免 manualCount 误报为 0（M-1 修复）
      const manualCount = await prisma.teaching_assignments.count({
        where: { course_id: Number(courseId), semester: semesterStr, is_auto: false },
      });
      return buildResult([], [], [], manualCount, '该课程没有可用教师', preview, [], null, mode);
    }

    const classes = await getClassesWithCourse(courseId, semesterStr);
    if (!classes.length) {
      const manualCount = await prisma.teaching_assignments.count({
        where: { course_id: Number(courseId), semester: semesterStr, is_auto: false },
      });
      return buildResult(
        [],
        [],
        [],
        manualCount,
        '当前学期没有开设该课程的班级',
        preview,
        [],
        null,
        mode
      );
    }

    const manualAssignments = await prisma.teaching_assignments.findMany({
      where: { course_id: Number(courseId), semester: semesterStr, is_auto: false },
    });
    // 锁定的自动安排也需排除（不参与重新分配）
    const lockedAssignments = await prisma.teaching_assignments.findMany({
      where: { course_id: Number(courseId), semester: semesterStr, is_auto: true, is_locked: true },
    });
    const manualClassIds = new Set([
      ...manualAssignments.map((a) => a.class_id),
      ...lockedAssignments.map((a) => a.class_id),
    ]);

    // 获取已自动排课的记录（含班级 combination_id，用于合班去重）
    const currentAutoAssignments = await prisma.teaching_assignments.findMany({
      where: {
        course_id: Number(courseId),
        semester: semesterStr,
        is_auto: true,
        is_locked: false,
      },
      select: {
        teacher_id: true,
        course_id: true,
        class_id: true,
        weekly_hours: true,
        class: { select: { combination_id: true } },
      },
    });
    // 合班场景下同一 (combination_id, course, teacher) 会有多条记录，
    // 用 dedupeTeachingUnits 去重后再按教师汇总课时，避免重复计数
    const dedupedAutoUnits = dedupeTeachingUnits(currentAutoAssignments);
    const autoHoursMap = new Map();
    for (const unit of dedupedAutoUnits) {
      const tid = unit.representative.teacher_id;
      autoHoursMap.set(tid, (autoHoursMap.get(tid) || 0) + unit.weeklyHours);
    }

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
    // 合班归并：同 combinationId 的成员班合并为 1 个教学单元（容量/选择按 1 班计，落库再展开）
    const mergedDemands = mergeCombinedClasses(validClassesToAssign);

    const teacherConstraints = buildTeacherConstraints(
      teachers,
      hourSettings,
      autoHoursMap,
      mode,
      extraTeacherHours,
      capacityReserveRatio,
      reserveExemptTeacherIds,
      customHoursGuarantee
    );

    // S-13 修复：预览模式下从前序课程累计教材负载
    // 审计修复：改为并集合并而非替换，保留 buildTeacherConstraints 从 DB 已排记录
    // 解析出的教材种子，避免批量第 2 门课起丢失 DB 教材导致 H4 全学期 2 本硬上限失效
    if (globalTextbookMap) {
      for (const t of teacherConstraints) {
        const prevTbs = globalTextbookMap.get(t.id);
        if (prevTbs && prevTbs.size > 0) {
          t.assignedTextbookIds = new Set([...(t.assignedTextbookIds || []), ...prevTbs]);
        }
      }
    }

    // === 固有班级延续：构建上学期快照 ===
    // 开关在排课开始时读取一次并固化，避免批量排课中途切换导致前后课程行为不一致。
    // 单课程：未显式传入时查 DB（key='inherent_class_enabled'），静态常量作为兜底默认；
    // 批量排课：batch.js 开始时读一次开关并预查上学期全量记录，经 options 传入，
    //           避免逐课程重复查询（N 门课 = N 次查询）。
    let inherentClassEnabled = options.inherentClassEnabled;
    if (inherentClassEnabled === undefined) {
      inherentClassEnabled = INHERENT_CLASS.ENABLED;
      if (!inherentClassEnabled) {
        try {
          const icSetting = await prisma.system_settings.findUnique({
            where: { key: 'inherent_class_enabled' },
          });
          if (icSetting?.value === 'true') inherentClassEnabled = true;
        } catch (_) {
          // DB 查询失败保持默认关闭，不影响排课主流程
        }
      }
    }
    if (inherentClassEnabled) {
      let inherentClassMap = null;
      const prevSemester = getPreviousSemester(semesterStr);
      if (options.inherentClassMap !== undefined) {
        // 批量模式：使用 batch.js 预加载的全课程快照；
        // 本课程无上学期记录时为空 Map，不再回查 DB（避免逐课程重复查询）
        inherentClassMap = options.inherentClassMap.get(Number(courseId)) || new Map();
      } else if (prevSemester) {
        try {
          const prevRows = await prisma.teaching_assignments.findMany({
            where: { course_id: Number(courseId), semester: prevSemester },
            select: { teacher_id: true, class_id: true },
          });
          inherentClassMap = new Map();
          for (const row of prevRows) {
            if (!inherentClassMap.has(row.teacher_id)) inherentClassMap.set(row.teacher_id, new Set());
            inherentClassMap.get(row.teacher_id).add(row.class_id);
          }
        } catch (_) {
          inherentClassMap = null; // 查询失败静默降级为无延续数据，行为退化为现状
        }
      }
      if (inherentClassMap?.size > 0) {
        let snapshotTeachers = 0;
        let snapshotClasses = 0;
        for (const t of teacherConstraints) {
          const classIds = inherentClassMap.get(t.id);
          if (classIds?.size > 0) {
            // 复制为每位教师独立的 Set：批量/补漏轮会多次调用 autoArrange，
            // 若直接共享 Map 中的 Set，某次调用的意外修改会污染后续调用
            t.inherentClassIds = new Set(classIds);
            snapshotTeachers++;
            snapshotClasses += classIds.size;
          }
        }
        if (snapshotTeachers > 0) {
          logger.info(
            `[固有班级延续] 课程 ${courseId} 上学期=${prevSemester || '(无法推算)'}：${snapshotTeachers} 位教师共 ${snapshotClasses} 个固有班级快照`
          );
        }
      }
    }

    // === 版本标记：验证代码已加载 ===
    logger.debug(
      `[TEXTBOOK_COHESION] v2024-06-20-REWRITE autoArrange 入口 courseId=${courseId} semester=${semesterStr} mode=${mode}`
    );

    // === 诊断日志（八轮：定位"全员2本"根因）===
    // F10 修复：整体包 debug 级别守卫，避免 ENABLED=true 时无条件构建大字符串
    if (TEXTBOOK_COHESION.ENABLED && (logger.isDebugEnabled?.() ?? logger.level === 'debug')) {
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

    const totalClassHours = mergedDemands.reduce((s, c) => s + c.weeklyHours, 0);
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
      // F11 修复：排序前预计算 eligibleCount Map（O(C×T)），
      // 替代比较器内重复调用 countEligibleTeachers（O(C log C × 2T)）
      const eligibleCountMap = new Map();
      if (!preserveOrder) {
        for (const cls of classList) {
          eligibleCountMap.set(cls.classId, countEligibleTeachers(cls, eligibilityFilter));
        }
      }
      const sorted = preserveOrder
        ? [...classList]
        : [...classList].sort((a, b) => {
            const ea = eligibleCountMap.get(a.classId) || 0;
            const eb = eligibleCountMap.get(b.classId) || 0;
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

            // 硬上限检查：已达教材上限的教师，只能接已持有教材的班级（个人开关上限覆写为 1）
            const maxTb = teacherMaxTextbooks(t);
            if (maxTb > 0) {
              const tbCount = t.assignedTextbookIds?.size ?? 0;
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
          memberClassIds: cls.memberClassIds || null,
        });
      }
      return remaining;
    }

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

    // F12 修复：意向教师供给不足前置预警
    // 意向是硬约束（全链路），意向学院/层次内供给 < 教师容量时该教师注定欠课时，
    // 提前输出 warning 避免像"蒋梅问题"一样事后逐人排查
    // prefSupplyWarnedIds：供标准课时保障轮后的欠课时告警去重，避免同一教师重复告警
    const prefSupplyWarnedIds = new Set();
    for (const t of teacherConstraints) {
      if (!t.schedulingCollegeIds?.length && !t.schedulingLevelIds?.length) continue;
      const cap = maxCapFn(t);
      if (cap <= 0) continue;
      let prefSupply = 0;
      for (const cls of mergedDemands) {
        if (isPrefMatch(t, cls)) prefSupply += cls.weeklyHours || 0;
      }
      if (prefSupply < cap) {
        warnings.push(
          `教师${t.name}意向范围内供给${prefSupply}h < 容量${cap}h（容量按自定义课时/类别配置从紧），无法排满`
        );
        prefSupplyWarnedIds.add(t.id);
      }
    }

    // --- 手动排课 & 锁定安排教材追踪 ---
    // 手动排课和锁定的班级虽然不参与自动排课，但教师已分配的教材和课时需要计入
    const allClassMap = new Map(classes.map((c) => [c.classId, c]));
    const protectedAssignments = [...manualAssignments, ...lockedAssignments];
    for (const ma of protectedAssignments) {
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
    logger.debug(
      `[手动排课追踪] ${protectedAssignments.length} 条受保护安排（手动${manualAssignments.length}+锁定${lockedAssignments.length}），教师教材已更新`
    );

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
        memberClassIds: cls.memberClassIds || null,
      });
    }

    // --- 辅助函数：检查班级教材是否可放入投影集合（不超限） ---
    function canFitTextbook(clsTextbookIds, projectedTextbooks, maxTb) {
      if (!clsTextbookIds?.length) return true;
      const newTbs = clsTextbookIds.filter((tid) => !projectedTextbooks.has(tid));
      return projectedTextbooks.size + newTbs.length <= maxTb;
    }

    // --- 辅助函数：教师从可用班级中拿取，直到课时满 ---
    // capOverride：标准课时保障轮传入，覆写容量上限（到 standard 即停，不吃到 max）；
    // 其余调用点不传，行为不变
    function takeClassesForTeacher(teacher, availableClasses, strictPrefCheck = true, capOverride = null) {
      const cap = capOverride ?? maxCapFn(teacher);
      const remainingCap = cap - teacher.assignedHours;
      if (remainingCap <= 0) return [];

      const taken = [];
      let usedHours = 0;

      // P1-2 修复：追踪“假设拿取后”的教材集合，防止累计超限（个人开关教师上限覆写为 1）
      const takeMaxTb = teacherMaxTextbooks(teacher);
      const useTbLimit = takeMaxTb > 0;
      const projectedTextbooks = useTbLimit ? new Set(teacher.assignedTextbookIds) : null;

      // 按学院排序：教师已分配的学院优先，然后按学院ID排序
      // 固有班级延续：上学期教过的班级最优先（延续 > 学院内聚）；
      // 门控为快照存在性，开关关闭时 inherentClassIds 缺失，排序退化为原逻辑
      const sorted = [...availableClasses].sort((a, b) => {
        if (teacher.inherentClassIds) {
          const aInherent = teacher.inherentClassIds.has(a.classId) ? 0 : 1;
          const bInherent = teacher.inherentClassIds.has(b.classId) ? 0 : 1;
          if (aInherent !== bInherent) return aInherent - bInherent;
        }
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

      // F6 修复：装箱补洞——贪婪拿取后若剩余容量有缺口，尝试精确补位
      // 场景：容量16、全是3h班 → 拿到15h留1h永久缺口，累积导致教师排不满标准课时
      const gap = remainingCap - usedHours;
      if (gap > 0) {
        const takenIds = new Set(taken.map((c) => c.classId));
        // 方案1：找恰好填补缺口的未拿班级
        const filler = sorted.find(
          (cls) =>
            !takenIds.has(cls.classId) &&
            cls.weeklyHours === gap &&
            (!strictPrefCheck || isPrefMatch(teacher, cls)) &&
            (!useTbLimit || canFitTextbook(cls.textbookIds, projectedTextbooks, takeMaxTb))
        );
        if (filler) {
          taken.push(filler);
          if (useTbLimit && filler.textbookIds?.length) {
            for (const tid of filler.textbookIds) projectedTextbooks.add(tid);
          }
        } else {
          // 方案2：单交换——换出已拿的 x、换入 y（y.hours − x.hours === gap）
          for (const x of taken) {
            const targetHours = x.weeklyHours + gap;
            const y = sorted.find(
              (cls) =>
                !takenIds.has(cls.classId) &&
                cls.weeklyHours === targetHours &&
                (!strictPrefCheck || isPrefMatch(teacher, cls)) &&
                (!useTbLimit || canFitTextbook(cls.textbookIds, projectedTextbooks, takeMaxTb))
            );
            if (y) {
              const idx = taken.indexOf(x);
              taken[idx] = y;
              if (useTbLimit && y.textbookIds?.length) {
                for (const tid of y.textbookIds) projectedTextbooks.add(tid);
              }
              break;
            }
          }
        }
      }

      return taken;
    }

    // --- F2 修复：教师视角选组共享函数 ---
    // 从阶段1提取，阶段2复用。参数化 strictPref 控制意向约束：
    //   strictPref=true  → 阶段1（有意向教师，isPrefMatch 严格过滤）
    //   strictPref=false → 阶段2（无意向教师，isPrefMatch 对所有教师返回 true）
    // 每位教师连续拿组（天然满足"先拿完第一本，再拿第二本"），
    // 直到容量不足、教材名额用尽或无可拿组。
    function takeGroupsForTeacher(teacher, groupAvailable, strictPref, tierZeroOnly = false, capOverride = null) {
      // 个人开关教师上限覆写为 1（不受全局 ENABLED 影响），否则跟随全局配置
      const maxTb = teacherMaxTextbooks(teacher);
      const useTbLimit = maxTb > 0;
      // 保障轮传入 capOverride 时到标准课时即停，否则吃到当前模式容量上限
      const effectiveCap = capOverride ?? maxCapFn(teacher);

      for (;;) {
        const remainingCap = effectiveCap - teacher.assignedHours;
        if (remainingCap <= 0) break;

        let best = null;
        for (const [tbKey, available] of groupAvailable) {
          if (available.length === 0) continue;

          const textbookIds = tbKey === '__no_textbook__' ? [] : tbKey.split(',').map(Number);
          const holdsGroupTb =
            textbookIds.length > 0 &&
            textbookIds.some((tid) => teacher.assignedTextbookIds.has(tid));

          // 种子续接轮：仅允许拿取已持有教材的组，不开新教材
          if (tierZeroOnly && !holdsGroupTb) continue;

          // 教材上限预检
          if (useTbLimit && textbookIds.length > 0) {
            const newTbCount = textbookIds.filter(
              (tid) => !teacher.assignedTextbookIds.has(tid)
            ).length;
            if (teacher.assignedTextbookIds.size + newTbCount > maxTb) continue;
          }

          // 本人可拿课时（strictPref 控制意向过滤）
          let matchHours = 0;
          let groupDemand = 0;
          let collegeMatchHours = 0; // L3：可拿课时中属于教师已分配学院的部分
          for (const cls of available) {
            groupDemand += cls.weeklyHours || 0;
            if (
              (cls.weeklyHours || 0) <= remainingCap &&
              (!strictPref || isPrefMatch(teacher, cls))
            ) {
              matchHours += cls.weeklyHours || 0;
              if (teacher.assignedCollegeIds?.has(cls.collegeId)) {
                collegeMatchHours += cls.weeklyHours || 0;
              }
            }
          }
          if (matchHours <= 0) continue;

          const tier = holdsGroupTb ? 0 : 1;
          // L3 修复：同 tier 且可拿课时接近（≥另一方的 GROUP_PROXIMITY_RATIO）时，
          // 优先选已分配学院课时更多的组（学院内聚软目标），否则仍按 matchHours 最大化
          let better;
          if (!best) {
            better = true;
          } else if (tier !== best.tier) {
            better = tier < best.tier;
          } else {
            const close =
              Math.min(matchHours, best.matchHours) >=
              Math.max(matchHours, best.matchHours) * GROUP_PROXIMITY_RATIO;
            if (close && collegeMatchHours !== best.collegeMatchHours) {
              better = collegeMatchHours > best.collegeMatchHours;
            } else if (matchHours !== best.matchHours) {
              better = matchHours > best.matchHours;
            } else if (groupDemand !== best.groupDemand) {
              better = groupDemand > best.groupDemand;
            } else {
              better = tbKey < best.tbKey;
            }
          }
          if (better) {
            best = { tbKey, available, matchHours, groupDemand, tier, collegeMatchHours };
          }
        }
        if (!best) break;

        const matchingClasses = strictPref
          ? best.available.filter((cls) => isPrefMatch(teacher, cls))
          : best.available;
        const taken = takeClassesForTeacher(teacher, matchingClasses, strictPref, capOverride);
        if (taken.length === 0) break; // 防死循环兜底
        for (const cls of taken) {
          recordAssignment(teacher, cls);
          const idx = best.available.findIndex((c) => c.classId === cls.classId);
          if (idx >= 0) best.available.splice(idx, 1);
        }
        logger.debug(`  [选组] ${teacher.name} 拿取教材组 ${best.tbKey}: ${taken.length} 个班级`);
      }
    }

    // --- 步骤1：按教材分组 ---
    const textbookGroups = new Map();
    for (const cls of mergedDemands) {
      const key =
        cls.textbookIds && cls.textbookIds.length > 0
          ? cls.textbookIds.slice().sort().join(',')
          : '__no_textbook__';
      if (!textbookGroups.has(key)) textbookGroups.set(key, []);
      textbookGroups.get(key).push(cls);
    }

    // 每组内按学院排序（保证同教材内优先拿完一个学院）
    for (const [, group] of textbookGroups) {
      group.sort((a, b) => {
        if (a.collegeId !== b.collegeId) return a.collegeId - b.collegeId;
        return a.classId - b.classId;
      });
    }

    logger.debug(`[新分配算法v2] 共 ${textbookGroups.size} 个教材组，开始分配...`);
    for (const [key, group] of textbookGroups) {
      logger.debug(`  教材组 ${key}: ${group.length} 个班级`);
    }

    // 跟踪每个教材组的可用班级（可变数组），按需求量降序遍历
    const groupAvailable = buildGroupAvailable(textbookGroups);

    // ================================================================
    // 第一阶段：处理有指定意向的教师（严格按意向分配）
    // 教师视角选组：按"本人意向范围内可拿课时"降序挑选教材组，
    // 而非按全局需求顺序遍历。防止全局需求大但意向内只有零头课时的组
    // 烧掉教材名额（MAX_TEXTBOOKS_PER_TEACHER），把意向内课时充足的组锁死
    // ================================================================
    logger.info('[阶段1] 意向教师按可拿课时最大的教材组优先拿取');
    if (onProgress)
      try {
        onProgress({ phase: 1, phaseName: '意向教师分配', total: 5 });
      } catch (_) {}

    const teachersWithPref = teacherConstraints.filter(
      (t) => t.schedulingCollegeIds?.length > 0 || t.schedulingLevelIds?.length > 0
    );

    // 优先处理剩余容量大的教师（与原实现口径一致）
    const prefTeachersSorted = [...teachersWithPref].sort(
      (a, b) => maxCapFn(b) - b.assignedHours - (maxCapFn(a) - a.assignedHours)
    );

    for (const teacher of prefTeachersSorted) {
      // F2 修复：使用共享选组函数（strictPref=true，意向教师严格按 isPrefMatch 过滤）
      takeGroupsForTeacher(teacher, groupAvailable, true);
    }

    for (const [tbKey, available] of groupAvailable) {
      logger.debug(`  [阶段1] 教材组 ${tbKey}: 剩余 ${available.length} 个班级`);
    }

    // ================================================================
    // 标准课时保障轮（阶段1 与 阶段2 之间）
    // 五阶段贪心按"剩余容量降序"选教师，大容量教师先整组吃光班级，
    // 导致教师充足时仍随机出现个别教师欠标准课时。本轮让有缺口的教师
    // 按 专职 > 兼职 > 外聘、缺口降序 优先拿班，拿到目标课时即停
    // （目标 = guaranteeCap，即自定义课时与类别标准取严；
    // capOverride = min(当前模式容量, guaranteeCap)），
    // 把超额课时留给后续阶段分配。
    // 复用 takeGroupsForTeacher：意向硬约束、教材上限、单教材开关、
    // 学院内聚、tier 0 已持教材组优先等规则全部照旧生效。
    // ================================================================
    logger.info(
      `[标准课时保障轮] 按专职>兼职>外聘优先补足目标课时（${
        customHoursGuarantee ? '硬保障已开启：目标取自定义课时' : '自定义与类别标准取严'
      }）`
    );

    const personnelGuaranteeRank = (t) => {
      const type = t.personnelType || 'full_time';
      if (type === 'full_time') return 0;
      if (type === 'part_time') return 1;
      return 2; // external 及未知类别
    };
    const guaranteeCandidates = teacherConstraints
      .filter((t) => t.guaranteeCap - t.assignedHours > 0)
      .sort((a, b) => {
        const rankDiff = personnelGuaranteeRank(a) - personnelGuaranteeRank(b);
        if (rankDiff !== 0) return rankDiff;
        const gapDiff = b.guaranteeCap - b.assignedHours - (a.guaranteeCap - a.assignedHours);
        if (gapDiff !== 0) return gapDiff;
        const capLeftDiff = maxCapFn(b) - b.assignedHours - (maxCapFn(a) - a.assignedHours);
        if (capLeftDiff !== 0) return capLeftDiff;
        return a.id - b.id; // 确定性兜底
      });

    for (const teacher of guaranteeCandidates) {
      if (teacher.guaranteeCap - teacher.assignedHours <= 0) continue;
      const capOverride = Math.min(maxCapFn(teacher), teacher.guaranteeCap);
      const hasPref = teacher.schedulingCollegeIds?.length > 0 || teacher.schedulingLevelIds?.length > 0;
      takeGroupsForTeacher(teacher, groupAvailable, hasPref, false, capOverride);
    }
    logger.debug(
      `[标准课时保障轮] ${guaranteeCandidates.length} 位有缺口教师参与，分配后累计 ${assignments.length} 条`
    );

    // ================================================================
    // 第二阶段：处理无指定意向的教师（按课时容量去拿）
    // F2 修复：改用教师视角选组（与阶段1共享 takeGroupsForTeacher），
    // 防止"零头组烧教材名额"模式（阶段1同款缺陷在无意向教师上的翻版）。
    // 阶段4（第二本教材）被天然吸收：教师视角选组本就允许开第二本。
    // ================================================================
    logger.info('[阶段2] 无指定意向的教师拿第一本教材');
    if (onProgress)
      try {
        onProgress({ phase: 2, phaseName: '无意向教师分配', total: 5 });
      } catch (_) {}

    const teachersWithoutPref = teacherConstraints.filter(
      (t) => !t.schedulingCollegeIds?.length && !t.schedulingLevelIds?.length
    );

    // L1 修复（种子续接轮）：已持有教材（手动排课/跨课程 DB 种子）的无意向教师
    // 先行续接本人已持教材组。阶段2按剩余容量降序处理，种子教师容量被扣减后
    // 排序靠后，其教材组可能被大容量空闲教师整组抢走，迫使种子教师开第二本教材。
    // 此轮仅允许拿取已持有教材的组（tierZeroOnly=true），不占用新教材名额。
    const seededTeachers = teachersWithoutPref
      .filter((t) => t.assignedTextbookIds.size > 0)
      .sort((a, b) => maxCapFn(b) - b.assignedHours - (maxCapFn(a) - a.assignedHours));
    for (const teacher of seededTeachers) {
      takeGroupsForTeacher(teacher, groupAvailable, false, true);
    }
    if (seededTeachers.length > 0) {
      logger.debug(`[阶段2-种子续接] ${seededTeachers.length} 位已持教材教师优先续接本人教材组`);
    }

    // 按剩余容量降序处理（与阶段1口径一致）
    const noPrefSorted = [...teachersWithoutPref].sort(
      (a, b) => maxCapFn(b) - b.assignedHours - (maxCapFn(a) - a.assignedHours)
    );

    for (const teacher of noPrefSorted) {
      // F2 修复：教师视角选组（strictPref=false，无意向教师不做 isPrefMatch 过滤）
      takeGroupsForTeacher(teacher, groupAvailable, false);
    }

    for (const [tbKey, available] of groupAvailable) {
      logger.debug(`  [阶段2] 教材组 ${tbKey}: 剩余 ${available.length} 个班级`);
    }

    // ================================================================
    // 第三阶段：所有教师追加同教材班级（不增加教材数）
    // 注意：`__no_textbook__` 组（textbookIds=[]）时，过滤条件
    // `textbookIds.length === 0 || textbookIds.some(...)` 恒为 true，
    // 即无教材班级在此阶段会被全体已持教材教师处理（不占教材名额，可安全追加）。
    // ================================================================
    logger.info('[阶段3] 所有教师追加同教材班级');
    if (onProgress)
      try {
        onProgress({ phase: 3, phaseName: '追加同教材班级', total: 5 });
      } catch (_) {}

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
    // F2 修复：改为教师视角选组（与阶段1/2一致），复用 takeGroupsForTeacher。
    // 原实现按 groupAvailable 全局需求降序遍历组、组内教师吃满，存在"零头组烧教材名额"
    // 风险（教师先拿小组消耗第2本教材名额，大组无法接管）。
    // takeGroupsForTeacher 的 tier 分级（已持有教材组 tier 0 优先）+ matchHours 最大化，
    // 确保教师优先拿本人可教课时最多的组，避免名额浪费。
    // ================================================================
    logger.info('[阶段4] 所有教师拿第二本教材（教师视角选组）');
    if (onProgress)
      try {
        onProgress({ phase: 4, phaseName: '第二本教材分配', total: 5 });
      } catch (_) {}

    const stage4Teachers = [...teacherConstraints]
      .filter((t) => maxCapFn(t) - t.assignedHours > 0)
      .sort((a, b) => maxCapFn(b) - b.assignedHours - (maxCapFn(a) - a.assignedHours));

    for (const teacher of stage4Teachers) {
      // 早退：所有组已空
      let anyLeft = false;
      for (const [, available] of groupAvailable) {
        if (available.length > 0) {
          anyLeft = true;
          break;
        }
      }
      if (!anyLeft) break;

      takeGroupsForTeacher(teacher, groupAvailable, true);
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
      if (onProgress)
        try {
          onProgress({ phase: 5, phaseName: '兜底放宽约束', total: 5 });
        } catch (_) {}
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
    for (const cls of mergedDemands) {
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

    // === 后置优化层：禁忌搜索（可选） ===
    // 在贪心+置换回溯（阶段1-5）之后，通过迭代邻域搜索进一步优化排课质量
    // 注意：本步骤是独立的后置优化，不属于 onProgress 上报的 phase 1-5
    // 开关：常量 TABU_SEARCH.ENABLED 为静态默认值（false）；
    //       也可通过 system_settings 表 key='tabu_search_enabled' 动态开启
    let tabuEnabled = TABU_SEARCH.ENABLED;
    if (!tabuEnabled) {
      try {
        const tsSetting = await prisma.system_settings.findUnique({
          where: { key: 'tabu_search_enabled' },
        });
        if (tsSetting && tsSetting.value === 'true') tabuEnabled = true;
      } catch (_) {
        // DB 查询失败不影响主流程，保持默认关闭
      }
    }
    if (tabuEnabled) {
      // tabuOptimize 会原地修改 assignments/unassigned/teacherConstraints（writeback 段）。
      // 若中途抛错（如历史 F15 的 ReferenceError），会留下半修改的脏状态污染后续流程。
      // 此处快照核心状态，异常时回滚到贪心+置换回溯的稳定解（原子性保证）。
      const tabuSnapshot = {
        assignments: assignments.slice(),
        unassigned: unassigned.slice(),
        teachers: teacherConstraints.map((t) => ({
          id: t.id,
          assignedHours: t.assignedHours,
          assignedTextbookIds: new Set(t.assignedTextbookIds),
          assignedCollegeIds: new Set(t.assignedCollegeIds),
        })),
      };
      try {
        const tsClassMap = new Map(mergedDemands.map((c) => [c.classId, c]));
        const tsResult = tabuOptimize(
          assignments,
          unassigned,
          teacherConstraints,
          mode,
          tsClassMap,
          courseId,
          semesterStr
        );
        if (tsResult.improved) {
          logger.info(
            `[禁忌搜索] 优化成功: 评分 ${tsResult.scoreBefore}→${tsResult.scoreAfter} ` +
              `(+${tsResult.delta}), 未分配 ${tsResult.unassignedBefore}→${tsResult.unassignedAfter}, ` +
              `迭代 ${tsResult.iterations}次, 耗时 ${tsResult.elapsed}ms`
          );
        } else {
          logger.info(
            `[禁忌搜索] 未找到更优解, 迭代 ${tsResult.iterations}次, 耗时 ${tsResult.elapsed}ms`
          );
        }
      } catch (tsErr) {
        // 回滚到 tabu 前的贪心稳定状态，避免半修改的脏数据污染后续跨课程累计
        assignments.length = 0;
        assignments.push(...tabuSnapshot.assignments);
        unassigned.length = 0;
        unassigned.push(...tabuSnapshot.unassigned);
        for (const s of tabuSnapshot.teachers) {
          const t = teacherConstraints.find((tc) => tc.id === s.id);
          if (t) {
            t.assignedHours = s.assignedHours;
            t.assignedTextbookIds = new Set(s.assignedTextbookIds);
            t.assignedCollegeIds = new Set(s.assignedCollegeIds);
          }
        }
        logger.warn(`[禁忌搜索] 优化异常，已跳过并回滚教师状态: ${tsErr.message}`);
      }
    }

    // === 目标课时欠课时告警 ===
    // 在全部阶段（含置换回溯/禁忌搜索）结束后评估，避免中途误报；
    // 口径用 guaranteeCap（自定义课时与类别标准取严），与保障轮目标一致；
    // 与 F12 意向供给预警按教师 id 去重（F12 先记录的保留）
    for (const t of teacherConstraints) {
      const remainingGap = t.guaranteeCap - t.assignedHours;
      if (remainingGap > 0 && !prefSupplyWarnedIds.has(t.id)) {
        const targetNote =
          t.defaultWeeklyHours != null
            ? customHoursGuarantee
              ? '（目标为自定义课时，硬保障已开启）'
              : '（目标取自定义课时与类别标准中较严者）'
            : '';
        warnings.push(
          `教师${t.name}目标课时未满足（本课程已排 ${t.assignedHours} h，目标 ${t.guaranteeCap} h，还差 ${remainingGap} h）${targetNote}，受意向/教材/学院约束限制`
        );
      }
    }

    // === 诊断日志：最终教材分布 ===
    // F10 修复：包 debug 级别守卫 + 预建教师班级计数 Map（消除 O(T×A) 嵌套）
    if (TEXTBOOK_COHESION.ENABLED && (logger.isDebugEnabled?.() ?? logger.level === 'debug')) {
      logger.debug('\n--- 最终教师教材分布 ---');
      const tbCountStats = new Map(); // size → count
      const classCountByTeacher = new Map();
      for (const a of assignments) {
        classCountByTeacher.set(a.teacher_id, (classCountByTeacher.get(a.teacher_id) || 0) + 1);
      }
      for (const t of teacherConstraints) {
        const tbSize = t.assignedTextbookIds.size;
        const tbs = [...t.assignedTextbookIds].join(',') || '(无)';
        logger.debug(
          `  ${t.name}: ${tbSize}本 [${tbs}] 班级数=${classCountByTeacher.get(t.id) || 0}`
        );
        tbCountStats.set(tbSize, (tbCountStats.get(tbSize) || 0) + 1);
      }
      logger.debug('--- 教材数统计 ---');
      for (const [size, count] of [...tbCountStats].sort((a, b) => a[0] - b[0])) {
        logger.debug(`  ${size}本教材: ${count}位教师`);
      }
      logger.debug('========== 诊断结束 ==========\n');
    }

    // === 固有班级延续标记：为每条最终分配计算 is_inherent ===
    // 在 tabu 优化/置换回溯之后、持久化之前统一计算，保证标记反映最终教师；
    // 无快照（开关关闭或上学期无记录）时一律 false，与关闭开关前行为一致
    const inherentByTeacher = new Map(teacherConstraints.map((t) => [t.id, t.inherentClassIds]));
    for (const a of assignments) {
      a.is_inherent = !!inherentByTeacher.get(a.teacher_id)?.has(a.class_id);
    }

    if (preview) {
      const previewResult = buildResult(
        expandCombinedAssignments(assignments),
        unassigned,
        classesToAssign,
        manualAssignments.length + lockedAssignments.length,
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
      // 仅删除未锁定的自动安排，锁定的保留不动
      await tx.teaching_assignments.deleteMany({
        where: {
          course_id: Number(courseId),
          semester: semesterStr,
          is_auto: true,
          is_locked: false,
        },
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
        // P1-6 修复：分离容量超载与教材上限违规两类降级原因，便于运维定位
        const safeAssignments = [];
        const overloadSkipped = []; // 容量超载（含教师缺失）
        const textbookSkipped = []; // 教材上限违规
        const constraintMap = new Map(teacherConstraints.map((t) => [t.id, t]));
        // M-5: 用 Map 累加每位教师已写入课时，避免 O(A²) 的 filter+reduce
        const writtenMap = new Map();
        // F1 修复：baseline 直接取 assignedTextbookIds（已含跨课程 DB 种子），
        // 不再与 inherentTextbookIds 取交集。旧交集逻辑在 assignedTextbookIds 为空集种子时
        // 用于提取"预存教材"，F1 种子修复后 assignedTextbookIds 本身即为全学期已有教材集合。
        // 按教师各自有效上限判定：个人开关教师恒为 1，不受全局 ENABLED 影响
        const txMaxTbMap = new Map(teacherConstraints.map((t) => [t.id, teacherMaxTextbooks(t)]));
        const useTxTbLimit = [...txMaxTbMap.values()].some((m) => m > 0);
        const baselineTextbooks = new Map();
        const writtenTextbooks = new Map();
        if (useTxTbLimit) {
          for (const t of teacherConstraints) {
            if ((txMaxTbMap.get(t.id) || 0) <= 0) continue;
            baselineTextbooks.set(t.id, new Set(t.assignedTextbookIds || []));
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
          // P2-9 注释：事务内容量二次校验公式
          //   左侧 = currentTotal（DB 实际已排，扣除本课程旧自动安排）
          //       + alreadyWritten（本课程本次已写入的新安排累加）
          //       + a.weekly_hours（当前待校验安排）
          //   右侧 = cap（本课程容量上限）+ t.effectiveTotal（其他课程已占）
          //        = 该教师在当前 mode 下的总可排课时
          //   左 > 右 表示并发排课导致容量已变（其他事务写入），降级跳过
          if (currentTotal + alreadyWritten + a.weekly_hours > cap + t.effectiveTotal) {
            // 超载，跳过该分配（并发导致容量已变）
            overloadSkipped.push(a);
            continue;
          }
          // P1-2 修复：教材上限二次校验，违规的不写入 DB（按教师各自有效上限）
          const txMaxTb = txMaxTbMap.get(a.teacher_id) || 0;
          if (txMaxTb > 0) {
            const baseline = baselineTextbooks.get(a.teacher_id);
            const written = writtenTextbooks.get(a.teacher_id);
            const tbIds = classTextbookMap.get(a.class_id) || [];
            if (baseline && written && tbIds.length > 0) {
              const projected = new Set(baseline);
              for (const tid of written) projected.add(tid);
              for (const tid of tbIds) projected.add(tid);
              if (projected.size > txMaxTb) {
                // P1-6 修复：教材上限违规归入独立数组，原因描述与容量超载区分
                textbookSkipped.push(a);
                continue;
              }
              for (const tid of tbIds) written.add(tid);
            }
          }
          safeAssignments.push(a);
          writtenMap.set(a.teacher_id, alreadyWritten + a.weekly_hours);
        }

        if (safeAssignments.length > 0) {
          // 合班单元展开为逐班行：所有成员班共享同一 teacher_id / weekly_hours
          await tx.teaching_assignments.createMany({
            data: expandCombinedAssignments(safeAssignments),
          });
        }

        // P1-6 修复：超载跳过的班级归入 unassigned，区分两类降级原因
        for (const a of overloadSkipped) {
          unassigned.push({
            classId: a.class_id,
            className: a.class_name,
            weeklyHours: a.weekly_hours,
            reason: '并发排课导致教师容量已满，已跳过',
          });
        }
        for (const a of textbookSkipped) {
          unassigned.push({
            classId: a.class_id,
            className: a.class_name,
            weeklyHours: a.weekly_hours,
            reason: '并发排课导致教师教材上限超出，已跳过',
          });
        }
        // 更新 assignments 为实际写入的部分，保证返回结果准确
        assignments.length = 0;
        assignments.push(...safeAssignments);
      }
    });

    logger.info(
      `[自动排课] 课程 ${courseId} 完成，分配 ${assignments.length}，未分配 ${unassigned.length}，耗时 ${Date.now() - _arrangeStart}ms`
    );
    const finalResult = buildResult(
      expandCombinedAssignments(assignments),
      unassigned,
      classesToAssign,
      manualAssignments.length + lockedAssignments.length,
      null,
      false,
      warnings,
      teacherConstraints,
      mode
    );
    // F1 修复：非预览结果也附带 classTextbookMap，供批量排课非预览模式跨课程累计教材
    finalResult.classTextbookMap = classTextbookMap;
    return finalResult;
  } finally {
    // C-2: 无论成功或异常，始终释放锁
    arrangeLocks.delete(lockKey);
    // B-01 修复：释放数据库锁
    await releaseLock(dbLockKey);
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
  placeClassOnTeacher,
  tryPlaceClass,
  trySwapUnassigned,
  buildGroupAvailable,
};
