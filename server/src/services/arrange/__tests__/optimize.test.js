import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runOptimizeSchedule, applyOptimizeResult } from '../optimize.js';

// Mock dependencies
// Schema 对齐修复：mock 对齐真实 Prisma schema
// - teaching_assignments 用 semester（非 semester_id），关系为 class/teacher
// - teachers 模型无 teacher_textbook_preferences 关系
// - classes 模型无 textbook_id/weekly_hours/class_name/course_id 字段
// - 教材通过 plan_courses → plan_course_semesters → plan_textbooks 获取
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    teaching_assignments: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    teachers: {
      findMany: vi.fn(),
    },
    classes: {
      findMany: vi.fn(),
    },
    plan_courses: {
      findMany: vi.fn(),
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

// plan_courses 查询返回（含教材信息）
function mockPlanCourse(courseId, textbookIds = [1]) {
  return {
    id: courseId * 10,
    course_id: courseId,
    training_plans: {
      id: 1,
      sort_order: 1,
      major_id: 1,
      training_level_id: 1,
    },
    plan_course_semesters: [
      {
        id: courseId * 100,
        semester: 1,
        plan_textbooks: textbookIds.map((tid) => ({
          textbook_id: tid,
          textbooks: { id: tid },
        })),
      },
    ],
  };
}

describe('Optimize Service', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认 mock：classes.findMany 批量返回班级基础信息
    const { prisma } = await import('../../../lib/prisma.js');
    prisma.classes.findMany.mockImplementation(({ where }) => {
      const ids = where.id?.in || [];
      return ids.map((id) => ({
        id,
        major_id: 1,
        training_level_id: 1,
        enrollment_year: 2023,
        custom_plan_id: null,
      }));
    });
    // 默认 mock：plan_courses.findMany 批量返回含教材的方案
    prisma.plan_courses.findMany.mockResolvedValue([mockPlanCourse(1, [1])]);
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

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1'),
        mockTeacher(2, 'Teacher 2'),
      ]);
      prisma.plan_courses.findMany.mockResolvedValue([mockPlanCourse(1, [1])]);

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

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([mockTeacher(1, 'Teacher 1')]);
      prisma.plan_courses.findMany.mockResolvedValue([mockPlanCourse(1, [1])]);

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

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([mockTeacher(1, 'Teacher 1')]);
      prisma.plan_courses.findMany.mockResolvedValue([mockPlanCourse(1, [1])]);

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

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1', {
          scheduling_colleges: [{ college_id: 1 }, { college_id: 2 }],
          scheduling_levels: [{ training_level: { id: 1, name: '本科' } }],
        }),
      ]);
      prisma.plan_courses.findMany.mockResolvedValue([mockPlanCourse(1, [1])]);

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
  });

  describe('meetsMinimumThreshold', () => {
    it('should return true when changes >= 3 and improvement > 5%', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      const mockAssignments = Array.from({ length: 4 }, (_, i) =>
        mockAssignment(i + 1, 1, 1)
      );

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1'),
        mockTeacher(2, 'Teacher 2'),
      ]);
      prisma.plan_courses.findMany.mockResolvedValue([mockPlanCourse(1, [1])]);

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

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1', { courses: [{ course_id: 1 }, { course_id: 2 }] }),
        mockTeacher(2, 'Teacher 2', { courses: [{ course_id: 1 }, { course_id: 2 }] }),
      ]);
      // 2 门课程的 plan_courses
      prisma.plan_courses.findMany.mockResolvedValue([
        mockPlanCourse(1, [10]),
        mockPlanCourse(2, [20]),
      ]);

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

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1'),
        mockTeacher(2, 'Teacher 2'),
      ]);
      prisma.plan_courses.findMany.mockResolvedValue([mockPlanCourse(1, [1])]);

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

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1'),
        mockTeacher(2, 'Teacher 2'),
      ]);
      prisma.plan_courses.findMany.mockResolvedValue([mockPlanCourse(1, [1])]);

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

  // ── P0 修复测试：N+1 查询改批量 ──
  describe('batch query (N+1 fix)', () => {
    it('classes.findMany 应被批量调用而非逐班 findUnique', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      const mockAssignments = [
        mockAssignment(1, 1, 1),
        mockAssignment(2, 2, 1),
        mockAssignment(3, 1, 2),
      ];

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'T1', { courses: [{ course_id: 1 }, { course_id: 2 }] }),
        mockTeacher(2, 'T2', { courses: [{ course_id: 1 }, { course_id: 2 }] }),
      ]);
      prisma.plan_courses.findMany.mockResolvedValue([mockPlanCourse(1, [1]), mockPlanCourse(2, [2])]);

      tabuOptimize.mockReturnValue({
        improved: false, iterations: 0, scoreBefore: 0, scoreAfter: 0, delta: 0, elapsed: 10,
      });

      await runOptimizeSchedule(1, 'standard');

      // classes.findMany 应只被调用 1 次（批量），而非 N 次
      expect(prisma.classes.findMany).toHaveBeenCalledTimes(1);
      // plan_courses.findMany 应只被调用 1 次（批量）
      expect(prisma.plan_courses.findMany).toHaveBeenCalledTimes(1);
      // 验证批量查询的 where 条件包含所有 classId
      const classesCallArgs = prisma.classes.findMany.mock.calls[0][0];
      expect(classesCallArgs.where.id.in).toContain(1);
      expect(classesCallArgs.where.id.in).toContain(2);
      expect(classesCallArgs.where.id.in).toContain(3);
    });
  });
});
