import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runOptimizeSchedule, applyOptimizeResult } from '../optimize.js';

// Mock dependencies
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    teaching_assignments: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    teachers: {
      findMany: vi.fn(),
    },
    course_classes: {
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

function mockTeacher(id, name, overrides = {}) {
  return {
    id,
    name,
    personnel_type: 'full_time',
    default_weekly_hours: 16,
    gender: 'male',
    scheduling_colleges: overrides.scheduling_colleges || [],
    scheduling_levels: overrides.scheduling_levels || [],
    teacher_textbook_preferences: overrides.teacher_textbook_preferences || [],
    ...overrides,
  };
}

function mockAssignment(classId, teacherId, courseId, overrides = {}) {
  return {
    class_id: classId,
    teacher_id: teacherId,
    weekly_hours: 4,
    is_auto: true,
    is_locked: false,
    course_classes: {
      course_id: courseId,
      textbook_id: 1,
      class_name: `Class ${classId}`,
      weekly_hours: 4,
      college_id: 1,
      training_level_id: 1,
    },
    teachers: {
      id: teacherId,
      name: `Teacher ${teacherId}`,
      personnel_type: 'full_time',
      default_weekly_hours: 16,
    },
    ...overrides,
  };
}

function mockClass(id, courseId, overrides = {}) {
  return {
    id,
    course_id: courseId,
    textbook_id: 1,
    weekly_hours: 4,
    class_name: `Class ${id}`,
    college_id: 1,
    training_level_id: 1,
    ...overrides,
  };
}

describe('Optimize Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 回归 BUG 1：optimize.js 不能从 audit.middleware.js 导入不存在的 createAuditLog
  // （ESM 模块加载期 SyntaxError 会让整个服务模块完全无法加载，两个优化端点 100% 失败）
  it('should load the module without import errors (createAuditLog source)', async () => {
    let loaded = false;
    let err = null;
    try {
      // 不带 vi.mock 的真实导入路径——vi.mock 已在文件顶部全局生效，
      // 这里仅验证“被 mock 后能解析到 createAuditLog 导出”，避免源码指向错误模块
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
      prisma.course_classes.findMany.mockResolvedValue([
        mockClass(1, 1),
        mockClass(2, 1),
        mockClass(3, 1),
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

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([mockTeacher(1, 'Teacher 1')]);
      prisma.course_classes.findMany.mockResolvedValue([mockClass(1, 1)]);

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
      prisma.course_classes.findMany.mockResolvedValue([mockClass(1, 1)]);

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
      prisma.course_classes.findMany.mockResolvedValue([mockClass(1, 1)]);

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
          fromTeacher: { id: 1, name: 'Teacher 1' },
          toTeacher: { id: 2, name: 'Teacher 2' },
        },
        {
          classId: 2,
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
      expect(createAuditLog).toHaveBeenCalledWith({
        userId: 1,
        action: 'optimize_schedule',
        targetType: 'semester',
        targetId: 1,
        details: '应用排课优化结果，变更2个班级的教师分配',
      });
    });

    it('should throw error when transaction fails', async () => {
      const { prisma } = await import('../../../lib/prisma.js');

      const changes = [
        {
          classId: 1,
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
      prisma.course_classes.findMany.mockResolvedValue(
        mockAssignments.map((a, i) => mockClass(i + 1, 1))
      );

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
      expect(result.improvements.scoreImprovement).toBeGreaterThan(5);
    });

    it('should return false when changes < 3', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      const mockAssignments = [
        mockAssignment(1, 1, 1),
        mockAssignment(2, 1, 1),
      ];

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([mockTeacher(1, 'Teacher 1')]);
      prisma.course_classes.findMany.mockResolvedValue([
        mockClass(1, 1),
        mockClass(2, 1),
      ]);

      tabuOptimize.mockReturnValue({
        improved: false,
        iterations: 5,
        scoreBefore: 30,
        scoreAfter: 30,
        delta: 0,
        elapsed: 50,
      });

      const result = await runOptimizeSchedule(1, 'standard');

      expect(result.meetsThreshold).toBe(false);
      expect(result.changes.length).toBeLessThan(3);
    });

    // 回归 BUG 3：changesCount 应基于真实变更班级数，而非迭代次数
    it('should set after.changesCount to real change count, not iterations', async () => {
      const { prisma } = await import('../../../lib/prisma.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      const mockAssignments = [
        mockAssignment(1, 1, 1),
        mockAssignment(2, 1, 1),
      ];

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        mockTeacher(1, 'Teacher 1'),
        mockTeacher(2, 'Teacher 2'),
      ]);
      prisma.course_classes.findMany.mockResolvedValue([mockClass(1, 1), mockClass(2, 1)]);

      // 仅变更 1 个班级，但迭代 100 次——若用 iterations 冒充 changesCount 会误判达阈值
      tabuOptimize.mockImplementation((assignments) => {
        if (assignments[0]) assignments[0].teacher_id = 2;
        return {
          improved: true,
          iterations: 100,
          scoreBefore: 30,
          scoreAfter: 40,
          delta: 10,
          elapsed: 50,
        };
      });

      const result = await runOptimizeSchedule(1, 'standard');

      expect(result.changes.length).toBe(1);
      expect(result.after.changesCount).toBe(1);
      expect(result.meetsThreshold).toBe(false); // changes < 3

      // 回归 BUG 4：changes 应携带 className 以便前端展示
      expect(result.changes[0].className).toBeDefined();
      expect(result.changes[0].className).toBe('Class 1');
      expect(result.changes[0].fromTeacher.name).toBe('Teacher 1');
      expect(result.changes[0].toTeacher.name).toBe('Teacher 2');
    });
  });
});
