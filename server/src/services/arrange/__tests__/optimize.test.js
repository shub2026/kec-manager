import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runOptimizeSchedule, applyOptimizeResult } from '../optimize.js';

// Mock dependencies
// Schema 对齐修复：mock 对齐真实 Prisma schema
// - teaching_assignments 用 semester（非 semester_id），关系为 class/teacher
// - teachers 模型无 teacher_textbook_preferences 关系
// - OL2 修复后教材推导复用 queries.js 的 getClassesWithCourse（mock 模块级替换）
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    teaching_assignments: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    teachers: {
      findMany: vi.fn(),
    },
    system_settings: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    isDebugEnabled: vi.fn(() => false),
  },
}));

vi.mock('../tabu-search.js', () => ({
  tabuOptimize: vi.fn(),
}));

vi.mock('../auto-arrange.js', () => ({
  calcMatchScore: vi.fn(() => 10),
}));

// OL2 修复后教材推导复用 queries.js 的 getClassesWithCourse（真实口径）
vi.mock('../queries.js', () => ({
  getClassesWithCourse: vi.fn(),
}));

vi.mock('../../../services/audit.service.js', () => ({
  createAuditLog: vi.fn(),
}));

// Schema 对齐后的 mock 数据构造器
function mockTeacher(id, name, overrides = {}) {
  return {
    id,
    name,
    personnel_type: 'full_time',
    default_weekly_hours: 16,
    gender: 'male',
    scheduling_colleges: overrides.scheduling_colleges || [],
    scheduling_levels: overrides.scheduling_levels || [],
    courses: overrides.courses || [{ course_id: 1 }], // 默认关联 courseId=1
    // teacher_textbook_preferences 已移除（schema 无此关系）
    ...overrides,
  };
}

// teaching_assignments 行：含 class/teacher 关系（对齐真实 schema）
function mockAssignment(classId, teacherId, courseId, overrides = {}) {
  return {
    id: overrides.id || classId * 100 + teacherId,
    class_id: classId,
    teacher_id: teacherId,
    course_id: courseId,
    semester: overrides.semester || '1',
    weekly_hours: 4,
    is_auto: true,
    is_locked: false,
    class: {
      id: classId,
      name: `Class ${classId}`,
      college_id: 1,
      training_level_id: 1,
      combination_id: null,
    },
    teacher: {
      id: teacherId,
      name: `Teacher ${teacherId}`,
      personnel_type: 'full_time',
      default_weekly_hours: 16,
    },
    ...overrides,
  };
}

// OL1 修复后 teaching_assignments.findMany 会被调用两次：
// 可优化记录查询（is_auto:true）与基线查询（where.OR 手动/锁定）
function mockAssignmentQueries(prisma, autoAssignments, baselineAssignments = []) {
  prisma.teaching_assignments.findMany.mockImplementation(({ where } = {}) =>
    where?.OR ? baselineAssignments : autoAssignments
  );
}

// 基线记录（手动排课/锁定）：仅含约束统计所需字段（对齐 optimize.js 的 select）
function mockBaselineAssignment(classId, teacherId, courseId, weeklyHours, collegeId = 1) {
  return {
    teacher_id: teacherId,
    class_id: classId,
    course_id: courseId,
    weekly_hours: weeklyHours,
    class: { id: classId, college_id: collegeId },
  };
}

describe('Optimize Service', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import('../../../lib/prisma.js');
    // 默认 mock：无系统课时配置（走 DEFAULT_HOUR_SETTINGS 回退）
    prisma.system_settings.findUnique.mockResolvedValue(null);
    // 默认 mock：教材推导返回空（班级无教材，与未匹配方案时的回退一致）
    const { getClassesWithCourse } = await import('../queries.js');
    getClassesWithCourse.mockResolvedValue([]);
  });

  // 回归 BUG 1：optimize.js 不能从 audit.middleware.js 导入不存在的 createAuditLog
  // （ESM 模块加载期 SyntaxError 会让整个服务模块完全无法加载，两个优化端点 100% 失败）
  it('should load the module without import errors (createAuditLog source)', async () => {
    let loaded = false;
    let err = null;
    try {
      const mod = await import('../optimize.js');
      loaded = !!mod.runOptimizeSchedule;
    } catch (e) {
      err = e;
    }
    expect(err).toBeNull();
    expect(loaded).toBe(true);
  });

  describe('runOptimizeSchedule', () => {
    it('should throw error when no assignments found', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      prisma.teaching_assignments.findMany.mockResolvedValue([]);

      await expect(runOptimizeSchedule(1, 'standard')).rejects.toThrow(
        '没有可优化的自动排课记录'
      );
    });

    it('should run optimization and return before/after metrics', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      const mockAssignments = [
        mockAssignment(1, 1, 1),
        mockAssignment(2, 1, 1),
        mockAssignment(3, 2, 1),
      ];

      mockAssignmentQueries(prisma, mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1'),
        mockTeacher(2, 'Teacher 2'),
      ]);

      tabuOptimize.mockImplementation((assignments, unassigned, teacherConstraints) => {
        const firstAssignment = assignments[0];
        if (firstAssignment) {
          firstAssignment.teacher_id = 2;
        }
        return {
          improved: true,
          iterations: 10,
          scoreBefore: 50,
          scoreAfter: 60,
          delta: 10,
          elapsed: 100,
        };
      });

      const result = await runOptimizeSchedule(1, 'standard');

      expect(result).toBeDefined();
      expect(result.semesterId).toBe(1);
      expect(result.mode).toBe('standard');
      expect(result.before).toBeDefined();
      expect(result.after).toBeDefined();
      expect(result.improvements).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.summary.totalClasses).toBe(3);
      expect(result.summary.affectedCourses).toBe(1);
      expect(result.summary.affectedTeachers).toBe(2);
    });

    it('should call progress callback when provided', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      const mockAssignments = [mockAssignment(1, 1, 1)];

      mockAssignmentQueries(prisma, mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([mockTeacher(1, 'Teacher 1')]);

      tabuOptimize.mockReturnValue({
        improved: false,
        iterations: 5,
        scoreBefore: 30,
        scoreAfter: 30,
        delta: 0,
        elapsed: 50,
      });

      const progressCallback = vi.fn();
      await runOptimizeSchedule(1, 'standard', { onProgress: progressCallback });

      expect(progressCallback).toHaveBeenCalled();
      expect(progressCallback.mock.calls.length).toBeGreaterThan(0);

      const firstCall = progressCallback.mock.calls[0][0];
      expect(firstCall).toHaveProperty('phase');
      expect(firstCall).toHaveProperty('message');
      expect(firstCall).toHaveProperty('percent');
    });

    it('should handle tabuOptimize errors gracefully', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      const mockAssignments = [mockAssignment(1, 1, 1)];

      mockAssignmentQueries(prisma, mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([mockTeacher(1, 'Teacher 1')]);

      tabuOptimize.mockImplementation(() => {
        throw new Error('Tabu optimization failed');
      });

      const result = await runOptimizeSchedule(1, 'standard');

      expect(result).toBeDefined();
      expect(result.summary.totalClasses).toBe(1);
      expect(result.changes).toHaveLength(0);
    });

    it('should include scheduling college/level IDs in teacher constraints', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      const mockAssignments = [mockAssignment(1, 1, 1)];

      mockAssignmentQueries(prisma, mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1', {
          scheduling_colleges: [{ college_id: 1 }, { college_id: 2 }],
          scheduling_levels: [{ training_level: { id: 1, name: '本科' } }],
        }),
      ]);

      let capturedConstraints = null;
      tabuOptimize.mockImplementation((assignments, unassigned, teacherConstraints) => {
        capturedConstraints = teacherConstraints;
        return {
          improved: false,
          iterations: 0,
          scoreBefore: 0,
          scoreAfter: 0,
          delta: 0,
          elapsed: 10,
        };
      });

      await runOptimizeSchedule(1, 'standard');

      expect(capturedConstraints).not.toBeNull();
      const teacher = capturedConstraints.find((t) => t.id === 1);
      expect(teacher).toBeDefined();
      expect(teacher.schedulingCollegeIds).toEqual([1, 2]);
      expect(teacher.schedulingLevelIds).toEqual([1]);
      expect(teacher.assignedTextbookIds).toBeInstanceOf(Set);
      expect(teacher.assignedCollegeIds).toBeInstanceOf(Set);
      expect(teacher.inherentTextbookIds).toBeDefined();
    });
  });

  describe('applyOptimizeResult', () => {
    it('should apply changes and create audit log', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { createAuditLog } = await import('../../../services/audit.service.js');

      const changes = [
        {
          class_id: 1,
          course_id: 1,
          from_teacher: { id: 1, name: 'Teacher 1' },
          to_teacher: { id: 2, name: 'Teacher 2' },
        },
        {
          class_id: 2,
          course_id: 1,
          from_teacher: { id: 1, name: 'Teacher 1' },
          to_teacher: { id: 3, name: 'Teacher 3' },
        },
      ];

      prisma.$transaction.mockImplementation(async (fn) => {
        const mockTx = {
          teaching_assignments: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return fn(mockTx);
      });

      createAuditLog.mockResolvedValue();

      const result = await applyOptimizeResult(1, changes, 1);

      expect(result.success).toBe(true);
      expect(result.appliedChanges).toBe(2);
      expect(result.requestedChanges).toBe(2);
      // Schema 对齐修复：审计日志改用 action/module/result/message 字段
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          action: 'update',
          module: 'teachingArrange',
          result: 'success',
          message: expect.stringContaining('变更2个班级'),
        })
      );
    });

    it('should throw error when transaction fails', async () => {
      const { prisma } = await import('../../../lib/prisma.js');

      const changes = [
        {
          class_id: 1,
          course_id: 1,
          from_teacher: { id: 1, name: 'Teacher 1' },
          to_teacher: { id: 2, name: 'Teacher 2' },
        },
      ];

      prisma.$transaction.mockRejectedValue(new Error('Transaction failed'));

      await expect(applyOptimizeResult(1, changes, 1)).rejects.toThrow(
        '应用优化结果失败'
      );
    });

    // OL4 修复：预览后数据变动时 where 匹配不到，appliedChanges 应报实际更新数而非请求数
    it('should report actual updated count when updateMany matches nothing (OL4 fix)', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { createAuditLog } = await import('../../../services/audit.service.js');

      const changes = [
        {
          class_id: 1,
          course_id: 1,
          from_teacher: { id: 1, name: 'Teacher 1' },
          to_teacher: { id: 2, name: 'Teacher 2' },
        },
        {
          class_id: 2,
          course_id: 1,
          from_teacher: { id: 1, name: 'Teacher 1' },
          to_teacher: { id: 3, name: 'Teacher 3' },
        },
      ];

      // 第一条命中，第二条因预览后被改动/锁定而匹配不到
      const updateManyMock = vi
        .fn()
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({ teaching_assignments: { updateMany: updateManyMock } })
      );
      createAuditLog.mockResolvedValue();

      const result = await applyOptimizeResult(1, changes, 1);

      expect(result.success).toBe(true);
      expect(result.appliedChanges).toBe(1);
      expect(result.requestedChanges).toBe(2);
    });
  });

  describe('meetsMinimumThreshold', () => {
    it('should return true when changes >= 3 and improvement > 5%', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      const mockAssignments = Array.from({ length: 4 }, (_, i) =>
        mockAssignment(i + 1, 1, 1)
      );

      mockAssignmentQueries(prisma, mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1'),
        mockTeacher(2, 'Teacher 2'),
      ]);

      const { calcMatchScore } = await import('../auto-arrange.js');
      // Simulate optimization improving scores
      let callCount = 0;
      calcMatchScore.mockImplementation(() => {
        callCount++;
        // Before metrics (first 4 calls): low score; after metrics (next 4 calls): high score
        return callCount <= 4 ? 5 : 15;
      });

      tabuOptimize.mockImplementation((assignments) => {
        // 优化后交替分配，保持负载均衡（而非全集中到一个教师）
        assignments.forEach((a, i) => {
          a.teacher_id = i % 2 === 0 ? 1 : 2;
        });
        return {
          improved: true,
          iterations: 20,
          scoreBefore: 100,
          scoreAfter: 120,
          delta: 20,
          elapsed: 150,
        };
      });

      const result = await runOptimizeSchedule(1, 'standard');
      expect(result.meetsThreshold).toBe(true);
      // 新阈值逻辑：scoreImprovement > 5% 即达标，不要求 changesCount >= 3
      expect(result.changes.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── P0 修复测试：跨课程状态回写 ──
  describe('cross-course state writeback (P0 fix)', () => {
    it('优化后 courseTeacherConstraints 的 assignedTextbookIds 应同步回共享 teacherConstraints', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      // 2 门课程，每门 2 个班级
      const mockAssignments = [
        mockAssignment(1, 1, 1),
        mockAssignment(2, 2, 2),
      ];

      mockAssignmentQueries(prisma, mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1', { courses: [{ course_id: 1 }, { course_id: 2 }] }),
        mockTeacher(2, 'Teacher 2', { courses: [{ course_id: 1 }, { course_id: 2 }] }),
      ]);
      // 2 门课程的教材：课程1→教材10，课程2→教材20
      const { getClassesWithCourse } = await import('../queries.js');
      getClassesWithCourse.mockImplementation(async (courseId) =>
        Number(courseId) === 1
          ? [{ classId: 1, textbooks: [{ id: 10 }] }]
          : [{ classId: 2, textbooks: [{ id: 20 }] }]
      );

      let capturedConstraints = null;
      tabuOptimize.mockImplementation((assignments, unassigned, teacherConstraints) => {
        capturedConstraints = teacherConstraints;
        // 模拟 tabu-search writeback：把教材写入 assignedTextbookIds
        // 课程1：教师1拿到教材10，教师2拿到教材10
        // 课程2：教师2拿到教材20
        for (const t of teacherConstraints) {
          if (assignments.some((a) => a.teacher_id === t.id)) {
            const courseAssignments = assignments.filter((a) => a.teacher_id === t.id);
            for (const a of courseAssignments) {
              // 模拟 writeback：教材加入 assignedTextbookIds
              t.assignedTextbookIds.add(a.course_id === 1 ? 10 : 20);
            }
          }
        }
        return {
          improved: true,
          iterations: 10,
          scoreBefore: 50,
          scoreAfter: 60,
          delta: 10,
          elapsed: 100,
        };
      });

      await runOptimizeSchedule(1, 'standard');

      // 验证 capturedConstraints 是副本（courseTeacherConstraints），不是共享的 teacherConstraints
      // 但更重要的是验证：优化后共享的 qualifiedTeachers 的 assignedTextbookIds 已被同步
      // 由于 qualifiedTeachers 是 teacherConstraints 数组中 filter 出的引用，
      // writeback 应已修改原始对象
      expect(capturedConstraints).not.toBeNull();

      // 课程1优化后，教师1应有教材10
      const teacher1InCourse1 = capturedConstraints.find((t) => t.id === 1);
      expect(teacher1InCourse1.assignedTextbookIds.has(10)).toBe(true);
    });

    // ── OL5 修复测试：跨课程课时基线同步 ──
    it('课程优化后 effectiveTotal 同步，后续课程容量修正基于真实剩余（防超课时/欠课时）', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      // 2 门课程×2 个班级（各 4h）：两位教师初始各教 2 个班（各 8h）
      const mockAssignments = [
        mockAssignment(1, 1, 1), // class1 course1 → t1
        mockAssignment(2, 2, 1), // class2 course1 → t2
        mockAssignment(3, 1, 2), // class3 course2 → t1
        mockAssignment(4, 2, 2), // class4 course2 → t2
      ];
      mockAssignmentQueries(prisma, mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1', { courses: [{ course_id: 1 }, { course_id: 2 }] }),
        mockTeacher(2, 'Teacher 2', { courses: [{ course_id: 1 }, { course_id: 2 }] }),
      ]);

      // 记录每次 tabuOptimize 调用时各教师的 standardCap 快照
      const capByCall = [];
      tabuOptimize.mockImplementation(
        (assignments, unassigned, teacherConstraints, mode, classMap, courseId) => {
          capByCall.push({
            courseId: Number(courseId),
            caps: new Map(teacherConstraints.map((t) => [t.id, t.standardCap])),
          });
          // 课程1：把 class2 从 t2 挪到 t1（t1 课程1 变 8h，t2 变 0h）
          if (Number(courseId) === 1) {
            for (const a of assignments) {
              if (a.class_id === 2) a.teacher_id = 1;
            }
            return { improved: true, iterations: 5, scoreBefore: 0, scoreAfter: 10, delta: 10, elapsed: 10 };
          }
          return { improved: false, iterations: 0, scoreBefore: 0, scoreAfter: 0, delta: 0, elapsed: 10 };
        }
      );

      await runOptimizeSchedule(1, 'standard');

      const course2Call = capByCall.find((c) => c.courseId === 2);
      expect(course2Call).toBeDefined();
      // 默认 full_time 标准课时 16：
      // t1 课程1 优化后升至 8h → 课程2 可用容量 = 16 - 8 = 8
      // （修复前 effectiveTotal 陈旧，会错算为 16 - 4 = 12，导致 t1 可被加到总课时 20h 超标）
      expect(course2Call.caps.get(1)).toBe(8);
      // t2 课程1 优化后降至 0h → 课程2 可用容量 = 16 - 0 = 16
      // （修复前会错算为 12，导致 t2 拿不到足额课时而欠分配）
      expect(course2Call.caps.get(2)).toBe(16);
    });

    // ── OL6 修复测试：容量修正段丢失个人周课时上限折算 ──
    it('容量修正段应折算教师个人周课时上限（default_weekly_hours）', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      // t1 个人周课时上限 10h（低于全局标准 16h），教 2 门课各 1 班（各 4h）
      const mockAssignments = [
        mockAssignment(1, 1, 1), // class1 course1 → t1
        mockAssignment(3, 1, 2), // class3 course2 → t1
      ];
      mockAssignmentQueries(prisma, mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1', {
          default_weekly_hours: 10,
          courses: [{ course_id: 1 }, { course_id: 2 }],
        }),
        mockTeacher(2, 'Teacher 2', { courses: [{ course_id: 1 }, { course_id: 2 }] }),
      ]);

      const capByCall = [];
      tabuOptimize.mockImplementation(
        (assignments, unassigned, teacherConstraints, mode, classMap, courseId) => {
          capByCall.push({
            courseId: Number(courseId),
            caps: new Map(teacherConstraints.map((t) => [t.id, t.standardCap])),
          });
          return { improved: false, iterations: 0, scoreBefore: 0, scoreAfter: 0, delta: 0, elapsed: 10 };
        }
      );

      await runOptimizeSchedule(1, 'standard');

      // 课程1 容量修正：otherHours = 8 - 4 = 4，
      // 个人剩余 = 10 - 4 = 6，standardCap = min(16 - 4, 6) = 6
      // （修复前丢失 min() 折算，错算为 16 - 4 = 12，
      //   导致 t1 可被加课至超出个人 10h 约束）
      const course1Call = capByCall.find((c) => c.courseId === 1);
      expect(course1Call).toBeDefined();
      expect(course1Call.caps.get(1)).toBe(6);
      // t2 无个人上限限制之外的变化：standardCap = min(16, 16 - 0) = 16
      expect(course1Call.caps.get(2)).toBe(16);
    });
  });

  // ── P0 修复测试：目标函数含 α/β 惩罚项 ──
  describe('calculateMetrics with penalty terms (P1 fix)', () => {
    it('score 应包含欠分配惩罚和负载方差惩罚（非仅 totalMatchScore）', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');
      const { calcMatchScore } = await import('../auto-arrange.js');

      // 2 个教师，3 个班级，全部分给教师1 → 教师2 欠分配
      const mockAssignments = [
        mockAssignment(1, 1, 1),
        mockAssignment(2, 1, 1),
        mockAssignment(3, 1, 1),
      ];

      mockAssignmentQueries(prisma, mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1'),
        mockTeacher(2, 'Teacher 2'),
      ]);

      // calcMatchScore 固定返回 10
      calcMatchScore.mockReturnValue(10);

      tabuOptimize.mockReturnValue({
        improved: false,
        iterations: 0,
        scoreBefore: 0,
        scoreAfter: 0,
        delta: 0,
        elapsed: 10,
      });

      const result = await runOptimizeSchedule(1, 'standard');

      // before.score 应 = totalMatchScore - underAssignmentPenalty - loadVariancePenalty
      // totalMatchScore = 3 × 10 = 30
      // 教师1: 3×4=12课时, cap=16, gap=4, 教师2: 0课时, cap=16, gap=16
      // underAssignmentPenalty = α × (4 + 16) = 5 × 20 = 100
      // loadVariance > 0（教师1=12/16=0.75, 教师2=0/16=0, variance>0）
      // score = 30 - 100 - loadVariancePenalty < 0
      expect(result.before.score).toBeLessThan(0);
      // 确认不是仅 totalMatchScore（30），而是减去了惩罚
      expect(result.before.score).toBeLessThan(30);
    });

    it('score 不应为 0 守卫丢弃负分场景（before.score !== 0 而非 > 0）', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');
      const { calcMatchScore } = await import('../auto-arrange.js');

      // 2 教师 2 班级，全给教师1 → 教师2 欠分配导致 before.score 为负
      const mockAssignments = [
        mockAssignment(1, 1, 1),
        mockAssignment(2, 1, 1),
      ];

      mockAssignmentQueries(prisma, mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1'),
        mockTeacher(2, 'Teacher 2'),
      ]);

      // 匹配分 = 1（极低），确保 totalMatchScore < underAssignmentPenalty
      calcMatchScore.mockReturnValue(1);

      // tabuOptimize 把班级2转给教师2 → 负载均衡改善，after.score 比 before.score 高
      tabuOptimize.mockImplementation((assignments) => {
        assignments[1].teacher_id = 2;
        return {
          improved: true,
          iterations: 5,
          scoreBefore: -100,
          scoreAfter: -50,
          delta: 50,
          elapsed: 50,
        };
      });

      const result = await runOptimizeSchedule(1, 'standard');

      // before.score 应为负数（匹配分2 - 欠分配惩罚5×24 - 方差惩罚 < 0）
      expect(result.before.score).toBeLessThan(0);
      // after.score 应比 before.score 高（负载均衡后欠分配减少）
      expect(result.after.score).toBeGreaterThan(result.before.score);
      // scoreImprovement 应正确计算（负分→正分的改进），而非返回 0
      expect(result.improvements.scoreImprovement).toBeGreaterThan(0);
      // meetsThreshold 应为 true
      expect(result.meetsThreshold).toBe(true);
    });
  });

  // ── OL2 修复测试：教材推导复用 getClassesWithCourse 真实口径 ──
  describe('textbook derivation via getClassesWithCourse (OL2 fix)', () => {
    it('应按 distinct 课程逐一调用 getClassesWithCourse，不再直查 classes/plan_courses', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');
      const { getClassesWithCourse } = await import('../queries.js');

      const mockAssignments = [
        mockAssignment(1, 1, 1),
        mockAssignment(2, 2, 1),
        mockAssignment(3, 1, 2),
      ];

      mockAssignmentQueries(prisma, mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'T1', { courses: [{ course_id: 1 }, { course_id: 2 }] }),
        mockTeacher(2, 'T2', { courses: [{ course_id: 1 }, { course_id: 2 }] }),
      ]);
      getClassesWithCourse.mockImplementation(async (courseId) =>
        Number(courseId) === 1
          ? [
              { classId: 1, textbooks: [{ id: 1 }] },
              { classId: 2, textbooks: [{ id: 1 }] },
            ]
          : [{ classId: 3, textbooks: [{ id: 2 }] }]
      );

      let capturedConstraints = null;
      tabuOptimize.mockImplementation((assignments, unassigned, teacherConstraints) => {
        capturedConstraints = capturedConstraints || teacherConstraints;
        return {
          improved: false, iterations: 0, scoreBefore: 0, scoreAfter: 0, delta: 0, elapsed: 10,
        };
      });

      await runOptimizeSchedule(1, 'standard');

      // 每门 distinct 课程调用一次（2 门课程 → 2 次），学期参数透传
      expect(getClassesWithCourse).toHaveBeenCalledTimes(2);
      expect(getClassesWithCourse).toHaveBeenCalledWith(1, '1');
      expect(getClassesWithCourse).toHaveBeenCalledWith(2, '1');

      // 教材按 (course_id, class_id) 口径计入教师约束：
      // 教堈1 持班1(课1→教材1) + 班3(课2→教材2)
      const teacher1 = capturedConstraints.find((t) => t.id === 1);
      expect(teacher1.assignedTextbookIds.has(1)).toBe(true);
      expect(teacher1.assignedTextbookIds.has(2)).toBe(true);
    });
  });

  // ── OL1 修复测试：手动/锁定记录计入教师约束基线 ──
  describe('baseline assignments in teacher constraints (OL1 fix)', () => {
    it('手动排课的课时与教材应计入教师约束（容量扣减 + 教材基线）', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');
      const { getClassesWithCourse } = await import('../queries.js');

      // 可优化：教堈1 在课程1 持班1（4h）；基线：教堈1 在课程2 有手动排课班99（6h，教材99）
      const autoAssignments = [mockAssignment(1, 1, 1)];
      const baseline = [mockBaselineAssignment(99, 1, 2, 6, 3)];

      mockAssignmentQueries(prisma, autoAssignments, baseline);
      prisma.teachers.findMany.mockResolvedValue([mockTeacher(1, 'Teacher 1')]);
      getClassesWithCourse.mockImplementation(async (courseId) =>
        Number(courseId) === 1
          ? [{ classId: 1, textbooks: [{ id: 1 }] }]
          : [{ classId: 99, textbooks: [{ id: 99 }] }]
      );

      let capturedConstraints = null;
      tabuOptimize.mockImplementation((assignments, unassigned, teacherConstraints) => {
        capturedConstraints = teacherConstraints;
        return {
          improved: false, iterations: 0, scoreBefore: 0, scoreAfter: 0, delta: 0, elapsed: 10,
        };
      });

      await runOptimizeSchedule(1, 'standard');

      // 基线查询应携带手动/锁定筛选条件
      const baselineCall = prisma.teaching_assignments.findMany.mock.calls.find(
        (c) => c[0]?.where?.OR
      );
      expect(baselineCall).toBeDefined();
      expect(baselineCall[0].where.OR).toEqual([{ is_auto: false }, { is_locked: true }]);

      expect(capturedConstraints).not.toBeNull();
      const teacher1 = capturedConstraints.find((t) => t.id === 1);
      // 教材基线：含自动教材1 + 手动教材99（全学期累计口径）
      expect(teacher1.assignedTextbookIds.has(1)).toBe(true);
      expect(teacher1.assignedTextbookIds.has(99)).toBe(true);
      expect(teacher1.inherentTextbookIds).toContain(99);
      // 学院基线：含手动排课班级的学院
      expect(teacher1.assignedCollegeIds.has(3)).toBe(true);
      // 容量口径：existingHours = 4(自动) + 6(手动) = 10；
      // 排除本课（课程1 占 4h）后 otherHours=6，standardCap = 16-6 = 10（非忽略手动时的 12）
      expect(teacher1.effectiveTotal).toBe(10);
      expect(teacher1.standardCap).toBe(10);
    });
  });

  // ── OL3 修复测试：课时容量采用系统设置 ──
  describe('hour settings from system_settings (OL3 fix)', () => {
    it('系统设置存在时 standardHours/maxHours 应采用配置值而非默认值', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      const mockAssignments = [mockAssignment(1, 1, 1)];
      mockAssignmentQueries(prisma, mockAssignments);
      // 教师无个人课时上限，走全局配置口径
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1', { default_weekly_hours: null }),
      ]);
      prisma.system_settings.findUnique.mockResolvedValue({
        key: 'teaching_hour_settings',
        value: JSON.stringify({ full_time: { standard: 20, max: 26 } }),
      });

      let capturedConstraints = null;
      tabuOptimize.mockImplementation((assignments, unassigned, teacherConstraints) => {
        capturedConstraints = teacherConstraints;
        return {
          improved: false, iterations: 0, scoreBefore: 0, scoreAfter: 0, delta: 0, elapsed: 10,
        };
      });

      await runOptimizeSchedule(1, 'standard');

      expect(capturedConstraints).not.toBeNull();
      const teacher1 = capturedConstraints.find((t) => t.id === 1);
      expect(teacher1.standardHours).toBe(20);
      expect(teacher1.maxHours).toBe(26);
      // 容量排除本课（4h）后：standardCap = 20 - 0 = 20
      expect(teacher1.standardCap).toBe(20);
    });
  });
});
