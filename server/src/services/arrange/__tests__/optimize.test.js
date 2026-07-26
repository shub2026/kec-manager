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
      findUnique: vi.fn(),
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
    // 默认 mock：classes.findUnique 返回班级基础信息
    const { prisma } = await import('../../../lib/prisma.js');
    prisma.classes.findUnique.mockImplementation(({ where }) => ({
      id: where.id,
      major_id: 1,
      training_level_id: 1,
      enrollment_year: 2023,
      custom_plan_id: null,
    }));
    // 默认 mock：plan_courses 返回含教材的方案
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
          classId: 1,
          courseId: 1,
          fromTeacher: { id: 1, name: 'Teacher 1' },
          toTeacher: { id: 2, name: 'Teacher 2' },
        },
        {
          classId: 2,
          courseId: 1,
          fromTeacher: { id: 1, name: 'Teacher 1' },
          toTeacher: { id: 3, name: 'Teacher 3' },
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
          classId: 1,
          courseId: 1,
          fromTeacher: { id: 1, name: 'Teacher 1' },
          toTeacher: { id: 2, name: 'Teacher 2' },
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
        assignments.forEach((a) => {
          a.teacher_id = 2;
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
      expect(result.changes.length).toBeGreaterThanOrEqual(3);
    });
  });
});
