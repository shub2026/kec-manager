/**
 * batchAutoArrange 单元测试
 *
 * 策略：直接 mock batch.js 依赖的所有外部模块
 * 由于 batchAutoArrange 内部直接调用 prisma，需要通过 vi.mock 拦截
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ──────────────────────────────────────────────
// Mock ALL dependencies using inline factories
// ──────────────────────────────────────────────

// Use vi.hoisted to get references we can use in tests
const {
  coursesFindMany,
  teacherCoursesGroupBy,
  teacherCoursesFindMany,
  planCourseSemestersGroupBy,
  planCoursesFindMany,
  teachersFindMany,
  teachingAssignmentsGroupBy,
  systemSettingsFindMany,
  systemSettingsFindUnique,
  autoArrangeFn,
  batchLocksSet,
  validateFn,
} = vi.hoisted(() => ({
  coursesFindMany: vi.fn().mockResolvedValue([]),
  teacherCoursesGroupBy: vi.fn().mockResolvedValue([]),
  teacherCoursesFindMany: vi.fn().mockResolvedValue([]),
  planCourseSemestersGroupBy: vi.fn().mockResolvedValue([]),
  planCoursesFindMany: vi.fn().mockResolvedValue([]),
  teachersFindMany: vi.fn().mockResolvedValue([]),
  teachingAssignmentsGroupBy: vi.fn().mockResolvedValue([]),
  systemSettingsFindMany: vi.fn().mockResolvedValue([]),
  systemSettingsFindUnique: vi.fn().mockResolvedValue(null),
  autoArrangeFn: vi.fn(),
  batchLocksSet: new Set(),
  validateFn: vi.fn(),
}));

vi.mock('../../../constants/index.js', () => ({
  DEFAULT_HOUR_SETTINGS: {
    full_time: { standard: 16, max: 20 },
    part_time: { standard: 12, max: 16 },
    external: { standard: 12, max: 16 },
  },
  // P0-2: batch.js 现在导入 BATCH_CONFIG，需在 mock 中补充
  BATCH_CONFIG: { RESERVE_RATIO: 0.85 },
  // 批量修复：batch.js 按课程解析课时配置需要存储键前缀
  HOUR_SETTINGS_PREFIX: 'teaching_hour_settings',
  // 固有班级延续：默认关闭，测试主流程行为与功能引入前一致
  INHERENT_CLASS: { ENABLED: false, CONTINUITY_WEIGHT: 8 },
}));

vi.mock('../../../utils/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../lib/prisma.js', () => {
  const prismaObj = {
    courses: { findMany: coursesFindMany },
    teacher_courses: { groupBy: teacherCoursesGroupBy, findMany: teacherCoursesFindMany },
    plan_course_semesters: { groupBy: planCourseSemestersGroupBy },
    plan_courses: { findMany: planCoursesFindMany },
    teachers: { findMany: teachersFindMany },
    teaching_assignments: { groupBy: teachingAssignmentsGroupBy },
    system_settings: {
      findMany: systemSettingsFindMany,
      findUnique: systemSettingsFindUnique,
    },
  };
  return { prisma: prismaObj };
});

vi.mock('../auto-arrange.js', () => ({
  autoArrange: autoArrangeFn,
  batchLocks: batchLocksSet,
}));

vi.mock('../validate.js', () => ({
  validateHourSettings: validateFn,
}));

// B-01 修复：mock 数据库锁模块
vi.mock('../lock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

// 固有班级延续：直接使用真实 semester.service（其依赖的 prisma/logger 已被 mock）

const { batchAutoArrange } = await import('../batch.js');

// ──────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────
const VALID_HOUR_SETTINGS = {
  full_time: { standard: 16, max: 20 },
  part_time: { standard: 12, max: 16 },
  external: { standard: 12, max: 16 },
};

function setupCourses(courses) {
  coursesFindMany.mockResolvedValue(courses);
}
function setupTeacherCounts(counts) {
  teacherCoursesGroupBy.mockResolvedValue(
    counts.map(([cid, cnt]) => ({ course_id: cid, _count: { teacher_id: cnt } }))
  );
}
// P0-2 深化：教师-课程关系（用于预留豁免计算）
function setupTeacherCourses(rows) {
  teacherCoursesFindMany.mockResolvedValue(
    rows.map(([tid, cid]) => ({ teacher_id: tid, course_id: cid }))
  );
}
function setupDemands(demands) {
  planCourseSemestersGroupBy.mockResolvedValue(
    demands.map(([pcId, hrs]) => ({ plan_course_id: pcId, _sum: { weekly_hours: hrs } }))
  );
}
function setupPlanMapping(mappings) {
  planCoursesFindMany.mockResolvedValue(mappings.map(([id, cid]) => ({ id, course_id: cid })));
}
function makeResult(overrides = {}) {
  return {
    assigned: [],
    autoCount: 0,
    unassignedCount: 0,
    warnings: [],
    classTextbookMap: null,
    ...overrides,
  };
}
// 批量修复：课程级课时配置（key = teaching_hour_settings_<courseId>）
function setupCourseHourSettings(entries) {
  systemSettingsFindMany.mockResolvedValue(
    entries.map(([courseId, value]) => ({
      key: `teaching_hour_settings_${courseId}`,
      value: JSON.stringify(value),
    }))
  );
}
function setupGlobalHourSettings(value) {
  systemSettingsFindUnique.mockResolvedValue(
    value ? { key: 'teaching_hour_settings', value: JSON.stringify(value) } : null
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  batchLocksSet.clear();
  validateFn.mockImplementation(() => {});
  coursesFindMany.mockResolvedValue([]);
  teacherCoursesGroupBy.mockResolvedValue([]);
  teacherCoursesFindMany.mockResolvedValue([]);
  planCourseSemestersGroupBy.mockResolvedValue([]);
  planCoursesFindMany.mockResolvedValue([]);
  teachersFindMany.mockResolvedValue([]);
  teachingAssignmentsGroupBy.mockResolvedValue([]);
  systemSettingsFindMany.mockResolvedValue([]);
  systemSettingsFindUnique.mockResolvedValue(null);
});

// ══════════════════════════════════════════════
describe('batchAutoArrange', () => {
  describe('前置校验', () => {
    it('应调用 validateHourSettings', async () => {
      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(validateFn).toHaveBeenCalledWith(VALID_HOUR_SETTINGS);
    });

    it('validateHourSettings 抛异常时应阻止后续', async () => {
      validateFn.mockImplementation(() => {
        throw new Error('课时设置无效');
      });
      await expect(
        batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {})
      ).rejects.toThrow('课时设置无效');
      expect(autoArrangeFn).not.toHaveBeenCalled();
    });
  });

  describe('停用课程过滤口径', () => {
    it('课程清单筛选应排除已停用的 plan_courses', async () => {
      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      // 仅存于停用 plan_course 的课时不应让课程进入批量排课清单
      expect(coursesFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            plan_courses: {
              some: expect.objectContaining({ is_active: true }),
            },
          },
        })
      );
    });

    it('需求测算 groupBy 应排除已停用的 plan_courses', async () => {
      setupCourses([{ id: 1, name: 'C1', code: 'C01' }]);
      autoArrangeFn.mockResolvedValue(makeResult());

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});

      expect(planCourseSemestersGroupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            plan_courses: expect.objectContaining({ is_active: true }),
          }),
        })
      );
    });
  });

  describe('并发锁', () => {
    it('同学期第二次调用应被拒绝', async () => {
      let resolveFirst;
      autoArrangeFn.mockReturnValue(
        new Promise((r) => {
          resolveFirst = () => r(makeResult());
        })
      );
      setupCourses([{ id: 1, name: 'C1', code: 'C01' }]);
      setupTeacherCounts([[1, 2]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 8]]);

      const first = batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      await vi.waitFor(() => expect(batchLocksSet.has('2025-2026-1')).toBe(true));

      await expect(
        batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {})
      ).rejects.toThrow(/正在进行中/);

      resolveFirst();
      await first;
    });

    it('不同学期互不干扰', async () => {
      autoArrangeFn.mockResolvedValue(makeResult());
      setupCourses([{ id: 1, name: 'C1', code: 'C01' }]);
      setupTeacherCounts([[1, 2]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 8]]);

      const r1 = await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      const r2 = await batchAutoArrange('2024-2025-2', 'standard', VALID_HOUR_SETTINGS, {});
      expect(r1.semester).toBe('2025-2026-1');
      expect(r2.semester).toBe('2024-2025-2');
    });

    it('完成后释放锁', async () => {
      autoArrangeFn.mockResolvedValue(makeResult());
      setupCourses([{ id: 1, name: 'C1', code: 'C01' }]);
      setupTeacherCounts([[1, 2]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 8]]);

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(batchLocksSet.has('2025-2026-1')).toBe(false);
      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
    });

    it('异常时也释放锁', async () => {
      coursesFindMany.mockRejectedValue(new Error('DB'));
      try {
        await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      } catch {}
      expect(batchLocksSet.has('2025-2026-1')).toBe(false);
    });
  });

  describe('空课程列表', () => {
    it('返回空结果', async () => {
      const r = await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(r.courseResults).toHaveLength(0);
      expect(r.summary.totalCourses).toBe(0);
      expect(autoArrangeFn).not.toHaveBeenCalled();
    });
  });

  describe('优先级排序', () => {
    it('供给紧张的课程优先（供需比高）', async () => {
      // 课程1有4个教师（供给充足），课程2只有1个教师（供给紧张），需求相同 → 课程2优先
      setupCourses([
        { id: 1, name: '多教师', code: 'A' },
        { id: 2, name: '少教师', code: 'B' },
      ]);
      setupTeacherCounts([
        [1, 4],
        [2, 1],
      ]);
      setupPlanMapping([
        [10, 1],
        [20, 2],
      ]);
      setupDemands([
        [10, 10],
        [20, 10],
      ]);
      setupTeacherCourses([
        [101, 1],
        [102, 1],
        [103, 1],
        [104, 1],
        [201, 2],
      ]);
      teachersFindMany.mockResolvedValue([
        { id: 101, personnel_type: 'full_time', default_weekly_hours: null },
        { id: 102, personnel_type: 'full_time', default_weekly_hours: null },
        { id: 103, personnel_type: 'full_time', default_weekly_hours: null },
        { id: 104, personnel_type: 'full_time', default_weekly_hours: null },
        { id: 201, personnel_type: 'full_time', default_weekly_hours: null },
      ]);
      autoArrangeFn.mockResolvedValue(makeResult());

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      // 课程1供给=4*16=64，优先级=10/64=0.156
      // 课程2供给=1*16=16，优先级=10/16=0.625 → 课程2先处理
      expect(autoArrangeFn.mock.calls[0][0]).toBe(2);
      expect(autoArrangeFn.mock.calls[1][0]).toBe(1);
    });

    it('无教师的课程最优先（正需求+零供给 → MAX_SAFE_INTEGER）', async () => {
      // 课程1有3个教师，课程2有0个教师，需求相同 → 课程2（正需求零供给）最优先
      setupCourses([
        { id: 1, name: '有教师', code: 'A' },
        { id: 2, name: '无教师', code: 'B' },
      ]);
      setupTeacherCounts([
        [1, 3],
        [2, 0],
      ]);
      setupPlanMapping([
        [10, 1],
        [20, 2],
      ]);
      setupDemands([
        [10, 10],
        [20, 10],
      ]);
      setupTeacherCourses([
        [101, 1],
        [102, 1],
        [103, 1],
      ]);
      teachersFindMany.mockResolvedValue([
        { id: 101, personnel_type: 'full_time', default_weekly_hours: null },
        { id: 102, personnel_type: 'full_time', default_weekly_hours: null },
        { id: 103, personnel_type: 'full_time', default_weekly_hours: null },
      ]);
      autoArrangeFn.mockResolvedValue(makeResult());

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      // 课程2：正需求+零供给 → MAX_SAFE_INTEGER → 最优先
      expect(autoArrangeFn.mock.calls[0][0]).toBe(2);
    });

    it('无需求的课程优先级为 0', async () => {
      // 课程1有0个教师但无需求，课程2有1个教师也无需求
      setupCourses([
        { id: 1, name: '无需求无教师', code: 'A' },
        { id: 2, name: '无需求有教师', code: 'B' },
      ]);
      setupTeacherCounts([
        [1, 0],
        [2, 1],
      ]);
      setupPlanMapping([
        [10, 1],
        [20, 2],
      ]);
      setupDemands([]);
      setupTeacherCourses([[201, 2]]);
      teachersFindMany.mockResolvedValue([
        { id: 201, personnel_type: 'full_time', default_weekly_hours: null },
      ]);
      autoArrangeFn.mockResolvedValue(makeResult());

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      // 两课程需求均为 0 → 优先级均为 0 → 按原始顺序处理
      expect(autoArrangeFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('正常执行', () => {
    it('正确汇总结果', async () => {
      setupCourses([
        { id: 1, name: 'C1', code: 'A' },
        { id: 2, name: 'C2', code: 'B' },
      ]);
      setupTeacherCounts([
        [1, 2],
        [2, 2],
      ]);
      setupPlanMapping([
        [10, 1],
        [20, 2],
      ]);
      setupDemands([
        [10, 8],
        [20, 8],
      ]);
      autoArrangeFn
        .mockResolvedValueOnce(makeResult({ autoCount: 5, unassignedCount: 1, warnings: ['W1'] }))
        .mockResolvedValueOnce(makeResult({ autoCount: 3, unassignedCount: 2 }))
        // F8：非预览补漏轮先跑 preview 评估，再跑真实重排（每门课各多一次调用）
        .mockResolvedValueOnce(makeResult({ autoCount: 5, unassignedCount: 1, warnings: ['W1'] })) // 课程1 preview
        .mockResolvedValueOnce(makeResult({ autoCount: 5, unassignedCount: 1, warnings: ['W1'] })) // 课程1 重排
        .mockResolvedValueOnce(makeResult({ autoCount: 3, unassignedCount: 2 })) // 课程2 preview
        .mockResolvedValueOnce(makeResult({ autoCount: 3, unassignedCount: 2 })); // 课程2 重排

      const r = await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(r.summary.totalCourses).toBe(2);
      expect(r.summary.successCount).toBe(2);
      expect(r.summary.totalAssigned).toBe(8);
      expect(r.summary.totalUnassigned).toBe(3);
      expect(r.summary.totalWarnings).toBe(1);
      expect(r.summary.timeoutReached).toBe(false);
    });

    it('传递 skipBatchLockCheck=true', async () => {
      setupCourses([{ id: 1, name: 'C1', code: 'A' }]);
      setupTeacherCounts([[1, 2]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 8]]);
      autoArrangeFn.mockResolvedValue(makeResult());

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(autoArrangeFn.mock.calls[0][5].skipBatchLockCheck).toBe(true);
    });

    it('传递 capacityReserveRatio=0.85（P0-2 容量预留）', async () => {
      setupCourses([{ id: 1, name: 'C1', code: 'A' }]);
      setupTeacherCounts([[1, 2]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 8]]);
      autoArrangeFn.mockResolvedValue(makeResult());

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(autoArrangeFn.mock.calls[0][5].capacityReserveRatio).toBe(0.85);
    });

    it('传递 mode 和 conditions', async () => {
      setupCourses([{ id: 1, name: 'C1', code: 'A' }]);
      setupTeacherCounts([[1, 2]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 8]]);
      autoArrangeFn.mockResolvedValue(makeResult());

      const cond = { avoidDays: [1] };
      await batchAutoArrange('2025-2026-1', 'full', VALID_HOUR_SETTINGS, cond);
      expect(autoArrangeFn.mock.calls[0][2]).toBe('full');
      expect(autoArrangeFn.mock.calls[0][4]).toBe(cond);
    });
  });

  describe('单课程失败不影响后续', () => {
    it('记录错误并继续', async () => {
      setupCourses([
        { id: 1, name: 'C1', code: 'A' },
        { id: 2, name: 'C2', code: 'B' },
      ]);
      setupTeacherCounts([
        [1, 2],
        [2, 2],
      ]);
      setupPlanMapping([
        [10, 1],
        [20, 2],
      ]);
      setupDemands([
        [10, 8],
        [20, 8],
      ]);
      autoArrangeFn
        .mockRejectedValueOnce(new Error('崩溃'))
        .mockResolvedValueOnce(makeResult({ autoCount: 4 }));

      const r = await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(r.summary.errorCount).toBe(1);
      expect(r.summary.successCount).toBe(1);
      const err = r.courseResults.find((x) => x.error);
      expect(err.error).toBe('崩溃');
    });
  });

  describe('预览模式', () => {
    it('preview=true 标记', async () => {
      setupCourses([{ id: 1, name: 'C1', code: 'A' }]);
      setupTeacherCounts([[1, 2]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 8]]);
      autoArrangeFn.mockResolvedValue(makeResult());

      const r = await batchAutoArrange(
        '2025-2026-1',
        'standard',
        VALID_HOUR_SETTINGS,
        {},
        { preview: true }
      );
      expect(r.preview).toBe(true);
    });

    it('跨课程累计 virtualTeacherHours', async () => {
      setupCourses([
        { id: 1, name: 'C1', code: 'A' },
        { id: 2, name: 'C2', code: 'B' },
      ]);
      setupTeacherCounts([
        [1, 2],
        [2, 2],
      ]);
      setupPlanMapping([
        [10, 1],
        [20, 2],
      ]);
      setupDemands([
        [10, 8],
        [20, 8],
      ]);

      // Capture the extraTeacherHours state during the second call
      let capturedHours;
      autoArrangeFn
        .mockImplementationOnce(async () =>
          makeResult({
            assigned: [{ teacher_id: 'T1', weekly_hours: 4, class_id: 100 }],
            autoCount: 1,
          })
        )
        .mockImplementationOnce(async (courseId, sem, mode, hs, cond, opts) => {
          capturedHours = opts.extraTeacherHours?.get('T1');
          return makeResult({
            assigned: [{ teacher_id: 'T1', weekly_hours: 6, class_id: 200 }],
            autoCount: 1,
          });
        });

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {}, { preview: true });
      // 第二次调用时 T1 应已累计课程1的 4 小时
      expect(capturedHours).toBe(4);
    });

    it('累计 globalTextbookMap', async () => {
      setupCourses([{ id: 1, name: 'C1', code: 'A' }]);
      setupTeacherCounts([[1, 2]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 8]]);
      const tbMap = new Map();
      tbMap.set(100, ['TB1']);
      autoArrangeFn.mockResolvedValue(
        makeResult({
          assigned: [{ teacher_id: 'T1', weekly_hours: 4, class_id: 100 }],
          autoCount: 1,
          classTextbookMap: tbMap,
        })
      );

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {}, { preview: true });
      expect(autoArrangeFn.mock.calls[0][5].globalTextbookMap).toBeDefined();
    });

    it('非预览模式 extraTeacherHours=null', async () => {
      setupCourses([{ id: 1, name: 'C1', code: 'A' }]);
      setupTeacherCounts([[1, 2]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 8]]);
      autoArrangeFn.mockResolvedValue(makeResult());

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(autoArrangeFn.mock.calls[0][5].extraTeacherHours).toBeNull();
    });
  });

  describe('超时保护', () => {
    it('超时后停止处理', async () => {
      setupCourses([
        { id: 1, name: 'C1', code: 'A' },
        { id: 2, name: 'C2', code: 'B' },
        { id: 3, name: 'C3', code: 'C' },
      ]);
      setupTeacherCounts([
        [1, 2],
        [2, 2],
        [3, 2],
      ]);
      setupPlanMapping([
        [10, 1],
        [20, 2],
        [30, 3],
      ]);
      setupDemands([
        [10, 8],
        [20, 8],
        [30, 8],
      ]);

      let cnt = 0;
      const t0 = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => {
        cnt++;
        return cnt <= 2 ? t0 : t0 + 6 * 60 * 1000;
      });
      autoArrangeFn.mockResolvedValue(makeResult({ autoCount: 1 }));

      const r = await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(r.summary.timeoutReached).toBe(true);
      expect(r.courseResults.length).toBeLessThan(3);
      Date.now.mockRestore();
    });
  });

  describe('返回结构', () => {
    it('包含完整 summary', async () => {
      setupCourses([{ id: 1, name: 'C1', code: 'A' }]);
      setupTeacherCounts([[1, 2]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 8]]);
      autoArrangeFn.mockResolvedValue(makeResult({ autoCount: 3 }));

      const r = await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(r.semester).toBe('2025-2026-1');
      expect(r.mode).toBe('standard');
      expect(r.summary).toHaveProperty('totalCourses');
      expect(r.summary).toHaveProperty('successCount');
      expect(r.summary).toHaveProperty('errorCount');
      expect(r.summary).toHaveProperty('totalAssigned');
      expect(r.summary).toHaveProperty('totalUnassigned');
      expect(r.summary).toHaveProperty('totalWarnings');
      expect(r.summary).toHaveProperty('timeoutReached');
    });

    it('无跳过时 skippedCourses=undefined', async () => {
      setupCourses([{ id: 1, name: 'C1', code: 'A' }]);
      setupTeacherCounts([[1, 2]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 8]]);
      autoArrangeFn.mockResolvedValue(makeResult());

      const r = await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(r.summary.skippedCourses).toBeUndefined();
    });
  });

  describe('P0-2 深化：预留豁免（reserveExemptTeacherIds）', () => {
    it('不出现在后续课程的教师应被豁免，共享教师不豁免', async () => {
      // 课程1优先（供需比高）：T101 只教课程1，T102 同时教课程1和课程2
      setupCourses([
        { id: 1, name: 'C1', code: 'A' },
        { id: 2, name: 'C2', code: 'B' },
      ]);
      setupTeacherCounts([
        [1, 1],
        [2, 5],
      ]);
      setupPlanMapping([
        [10, 1],
        [20, 2],
      ]);
      setupDemands([
        [10, 20],
        [20, 8],
      ]);
      setupTeacherCourses([
        [101, 1],
        [102, 1],
        [102, 2],
      ]);
      autoArrangeFn.mockResolvedValue(makeResult());

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      // 课程1先处理：T101 无后续课程→豁免；T102 还要教课程2→不豁免
      const exempt1 = autoArrangeFn.mock.calls[0][5].reserveExemptTeacherIds;
      expect(autoArrangeFn.mock.calls[0][0]).toBe(1);
      expect(exempt1.has(101)).toBe(true);
      expect(exempt1.has(102)).toBe(false);
      // 课程2是最后一门：全部教师豁免
      const exempt2 = autoArrangeFn.mock.calls[1][5].reserveExemptTeacherIds;
      expect(autoArrangeFn.mock.calls[1][0]).toBe(2);
      expect(exempt2.has(102)).toBe(true);
    });

    it('后续课程无课时需求时不算"后续"，共享教师也豁免', async () => {
      setupCourses([
        { id: 1, name: 'C1', code: 'A' },
        { id: 2, name: 'C2无需求', code: 'B' },
      ]);
      setupTeacherCounts([
        [1, 1],
        [2, 5],
      ]);
      setupPlanMapping([
        [10, 1],
        [20, 2],
      ]);
      setupDemands([[10, 20]]); // 课程2 无课时需求
      setupTeacherCourses([
        [102, 1],
        [102, 2],
      ]);
      autoArrangeFn.mockResolvedValue(makeResult());

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      const call1 = autoArrangeFn.mock.calls.find((c) => c[0] === 1);
      // 课程2虽在后续但无需求，T102 的容量不会被它用到 → 豁免
      expect(call1[5].reserveExemptTeacherIds.has(102)).toBe(true);
    });
  });

  describe('P0-2 深化：补漏轮（回收预留容量）', () => {
    it('有未分配班级的课程应用 capacityReserveRatio=1.0 重排并采纳更优结果', async () => {
      setupCourses([{ id: 1, name: 'C1', code: 'A' }]);
      setupTeacherCounts([[1, 1]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 16]]);
      setupTeacherCourses([[101, 1]]);
      autoArrangeFn
        .mockResolvedValueOnce(makeResult({ autoCount: 1, unassignedCount: 2 })) // 主轮
        .mockResolvedValueOnce(makeResult({ autoCount: 3, unassignedCount: 0 })) // F8 preview 评估
        .mockResolvedValueOnce(makeResult({ autoCount: 3, unassignedCount: 0 })); // 补漏轮

      const r = await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(autoArrangeFn).toHaveBeenCalledTimes(3);
      expect(autoArrangeFn.mock.calls[0][5].capacityReserveRatio).toBe(0.85);
      expect(autoArrangeFn.mock.calls[1][5].capacityReserveRatio).toBe(1.0);
      expect(autoArrangeFn.mock.calls[1][5].preview).toBe(true); // F8 preview 评估
      expect(autoArrangeFn.mock.calls[2][5].capacityReserveRatio).toBe(1.0);
      expect(r.summary.totalAssigned).toBe(3);
      expect(r.summary.totalUnassigned).toBe(0);
      expect(r.courseResults[0].autoCount).toBe(3);
    });

    it('全部分配完成时不触发补漏轮', async () => {
      setupCourses([{ id: 1, name: 'C1', code: 'A' }]);
      setupTeacherCounts([[1, 1]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 8]]);
      autoArrangeFn.mockResolvedValue(makeResult({ autoCount: 2, unassignedCount: 0 }));

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(autoArrangeFn).toHaveBeenCalledTimes(1);
    });

    it('补漏轮失败时保留主轮结果', async () => {
      setupCourses([{ id: 1, name: 'C1', code: 'A' }]);
      setupTeacherCounts([[1, 1]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 16]]);
      autoArrangeFn
        .mockResolvedValueOnce(makeResult({ autoCount: 1, unassignedCount: 2 }))
        .mockRejectedValueOnce(new Error('补漏崩溃'));

      const r = await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(r.summary.totalAssigned).toBe(1);
      expect(r.summary.totalUnassigned).toBe(2);
      expect(r.courseResults[0].autoCount).toBe(1);
      expect(r.summary.errorCount).toBe(0); // 主轮成功，补漏失败不计错
    });

    it('预览模式补漏重排时不重复计入自身主轮课时', async () => {
      setupCourses([{ id: 1, name: 'C1', code: 'A' }]);
      setupTeacherCounts([[1, 1]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 16]]);
      let refillExtraHours;
      autoArrangeFn
        .mockResolvedValueOnce(
          makeResult({
            assigned: [{ teacher_id: 'T1', weekly_hours: 4, class_id: 100 }],
            autoCount: 1,
            unassignedCount: 2,
          })
        )
        .mockImplementationOnce(async (courseId, sem, mode, hs, cond, opts) => {
          refillExtraHours = opts.extraTeacherHours?.get('T1');
          return makeResult({ autoCount: 3, unassignedCount: 0 });
        });

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {}, { preview: true });
      // 重排前应先扣除本课程主轮的 4 小时，否则自身占用会压缩重排容量
      expect(refillExtraHours).toBeUndefined();
    });
  });

  // ══════════════════════════════════════
  describe('批量修复：按课程解析课时配置', () => {
    const COURSE_SETTINGS = {
      full_time: { standard: 16, max: 20 },
      part_time: { standard: 8, max: 10 },
      external: { standard: 12, max: 16 },
    };

    function setupSingleCourse() {
      setupCourses([{ id: 1, name: 'C1', code: 'A' }]);
      setupTeacherCounts([[1, 1]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 8]]);
      autoArrangeFn.mockResolvedValue(makeResult());
    }

    it('DB 存在课程级配置时应优先于请求传入值（兼职超限根因回归）', async () => {
      setupSingleCourse();
      setupCourseHourSettings([[1, COURSE_SETTINGS]]);

      // 请求传入前端默认值（兼职 12/16），课程已保存 8/10 → 应用 8/10
      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(autoArrangeFn.mock.calls[0][3]).toEqual(COURSE_SETTINGS);
    });

    it('课程无独立配置时回退请求传入值', async () => {
      setupSingleCourse();
      setupCourseHourSettings([]);

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(autoArrangeFn.mock.calls[0][3]).toBe(VALID_HOUR_SETTINGS);
    });

    it('请求未传且无课程配置时回退全局 DB 配置', async () => {
      setupSingleCourse();
      setupGlobalHourSettings(COURSE_SETTINGS);
      validateFn.mockImplementation(() => {});

      await batchAutoArrange('2025-2026-1', 'standard', null, {});
      expect(autoArrangeFn.mock.calls[0][3]).toEqual(COURSE_SETTINGS);
    });

    it('课程级配置损坏时回退请求传入值并警告', async () => {
      setupSingleCourse();
      systemSettingsFindMany.mockResolvedValue([
        { key: 'teaching_hour_settings_1', value: '{非法JSON' },
      ]);

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(autoArrangeFn.mock.calls[0][3]).toBe(VALID_HOUR_SETTINGS);
    });

    it('多课程各自应用自己的配置', async () => {
      setupCourses([
        { id: 1, name: 'C1', code: 'A' },
        { id: 2, name: 'C2', code: 'B' },
      ]);
      setupTeacherCounts([
        [1, 1],
        [2, 1],
      ]);
      setupPlanMapping([
        [10, 1],
        [20, 2],
      ]);
      setupDemands([
        [10, 8],
        [20, 8],
      ]);
      autoArrangeFn.mockResolvedValue(makeResult());
      const course2Settings = { ...COURSE_SETTINGS, external: { standard: 20, max: 24 } };
      setupCourseHourSettings([
        [1, COURSE_SETTINGS],
        [2, course2Settings],
      ]);

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      const call1 = autoArrangeFn.mock.calls.find((c) => c[0] === 1);
      const call2 = autoArrangeFn.mock.calls.find((c) => c[0] === 2);
      expect(call1[3]).toEqual(COURSE_SETTINGS);
      expect(call2[3]).toEqual(course2Settings);
    });

    it('补漏轮（F8 preview 评估 + 重排）同样使用课程级配置', async () => {
      setupCourses([{ id: 1, name: 'C1', code: 'A' }]);
      setupTeacherCounts([[1, 1]]);
      setupPlanMapping([[10, 1]]);
      setupDemands([[10, 16]]);
      setupTeacherCourses([[101, 1]]);
      setupCourseHourSettings([[1, COURSE_SETTINGS]]);
      autoArrangeFn
        .mockResolvedValueOnce(makeResult({ autoCount: 1, unassignedCount: 2 })) // 主轮
        .mockResolvedValueOnce(makeResult({ autoCount: 3, unassignedCount: 0 })) // F8 preview
        .mockResolvedValueOnce(makeResult({ autoCount: 3, unassignedCount: 0 })); // 补漏重排

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(autoArrangeFn).toHaveBeenCalledTimes(3);
      for (const call of autoArrangeFn.mock.calls) {
        expect(call[3]).toEqual(COURSE_SETTINGS);
      }
    });

    it('供需估算采用教师所授课程配置的最小 standard（保守口径）', async () => {
      // 课程2配置兼职 standard=8，课程1无配置（回退请求值 12）；
      // 教师101 只教课程2 → 供给按 8 估算；教师201 只教课程1 → 供给按 12 估算。
      // 旧逻辑统一用请求值 12：两课程供给相等（12/12）→ 同分按原顺序课程1先；
      // 新逻辑：课程2供需比 10/8=1.25 > 课程1 10/12≈0.83 → 课程2先，可区分新旧口径
      setupCourses([
        { id: 1, name: 'C1', code: 'A' },
        { id: 2, name: 'C2', code: 'B' },
      ]);
      setupTeacherCounts([
        [1, 1],
        [2, 1],
      ]);
      setupPlanMapping([
        [10, 1],
        [20, 2],
      ]);
      setupDemands([
        [10, 10],
        [20, 10],
      ]);
      setupTeacherCourses([
        [101, 2],
        [201, 1],
      ]);
      teachersFindMany.mockResolvedValue([
        { id: 101, personnel_type: 'part_time', default_weekly_hours: null },
        { id: 201, personnel_type: 'part_time', default_weekly_hours: null },
      ]);
      setupCourseHourSettings([[2, COURSE_SETTINGS]]);
      autoArrangeFn.mockResolvedValue(makeResult());

      await batchAutoArrange('2025-2026-1', 'standard', VALID_HOUR_SETTINGS, {});
      expect(autoArrangeFn.mock.calls[0][0]).toBe(2);
    });
  });
});
