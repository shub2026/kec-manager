/**
 * selectBestTeacher 与 trySwapOne 单元测试
 *
 * 重点覆盖：
 * - selectBestTeacher：七层优先级排序逻辑
 *   1. 分数差异 >= SCORE_THRESHOLD → 按分数降序
 *   2. 分数差异 < 阈值 + 负载率差异 > LOAD_RATE_THRESHOLD → 按负载率升序
 *   3. 综合排序：分数降序 > 负载率升序
 *   4. 空数组、单元素边界
 *   5. 不修改原数组（纯函数）
 *
 * - trySwapOne：置换优化逻辑
 *   1. S-02 回归：教师对 U（待分配班级）的学院/层次资格校验
 *   2. S-02 回归：T2 对 V（被接管班级）的学院/层次资格校验
 *   3. 教材上限检查（防置换越狱）
 *   4. 容量约束
 *   5. 无可置换场景返回 false
 */
import { describe, it, expect, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock constants/index.js（与 auto-arrange.test.js 保持一致）
// ──────────────────────────────────────────────
vi.mock('../../../constants/index.js', () => ({
  DEFAULT_HOUR_SETTINGS: {
    full_time: { standard: 16, max: 20 },
    part_time: { standard: 12, max: 16 },
    external: { standard: 12, max: 16 },
  },
  WORKLOAD_BALANCE: { SCORE_THRESHOLD: 1, LOAD_RATE_THRESHOLD: 0.2 },
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
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

const { selectBestTeacher, trySwapOne } = await import('../auto-arrange.js');

// ════════════════════════════════════════════════
// selectBestTeacher
// ════════════════════════════════════════════════
describe('selectBestTeacher', () => {
  // SCORE_THRESHOLD = 1, LOAD_RATE_THRESHOLD = 0.2

  describe('分数优先（差异 >= SCORE_THRESHOLD）', () => {
    it('分数高的教师应被选中', () => {
      const candidates = [
        { teacher: { id: 1 }, score: 10, loadRate: 0.5 },
        { teacher: { id: 2 }, score: 20, loadRate: 0.5 },
      ];
      const best = selectBestTeacher(candidates);
      expect(best.teacher.id).toBe(2);
    });

    it('分数差异恰好等于阈值时按分数降序', () => {
      const candidates = [
        { teacher: { id: 1 }, score: 9, loadRate: 0.8 },
        { teacher: { id: 2 }, score: 10, loadRate: 0.1 },
      ];
      // 差值 = 1 = SCORE_THRESHOLD → 按分数降序
      const best = selectBestTeacher(candidates);
      expect(best.teacher.id).toBe(2);
    });
  });

  describe('负载率优先（分数差异 < 阈值）', () => {
    it('分数相近时低负载率教师应被选中', () => {
      const candidates = [
        { teacher: { id: 1 }, score: 10, loadRate: 0.7 },
        { teacher: { id: 2 }, score: 10, loadRate: 0.3 },
      ];
      // 分数差 = 0 < 1, 负载率差 = 0.4 > 0.2 → 按负载率升序
      const best = selectBestTeacher(candidates);
      expect(best.teacher.id).toBe(2);
    });

    it('负载率差异恰好大于阈值时按负载率排序', () => {
      const candidates = [
        { teacher: { id: 1 }, score: 10, loadRate: 0.51 },
        { teacher: { id: 2 }, score: 10, loadRate: 0.3 },
      ];
      // 差 = 0.21 > 0.2 → 按负载率升序
      const best = selectBestTeacher(candidates);
      expect(best.teacher.id).toBe(2);
    });

    it('负载率差异不大于阈值时回退到分数降序', () => {
      const candidates = [
        { teacher: { id: 1 }, score: 10, loadRate: 0.35 },
        { teacher: { id: 2 }, score: 10.5, loadRate: 0.3 },
      ];
      // 分数差 = 0.5 < 1, 负载率差 = 0.05 < 0.2 → 综合排序：分数降序
      const best = selectBestTeacher(candidates);
      expect(best.teacher.id).toBe(2);
    });
  });

  describe('边界情况', () => {
    it('空数组应返回 undefined', () => {
      expect(selectBestTeacher([])).toBeUndefined();
    });

    it('单元素应返回该元素', () => {
      const candidates = [{ teacher: { id: 1 }, score: 5, loadRate: 0.5 }];
      expect(selectBestTeacher(candidates).teacher.id).toBe(1);
    });

    it('不应修改原数组（纯函数）', () => {
      const candidates = [
        { teacher: { id: 1 }, score: 10, loadRate: 0.5 },
        { teacher: { id: 2 }, score: 20, loadRate: 0.3 },
      ];
      const original = [...candidates];
      selectBestTeacher(candidates);
      expect(candidates).toEqual(original);
    });

    it('三个候选教师的综合排序应正确', () => {
      const candidates = [
        { teacher: { id: 'A' }, score: 15, loadRate: 0.8 }, // 分数最高
        { teacher: { id: 'B' }, score: 15, loadRate: 0.2 }, // 分数同A，负载最低
        { teacher: { id: 'C' }, score: 10, loadRate: 0.1 }, // 分数低
      ];
      // A vs B: 分数差 0 < 1, 负载率差 0.6 > 0.2 → B 优先
      // B vs C: 分数差 5 >= 1 → B 优先
      const best = selectBestTeacher(candidates);
      expect(best.teacher.id).toBe('B');
    });
  });
});

// ════════════════════════════════════════════════
// trySwapOne
// ════════════════════════════════════════════════
describe('trySwapOne', () => {
  // 辅助：构造教师约束对象
  function makeTeacher(id, opts = {}) {
    return {
      id,
      name: `T${id}`,
      personnelType: 'full_time',
      schedulingCollegeIds: opts.schedulingCollegeIds || [],
      schedulingLevelIds: opts.schedulingLevelIds || [],
      assignedTextbookIds: new Set(opts.assignedTextbookIds || []),
      assignedCollegeIds: new Set(),
      assignedHours: opts.assignedHours || 0,
      totalWeeklyHours: opts.totalWeeklyHours || 0,
      courseHours: 0,
      inherentTextbookIds: opts.inherentTextbookIds || [],
      textbookIds: opts.textbookIds || [],
      standardCap: opts.standardCap ?? 16,
      fullCap: opts.fullCap ?? 20,
      effectiveTotal: opts.effectiveTotal || 0,
      defaultWeeklyHours: opts.defaultWeeklyHours ?? null,
    };
  }

  // 辅助：构造未分配班级
  function makeUnassigned(classId, opts = {}) {
    return {
      classId,
      className: `C${classId}`,
      collegeId: opts.collegeId ?? 10,
      trainingLevelId: opts.trainingLevelId ?? 20,
      weeklyHours: opts.weeklyHours ?? 4,
      textbookIds: opts.textbookIds || [300],
    };
  }

  // 辅助：构造已分配记录
  function makeAssignment(teacherId, classId, weeklyHours, teacherName) {
    return {
      teacher_id: teacherId,
      teacher_name: teacherName || `T${teacherId}`,
      class_id: classId,
      weekly_hours: weeklyHours,
    };
  }

  // 辅助：构造 classTextbookMap 和 classInfoMap
  function makeMaps(assignments) {
    const classTextbookMap = new Map();
    const classInfoMap = new Map();
    for (const a of assignments) {
      classTextbookMap.set(a.class_id, [300]);
      classInfoMap.set(a.class_id, { collegeId: 10, trainingLevelId: 20 });
    }
    return { classTextbookMap, classInfoMap };
  }

  describe('S-02 回归：资格校验', () => {
    it('教师 T 对 U 的学院限制不匹配时应跳过 T', () => {
      const t1 = makeTeacher(1, { schedulingCollegeIds: [99], assignedHours: 8 });
      // T1 有已分配班级 V
      const assignments = [makeAssignment(1, 100, 4, 'T1')];
      const { classTextbookMap, classInfoMap } = makeMaps(assignments);

      // U 的学院是 10，T1 只能教学院 99 → 跳过
      const u = makeUnassigned(200, { collegeId: 10 });
      const teacherMap = new Map([[1, t1]]);
      const assignmentsByTeacher = new Map([[1, assignments]]);

      const result = trySwapOne(
        u,
        assignments,
        assignmentsByTeacher,
        teacherMap,
        [t1],
        'standard',
        1,
        '2025-2026-1',
        classTextbookMap,
        classInfoMap
      );
      expect(result).toBe(false);
    });

    it('教师 T 对 U 的层次限制不匹配时应跳过 T', () => {
      const t1 = makeTeacher(1, { schedulingLevelIds: [99], assignedHours: 8 });
      const assignments = [makeAssignment(1, 100, 4, 'T1')];
      const { classTextbookMap, classInfoMap } = makeMaps(assignments);

      const u = makeUnassigned(200, { trainingLevelId: 20 });
      const teacherMap = new Map([[1, t1]]);
      const assignmentsByTeacher = new Map([[1, assignments]]);

      const result = trySwapOne(
        u,
        assignments,
        assignmentsByTeacher,
        teacherMap,
        [t1],
        'standard',
        1,
        '2025-2026-1',
        classTextbookMap,
        classInfoMap
      );
      expect(result).toBe(false);
    });

    it('T2 对 V 的学院限制不匹配时应跳过 T2', () => {
      const t1 = makeTeacher(1, { assignedHours: 8 });
      const t2 = makeTeacher(2, { schedulingCollegeIds: [99] }); // T2 只能教 99

      const assignments = [makeAssignment(1, 100, 4, 'T1')];
      const { classTextbookMap, classInfoMap } = makeMaps(assignments);

      const u = makeUnassigned(200, { collegeId: 10, weeklyHours: 4 });
      const teacherMap = new Map([
        [1, t1],
        [2, t2],
      ]);
      const assignmentsByTeacher = new Map([[1, assignments]]);

      const result = trySwapOne(
        u,
        assignments,
        assignmentsByTeacher,
        teacherMap,
        [t1, t2],
        'standard',
        1,
        '2025-2026-1',
        classTextbookMap,
        classInfoMap
      );
      // T1 有已分配 V(学院10)，T1 对 U(学院10) 资格OK
      // 但 T2 对 V(学院10) 学院限制不匹配 → 跳过 T2
      // 无其他 T2 → 置换失败
      expect(result).toBe(false);
    });
  });

  describe('容量约束', () => {
    it('T 置换后容量超限时应跳过', () => {
      const t1 = makeTeacher(1, { assignedHours: 14, standardCap: 16 });
      const t2 = makeTeacher(2, { assignedHours: 0, standardCap: 16 });

      // V = 4h, U = 4h → T1 移除 V 后 10h, 加 U 后 14h ≤ 16 ✓
      // 但如果 U = 8h → 10+8=18 > 16 → 跳过
      const assignments = [makeAssignment(1, 100, 4, 'T1')];
      const { classTextbookMap, classInfoMap } = makeMaps(assignments);

      const u = makeUnassigned(200, { weeklyHours: 8 });
      const teacherMap = new Map([
        [1, t1],
        [2, t2],
      ]);
      const assignmentsByTeacher = new Map([[1, assignments]]);

      const result = trySwapOne(
        u,
        assignments,
        assignmentsByTeacher,
        teacherMap,
        [t1, t2],
        'standard',
        1,
        '2025-2026-1',
        classTextbookMap,
        classInfoMap
      );
      expect(result).toBe(false);
    });

    it('T2 接管 V 后容量超限时应跳过', () => {
      const t1 = makeTeacher(1, { assignedHours: 8, standardCap: 16 });
      const t2 = makeTeacher(2, { assignedHours: 14, standardCap: 16 });
      // T2 已有 14h, V=4h → 18 > 16 → 跳过

      const assignments = [makeAssignment(1, 100, 4, 'T1')];
      const { classTextbookMap, classInfoMap } = makeMaps(assignments);

      const u = makeUnassigned(200, { weeklyHours: 4 });
      const teacherMap = new Map([
        [1, t1],
        [2, t2],
      ]);
      const assignmentsByTeacher = new Map([[1, assignments]]);

      const result = trySwapOne(
        u,
        assignments,
        assignmentsByTeacher,
        teacherMap,
        [t1, t2],
        'standard',
        1,
        '2025-2026-1',
        classTextbookMap,
        classInfoMap
      );
      expect(result).toBe(false);
    });
  });

  describe('教材上限检查', () => {
    it('T 置换后教材数超 MAX 时应跳过', () => {
      // MAX_TEXTBOOKS_PER_TEACHER = 2
      const t1 = makeTeacher(1, {
        assignedTextbookIds: [300, 301], // 已满 2 本
        assignedHours: 8,
      });
      const t2 = makeTeacher(2, { assignedTextbookIds: [], assignedHours: 0 });

      // V 使用教材 [300]，U 使用教材 [302]（新教材）
      // T1 移除 V 后：教材 {301}（300 是 V 独有），加 U 的 302 → {301, 302} = 2 ≤ 2 ✓
      // 但如果 U 使用 [302, 303] → {301, 302, 303} = 3 > 2 → 跳过
      const assignments = [makeAssignment(1, 100, 4, 'T1')];
      const classTextbookMap = new Map([[100, [300]]]);
      const classInfoMap = new Map([[100, { collegeId: 10, trainingLevelId: 20 }]]);

      const u = makeUnassigned(200, { textbookIds: [302, 303], weeklyHours: 4 });
      const teacherMap = new Map([
        [1, t1],
        [2, t2],
      ]);
      const assignmentsByTeacher = new Map([[1, assignments]]);

      const result = trySwapOne(
        u,
        assignments,
        assignmentsByTeacher,
        teacherMap,
        [t1, t2],
        'standard',
        1,
        '2025-2026-1',
        classTextbookMap,
        classInfoMap
      );
      expect(result).toBe(false);
    });

    it('T2 接管 V 后教材数超 MAX 时应跳过', () => {
      const t1 = makeTeacher(1, { assignedTextbookIds: [300], assignedHours: 8 });
      const t2 = makeTeacher(2, {
        assignedTextbookIds: [301, 302], // 已满 2 本
        assignedHours: 0,
      });
      // V 使用 [300]，T2 已有 {301,302}，接管 V 加 300 → 3 > 2 → 跳过

      const assignments = [makeAssignment(1, 100, 4, 'T1')];
      const classTextbookMap = new Map([[100, [300]]]);
      const classInfoMap = new Map([[100, { collegeId: 10, trainingLevelId: 20 }]]);

      const u = makeUnassigned(200, { textbookIds: [300], weeklyHours: 4 });
      const teacherMap = new Map([
        [1, t1],
        [2, t2],
      ]);
      const assignmentsByTeacher = new Map([[1, assignments]]);

      const result = trySwapOne(
        u,
        assignments,
        assignmentsByTeacher,
        teacherMap,
        [t1, t2],
        'standard',
        1,
        '2025-2026-1',
        classTextbookMap,
        classInfoMap
      );
      expect(result).toBe(false);
    });
  });

  describe('成功置换', () => {
    it('满足所有约束时应成功置换并返回 true', () => {
      const t1 = makeTeacher(1, {
        assignedTextbookIds: [300],
        assignedHours: 8,
        standardCap: 16,
      });
      const t2 = makeTeacher(2, {
        assignedTextbookIds: [],
        assignedHours: 0,
        standardCap: 16,
      });

      // V = 4h, U = 4h
      // T1: 8 - 4 + 4 = 8 ≤ 16 ✓
      // T2: 0 + 4 = 4 ≤ 16 ✓
      // 教材: T1 移除 V(300, 独有) → {}, 加 U(300) → {300} = 1 ≤ 2 ✓
      // T2 接管 V(300) → {300} = 1 ≤ 2 ✓
      const vAssign = makeAssignment(1, 100, 4, 'T1');
      const assignments = [vAssign];
      const classTextbookMap = new Map([[100, [300]]]);
      const classInfoMap = new Map([[100, { collegeId: 10, trainingLevelId: 20 }]]);

      const u = makeUnassigned(200, { textbookIds: [300], weeklyHours: 4 });
      const teacherMap = new Map([
        [1, t1],
        [2, t2],
      ]);
      const assignmentsByTeacher = new Map([[1, [vAssign]]]);

      const result = trySwapOne(
        u,
        assignments,
        assignmentsByTeacher,
        teacherMap,
        [t1, t2],
        'standard',
        1,
        '2025-2026-1',
        classTextbookMap,
        classInfoMap
      );
      expect(result).toBe(true);

      // 验证 V 的 teacher_id 已改为 T2
      expect(vAssign.teacher_id).toBe(2);

      // 验证 U 已加入 assignments
      const uAssign = assignments.find((a) => a.class_id === 200);
      expect(uAssign).toBeDefined();
      expect(uAssign.teacher_id).toBe(1);
      expect(uAssign.weekly_hours).toBe(4);
    });
  });

  describe('无可置换场景', () => {
    it('无已分配记录时应返回 false', () => {
      const t1 = makeTeacher(1, { assignedHours: 0 });
      const u = makeUnassigned(200);
      const teacherMap = new Map([[1, t1]]);
      const assignmentsByTeacher = new Map(); // 空的

      const result = trySwapOne(
        u,
        [],
        assignmentsByTeacher,
        teacherMap,
        [t1],
        'standard',
        1,
        '2025-2026-1',
        new Map(),
        new Map()
      );
      expect(result).toBe(false);
    });

    it('只有一个教师且无其他教师接管 V 时应返回 false', () => {
      const t1 = makeTeacher(1, { assignedHours: 8 });
      const assignments = [makeAssignment(1, 100, 4, 'T1')];
      const { classTextbookMap, classInfoMap } = makeMaps(assignments);

      const u = makeUnassigned(200, { weeklyHours: 4 });
      const teacherMap = new Map([[1, t1]]);
      const assignmentsByTeacher = new Map([[1, assignments]]);

      const result = trySwapOne(
        u,
        assignments,
        assignmentsByTeacher,
        teacherMap,
        [t1],
        'standard',
        1,
        '2025-2026-1',
        classTextbookMap,
        classInfoMap
      );
      // T1 是唯一教师，T2 不存在（t2.id === t1.id 时 continue）→ 无可接管
      expect(result).toBe(false);
    });
  });
});
