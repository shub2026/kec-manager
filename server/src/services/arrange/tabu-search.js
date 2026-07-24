/**
 * 禁忌搜索排课优化模块
 *
 * 在五阶段贪心算法构造初始解之后，通过迭代搜索邻域解来优化排课质量。
 * 核心策略：
 *   - 三种邻域移动算子：Insert（插入未分配）、Shift（转移已分配）、Swap（交换分配）
 *   - 禁忌表防止短期回溯，aspiration criterion 允许突破禁忌
 *   - 全局目标函数：所有分配的 calcMatchScore 总和 - 未分配惩罚
 *   - 硬约束（容量、教材上限、意向）在邻域生成时即过滤，不可行解不参与搜索
 *
 * @module arrange/tabu-search
 */

import { TEXTBOOK_COHESION, TABU_SEARCH } from '../../constants/index.js';
import { calcMatchScore } from './auto-arrange.js';
import logger from '../../utils/logger.js';

// ── 教材引用计数管理 ──

function addTextbookRef(refCountMap, assignedSet, tid) {
  const count = (refCountMap.get(tid) || 0) + 1;
  refCountMap.set(tid, count);
  if (count === 1) assignedSet.add(tid);
}

function removeTextbookRef(refCountMap, assignedSet, tid) {
  const count = (refCountMap.get(tid) || 0) - 1;
  if (count <= 0) {
    refCountMap.delete(tid);
    assignedSet.delete(tid);
  } else {
    refCountMap.set(tid, count);
  }
}

// ── 教师状态管理 ──

/**
 * 为每位教师构建运行时状态快照
 * 包含 assignedHours、教材引用计数、教材集合、学院集合
 * 搜索过程中直接修改这些对象，保持状态一致
 */
function buildTeacherStates(teacherConstraints, assignments, classMap) {
  const states = new Map();
  for (const t of teacherConstraints) {
    const refCountMap = new Map();
    const assignedTextbookIds = new Set(t.assignedTextbookIds || []);
    const assignedCollegeIds = new Set(t.assignedCollegeIds || []);

    // 从当前分配重建教材引用计数和课时总量
    let assignedHours = 0;
    for (const a of assignments) {
      if (a.teacher_id === t.id) {
        const cls = classMap.get(a.class_id);
        if (cls) {
          assignedHours += cls.weeklyHours || 0;
          for (const tid of cls.textbookIds || []) {
            addTextbookRef(refCountMap, assignedTextbookIds, tid);
          }
        }
      }
    }

    states.set(t.id, {
      assignedHours,
      refCountMap,
      assignedTextbookIds,
      assignedCollegeIds,
    });
  }
  return states;
}

// ── 分配操作（增删班级到教师） ──

function addToTeacher(teacherId, classId, cls, teacherStates) {
  const state = teacherStates.get(teacherId);
  state.assignedHours += cls.weeklyHours || 0;
  state.assignedCollegeIds.add(cls.collegeId);
  for (const tid of cls.textbookIds || []) {
    addTextbookRef(state.refCountMap, state.assignedTextbookIds, tid);
  }
}

function removeFromTeacher(teacherId, classId, cls, teacherStates) {
  const state = teacherStates.get(teacherId);
  state.assignedHours -= cls.weeklyHours || 0;
  for (const tid of cls.textbookIds || []) {
    removeTextbookRef(state.refCountMap, state.assignedTextbookIds, tid);
  }
  // 学院集合保守策略：不删除（只增不减），避免遍历所有剩余分配的高昂开销
  // 影响仅为评分微偏（学院内聚加分略高），不影响硬约束正确性
}

// ── 模拟教师状态计算评分 ──

/**
 * 为评分构建一个临时的教师代理对象
 * 使用教师状态中的教材集合来计算 calcMatchScore
 */
function buildScoringProxy(teacher, state) {
  return {
    ...teacher,
    assignedTextbookIds: state.assignedTextbookIds,
    assignedCollegeIds: state.assignedCollegeIds,
    assignedHours: state.assignedHours,
  };
}

// ── 可行性检查（不修改状态） ──

function canAccept(teacher, cls, state, mode) {
  const cap = mode === 'standard' ? teacher.standardCap : teacher.fullCap;
  // 容量检查
  if (state.assignedHours + cls.weeklyHours > cap) return false;

  // 学院意向
  if (
    teacher.schedulingCollegeIds?.length > 0 &&
    !teacher.schedulingCollegeIds.includes(cls.collegeId)
  ) {
    return false;
  }

  // 层次意向
  if (
    teacher.schedulingLevelIds?.length > 0 &&
    cls.trainingLevelId &&
    !teacher.schedulingLevelIds.includes(cls.trainingLevelId)
  ) {
    return false;
  }
  if (!cls.trainingLevelId && teacher.schedulingLevelIds?.length > 0) {
    return false;
  }

  // 教材硬上限
  const maxTb = TEXTBOOK_COHESION.MAX_TEXTBOOKS_PER_TEACHER;
  if (TEXTBOOK_COHESION.ENABLED && maxTb > 0 && cls.textbookIds?.length > 0) {
    const newTbCount = cls.textbookIds.filter((tid) => !state.assignedTextbookIds.has(tid)).length;
    if (state.assignedTextbookIds.size + newTbCount > maxTb) return false;
  }

  return true;
}

// ── 禁忌表操作 ──

function tabuKey(classId, teacherId) {
  return `${classId}:${teacherId}`;
}

function isTabu(tabuList, classId, teacherId, iter) {
  const key = tabuKey(classId, teacherId);
  return tabuList.has(key) && tabuList.get(key) > iter;
}

function setTabu(tabuList, classId, teacherId, iter, tenure) {
  tabuList.set(tabuKey(classId, teacherId), iter + tenure);
}

// ── 邻域搜索 ──

/**
 * 搜索所有可行的邻域移动，返回最优移动
 * 移动类型：
 *   - insert: 将未分配班级分配给某教师
 *   - shift: 将已分配班级从教师A转移到教师B
 *   - swap: 交换教师A和教师B各一个班级
 *
 * @returns {object|null} 最优移动描述，含 type/classId/fromTeacher/toTeacher/delta/等
 */
function findBestMove(
  assignments,
  unassignedSet,
  teacherConstraints,
  teacherStates,
  classMap,
  teacherMap,
  mode,
  tabuList,
  iter,
  tenure,
  bestScore,
  currentScore
) {
  let bestMove = null;
  let bestDelta = -Infinity;

  // --- Insert：未分配班级 → 某教师 ---
  for (const classId of unassignedSet) {
    const cls = classMap.get(classId);
    if (!cls || !cls.weeklyHours || cls.weeklyHours <= 0) continue;

    for (const t of teacherConstraints) {
      const state = teacherStates.get(t.id);
      if (!canAccept(t, cls, state, mode)) continue;

      const proxy = buildScoringProxy(t, state);
      const score = calcMatchScore(proxy, cls);
      const delta = score + TABU_SEARCH.UNASSIGNED_PENALTY; // 消除未分配惩罚 + 新增评分

      if (delta <= bestDelta) continue;

      const tabu = isTabu(tabuList, classId, t.id, iter);
      if (tabu && currentScore + delta <= bestScore) continue;

      bestDelta = delta;
      bestMove = {
        type: 'insert',
        classId,
        toTeacherId: t.id,
        delta,
        score,
      };
    }
  }

  // --- Shift：教师A的班级 → 教师B ---
  for (const [classId, fromTeacherId] of assignments) {
    const cls = classMap.get(classId);
    if (!cls || !cls.weeklyHours || cls.weeklyHours <= 0) continue;
    const fromTeacher = teacherMap.get(fromTeacherId);
    const fromState = teacherStates.get(fromTeacherId);
    if (!fromTeacher || !fromState) continue;

    const fromProxy = buildScoringProxy(fromTeacher, fromState);
    const fromScore = calcMatchScore(fromProxy, cls);

    for (const t of teacherConstraints) {
      if (t.id === fromTeacherId) continue;
      const toState = teacherStates.get(t.id);
      if (!canAccept(t, cls, toState, mode)) continue;

      const toProxy = buildScoringProxy(t, toState);
      const toScore = calcMatchScore(toProxy, cls);
      const delta = toScore - fromScore;

      if (delta <= bestDelta) continue;

      const tabuFrom = isTabu(tabuList, classId, fromTeacherId, iter);
      const tabuTo = isTabu(tabuList, classId, t.id, iter);
      if ((tabuFrom || tabuTo) && currentScore + delta <= bestScore) continue;

      bestDelta = delta;
      bestMove = {
        type: 'shift',
        classId,
        fromTeacherId,
        toTeacherId: t.id,
        delta,
      };
    }
  }

  // --- Swap：教师A班级 ↔ 教师B班级 ---
  // P1-7 修复：采样策略改为随机采样，避免顺序前 N 导致的采样偏差
  // 原实现只检查 assignmentEntries 前 50 项及其后 50 项，排在末尾的分配
  // 永远不会被考虑为 Swap 候选，导致邻域搜索严重偏向头部分配
  // 随机采样允许重复索引（不显著影响最优解搜索质量），保证全量分配
  // 都有概率被采中，邻域覆盖更均匀
  const assignmentEntries = [...assignments.entries()];
  const totalAssignments = assignmentEntries.length;
  const maxSwapChecks = Math.min(totalAssignments, 50);

  for (let a = 0; a < maxSwapChecks; a++) {
    const i = Math.floor(Math.random() * totalAssignments);
    const [classIdA, teacherIdA] = assignmentEntries[i];
    const clsA = classMap.get(classIdA);
    if (!clsA || !clsA.weeklyHours || clsA.weeklyHours <= 0) continue;

    for (let b = 0; b < maxSwapChecks; b++) {
      const j = Math.floor(Math.random() * totalAssignments);
      if (i === j) continue;
      const [classIdB, teacherIdB] = assignmentEntries[j];
      if (teacherIdA === teacherIdB) continue;
      const clsB = classMap.get(classIdB);
      if (!clsB || !clsB.weeklyHours || clsB.weeklyHours <= 0) continue;

      const tA = teacherMap.get(teacherIdA);
      const tB = teacherMap.get(teacherIdB);
      const stateA = teacherStates.get(teacherIdA);
      const stateB = teacherStates.get(teacherIdB);
      if (!tA || !tB || !stateA || !stateB) continue;

      // 容量检查：交换后双方容量变化 = 对方班级课时 - 己方班级课时
      const capA = mode === 'standard' ? tA.standardCap : tA.fullCap;
      const capB = mode === 'standard' ? tB.standardCap : tB.fullCap;
      const deltaHoursA = (clsB.weeklyHours || 0) - (clsA.weeklyHours || 0);
      const deltaHoursB = (clsA.weeklyHours || 0) - (clsB.weeklyHours || 0);
      if (stateA.assignedHours + deltaHoursA > capA) continue;
      if (stateB.assignedHours + deltaHoursB > capB) continue;

      // 意向检查：tA 能否教 clsB，tB 能否教 clsA
      if (tA.schedulingCollegeIds?.length > 0 && !tA.schedulingCollegeIds.includes(clsB.collegeId))
        continue;
      if (tB.schedulingCollegeIds?.length > 0 && !tB.schedulingCollegeIds.includes(clsA.collegeId))
        continue;
      if (
        tA.schedulingLevelIds?.length > 0 &&
        clsB.trainingLevelId &&
        !tA.schedulingLevelIds.includes(clsB.trainingLevelId)
      )
        continue;
      if (
        tB.schedulingLevelIds?.length > 0 &&
        clsA.trainingLevelId &&
        !tB.schedulingLevelIds.includes(clsA.trainingLevelId)
      )
        continue;
      if (!clsB.trainingLevelId && tA.schedulingLevelIds?.length > 0) continue;
      if (!clsA.trainingLevelId && tB.schedulingLevelIds?.length > 0) continue;

      // 教材上限检查（简化：假设交换后教材数变化不超过上限）
      const maxTb = TEXTBOOK_COHESION.MAX_TEXTBOOKS_PER_TEACHER;
      if (TEXTBOOK_COHESION.ENABLED && maxTb > 0) {
        const aNewTbs = (clsB.textbookIds || []).filter(
          (tid) => !stateA.assignedTextbookIds.has(tid)
        );
        const aOldTbs = (clsA.textbookIds || []).filter(
          (tid) => (stateA.refCountMap.get(tid) || 0) <= 1
        );
        const projectedASize = stateA.assignedTextbookIds.size - aOldTbs.length + aNewTbs.length;
        if (projectedASize > maxTb) continue;

        const bNewTbs = (clsA.textbookIds || []).filter(
          (tid) => !stateB.assignedTextbookIds.has(tid)
        );
        const bOldTbs = (clsB.textbookIds || []).filter(
          (tid) => (stateB.refCountMap.get(tid) || 0) <= 1
        );
        const projectedBSize = stateB.assignedTextbookIds.size - bOldTbs.length + bNewTbs.length;
        if (projectedBSize > maxTb) continue;
      }

      // 评分变化
      const proxyAOld = buildScoringProxy(tA, stateA);
      const proxyBOld = buildScoringProxy(tB, stateB);
      const scoreAOld = calcMatchScore(proxyAOld, clsA);
      const scoreBOld = calcMatchScore(proxyBOld, clsB);

      // 保存学院集合快照（防止模拟评估污染状态）
      const savedCollegeA = new Set(stateA.assignedCollegeIds);
      const savedCollegeB = new Set(stateB.assignedCollegeIds);

      // 模拟交换后评分（临时修改状态）
      removeFromTeacher(teacherIdA, classIdA, clsA, teacherStates);
      addToTeacher(teacherIdA, classIdB, clsB, teacherStates);
      removeFromTeacher(teacherIdB, classIdB, clsB, teacherStates);
      addToTeacher(teacherIdB, classIdA, clsA, teacherStates);

      // 模拟后硬约束检查：预检公式基于投影估算，此处用实际状态兜底
      if (TEXTBOOK_COHESION.ENABLED && maxTb > 0) {
        if (stateA.assignedTextbookIds.size > maxTb || stateB.assignedTextbookIds.size > maxTb) {
          // 还原状态后跳过此交换对
          removeFromTeacher(teacherIdA, classIdB, clsB, teacherStates);
          addToTeacher(teacherIdA, classIdA, clsA, teacherStates);
          removeFromTeacher(teacherIdB, classIdA, clsA, teacherStates);
          addToTeacher(teacherIdB, classIdB, clsB, teacherStates);
          stateA.assignedCollegeIds = savedCollegeA;
          stateB.assignedCollegeIds = savedCollegeB;
          continue;
        }
      }

      const proxyANew = buildScoringProxy(tA, stateA);
      const proxyBNew = buildScoringProxy(tB, stateB);
      const scoreANew = calcMatchScore(proxyANew, clsB);
      const scoreBNew = calcMatchScore(proxyBNew, clsA);

      // 还原状态（含学院集合恢复，防止只增不减的累积污染）
      removeFromTeacher(teacherIdA, classIdB, clsB, teacherStates);
      addToTeacher(teacherIdA, classIdA, clsA, teacherStates);
      removeFromTeacher(teacherIdB, classIdA, clsA, teacherStates);
      addToTeacher(teacherIdB, classIdB, clsB, teacherStates);
      stateA.assignedCollegeIds = savedCollegeA;
      stateB.assignedCollegeIds = savedCollegeB;

      const delta = scoreANew + scoreBNew - scoreAOld - scoreBOld;

      if (delta <= bestDelta) continue;

      // 禁忌检查：检查交换后的新配对（防止回弹），而非旧配对
      const tabuA = isTabu(tabuList, classIdA, teacherIdB, iter);
      const tabuB = isTabu(tabuList, classIdB, teacherIdA, iter);
      if ((tabuA || tabuB) && currentScore + delta <= bestScore) continue;

      bestDelta = delta;
      bestMove = {
        type: 'swap',
        classIdA,
        teacherIdA,
        classIdB,
        teacherIdB,
        delta,
      };
    }
  }

  return bestMove;
}

// ── 应用移动 ──

function applyMove(
  move,
  assignments,
  unassignedSet,
  teacherStates,
  classMap,
  tabuList,
  iter,
  tenure
) {
  switch (move.type) {
    case 'insert': {
      const cls = classMap.get(move.classId);
      unassignedSet.delete(move.classId);
      assignments.set(move.classId, move.toTeacherId);
      addToTeacher(move.toTeacherId, move.classId, cls, teacherStates);
      setTabu(tabuList, move.classId, move.toTeacherId, iter, tenure);
      break;
    }
    case 'shift': {
      const cls = classMap.get(move.classId);
      assignments.set(move.classId, move.toTeacherId);
      removeFromTeacher(move.fromTeacherId, move.classId, cls, teacherStates);
      addToTeacher(move.toTeacherId, move.classId, cls, teacherStates);
      setTabu(tabuList, move.classId, move.fromTeacherId, iter, tenure);
      setTabu(tabuList, move.classId, move.toTeacherId, iter, tenure);
      break;
    }
    case 'swap': {
      const clsA = classMap.get(move.classIdA);
      const clsB = classMap.get(move.classIdB);
      // A 的班级给 B，B 的班级给 A
      assignments.set(move.classIdA, move.teacherIdB);
      assignments.set(move.classIdB, move.teacherIdA);
      removeFromTeacher(move.teacherIdA, move.classIdA, clsA, teacherStates);
      addToTeacher(move.teacherIdA, move.classIdB, clsB, teacherStates);
      removeFromTeacher(move.teacherIdB, move.classIdB, clsB, teacherStates);
      addToTeacher(move.teacherIdB, move.classIdA, clsA, teacherStates);
      // 禁忌新配对，防止立即回弹
      setTabu(tabuList, move.classIdA, move.teacherIdB, iter, tenure);
      setTabu(tabuList, move.classIdB, move.teacherIdA, iter, tenure);
      break;
    }
  }
}

// ── 目标函数 ──

function computeObjective(
  assignments,
  unassignedSet,
  teacherConstraints,
  teacherStates,
  classMap,
  teacherMap,
  _mode
) {
  let score = 0;
  for (const [classId, teacherId] of assignments) {
    const cls = classMap.get(classId);
    const teacher = teacherMap.get(teacherId);
    const state = teacherStates.get(teacherId);
    if (!cls || !teacher || !state) continue;
    const proxy = buildScoringProxy(teacher, state);
    score += calcMatchScore(proxy, cls);
  }
  // 未分配惩罚
  score -= unassignedSet.size * TABU_SEARCH.UNASSIGNED_PENALTY;
  return score;
}

// ── 主入口 ──

/**
 * 禁忌搜索优化排课结果
 *
 * 以贪心算法的初始解为起点，通过迭代搜索邻域来提升排课质量。
 * 搜索完成后，将最优解的分配结果写回 assignments 和 teacherConstraints。
 *
 * @param {Array} assignments - 初始分配数组 [{teacher_id, teacher_name, class_id, class_name, course_id, semester, weekly_hours, is_auto}]
 * @param {Array} unassigned - 未分配班级数组（可被修改：成功分配的会被移出）
 * @param {Array} teacherConstraints - 教师约束数组（会被原地修改：assignedHours、assignedTextbookIds 等）
 * @param {string} mode - 排课模式 'standard' | 'full'
 * @param {Map} classMap - classId → class 对象映射
 * @param {number} courseId - 课程ID
 * @param {string} semesterStr - 学期字符串
 * @returns {object} { improved: boolean, iterations: number, scoreBefore: number, scoreAfter: number, elapsed: number }
 */
export function tabuOptimize(
  assignments,
  unassigned,
  teacherConstraints,
  mode,
  classMap,
  courseId,
  semesterStr
) {
  const startTime = Date.now();
  const maxIter = TABU_SEARCH.MAX_ITERATIONS;
  const tenure = TABU_SEARCH.TABU_TENURE;
  const noImproveLimit = TABU_SEARCH.NO_IMPROVEMENT_LIMIT;
  const timeout = TABU_SEARCH.SINGLE_COURSE_TIMEOUT_MS;

  // 构建教师查找表
  const teacherMap = new Map(teacherConstraints.map((t) => [t.id, t]));

  // 构建 classId → class 的完整映射（包含 textbookIds）
  const fullClassMap = new Map();
  for (const [cid, cls] of classMap) {
    fullClassMap.set(cid, {
      ...cls,
      textbookIds: cls.textbookIds || (cls.textbooks || []).map((tb) => tb.id),
    });
  }

  // 从初始分配构建内部状态
  // assignments Map: classId → teacherId
  const assignmentMap = new Map();
  for (const a of assignments) {
    assignmentMap.set(a.class_id, a.teacher_id);
  }

  // unassignedSet: classId 集合
  const unassignedSet = new Set();
  const unassignedClassMap = new Map(); // classId → class 对象
  for (const u of unassigned) {
    unassignedSet.add(u.classId);
    unassignedClassMap.set(u.classId, u);
  }

  // 构建教师运行时状态
  const teacherStates = buildTeacherStates(teacherConstraints, assignments, fullClassMap);

  // 记录每位教师在本课程中的初始教材集合（用于 writeback 时计算增量）
  const initialCourseTbs = new Map();
  for (const t of teacherConstraints) {
    const tbs = new Set();
    for (const a of assignments) {
      if (a.teacher_id === t.id) {
        const cls = fullClassMap.get(a.class_id);
        if (cls) for (const tid of cls.textbookIds || []) tbs.add(tid);
      }
    }
    initialCourseTbs.set(t.id, tbs);
  }

  // 计算初始目标函数值
  const scoreBefore = computeObjective(
    assignmentMap,
    unassignedSet,
    teacherConstraints,
    teacherStates,
    fullClassMap,
    teacherMap,
    mode
  );

  let currentScore = scoreBefore;
  let bestScore = scoreBefore;
  let bestAssignmentMap = new Map(assignmentMap);
  let bestUnassignedSet = new Set(unassignedSet);

  const tabuList = new Map();
  let noImprovementCount = 0;
  let iter;

  logger.debug(
    `[禁忌搜索] 开始 courseId=${courseId} semester=${semesterStr} 初始分配=${assignments.length} 未分配=${unassignedSet.size} 初始评分=${scoreBefore}`
  );

  for (iter = 0; iter < maxIter; iter++) {
    // 超时检查
    if (Date.now() - startTime > timeout) {
      logger.debug(`[禁忌搜索] 超时终止 iter=${iter} elapsed=${Date.now() - startTime}ms`);
      break;
    }

    // 搜索最优邻域移动
    const move = findBestMove(
      assignmentMap,
      unassignedSet,
      teacherConstraints,
      teacherStates,
      fullClassMap,
      teacherMap,
      mode,
      tabuList,
      iter,
      tenure,
      bestScore,
      currentScore
    );

    if (!move) {
      logger.debug(`[禁忌搜索] 无可行移动 iter=${iter}`);
      break;
    }

    // 应用移动
    applyMove(
      move,
      assignmentMap,
      unassignedSet,
      teacherStates,
      fullClassMap,
      tabuList,
      iter,
      tenure
    );
    currentScore += move.delta;

    // 更新历史最优
    if (currentScore > bestScore) {
      bestScore = currentScore;
      bestAssignmentMap = new Map(assignmentMap);
      bestUnassignedSet = new Set(unassignedSet);
      noImprovementCount = 0;
    } else {
      noImprovementCount++;
    }

    // 连续无改进提前终止
    if (noImprovementCount >= noImproveLimit) {
      logger.debug(`[禁忌搜索] 连续 ${noImproveLimit} 轮无改进 iter=${iter}`);
      break;
    }
  }

  const elapsed = Date.now() - startTime;
  const improved = bestScore > scoreBefore;

  logger.debug(
    `[禁忌搜索] 结束 iter=${iter} elapsed=${elapsed}ms improved=${improved} scoreBefore=${scoreBefore} scoreAfter=${bestScore} delta=${bestScore - scoreBefore}`
  );

  // 如果最优解不是当前解（中途走过更好的解），需要还原
  // 用 bestAssignmentMap 重建最终状态
  if (bestScore !== currentScore) {
    assignmentMap.clear();
    for (const [cid, tid] of bestAssignmentMap) {
      assignmentMap.set(cid, tid);
    }
    unassignedSet.clear();
    for (const cid of bestUnassignedSet) {
      unassignedSet.add(cid);
    }
    // 重建教师状态
    const tempAssignments = [];
    for (const [cid, tid] of bestAssignmentMap) {
      tempAssignments.push({ teacher_id: tid, class_id: cid });
    }
    const newStates = buildTeacherStates(teacherConstraints, tempAssignments, fullClassMap);
    for (const [tid, state] of newStates) {
      teacherStates.set(tid, state);
    }
  }

  // 写回 assignments 和 unassigned
  assignments.length = 0;
  for (const [classId, teacherId] of assignmentMap) {
    const cls = fullClassMap.get(classId);
    const teacher = teacherMap.get(teacherId);
    if (!cls || !teacher) continue;
    assignments.push({
      teacher_id: teacherId,
      teacher_name: teacher.name,
      class_id: classId,
      class_name: cls.className,
      course_id: Number(courseId),
      semester: semesterStr,
      weekly_hours: cls.weeklyHours,
      is_auto: true,
    });
  }

  // 重建 unassigned 数组
  unassigned.length = 0;
  for (const u of unassignedClassMap.values()) {
    if (unassignedSet.has(u.classId)) {
      unassigned.push(u);
    }
  }

  // 同步教师约束对象的状态（增量写回，保护跨课程数据）
  for (const t of teacherConstraints) {
    const state = teacherStates.get(t.id);
    if (!state) continue;

    // 课时：直接用搜索后的值（buildTeacherStates 已从本课程分配重建）
    t.assignedHours = state.assignedHours;

    // 教材：计算本课程维度的增量，应用到全局集合
    const initialTbs = initialCourseTbs.get(t.id) || new Set();
    const finalTbs = new Set();
    for (const [cid, tid] of assignmentMap) {
      if (tid === t.id) {
        const cls = fullClassMap.get(cid);
        if (cls) for (const tb of cls.textbookIds || []) finalTbs.add(tb);
      }
    }
    // 新增的教材 → 加入全局集合
    for (const tb of finalTbs) {
      if (!initialTbs.has(tb)) t.assignedTextbookIds.add(tb);
    }
    // 移除的教材 → 从全局集合删除
    for (const tb of initialTbs) {
      if (!finalTbs.has(tb)) t.assignedTextbookIds.delete(tb);
    }

    // 学院：只增不减（保守策略）
    for (const cid of state.assignedCollegeIds) {
      t.assignedCollegeIds.add(cid);
    }
  }

  return {
    improved,
    iterations: iter,
    scoreBefore,
    scoreAfter: bestScore,
    delta: bestScore - scoreBefore,
    elapsed,
    unassignedBefore: unassignedClassMap.size,
    unassignedAfter: unassignedSet.size,
  };
}
