import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runOptimizeSchedule, applyOptimizeResult } from '../optimize.js';

// Mock dependencies
vi.mock('../../database.js', () => ({
  default: {
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

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../tabu-search.js', () => ({
  tabuOptimize: vi.fn(),
}));

vi.mock('../../middleware/audit.middleware.js', () => ({
  createAuditLog: vi.fn(),
}));

describe('Optimize Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runOptimizeSchedule', () => {
    it('should throw error when no assignments found', async () => {
      const { default: prisma } = await import('../../database.js');
      prisma.teaching_assignments.findMany.mockResolvedValue([]);

      await expect(runOptimizeSchedule(1, 'standard')).rejects.toThrow(
        '没有可优化的自动排课记录'
      );
    });

    it('should run optimization and return before/after metrics', async () => {
      const { default: prisma } = await import('../../database.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      // Mock assignments data
      const mockAssignments = [
        {
          class_id: 1,
          teacher_id: 1,
          weekly_hours: 4,
          is_auto: true,
          is_locked: false,
          course_classes: {
            course_id: 1,
            textbook_id: 1,
            class_name: 'Class A',
            weekly_hours: 4,
          },
          teachers: {
            id: 1,
            name: 'Teacher 1',
            personnel_type: 'full_time',
            default_weekly_hours: 16,
          },
        },
        {
          class_id: 2,
          teacher_id: 1,
          weekly_hours: 4,
          is_auto: true,
          is_locked: false,
          course_classes: {
            course_id: 1,
            textbook_id: 1,
            class_name: 'Class B',
            weekly_hours: 4,
          },
          teachers: {
            id: 1,
            name: 'Teacher 1',
            personnel_type: 'full_time',
            default_weekly_hours: 16,
          },
        },
        {
          class_id: 3,
          teacher_id: 2,
          weekly_hours: 4,
          is_auto: true,
          is_locked: false,
          course_classes: {
            course_id: 1,
            textbook_id: 1,
            class_name: 'Class C',
            weekly_hours: 4,
          },
          teachers: {
            id: 2,
            name: 'Teacher 2',
            personnel_type: 'full_time',
            default_weekly_hours: 16,
          },
        },
      ];

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Teacher 1',
          personnel_type: 'full_time',
          default_weekly_hours: 16,
          teacher_textbook_preferences: [],
        },
        {
          id: 2,
          name: 'Teacher 2',
          personnel_type: 'full_time',
          default_weekly_hours: 16,
          teacher_textbook_preferences: [],
        },
      ]);
      prisma.course_classes.findMany.mockResolvedValue([
        {
          id: 1,
          course_id: 1,
          textbook_id: 1,
          weekly_hours: 4,
          class_name: 'Class A',
          college_id: 1,
          training_level_id: 1,
        },
        {
          id: 2,
          course_id: 1,
          textbook_id: 1,
          weekly_hours: 4,
          class_name: 'Class B',
          college_id: 1,
          training_level_id: 1,
        },
        {
          id: 3,
          course_id: 1,
          textbook_id: 1,
          weekly_hours: 4,
          class_name: 'Class C',
          college_id: 1,
          training_level_id: 1,
        },
      ]);

      // Mock tabuOptimize to simulate optimization
      tabuOptimize.mockImplementation((assignments, unassigned, teacherConstraints) => {
        // Simulate optimization: swap one assignment
        const firstAssignment = assignments[0];
        if (firstAssignment) {
          firstAssignment.teacher_id = 2; // Swap to teacher 2
        }
        return {
          improved: true,
          iterations: 10,
          scoreBefore: 50,
          scoreAfter: 40,
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
      const { default: prisma } = await import('../../database.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      const mockAssignments = [
        {
          class_id: 1,
          teacher_id: 1,
          weekly_hours: 4,
          is_auto: true,
          is_locked: false,
          course_classes: {
            course_id: 1,
            textbook_id: 1,
            class_name: 'Class A',
            weekly_hours: 4,
          },
          teachers: {
            id: 1,
            name: 'Teacher 1',
            personnel_type: 'full_time',
            default_weekly_hours: 16,
          },
        },
      ];

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Teacher 1',
          personnel_type: 'full_time',
          default_weekly_hours: 16,
          teacher_textbook_preferences: [],
        },
      ]);
      prisma.course_classes.findMany.mockResolvedValue([
        {
          id: 1,
          course_id: 1,
          textbook_id: 1,
          weekly_hours: 4,
          class_name: 'Class A',
          college_id: 1,
          training_level_id: 1,
        },
      ]);

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
      
      // Check that progress was called with correct structure
      const firstCall = progressCallback.mock.calls[0][0];
      expect(firstCall).toHaveProperty('phase');
      expect(firstCall).toHaveProperty('message');
      expect(firstCall).toHaveProperty('percent');
    });

    it('should handle tabuOptimize errors gracefully', async () => {
      const { default: prisma } = await import('../../database.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      const mockAssignments = [
        {
          class_id: 1,
          teacher_id: 1,
          weekly_hours: 4,
          is_auto: true,
          is_locked: false,
          course_classes: {
            course_id: 1,
            textbook_id: 1,
            class_name: 'Class A',
            weekly_hours: 4,
          },
          teachers: {
            id: 1,
            name: 'Teacher 1',
            personnel_type: 'full_time',
            default_weekly_hours: 16,
          },
        },
      ];

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Teacher 1',
          personnel_type: 'full_time',
          default_weekly_hours: 16,
          teacher_textbook_preferences: [],
        },
      ]);
      prisma.course_classes.findMany.mockResolvedValue([
        {
          id: 1,
          course_id: 1,
          textbook_id: 1,
          weekly_hours: 4,
          class_name: 'Class A',
          college_id: 1,
          training_level_id: 1,
        },
      ]);

      tabuOptimize.mockImplementation(() => {
        throw new Error('Tabu optimization failed');
      });

      // Should not throw, but log warning and continue
      const result = await runOptimizeSchedule(1, 'standard');

      expect(result).toBeDefined();
      expect(result.summary.totalClasses).toBe(1);
      // Since tabu failed, no changes should be made
      expect(result.changes).toHaveLength(0);
    });
  });

  describe('applyOptimizeResult', () => {
    it('should apply changes and create audit log', async () => {
      const { default: prisma } = await import('../../database.js');
      const { createAuditLog } = await import('../../middleware/audit.middleware.js');

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
      const { default: prisma } = await import('../../database.js');

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
      const { default: prisma } = await import('../../database.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      // Create 4 assignments that will all be changed
      const mockAssignments = Array.from({ length: 4 }, (_, i) => ({
        class_id: i + 1,
        teacher_id: 1,
        weekly_hours: 4,
        is_auto: true,
        is_locked: false,
        course_classes: {
          course_id: 1,
          textbook_id: 1,
          class_name: `Class ${i + 1}`,
          weekly_hours: 4,
        },
        teachers: {
          id: 1,
          name: 'Teacher 1',
          personnel_type: 'full_time',
          default_weekly_hours: 16,
        },
      }));

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Teacher 1',
          personnel_type: 'full_time',
          default_weekly_hours: 16,
          teacher_textbook_preferences: [],
        },
        {
          id: 2,
          name: 'Teacher 2',
          personnel_type: 'full_time',
          default_weekly_hours: 16,
          teacher_textbook_preferences: [],
        },
      ]);
      prisma.course_classes.findMany.mockResolvedValue(
        mockAssignments.map((a, i) => ({
          id: i + 1,
          course_id: 1,
          textbook_id: 1,
          weekly_hours: 4,
          class_name: `Class ${i + 1}`,
          college_id: 1,
          training_level_id: 1,
        }))
      );

      // Simulate optimization that changes all assignments
      tabuOptimize.mockImplementation((assignments) => {
        assignments.forEach((a) => {
          a.teacher_id = 2; // Change all to teacher 2
        });
        return {
          improved: true,
          iterations: 20,
          scoreBefore: 100,
          scoreAfter: 80,
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
      const { default: prisma } = await import('../../database.js');
      const { tabuOptimize } = await import('../tabu-search.js');

      // Create 2 assignments
      const mockAssignments = [
        {
          class_id: 1,
          teacher_id: 1,
          weekly_hours: 4,
          is_auto: true,
          is_locked: false,
          course_classes: {
            course_id: 1,
            textbook_id: 1,
            class_name: 'Class A',
            weekly_hours: 4,
          },
          teachers: {
            id: 1,
            name: 'Teacher 1',
            personnel_type: 'full_time',
            default_weekly_hours: 16,
          },
        },
        {
          class_id: 2,
          teacher_id: 1,
          weekly_hours: 4,
          is_auto: true,
          is_locked: false,
          course_classes: {
            course_id: 1,
            textbook_id: 1,
            class_name: 'Class B',
            weekly_hours: 4,
          },
          teachers: {
            id: 1,
            name: 'Teacher 1',
            personnel_type: 'full_time',
            default_weekly_hours: 16,
          },
        },
      ];

      prisma.teaching_assignments.findMany.mockResolvedValue(mockAssignments);
      prisma.teachers.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Teacher 1',
          personnel_type: 'full_time',
          default_weekly_hours: 16,
          teacher_textbook_preferences: [],
        },
      ]);
      prisma.course_classes.findMany.mockResolvedValue([
        {
          id: 1,
          course_id: 1,
          textbook_id: 1,
          weekly_hours: 4,
          class_name: 'Class A',
          college_id: 1,
          training_level_id: 1,
        },
        {
          id: 2,
          course_id: 1,
          textbook_id: 1,
          weekly_hours: 4,
          class_name: 'Class B',
          college_id: 1,
          training_level_id: 1,
        },
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
  });
});
