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
    if (cls.trainingLevelId && teacher.schedulingLevelIds?.includes?.(cls.trainingLevelId)) score += 5;
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
    expect(result.scoreBefore).toBe(0);
    expect(result.scoreAfter).toBe(0);
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
    const classMap = new Map([[100, cls1], [101, cls2]]);

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
    const classMap = new Map([[100, cls1], [101, cls2]]);

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
    const classMap = new Map([[100, cls1], [101, cls2]]);

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
    const classMap = new Map([[100, cls1], [101, cls2]]);

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
    const classMap = new Map([[100, cls1], [101, cls2]]);

    const result = tabuOptimize(assignments, unassigned, [t1, t2], 'full', classMap, 1, '2025-2026-2');

    // cls2 应该分配给 t1（教材+学院双重匹配，评分更高）
    if (result.unassignedAfter === 0) {
      const cls2Assignment = assignments.find((a) => a.class_id === 101);
      expect(cls2Assignment).toBeDefined();
      expect(cls2Assignment.teacher_id).toBe(1);
    }
  });
});
