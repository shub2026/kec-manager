/**
 * 排课优化硬约束集成回归测试（不 mock tabuOptimize，走真实禁忌搜索）
 *
 * 覆盖三类历史缺陷的回归防护：
 * - P0-1 教师课时超容量：globalClassMap 按 class_id 摊平 weekly_hours，
 *   同班多课程时首条记录污染其余课程口径，搜索内部记账偏小导致超容量加课
 * - P0-2 合班拆散：优化把同一 combination 的成员班分给不同教师
 * - P0-3 教材硬上限失守：跨课程教材口径污染导致上限检查漏判
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runOptimizeSchedule } from '../optimize.js';

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

vi.mock('../../../utils/logger.js', () => {
  const fn = vi.fn();
  return { default: { info: fn, warn: fn, error: fn, debug: fn }, log: { info: fn, warn: fn, error: fn, debug: fn } };
});

// 注意：不 mock ../tabu-search.js —— 使用真实禁忌搜索验证约束链路
vi.mock('../auto-arrange.js', () => ({
  calcMatchScore: vi.fn((teacher) => (teacher.id === 1 ? 50 : 0)),
  batchLocks: new Set(),
}));

vi.mock('../lock.js', () => ({
  acquireLock: vi.fn(async () => true),
  releaseLock: vi.fn(async () => true),
}));

vi.mock('../queries.js', () => ({
  getClassesWithCourse: vi.fn(async () => []),
}));

vi.mock('../../../services/audit.service.js', () => ({
  createAuditLog: vi.fn(),
}));

function mockTeacher(id, overrides = {}) {
  return {
    id,
    name: `Teacher ${id}`,
    personnel_type: 'full_time',
    default_weekly_hours: null,
    gender: 'male',
    scheduling_colleges: [],
    scheduling_levels: [],
    courses: [{ course_id: 1 }, { course_id: 2 }],
    ...overrides,
  };
}

function mockAssignment(classId, teacherId, courseId, weeklyHours, overrides = {}) {
  return {
    id: classId * 1000 + courseId,
    class_id: classId,
    teacher_id: teacherId,
    course_id: courseId,
    semester: '2025-2026-1',
    weekly_hours: weeklyHours,
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
      default_weekly_hours: null,
    },
    ...overrides,
  };
}

/** 依据初始课时 + 优化变更重建每位教师的最终总课时 */
function computeFinalHours(fixture, changes) {
  const teacherHours = new Map();
  for (const a of fixture) {
    teacherHours.set(a.teacher_id, (teacherHours.get(a.teacher_id) || 0) + a.weekly_hours);
  }
  const hoursByKey = new Map(fixture.map((a) => [`${a.class_id}:${a.course_id}`, a.weekly_hours]));
  for (const c of changes) {
    const h = hoursByKey.get(`${c.classId}:${c.courseId}`) || 0;
    teacherHours.set(c.fromTeacher.id, (teacherHours.get(c.fromTeacher.id) || 0) - h);
    teacherHours.set(c.toTeacher.id, (teacherHours.get(c.toTeacher.id) || 0) + h);
  }
  return teacherHours;
}

describe('排课优化硬约束回归（真实禁忌搜索）', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import('../../../lib/prisma.js');
    prisma.system_settings.findUnique.mockResolvedValue(null);
    prisma.teaching_assignments.findMany.mockImplementation(({ where } = {}) =>
      where?.OR ? [] : []
    );
    prisma.teachers.findMany.mockResolvedValue([mockTeacher(1), mockTeacher(2)]);
  });

  it('P0-1：优化后教师总课时不应超过标准容量（16h）', async () => {
    const { prisma } = await import('../../../lib/prisma.js');

    // 两门课都覆盖班 1-4；课程1 每班 2h、课程2 每班 4h。
    // 初始：T1 与 T2 各 12h（容量 16h）。calcMatchScore 强烈偏向 T1，
    // 诱导算法向 T1 集中——修复前 classMap 按首条记录把课程2的班记成 2h，
    // 搜索误判容量充足，T1 最终被加到 24h。
    const fixture = [
      mockAssignment(1, 1, 1, 2),
      mockAssignment(2, 1, 1, 2),
      mockAssignment(3, 2, 1, 2),
      mockAssignment(4, 2, 1, 2),
      mockAssignment(1, 1, 2, 4),
      mockAssignment(2, 1, 2, 4),
      mockAssignment(3, 2, 2, 4),
      mockAssignment(4, 2, 2, 4),
    ];
    prisma.teaching_assignments.findMany.mockImplementation(({ where } = {}) =>
      where?.OR ? [] : fixture
    );

    const result = await runOptimizeSchedule('2025-2026-1', 'standard');

    const finalHours = computeFinalHours(fixture, result.changes);
    for (const [tid, hours] of finalHours) {
      expect(hours, `教师${tid}优化后总课时${hours}h超过标准容量16h`).toBeLessThanOrEqual(16);
    }
  });

  it('P0-2：优化不应拆散合班（同一 combination 的成员班必须同教师）', async () => {
    const { prisma } = await import('../../../lib/prisma.js');

    // 课程1：组合7 的班10、班11 → T2（各 2h）
    // 课程2：班20、班21 → T1（各 7h）；班22 → T2（7h）
    // T1 otherHours = 14 → 课程1 可用容量恰为 2，只放得下 1 个成员班：
    // 修复前优化会把班10、班11 分别处理，拆给不同教师
    const fixture = [
      mockAssignment(10, 2, 1, 2, {
        class: { id: 10, name: 'C10', college_id: 1, training_level_id: 1, combination_id: 7 },
      }),
      mockAssignment(11, 2, 1, 2, {
        class: { id: 11, name: 'C11', college_id: 1, training_level_id: 1, combination_id: 7 },
      }),
      mockAssignment(20, 1, 2, 7),
      mockAssignment(21, 1, 2, 7),
      mockAssignment(22, 2, 2, 7),
    ];
    prisma.teaching_assignments.findMany.mockImplementation(({ where } = {}) =>
      where?.OR ? [] : fixture
    );

    const result = await runOptimizeSchedule('2025-2026-1', 'standard');

    const finalTeacher = new Map(fixture.map((a) => [`${a.class_id}:${a.course_id}`, a.teacher_id]));
    for (const c of result.changes) {
      finalTeacher.set(`${c.classId}:${c.courseId}`, c.toTeacher.id);
    }
    const t10 = finalTeacher.get('10:1');
    const t11 = finalTeacher.get('11:1');
    expect(t10, '合班成员班被优化拆散：班10与班11教师不同').toBe(t11);
  });

  it('P0-3：优化不应让教师教材数超过硬上限（2 本）', async () => {
    const { prisma } = await import('../../../lib/prisma.js');
    const { getClassesWithCourse } = await import('../queries.js');

    // 教材按 (course, class) 推导：课1班1→教材10、课3班30→教材30（均 T1 已教），
    // 课2班1→教材20（T2 名下）。T1 已持 2 本教材；
    // 修复前优化课程2 时误用课程1 的教材口径（以为班1 无新教材），
    // 把班1 挪给 T1 后其教材数达 3 本，超出上限。
    getClassesWithCourse.mockImplementation(async (courseId) => {
      const map = {
        1: [{ classId: 1, textbooks: [{ id: 10 }] }],
        2: [{ classId: 1, textbooks: [{ id: 20 }] }],
        3: [{ classId: 30, textbooks: [{ id: 30 }] }],
      };
      return map[Number(courseId)] || [];
    });

    const fixture = [
      mockAssignment(1, 1, 1, 2), // 课1 班1 → T1（教材10）
      mockAssignment(30, 1, 3, 2), // 课3 班30 → T1（教材30）
      mockAssignment(1, 2, 2, 2), // 课2 班1 → T2（教材20）
    ];
    prisma.teaching_assignments.findMany.mockImplementation(({ where } = {}) =>
      where?.OR ? [] : fixture
    );
    prisma.teachers.findMany.mockResolvedValue([
      mockTeacher(1, { courses: [{ course_id: 1 }, { course_id: 2 }, { course_id: 3 }] }),
      mockTeacher(2, { courses: [{ course_id: 1 }, { course_id: 2 }, { course_id: 3 }] }),
    ]);

    const result = await runOptimizeSchedule('2025-2026-1', 'standard');

    const finalByClassCourse = new Map(
      fixture.map((a) => [`${a.class_id}:${a.course_id}`, a.teacher_id])
    );
    for (const c of result.changes) {
      finalByClassCourse.set(`${c.classId}:${c.courseId}`, c.toTeacher.id);
    }
    const tbs = new Set();
    for (const [key, tid] of finalByClassCourse) {
      if (tid !== 1) continue;
      const [classId, courseId] = key.split(':').map(Number);
      const cls = (await getClassesWithCourse(courseId)).find((c) => c.classId === classId);
      for (const tb of cls?.textbooks || []) tbs.add(tb.id);
    }
    expect(tbs.size, `教师1教材数${tbs.size}超过硬上限2本`).toBeLessThanOrEqual(2);
  });
});
