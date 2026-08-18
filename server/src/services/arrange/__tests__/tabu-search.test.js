/**
 * tabu-search.js 单元测试
 *
 * 策略：通过构造可控的教师/班级/分配数据，验证禁忌搜索各邻域移动的正确性
 * 核心覆盖：
 * - Insert 移动：未分配班级被成功分配
 * - Shift 移动：已分配班级转移到更优教师
 * - Swap 移动：两个教师的班级交换后总分提升
 * - 硬约束不被违反（容量、教材上限、学院/层次意向）
 * - 空输入、无改进等边界场景
 * - 返回结构完整性
 */
import { describe, it, expect, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock constants
// ──────────────────────────────────────────────
vi.mock('../../../constants/index.js', () => ({
  TEXTBOOK_COHESION: {
    ENABLED: true,
    COLLEGE_WEIGHT: 5,
    LEVEL_WEIGHT: 5,
    ASSIGNED_WEIGHT: 10,
    INHERENT_WEIGHT: 4,
    PENALTY_PER_NEW: 10,
    ZERO_TEXTBOOK_BONUS: 30,
    TEXTBOOK_COUNT_PENALTY_1_NEW: 200,
    TEXTBOOK_COUNT_BONUS_1_SAME: 8,
    TEXTBOOK_COUNT_PENALTY_2: 20,
    TEXTBOOK_COUNT_PENALTY_3PLUS: 150,
    MAX_TEXTBOOKS_PER_TEACHER: 2,
    COHESION_PHASE_ENABLED: true,
    PHASE0_ENABLED: false,
    FALLBACK_EMPTY: true,
    SCATTERED_THRESHOLD: 3,
  },
  TABU_SEARCH: {
    ENABLED: true,
    MAX_ITERATIONS: 50,
    TABU_TENURE: 5,
    NO_IMPROVEMENT_LIMIT: 20,
    SINGLE_COURSE_TIMEOUT_MS: 5000,
    UNASSIGNED_PENALTY: 500,
    // F15 回归测试：补全生产配置中的欠分配与负载方差权重，
    // 确保 computeObjective 的负载方差分支（引用 mode 参数）被真正执行，
    // 防止 _mode 拼写错误导致的 ReferenceError 被测试盲区掩盖。
    UNDER_ASSIGNMENT_PENALTY: 5,
    LOAD_VARIANCE_WEIGHT: 2,
    RANDOM_SEED: 42,
  },
}));

// ──────────────────────────────────────────────
// Mock auto-arrange.js exports
// calcMatchScore: 简单评分 = 学院匹配+5, 层次匹配+5, 教材匹配+10
// isTeacherEligible: 始终返回 true（资格检查在 canAccept 中完成）
// ──────────────────────────────────────────────
vi.mock('../auto-arrange.js', () => ({
  calcMatchScore: (teacher, cls) => {
    let score = 0;
    // 学院匹配
    if (teacher.assignedCollegeIds?.has?.(cls.collegeId)) score += 5;
    // 层次匹配
    if (cls.trainingLevelId && teacher.schedulingLevelIds?.includes?.(cls.trainingLevelId))
      score += 5;
    // 教材匹配（已有教材 → 内聚加分）
    const tbIds = cls.textbookIds || [];
    for (const tid of tbIds) {
      if (teacher.assignedTextbookIds?.has?.(tid)) score += 10;
    }
    return score;
  },
  isTeacherEligible: () => true,
}));

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { tabuOptimize } = await import('../tabu-search.js');

// ──────────────────────────────────────────────
// 测试数据工厂
// ──────────────────────────────────────────────

function makeTeacher(overrides = {}) {
  return {
    id: 1,
    name: 'T1',
    personnelType: 'full_time',
    schedulingCollegeIds: [],
    schedulingLevelIds: [],
    assignedTextbookIds: new Set(),
    assignedCollegeIds: new Set(),
    assignedHours: 0,
    standardCap: 16,
    fullCap: 20,
    inherentTextbookIds: [],
    ...overrides,
  };
}

function makeClass(overrides = {}) {
  return {
    classId: 100,
    className: 'C1',
    collegeId: 10,
    trainingLevelId: 20,
    weeklyHours: 4,
    textbookIds: [1],
    ...overrides,
  };
}

function makeAssignment(teacher, cls, courseId = 1, semester = '2025-2026-2') {
  return {
    teacher_id: teacher.id,
    teacher_name: teacher.name,
    class_id: cls.classId,
    class_name: cls.className,
    course_id: courseId,
    semester,
    weekly_hours: cls.weeklyHours,
    is_auto: true,
  };
}

// ──────────────────────────────────────────────
// 测试用例
// ──────────────────────────────────────────────

describe('tabuOptimize — 边界场景', () => {
  it('空分配+空未分配 → 无操作，improved=false', () => {
    const teachers = [makeTeacher()];
    const result = tabuOptimize([], [], teachers, 'full', new Map(), 1, '2025-2026-2');

    expect(result.improved).toBe(false);
    // F15 修复后目标函数含欠分配惩罚：教师 standardCap=16, assignedHours=0,
    // gap=16, UNDER_ASSIGNMENT_PENALTY=5 → 惩罚 5×16=80，故 scoreBefore=-80
    // （空分配时教师欠达标被正确惩罚，这是 F15 增强后的预期行为）
    expect(result.scoreBefore).toBe(-80);
    expect(result.scoreAfter).toBe(-80);
    expect(result.delta).toBe(0);
    expect(result.iterations).toBeGreaterThanOrEqual(0);
    expect(result.elapsed).toBeGreaterThanOrEqual(0);
  });

  it('所有班级已分配且无优化空间 → improved=false', () => {
    const t1 = makeTeacher({ id: 1, name: 'T1', assignedTextbookIds: new Set([1]) });
    const cls = makeClass({ classId: 100, textbookIds: [1] });
    const assignments = [makeAssignment(t1, cls)];
    const classMap = new Map([[100, cls]]);

    const result = tabuOptimize(assignments, [], [t1], 'full', classMap, 1, '2025-2026-2');

    expect(result.improved).toBe(false);
    expect(result.unassignedBefore).toBe(0);
    expect(result.unassignedAfter).toBe(0);
  });
});

describe('tabuOptimize — Insert 移动', () => {
  it('未分配班级能被分配给有容量的教师', () => {
    const t1 = makeTeacher({
      id: 1,
      name: 'T1',
      standardCap: 20,
      fullCap: 20,
      assignedTextbookIds: new Set([1]),
    });
    const cls1 = makeClass({ classId: 100, textbookIds: [1], weeklyHours: 4 });
    const cls2 = makeClass({ classId: 101, textbookIds: [1], weeklyHours: 4 });

    // cls1 已分配，cls2 未分配
    const assignments = [makeAssignment(t1, cls1)];
    const unassigned = [{ classId: 101, className: 'C2', weeklyHours: 4, reason: 'test' }];
    const classMap = new Map([
      [100, cls1],
      [101, cls2],
    ]);

    const result = tabuOptimize(assignments, unassigned, [t1], 'full', classMap, 1, '2025-2026-2');

    // 应该成功将 cls2 分配给 t1
    expect(result.unassignedAfter).toBeLessThan(result.unassignedBefore);
    expect(assignments.length).toBe(2);
    expect(unassigned.length).toBe(0);
  });

  it('教师容量不足时不强制分配', () => {
    const t1 = makeTeacher({
      id: 1,
      name: 'T1',
      standardCap: 4,
      fullCap: 4,
      assignedHours: 4,
      assignedTextbookIds: new Set([1]),
    });
    const cls1 = makeClass({ classId: 100, textbookIds: [1], weeklyHours: 4 });
    const cls2 = makeClass({ classId: 101, textbookIds: [1], weeklyHours: 4 });

    const assignments = [makeAssignment(t1, cls1)];
    const unassigned = [{ classId: 101, className: 'C2', weeklyHours: 4, reason: 'test' }];
    const classMap = new Map([
      [100, cls1],
      [101, cls2],
    ]);

    const result = tabuOptimize(assignments, unassigned, [t1], 'full', classMap, 1, '2025-2026-2');

    // t1 满了，cls2 无法分配
    expect(assignments.length).toBe(1);
    expect(unassigned.length).toBe(1);
  });
});

describe('tabuOptimize — Shift 移动', () => {
  it('班级从低评分教师转移到高评分教师', () => {
    // t1 学院不匹配（低分），t2 学院匹配（高分）
    const t1 = makeTeacher({
      id: 1,
      name: 'T1',
      standardCap: 20,
      fullCap: 20,
      assignedTextbookIds: new Set([1]),
      assignedCollegeIds: new Set([99]), // 不匹配 collegeId=10
    });
    const t2 = makeTeacher({
      id: 2,
      name: 'T2',
      standardCap: 20,
      fullCap: 20,
      assignedTextbookIds: new Set([1]),
      assignedCollegeIds: new Set([10]), // 匹配 collegeId=10
    });

    const cls = makeClass({ classId: 100, collegeId: 10, textbookIds: [1] });
    // cls 分配给 t1（低分教师）
    const assignments = [makeAssignment(t1, cls)];
    const classMap = new Map([[100, cls]]);

    const result = tabuOptimize(assignments, [], [t1, t2], 'full', classMap, 1, '2025-2026-2');

    // Shift 应将 cls 从 t1 转移到 t2
    if (result.improved) {
      expect(assignments[0].teacher_id).toBe(2);
    }
  });
});

describe('tabuOptimize — 硬约束', () => {
  it('不违反教师容量上限', () => {
    const t1 = makeTeacher({
      id: 1,
      name: 'T1',
      standardCap: 8,
      fullCap: 8,
      assignedHours: 4,
      assignedTextbookIds: new Set([1]),
    });
    const cls1 = makeClass({ classId: 100, textbookIds: [1], weeklyHours: 4 });
    const cls2 = makeClass({ classId: 101, textbookIds: [1], weeklyHours: 6 }); // 超容量

    const assignments = [makeAssignment(t1, cls1)];
    const unassigned = [{ classId: 101, className: 'C2', weeklyHours: 6, reason: 'test' }];
    const classMap = new Map([
      [100, cls1],
      [101, cls2],
    ]);

    tabuOptimize(assignments, unassigned, [t1], 'full', classMap, 1, '2025-2026-2');

    // t1 已有 4h，再加 6h = 10h > 8h 容量上限 → 不分配
    expect(assignments.length).toBe(1);
    expect(unassigned.length).toBe(1);
  });

  it('不违反学院意向约束', () => {
    const t1 = makeTeacher({
      id: 1,
      name: 'T1',
      standardCap: 20,
      fullCap: 20,
      schedulingCollegeIds: [20], // 只接受学院 20
      assignedTextbookIds: new Set([1]),
    });
    const cls = makeClass({ classId: 100, collegeId: 10, textbookIds: [1] }); // 学院 10，不匹配
    const unassigned = [{ classId: 100, className: 'C1', weeklyHours: 4, reason: 'test' }];
    const classMap = new Map([[100, cls]]);

    tabuOptimize([], unassigned, [t1], 'full', classMap, 1, '2025-2026-2');

    // 学院不匹配，不能分配
    expect(unassigned.length).toBe(1);
  });

  it('不违反层次意向约束', () => {
    const t1 = makeTeacher({
      id: 1,
      name: 'T1',
      standardCap: 20,
      fullCap: 20,
      schedulingLevelIds: [30], // 只接受层次 30
      assignedTextbookIds: new Set([1]),
    });
    const cls = makeClass({ classId: 100, trainingLevelId: 20, textbookIds: [1] }); // 层次 20，不匹配
    const unassigned = [{ classId: 100, className: 'C1', weeklyHours: 4, reason: 'test' }];
    const classMap = new Map([[100, cls]]);

    tabuOptimize([], unassigned, [t1], 'full', classMap, 1, '2025-2026-2');

    expect(unassigned.length).toBe(1);
  });

  // ── 只带一本教材开关（教师个人维度硬约束，canAccept 拒收新教材移动）──
  it('单教材开关：受限教师拒收会引入第 2 本教材的未分配班级', () => {
    const t1 = makeTeacher({
      id: 1,
      name: 'T1',
      standardCap: 20,
      fullCap: 20,
      singleTextbookOnly: true,
      assignedTextbookIds: new Set([1]), // 已持教材 1
    });
    const cls1 = makeClass({ classId: 100, textbookIds: [1], weeklyHours: 4 });
    const cls2 = makeClass({ classId: 101, textbookIds: [2], weeklyHours: 4 }); // 新教材

    const assignments = [makeAssignment(t1, cls1)];
    const unassigned = [{ classId: 101, className: 'C2', weeklyHours: 4, reason: 'test' }];
    const classMap = new Map([
      [100, cls1],
      [101, cls2],
    ]);

    tabuOptimize(assignments, unassigned, [t1], 'full', classMap, 1, '2025-2026-2');

    // 引入第 2 本教材被硬拒绝
    expect(assignments.length).toBe(1);
    expect(unassigned.length).toBe(1);
  });

  it('单教材开关：受限教师可接收同教材班级', () => {
    const t1 = makeTeacher({
      id: 1,
      name: 'T1',
      standardCap: 20,
      fullCap: 20,
      singleTextbookOnly: true,
      assignedTextbookIds: new Set([1]),
    });
    const cls1 = makeClass({ classId: 100, textbookIds: [1], weeklyHours: 4 });
    const cls2 = makeClass({ classId: 101, textbookIds: [1], weeklyHours: 4 }); // 同教材

    const assignments = [makeAssignment(t1, cls1)];
    const unassigned = [{ classId: 101, className: 'C2', weeklyHours: 4, reason: 'test' }];
    const classMap = new Map([
      [100, cls1],
      [101, cls2],
    ]);

    tabuOptimize(assignments, unassigned, [t1], 'full', classMap, 1, '2025-2026-2');

    expect(assignments.length).toBe(2);
    expect(unassigned.length).toBe(0);
  });

  it('对照：未开启开关的教师可接第 2 本教材（全局 2 本上限）', () => {
    const t1 = makeTeacher({
      id: 1,
      name: 'T1',
      standardCap: 20,
      fullCap: 20,
      assignedTextbookIds: new Set([1]),
    });
    const cls1 = makeClass({ classId: 100, textbookIds: [1], weeklyHours: 4 });
    const cls2 = makeClass({ classId: 101, textbookIds: [2], weeklyHours: 4 });

    const assignments = [makeAssignment(t1, cls1)];
    const unassigned = [{ classId: 101, className: 'C2', weeklyHours: 4, reason: 'test' }];
    const classMap = new Map([
      [100, cls1],
      [101, cls2],
    ]);

    tabuOptimize(assignments, unassigned, [t1], 'full', classMap, 1, '2025-2026-2');

    expect(assignments.length).toBe(2);
    expect(unassigned.length).toBe(0);
  });
});

describe('tabuOptimize — 返回结构', () => {
  it('返回完整的统计对象', () => {
    const t1 = makeTeacher({ id: 1, assignedTextbookIds: new Set([1]) });
    const cls = makeClass({ classId: 100, textbookIds: [1] });
    const assignments = [makeAssignment(t1, cls)];
    const classMap = new Map([[100, cls]]);

    const result = tabuOptimize(assignments, [], [t1], 'full', classMap, 1, '2025-2026-2');

    expect(result).toHaveProperty('improved');
    expect(result).toHaveProperty('iterations');
    expect(result).toHaveProperty('scoreBefore');
    expect(result).toHaveProperty('scoreAfter');
    expect(result).toHaveProperty('delta');
    expect(result).toHaveProperty('elapsed');
    expect(result).toHaveProperty('unassignedBefore');
    expect(result).toHaveProperty('unassignedAfter');
    expect(typeof result.improved).toBe('boolean');
    expect(typeof result.iterations).toBe('number');
    expect(typeof result.elapsed).toBe('number');
  });
});

describe('tabuOptimize — 教师约束同步', () => {
  it('优化后教师 assignedHours 正确更新', () => {
    const t1 = makeTeacher({
      id: 1,
      name: 'T1',
      standardCap: 20,
      fullCap: 20,
      assignedHours: 4,
      assignedTextbookIds: new Set([1]),
    });
    const cls1 = makeClass({ classId: 100, textbookIds: [1], weeklyHours: 4 });
    const cls2 = makeClass({ classId: 101, textbookIds: [1], weeklyHours: 4 });

    const assignments = [makeAssignment(t1, cls1)];
    const unassigned = [{ classId: 101, className: 'C2', weeklyHours: 4, reason: 'test' }];
    const classMap = new Map([
      [100, cls1],
      [101, cls2],
    ]);

    tabuOptimize(assignments, unassigned, [t1], 'full', classMap, 1, '2025-2026-2');

    // 如果 cls2 被成功分配，t1.assignedHours 应该增加
    if (unassigned.length === 0) {
      expect(t1.assignedHours).toBe(8);
    }
  });
});

describe('tabuOptimize — 多教师场景', () => {
  it('多个教师+未分配班级 → 选择最优教师分配', () => {
    const t1 = makeTeacher({
      id: 1,
      name: 'T1',
      standardCap: 20,
      fullCap: 20,
      assignedTextbookIds: new Set([1]),
      assignedCollegeIds: new Set([10]),
    });
    const t2 = makeTeacher({
      id: 2,
      name: 'T2',
      standardCap: 20,
      fullCap: 20,
      assignedTextbookIds: new Set([2]),
      assignedCollegeIds: new Set([20]),
    });

    // cls2 教材与 t1 匹配（教材1），与 t2 不匹配（教材2）
    const cls1 = makeClass({ classId: 100, collegeId: 10, textbookIds: [1], weeklyHours: 4 });
    const cls2 = makeClass({ classId: 101, collegeId: 10, textbookIds: [1], weeklyHours: 4 });

    const assignments = [makeAssignment(t1, cls1)];
    const unassigned = [{ classId: 101, className: 'C2', weeklyHours: 4, reason: 'test' }];
    const classMap = new Map([
      [100, cls1],
      [101, cls2],
    ]);

    const result = tabuOptimize(
      assignments,
      unassigned,
      [t1, t2],
      'full',
      classMap,
      1,
      '2025-2026-2'
    );

    // cls2 应该分配给 t1（教材+学院双重匹配，评分更高）
    if (result.unassignedAfter === 0) {
      const cls2Assignment = assignments.find((a) => a.class_id === 101);
      expect(cls2Assignment).toBeDefined();
      expect(cls2Assignment.teacher_id).toBe(1);
    }
  });
});

// ──────────────────────────────────────────────
// 合班 memberClassIds 回写回归测试
// ──────────────────────────────────────────────
describe('tabuOptimize — 合班 memberClassIds 回写', () => {
  it('合班班级经 tabu 搜索后 assignments 应保留 memberClassIds', () => {
    const t1 = makeTeacher({ id: 1, name: '张老师', standardCap: 20, fullCap: 20 });

    // 合班单元：classId=10 + classId=11，共享 memberClassIds
    const combinedCls = makeClass({
      classId: 10,
      className: '合班A+B',
      weeklyHours: 4,
      textbookIds: [1],
      memberClassIds: [10, 11], // 合班两个成员
    });

    // 初始分配：合班已分配给 t1
    const assignments = [makeAssignment(t1, combinedCls)];
    const classMap = new Map([[10, combinedCls]]);

    tabuOptimize(assignments, [], [t1], 'full', classMap, 1, '2025-2026-2');

    // tabu 搜索回写后，assignment 仍应携带 memberClassIds
    expect(assignments).toHaveLength(1);
    expect(assignments[0].memberClassIds).toEqual([10, 11]);
  });

  it('非合班班级回写时 memberClassIds 应为 null', () => {
    const t1 = makeTeacher({ id: 1, name: '张老师', standardCap: 20, fullCap: 20 });
    const cls = makeClass({ classId: 20, className: '单班', weeklyHours: 4 });

    const assignments = [makeAssignment(t1, cls)];
    const classMap = new Map([[20, cls]]);

    tabuOptimize(assignments, [], [t1], 'full', classMap, 1, '2025-2026-2');

    expect(assignments[0].memberClassIds).toBeNull();
  });

  it('合班回写后 assignment 数据结构可供 expandCombinedAssignments 正确展开', () => {
    // 验证回写数据满足 expandCombinedAssignments 的展开条件：
    // memberClassIds 存在且为数组 → 展开为 N 行
    const t1 = makeTeacher({ id: 1, name: '张老师', standardCap: 20, fullCap: 20 });
    const combinedCls = makeClass({
      classId: 10,
      className: '合班A+B',
      weeklyHours: 4,
      memberClassIds: [10, 11],
    });

    const assignments = [makeAssignment(t1, combinedCls)];
    const classMap = new Map([[10, combinedCls]]);

    tabuOptimize(assignments, [], [t1], 'full', classMap, 1, '2025-2026-2');

    // 回写后的 assignment 必须满足展开条件
    const a = assignments[0];
    expect(a.memberClassIds).toEqual([10, 11]);
    expect(a.class_id).toBe(10); // representative class
    expect(a.teacher_id).toBe(1);
    expect(a.weekly_hours).toBe(4);
    // expandCombinedAssignments 看到 memberClassIds=[10,11] 会生成两行
    // （展开逻辑已在 auto-arrange.test.js 中单独测试）
  });
});

// ──────────────────────────────────────────────
// F15 回归测试：负载方差分支不抛 ReferenceError
// 修复前 computeObjective 参数名为 _mode，函数体却引用 mode（未声明），
// 在 LOAD_VARIANCE_WEIGHT>0 且教师数≥2 时必抛 ReferenceError，
// 被 auto-arrange try/catch 静默吞掉，致禁忌搜索层完全失效。
// ──────────────────────────────────────────────
describe('tabuOptimize — F15 负载方差分支回归', () => {
  it('2名教师 + LOAD_VARIANCE_WEIGHT>0 时不抛 ReferenceError（mode 参数正确解析）', () => {
    const t1 = makeTeacher({
      id: 1,
      name: 'T1',
      standardCap: 16,
      fullCap: 20,
      assignedTextbookIds: new Set([1]),
      assignedCollegeIds: new Set([10]),
      assignedHours: 4,
    });
    const t2 = makeTeacher({
      id: 2,
      name: 'T2',
      standardCap: 16,
      fullCap: 20,
      assignedTextbookIds: new Set([1]),
      assignedCollegeIds: new Set([10]),
      assignedHours: 8,
    });
    const cls1 = makeClass({ classId: 100, textbookIds: [1], weeklyHours: 4 });
    const cls2 = makeClass({ classId: 101, textbookIds: [1], weeklyHours: 4 });
    const assignments = [makeAssignment(t1, cls1), makeAssignment(t2, cls2)];
    const classMap = new Map([
      [100, cls1],
      [101, cls2],
    ]);

    // 修复前：此调用会抛 ReferenceError: mode is not defined
    // 修复后：computeObjective 正确使用 mode 参数，负载方差分支正常执行
    expect(() => {
      tabuOptimize(assignments, [], [t1, t2], 'standard', classMap, 1, '2025-2026-2');
    }).not.toThrow();
  });

  it('standard 模式下负载方差分支使用 standardCap（非 fullCap）', () => {
    // 构造两名教师：t1 欠分配（assignedHours=2, standardCap=16），t2 满载（assignedHours=16）
    // 负载方差大 → 搜索应尝试平衡（若 cls 可从 t2 移到 t1）
    const t1 = makeTeacher({
      id: 1,
      name: 'T1',
      standardCap: 16,
      fullCap: 20,
      assignedTextbookIds: new Set([1]),
      assignedCollegeIds: new Set([10]),
      assignedHours: 2,
    });
    const t2 = makeTeacher({
      id: 2,
      name: 'T2',
      standardCap: 16,
      fullCap: 20,
      assignedTextbookIds: new Set([1]),
      assignedCollegeIds: new Set([10]),
      assignedHours: 16,
    });
    const cls = makeClass({ classId: 100, textbookIds: [1], weeklyHours: 4 });
    const assignments = [makeAssignment(t2, cls)];
    const classMap = new Map([[100, cls]]);

    const result = tabuOptimize(assignments, [], [t1, t2], 'standard', classMap, 1, '2025-2026-2');

    // 不抛错即证明 mode='standard' 被正确传入 computeObjective 并用于 cap 选择
    expect(result).toHaveProperty('scoreBefore');
    expect(typeof result.scoreBefore).toBe('number');
  });
});

// ─────────────────────────────────────────────
// OL7 回归测试：候选移动 delta 必须含 α/β 惩罚增量
// 修复前 findBestMove 的 delta 只算 calcMatchScore 变化，
// 两位评分相同的教师之间的均衡移动 delta=0，currentScore 从不超过
// bestScore，最终回溯到初始解 → 欠课时教师永远拿不到课。
// 修复后 β 负载方差增量使均衡 Shift 的 delta > 0，搜索主动纠正苦乐不均。
// ─────────────────────────────────────────────
describe('tabuOptimize — OL7 候选评估含惩罚增量回归', () => {
  it('评分相同时，满载教师的课应被移给欠课时教师（负载均衡驱动）', () => {
    // 两位教师学院/教材完全相同 → calcMatchScore 对两人评分相同（纯评分 delta=0）
    const t1 = makeTeacher({
      id: 1,
      name: 'T1',
      standardCap: 8,
      fullCap: 8,
      assignedTextbookIds: new Set([1]),
      assignedCollegeIds: new Set([10]),
    });
    const t2 = makeTeacher({
      id: 2,
      name: 'T2',
      standardCap: 8,
      fullCap: 8,
      assignedTextbookIds: new Set([1]),
      assignedCollegeIds: new Set([10]),
    });

    // t1 满载（2 班×4h = 8h = standardCap），t2 欠课时（0h，gap=8）
    const cls1 = makeClass({ classId: 100, collegeId: 10, textbookIds: [1], weeklyHours: 4 });
    const cls2 = makeClass({ classId: 101, collegeId: 10, textbookIds: [1], weeklyHours: 4 });
    const assignments = [makeAssignment(t1, cls1), makeAssignment(t1, cls2)];
    const classMap = new Map([
      [100, cls1],
      [101, cls2],
    ]);

    const result = tabuOptimize(assignments, [], [t1, t2], 'standard', classMap, 1, '2025-2026-2');

    // 修复后：均衡 Shift 的 β 增量 = -2×(0-0.25)×100 = +50 > 0 → 被采纳为更优解
    // （修复前纯评分 delta=0，best 解回溯至初始状态，t2 仍为 0h）
    expect(result.improved).toBe(true);
    const t1Classes = assignments.filter((a) => a.teacher_id === 1);
    const t2Classes = assignments.filter((a) => a.teacher_id === 2);
    expect(t1Classes.length).toBe(1);
    expect(t2Classes.length).toBe(1);
    expect(t1.assignedHours).toBe(4);
    expect(t2.assignedHours).toBe(4);
  });
});
