/**
 * query.controller 单元测试
 *
 * 重点覆盖 querySemester 的筛选器逻辑：
 * - 命名中间件已将 req.query 转为 snake_case 后，控制器能否正确读取
 * - college_id / major_id / training_level_id / enrollment_year / grade 各筛选器
 * - 组合筛选、分页参数
 * - 年级到入学年份的内部转换
 * - 错误处理（无效学期、未设学期）
 *
 * Mock 策略：mock prisma 和依赖服务，直接调用控制器函数验证行为。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  classes: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  plan_courses: {
    findMany: vi.fn(),
  },
  training_plans: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  system_settings: {
    findUnique: vi.fn(),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖服务
// ──────────────────────────────────────────────
vi.mock('../../services/settings.service.js', () => ({
  getCurrentSemesterInfo: vi.fn(),
  getSemesterInfoFromRequest: vi.fn(),
}));

vi.mock('../../services/class.service.js', () => ({
  getActiveClassFilter: vi.fn(),
}));

vi.mock('../../services/semester.service.js', () => ({
  calcClassSemester: vi.fn(),
  buildConsecutiveTextbookMap: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../../services/plan.service.js', () => ({
  findBestMatchPlan: vi.fn(),
  buildClassWithPlanFilter: vi.fn(),
  isClassMatchPlan: vi.fn(),
  // 默认全部方案视为本学期有开课；个别用例可覆写以验证无课班级排除
  planHasOfferedCourses: vi.fn().mockReturnValue(true),
  // 与真实实现同构的常量（归档排除条件）
  NOT_ARCHIVED_PLAN_WHERE: { status: { not: 'archived' } },
}));

vi.mock('../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入被测模块（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const { querySemester, queryCoursePlans, invalidateQueryFilterCache } = await import('../query.controller.js');
const { getSemesterInfoFromRequest } = await import('../../services/settings.service.js');
const { getActiveClassFilter } = await import('../../services/class.service.js');
const { buildClassWithPlanFilter, findBestMatchPlan, planHasOfferedCourses } = await import(
  '../../services/plan.service.js'
);
const { calcClassSemester } = await import('../../services/semester.service.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(query = {}) {
  return { query, user: { id: 1 }, ip: '127.0.0.1' };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

const SEMESTER_INFO = {
  startYear: 2025,
  endYear: 2026,
  semesterIndex: 2,
  label: '2026年春季(第2学期)',
  raw: '2025-2026-2',
};

const ACTIVE_FILTER = {
  OR: [{ duration_years: 3, is_left_school: false, enrollment_year: { gte: 2023, lte: 2025 } }],
};

const PLAN_FILTER = {
  OR: [{ custom_plan_id: { not: null } }, { major_id: { in: [1] } }],
};

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('querySemester — 筛选器单元测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateQueryFilterCache(); // 优化2：清除筛选器选项缓存，确保每次测试独立

    // 默认：学期正常
    getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);
    getActiveClassFilter.mockResolvedValue(ACTIVE_FILTER);
    buildClassWithPlanFilter.mockResolvedValue(PLAN_FILTER);

    // 默认：空数据
    mockPrisma.classes.count.mockResolvedValue(0);
    mockPrisma.classes.findMany.mockResolvedValue([]);
    mockPrisma.training_plans.findMany.mockResolvedValue([]);
    mockPrisma.training_plans.findUnique.mockResolvedValue(null);
  });

  // ──────────────────────────────────────────────
  // 1. 各筛选器参数是否正确传入 WHERE 条件
  // ──────────────────────────────────────────────
  describe('筛选器参数传递', () => {
    it('college_id 应出现在 extraConditions 中', async () => {
      const req = mockReq({ semester: '2025-2026-2', college_id: '35' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const where = mockPrisma.classes.findMany.mock.calls[1][0].where;
      expect(where.AND[1]).toHaveProperty('college_id', 35);
    });

    it('major_id 应出现在 extraConditions 中', async () => {
      const req = mockReq({ semester: '2025-2026-2', major_id: '146' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const where = mockPrisma.classes.findMany.mock.calls[1][0].where;
      expect(where.AND[1]).toHaveProperty('major_id', 146);
    });

    it('training_level_id 应出现在 extraConditions 中', async () => {
      const req = mockReq({ semester: '2025-2026-2', training_level_id: '10' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const where = mockPrisma.classes.findMany.mock.calls[1][0].where;
      expect(where.AND[1]).toHaveProperty('training_level_id', 10);
    });

    it('enrollment_year 应出现在 extraConditions 中', async () => {
      const req = mockReq({ semester: '2025-2026-2', enrollment_year: '2024' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const where = mockPrisma.classes.findMany.mock.calls[1][0].where;
      expect(where.AND[1]).toHaveProperty('enrollment_year', 2024);
    });
  });

  // ──────────────────────────────────────────────
  // 2. 组合筛选
  // ──────────────────────────────────────────────
  describe('组合筛选', () => {
    it('college_id + major_id 应同时出现', async () => {
      const req = mockReq({
        semester: '2025-2026-2',
        college_id: '35',
        major_id: '146',
      });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const extra = mockPrisma.classes.findMany.mock.calls[1][0].where.AND[1];
      expect(extra).toHaveProperty('college_id', 35);
      expect(extra).toHaveProperty('major_id', 146);
    });

    it('college_id + training_level_id + enrollment_year 应同时出现', async () => {
      const req = mockReq({
        semester: '2025-2026-2',
        college_id: '35',
        training_level_id: '10',
        enrollment_year: '2024',
      });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const extra = mockPrisma.classes.findMany.mock.calls[1][0].where.AND[1];
      expect(extra).toHaveProperty('college_id', 35);
      expect(extra).toHaveProperty('training_level_id', 10);
      expect(extra).toHaveProperty('enrollment_year', 2024);
    });

    it('所有筛选器同时传应全部生效', async () => {
      const req = mockReq({
        semester: '2025-2026-2',
        college_id: '35',
        major_id: '146',
        training_level_id: '10',
        enrollment_year: '2024',
      });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const extra = mockPrisma.classes.findMany.mock.calls[1][0].where.AND[1];
      expect(Object.keys(extra)).toHaveLength(4);
      expect(extra.college_id).toBe(35);
      expect(extra.major_id).toBe(146);
      expect(extra.training_level_id).toBe(10);
      expect(extra.enrollment_year).toBe(2024);
    });
  });

  // ──────────────────────────────────────────────
  // 3. 无筛选条件
  // ──────────────────────────────────────────────
  describe('无筛选条件', () => {
    it('不传任何筛选参数时 classWhere 应只有 baseWhere', async () => {
      const req = mockReq({ semester: '2025-2026-2' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const where = mockPrisma.classes.findMany.mock.calls[1][0].where;
      // baseWhere = { AND: [activeFilter, planFilter] }
      expect(where.AND).toHaveLength(2);
      // 没有 extraConditions 就不会有 AND[2]
    });
  });

  // ──────────────────────────────────────────────
  // 4. 年级筛选内部转换
  // ──────────────────────────────────────────────
  describe('年级筛选', () => {
    it('grade=1 → enrollment_year=2025 (startYear)', async () => {
      const req = mockReq({ semester: '2025-2026-2', grade: '1' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const extra = mockPrisma.classes.findMany.mock.calls[1][0].where.AND[1];
      expect(extra).toHaveProperty('enrollment_year', 2025);
    });

    it('grade=2 → enrollment_year=2024 (startYear-1)', async () => {
      const req = mockReq({ semester: '2025-2026-2', grade: '2' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const extra = mockPrisma.classes.findMany.mock.calls[1][0].where.AND[1];
      expect(extra).toHaveProperty('enrollment_year', 2024);
    });

    it('grade=3 → enrollment_year=2023 (startYear-2)', async () => {
      const req = mockReq({ semester: '2025-2026-2', grade: '3' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const extra = mockPrisma.classes.findMany.mock.calls[1][0].where.AND[1];
      expect(extra).toHaveProperty('enrollment_year', 2023);
    });

    it('同时传入 grade 和 enrollment_year 应返回400（互斥校验）', async () => {
      const req = mockReq({
        semester: '2025-2026-2',
        enrollment_year: '2024',
        grade: '1',
      });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: '年级和入学年份不能同时筛选' })
      );
    });
  });

  // ──────────────────────────────────────────────
  // 5. 分页参数
  // ──────────────────────────────────────────────
  describe('分页参数', () => {
    // 新流程为 JS 侧 valid 集合切片 + id in 取数（无 DB skip/take），
    // 分页参数正确性改由响应字段 page/pageSize 验证。
    it('page=2, page_size=10 → 响应 page=2, pageSize=10', async () => {
      const req = mockReq({ semester: '2025-2026-2', page: '2', page_size: '10' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const json = res.json.mock.calls[0][0];
      expect(json.data.page).toBe(2);
      expect(json.data.pageSize).toBe(10);
    });

    it('page_size 超过 100 应被限制为 100', async () => {
      const req = mockReq({ semester: '2025-2026-2', page_size: '999' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const json = res.json.mock.calls[0][0];
      expect(json.data.pageSize).toBeLessThanOrEqual(100);
    });

    it('默认 page=1, page_size=50', async () => {
      const req = mockReq({ semester: '2025-2026-2' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const json = res.json.mock.calls[0][0];
      expect(json.data.page).toBe(1);
      expect(json.data.pageSize).toBe(50);
    });
  });

  // ──────────────────────────────────────────────
  // 6. 错误处理
  // ──────────────────────────────────────────────
  describe('错误处理', () => {
    it('无效学期格式应返回失败响应', async () => {
      // getSemesterInfoFromRequest 在传入无效格式时返回 null
      getSemesterInfoFromRequest.mockResolvedValue(null);

      const req = mockReq({ semester: 'invalid-format' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining('学期格式错误'),
        })
      );
    });

    it('未设学期且未传 semester 参数应返回失败响应', async () => {
      getSemesterInfoFromRequest.mockResolvedValue(null);

      const req = mockReq({});
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining('请先设置当前学期'),
        })
      );
    });
  });

  // ──────────────────────────────────────────────
  // 7. 按培养方案筛选（training_plan_id）
  // ──────────────────────────────────────────────
  describe('按培养方案筛选', () => {
    // 预筛轻量查询返回的候选班级：专业1 → 方案7，专业2 → 方案8
    const CANDIDATES = [
      {
        id: 11,
        major_id: 1,
        training_level_id: null,
        custom_plan_id: null,
        enrollment_year: 2025,
        duration_years: 3,
      },
      {
        id: 12,
        major_id: 2,
        training_level_id: null,
        custom_plan_id: null,
        enrollment_year: 2024,
        duration_years: 3,
      },
      {
        id: 13,
        major_id: 1,
        training_level_id: null,
        custom_plan_id: null,
        enrollment_year: 2024,
        duration_years: 3,
      },
    ];

    beforeEach(() => {
      // 目标方案默认存在；在读校验全部通过；最佳方案由专业决定
      mockPrisma.training_plans.findUnique.mockResolvedValue({ id: 7 });
      calcClassSemester.mockReturnValue({ grade: 1, currentSemesterNum: 2 });
      findBestMatchPlan.mockImplementation((cls) => {
        if (cls.major_id === 1) return { id: 7, name: '方案A', plan_courses: [] };
        if (cls.major_id === 2) return { id: 8, name: '方案B', plan_courses: [] };
        return null;
      });

      mockPrisma.classes.findMany.mockImplementation((args) => {
        // 带 select 的是预筛/筛选选项轻量查询，直接返回候选数据
        if (args.select) return Promise.resolve(CANDIDATES);
        // 全量取数：按 where.id.in 条件裁剪返回顺序与主查询一致（入学年份降序）
        // 新流程（重构后）：当页取数 where 形如 { id: { in: pageIds } }，不再有 AND 包装
        const idIn = args.where?.id?.in;
        if (Array.isArray(idIn)) {
          return Promise.resolve(
            CANDIDATES.filter((c) => idIn.includes(c.id)).map((c) => ({
              ...c,
              name: `班级${c.id}`,
              student_count: 30,
              majors: null,
              colleges: null,
              training_levels: null,
              training_plans: null,
            }))
          );
        }
        // 其他无 select 调用：返回空（兜底）
        return Promise.resolve([]);
      });
      mockPrisma.training_plans.findMany.mockResolvedValue([
        { id: 7, major_id: 1, plan_courses: [] },
        { id: 8, major_id: 2, plan_courses: [] },
      ]);
    });

    it('目标方案不存在应返回 404', async () => {
      mockPrisma.training_plans.findUnique.mockResolvedValue(null);
      const req = mockReq({ semester: '2025-2026-2', training_plan_id: '999' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: '培养方案不存在' })
      );
    });

    it('只保留最佳匹配方案为目标方案的班级，总数与数据口径一致', async () => {
      const req = mockReq({ semester: '2025-2026-2', training_plan_id: '7' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const json = res.json.mock.calls[0][0];
      expect(json.success).toBe(true);
      // 班级12 的最佳方案为方案8，应被排除；总数与明细一致（均为2）
      expect(json.data.total).toBe(2);
      expect(json.data.totalClasses).toBe(2);
      expect(json.data.data.map((r) => r.classId)).toEqual([11, 13]);
      expect(json.data.data.every((r) => r.planName === '方案A')).toBe(true);
    });

    it('预筛后分页：page=2 & page_size=1 只返回第二个匹配班级', async () => {
      const req = mockReq({
        semester: '2025-2026-2',
        training_plan_id: '7',
        page: '2',
        page_size: '1',
      });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const json = res.json.mock.calls[0][0];
      expect(json.data.total).toBe(2);
      // 按入学年份降序：[11(2025), 13(2024)]，第二页为班级13
      expect(json.data.data.map((r) => r.classId)).toEqual([13]);
    });

    it('无匹配班级时返回空列表且不执行全量取数', async () => {
      findBestMatchPlan.mockReturnValue(null);
      const req = mockReq({ semester: '2025-2026-2', training_plan_id: '7' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const json = res.json.mock.calls[0][0];
      expect(json.data.total).toBe(0);
      expect(json.data.data).toEqual([]);
      // classes.findMany 仅两次（预筛轻量查询 + 筛选选项查询），无带 include 的全量取数
      const includeCalls = mockPrisma.classes.findMany.mock.calls.filter((c) => c[0].include);
      expect(includeCalls).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────
  // 9. 无课班级不展示（planHasOfferedCourses 谓词生效）
  // ──────────────────────────────────────────────
  describe('无课班级不展示', () => {
    // 候选班级：11/13 有课方案（major_id=1 → 方案7），12 走方案9（本学期无开课）
    const CANDIDATES = [
      { id: 11, major_id: 1, training_level_id: null, custom_plan_id: null, enrollment_year: 2025, duration_years: 3, college_id: 1 },
      { id: 12, major_id: 2, training_level_id: null, custom_plan_id: 9, enrollment_year: 2024, duration_years: 3, college_id: 1 },
      { id: 13, major_id: 1, training_level_id: null, custom_plan_id: null, enrollment_year: 2024, duration_years: 3, college_id: 1 },
    ];

    beforeEach(() => {
      calcClassSemester.mockReturnValue({ grade: 1, currentSemesterNum: 2 });
      // 11/13 → 方案7（有课），12 → 方案9（无课，被谓词排除）
      findBestMatchPlan.mockImplementation((cls) => {
        if (cls.major_id === 1) return { id: 7, name: '方案A', plan_courses: [{ courses: { id: 1, name: '语文', type: 'public' }, start_semester: 1, end_semester: 4, weekly_hours: 4, plan_course_semesters: [{ semester: 2, weekly_hours: 4 }] }] };
        if (cls.major_id === 2) return { id: 9, name: '方案B', plan_courses: [{ courses: { id: 2, name: '数学', type: 'public' }, start_semester: 1, end_semester: 4, weekly_hours: 0, plan_course_semesters: [{ semester: 2, weekly_hours: 0 }] }] };
        return null;
      });
      // 谓词走真实实现语义：plan_courses 中是否有覆盖当前学期且 weekly_hours>0 的课
      planHasOfferedCourses.mockImplementation((plan, currentSemesterNum) =>
        (plan.plan_courses || []).some((pc) => {
          if (pc.start_semester > currentSemesterNum || pc.end_semester < currentSemesterNum) return false;
          const semRecord = (pc.plan_course_semesters || []).find((s) => s.semester === currentSemesterNum);
          return (semRecord?.weekly_hours ?? pc.weekly_hours) > 0;
        })
      );

      mockPrisma.classes.findMany.mockImplementation((args) => {
        if (args.select) return Promise.resolve(CANDIDATES);
        const idIn = args.where?.id?.in;
        if (Array.isArray(idIn)) {
          return Promise.resolve(
            CANDIDATES.filter((c) => idIn.includes(c.id)).map((c) => ({
              ...c,
              name: `班级${c.id}`,
              student_count: 30,
              majors: null,
              colleges: null,
              training_levels: null,
              training_plans: null,
            }))
          );
        }
        return Promise.resolve([]);
      });
      mockPrisma.training_plans.findMany.mockResolvedValue([
        { id: 7, major_id: 1, plan_courses: [] },
        { id: 9, major_id: 2, plan_courses: [] },
      ]);
    });

    it('本学期无开课的班级不展示且 total 与明细口径一致', async () => {
      const req = mockReq({ semester: '2025-2026-2' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const json = res.json.mock.calls[0][0];
      expect(json.success).toBe(true);
      // 12 班方案本学期无开课 → 被排除；11/13 保留
      expect(json.data.total).toBe(2);
      expect(json.data.totalClasses).toBe(2);
      expect(json.data.data.map((r) => r.classId).sort((a, b) => a - b)).toEqual([11, 13]);
    });
  });

  // ──────────────────────────────────────────────
  // 10. 命名转换回归（模拟前端发 camelCase 被中间件转换后的效果）
  // ──────────────────────────────────────────────
  describe('命名转换回归测试', () => {
    it('前端发 collegeId=35 经中间件转换后，req.query 中是 college_id=35', async () => {
      // 模拟命名中间件转换后的 req.query（camelCase → snake_case）
      const req = mockReq({ semester: '2025-2026-2', college_id: '35' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      // 控制器应能正确读取 college_id（snake_case）
      const where = mockPrisma.classes.findMany.mock.calls[1][0].where;
      expect(where.AND[1]).toHaveProperty('college_id', 35);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('前端发 pageSize=25 经中间件转换后，req.query 中是 page_size=25', async () => {
      const req = mockReq({ semester: '2025-2026-2', page_size: '25' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const json = res.json.mock.calls[0][0];
      expect(json.data.pageSize).toBe(25);
    });

    it('前端发 trainingLevelId=10 经中间件转换后，控制器正确读取', async () => {
      const req = mockReq({ semester: '2025-2026-2', training_level_id: '10' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const extra = mockPrisma.classes.findMany.mock.calls[1][0].where.AND[1];
      expect(extra).toHaveProperty('training_level_id', 10);
    });
  });
});

// ════════════════════════════════════════════════
// queryCoursePlans — 课程查询单元测试
// ════════════════════════════════════════════════
describe('queryCoursePlans — 课程查询单元测试', () => {
  // 构造一行 plan_courses 数据（含课程/方案/学期明细）
  function makeRow(overrides = {}) {
    return {
      id: 1,
      plan_id: 1,
      course_id: 1,
      start_semester: 1,
      end_semester: 2,
      weekly_hours: 4,
      weeks_per_semester: 18,
      is_active: true,
      courses: { id: 1, name: '语文', code: 'C001', type: 'public' },
      training_plans: {
        id: 1,
        name: '方案A',
        version: 'V1.0',
        status: 'active',
        majors: { id: 1, name: '专业1' },
        colleges: { id: 1, name: '学院1' },
        training_levels: { id: 1, name: '中专' },
      },
      plan_course_semesters: [
        { semester: 1, weekly_hours: 4, weeks_count: 18 },
        { semester: 2, weekly_hours: 2, weeks_count: 18 },
      ],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.plan_courses.findMany.mockResolvedValue([]);
  });

  it('无筛选时应查询非归档方案的全部 plan_courses（默认排除归档）', async () => {
    const req = mockReq({});
    const res = mockRes();
    await queryCoursePlans(req, res, vi.fn());

    expect(mockPrisma.plan_courses.findMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.plan_courses.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ training_plans: { status: { not: 'archived' } } });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ totalCourses: 0, totalPlans: 0 }),
      })
    );
  });

  it('显式传 plan_status=archived 时可单独查询归档方案', async () => {
    const res = mockRes();
    await queryCoursePlans(mockReq({ plan_status: 'archived' }), res, vi.fn());

    const where = mockPrisma.plan_courses.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ training_plans: { status: 'archived' } });
  });

  it('同一课程在多个方案中应聚合为一个课程条目，课时按学期汇总', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([
      makeRow({
        id: 1,
        course_id: 1,
        plan_id: 1,
        training_plans: { id: 1, name: '方案A', version: 'V1.0', status: 'active', majors: null, colleges: null, training_levels: null },
      }),
      makeRow({
        id: 2,
        course_id: 1,
        plan_id: 2,
        training_plans: { id: 2, name: '方案B', version: null, status: 'active', majors: null, colleges: null, training_levels: null },
        plan_course_semesters: [{ semester: 3, weekly_hours: 3, weeks_count: 16 }],
      }),
    ]);

    const res = mockRes();
    await queryCoursePlans(mockReq({}), res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.totalCourses).toBe(1);
    expect(data.totalPlans).toBe(2);
    expect(data.courses[0].course.name).toBe('语文');
    expect(data.courses[0].planCount).toBe(2);
    expect(data.courses[0].plans).toHaveLength(2);
    // 方案A: 4*18 + 2*18 = 108；方案B: 3*16 = 48；总计 156
    expect(data.courses[0].plans[0].totalHours).toBe(108);
    expect(data.courses[0].plans[1].totalHours).toBe(48);
    expect(data.courses[0].totalHours).toBe(156);
  });

  it('course_name 模糊匹配应过滤课程', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([
      makeRow({ courses: { id: 1, name: '大学英语', code: 'C001', type: 'public' } }),
      makeRow({ id: 2, course_id: 2, courses: { id: 2, name: '高等数学', code: 'C002', type: 'public' } }),
    ]);

    const res = mockRes();
    await queryCoursePlans(mockReq({ course_name: '英语' }), res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.totalCourses).toBe(1);
    expect(data.courses[0].course.name).toBe('大学英语');
  });

  it('course_type 筛选应过滤课程', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([
      makeRow(),
      makeRow({ id: 2, course_id: 2, courses: { id: 2, name: '护理学', code: 'C002', type: 'professional' } }),
    ]);

    const res = mockRes();
    await queryCoursePlans(mockReq({ course_type: 'professional' }), res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.totalCourses).toBe(1);
    expect(data.courses[0].course.type).toBe('professional');
  });

  it('方案维度筛选应生成嵌套 training_plans where 条件', async () => {
    const res = mockRes();
    await queryCoursePlans(
      mockReq({ college_id: '35', major_id: '146', plan_status: 'active' }),
      res,
      vi.fn()
    );

    const where = mockPrisma.plan_courses.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      training_plans: { college_id: 35, major_id: 146, status: 'active' },
    });
  });

  it('禁用课程（is_active=false）应保留且排序靠后，缺省字段视为启用', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([
      // 缺省 is_active 字段（undefined 视为启用）
      makeRow({ id: 1, is_active: undefined, plan_id: 1, training_plans: { id: 1, name: '方案A', version: null, status: 'active', majors: null, colleges: null, training_levels: null } }),
      makeRow({ id: 2, plan_id: 2, is_active: false, training_plans: { id: 2, name: '方案B', version: null, status: 'active', majors: null, colleges: null, training_levels: null } }),
    ]);

    const res = mockRes();
    await queryCoursePlans(mockReq({}), res, vi.fn());

    const entry = res.json.mock.calls[0][0].data.courses[0];
    expect(entry.planCount).toBe(2);
    expect(entry.activePlanCount).toBe(1);
    // 启用方案排前，禁用排后
    expect(entry.plans[0].planName).toBe('方案A');
    expect(entry.plans[0].isActive).toBe(true);
    expect(entry.plans[1].planName).toBe('方案B');
    expect(entry.plans[1].isActive).toBe(false);
    // 课程总课时只统计启用方案
    expect(entry.totalHours).toBe(108);
  });

  it('方案排序：active > draft > archived', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([
      makeRow({ id: 1, plan_id: 1, training_plans: { id: 1, name: '归档方案', version: null, status: 'archived', majors: null, colleges: null, training_levels: null } }),
      makeRow({ id: 2, plan_id: 2, training_plans: { id: 2, name: '草稿方案', version: null, status: 'draft', majors: null, colleges: null, training_levels: null } }),
      makeRow({ id: 3, plan_id: 3, training_plans: { id: 3, name: '生效方案', version: null, status: 'active', majors: null, colleges: null, training_levels: null } }),
    ]);

    const res = mockRes();
    await queryCoursePlans(mockReq({}), res, vi.fn());

    const plans = res.json.mock.calls[0][0].data.courses[0].plans;
    expect(plans.map((p) => p.planStatus)).toEqual(['active', 'draft', 'archived']);
  });

  it('数据库异常时应调用 next 传递错误', async () => {
    mockPrisma.plan_courses.findMany.mockRejectedValue(new Error('db error'));
    const next = vi.fn();
    const res = mockRes();

    await queryCoursePlans(mockReq({}), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.json).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════
// queryCoursePlans — 教材明细（悬停展示）
// ════════════════════════════════════════════════
describe('queryCoursePlans — 教材明细', () => {
  // 与上一 describe 的 makeRow 同构（makeRow 定义在其闭包内，此处无法复用）
  function makeTextbookRow(overrides = {}) {
    return {
      id: 1,
      plan_id: 1,
      course_id: 1,
      start_semester: 1,
      end_semester: 2,
      weekly_hours: 4,
      weeks_per_semester: 18,
      is_active: true,
      courses: { id: 1, name: '语文', code: 'C001', type: 'public' },
      training_plans: {
        id: 1,
        name: '方案A',
        version: 'V1.0',
        status: 'active',
        majors: { id: 1, name: '专业1' },
        colleges: { id: 1, name: '学院1' },
        training_levels: { id: 1, name: '中专' },
      },
      plan_course_semesters: [
        { semester: 1, weekly_hours: 4, weeks_count: 18 },
        { semester: 2, weekly_hours: 2, weeks_count: 18 },
      ],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.plan_courses.findMany.mockResolvedValue([]);
  });

  it('学期教材应映射为 textbooks 数组（含必订/停用状态）', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([
      makeTextbookRow({
        plan_course_semesters: [
          {
            semester: 1,
            weekly_hours: 4,
            weeks_count: 18,
            plan_textbooks: [
              {
                is_required: true,
                textbooks: { id: 11, title: '语文基础', isbn: '978-1', publisher: '人教社', is_active: true },
              },
              {
                is_required: false,
                textbooks: { id: 12, title: '语文阅读（已停用）', isbn: null, publisher: null, is_active: false },
              },
            ],
          },
          { semester: 2, weekly_hours: 2, weeks_count: 18, plan_textbooks: [] },
        ],
      }),
    ]);

    const res = mockRes();
    await queryCoursePlans(mockReq({}), res, vi.fn());

    const plan = res.json.mock.calls[0][0].data.courses[0].plans[0];
    expect(plan.semesters).toHaveLength(2);
    expect(plan.semesters[0].textbooks).toHaveLength(2);
    expect(plan.semesters[0].textbooks[0]).toMatchObject({
      id: 11,
      title: '语文基础',
      isbn: '978-1',
      publisher: '人教社',
      isActive: true,
      isRequired: true,
    });
    expect(plan.semesters[0].textbooks[1]).toMatchObject({
      id: 12,
      isActive: false,
      isRequired: false,
    });
    // 无教材学期为空数组
    expect(plan.semesters[1].textbooks).toEqual([]);
  });

  it('plan_textbooks 字段缺省（旧 mock 数据）不应报错', async () => {
    mockPrisma.plan_courses.findMany.mockResolvedValue([
      makeTextbookRow({
        plan_course_semesters: [
          { semester: 1, weekly_hours: 4, weeks_count: 18 }, // 无 plan_textbooks 字段
        ],
      }),
    ]);

    const res = mockRes();
    await queryCoursePlans(mockReq({}), res, vi.fn());

    const plan = res.json.mock.calls[0][0].data.courses[0].plans[0];
    expect(plan.semesters[0].textbooks).toEqual([]);
  });
});

// ════════════════════════════════════════════════
// querySemester — 归档方案处理（classPlanMap 构建口径）
// ════════════════════════════════════════════════
describe('querySemester — 归档方案处理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateQueryFilterCache();
    getSemesterInfoFromRequest.mockResolvedValue(SEMESTER_INFO);
    getActiveClassFilter.mockResolvedValue(ACTIVE_FILTER);
    buildClassWithPlanFilter.mockResolvedValue(PLAN_FILTER);
    mockPrisma.training_plans.findMany.mockResolvedValue([]);
    mockPrisma.training_plans.findUnique.mockResolvedValue(null);
  });

  it('班级自定义关联归档方案 → 不进入 classPlanMap，落入 unmatchedClasses', async () => {
    // 班级钉住归档方案（training_plans.status='archived'）；
    // 新流程：归档方案在 matchingPlans 的 Prisma where 阶段就被过滤（NOT_ARCHIVED_PLAN_WHERE），
    // 因此 classPlanMap 不会包含该班级，最终落入 unmatchedClasses。
    mockPrisma.classes.findMany.mockImplementation((args) => {
      if (args.select) {
        // candidates 阶段（轻量 select）：返回该自定义方案班级
        return Promise.resolve([
          {
            id: 21,
            name: '班级21',
            major_id: null,
            training_level_id: null,
            custom_plan_id: 9,
            enrollment_year: 2024,
            duration_years: 3,
            college_id: null,
          },
        ]);
      }
      // 当页全量取数（含 training_plans 关联）
      return Promise.resolve([
        {
          id: 21,
          name: '班级21',
          major_id: null,
          training_level_id: null,
          custom_plan_id: 9,
          enrollment_year: 2024,
          duration_years: 3,
          student_count: 30,
          majors: null,
          colleges: null,
          training_levels: null,
          training_plans: { id: 9, status: 'archived', plan_courses: [] },
        },
      ]);
    });
    calcClassSemester.mockReturnValue({ grade: 2, currentSemesterNum: 3 });
    // 归档方案不在候选 → findBestMatchPlan 无解
    findBestMatchPlan.mockReturnValue(null);

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await querySemester(req, res, vi.fn());

    // findBestMatchPlan 收到的 classPlanMap 不含该班级（归档拦截生效）
    const mapCall = findBestMatchPlan.mock.calls.find((c) => c[2] instanceof Map);
    expect(mapCall).toBeTruthy();
    expect(mapCall[2].has(21)).toBe(false);

    // 班级落入 unmatchedClasses，提示自定义方案已失效
    const json = res.json.mock.calls[0][0];
    expect(json.data.unmatchedClasses).toHaveLength(1);
    expect(json.data.unmatchedClasses[0]).toMatchObject({ classId: 21, custom_plan_id: 9 });
  });

  it('班级自定义关联非归档方案 → 正常进入 classPlanMap', async () => {
    // 让 matchingPlans 实际包含该非归档自定义方案（模拟 Prisma DB 层真实加载）
    const activePlan = { id: 9, status: 'active', plan_courses: [] };
    mockPrisma.training_plans.findMany.mockResolvedValue([activePlan]);
    mockPrisma.classes.findMany.mockImplementation((args) => {
      if (args.select) {
        return Promise.resolve([
          {
            id: 22,
            name: '班级22',
            major_id: null,
            training_level_id: null,
            custom_plan_id: 9,
            enrollment_year: 2024,
            duration_years: 3,
            college_id: null,
          },
        ]);
      }
      return Promise.resolve([
        {
          id: 22,
          name: '班级22',
          major_id: null,
          training_level_id: null,
          custom_plan_id: 9,
          enrollment_year: 2024,
          duration_years: 3,
          student_count: 30,
          majors: null,
          colleges: null,
          training_levels: null,
          training_plans: { id: 9, status: 'active', plan_courses: [] },
        },
      ]);
    });
    calcClassSemester.mockReturnValue({ grade: 2, currentSemesterNum: 3 });
    findBestMatchPlan.mockReturnValue({ id: 9, name: '现行方案', plan_courses: [] });

    const req = mockReq({ semester: '2025-2026-2' });
    const res = mockRes();
    await querySemester(req, res, vi.fn());

    // classPlanMap 命中该班级，指向非归档方案
    const mapCall = findBestMatchPlan.mock.calls.find((c) => c[2] instanceof Map);
    expect(mapCall).toBeTruthy();
    expect(mapCall[2].get(22)).toMatchObject({ id: 9, status: 'active' });

    // 班级正常进入结果（不在 unmatchedClasses）
    const json = res.json.mock.calls[0][0];
    expect(json.data.unmatchedClasses).toHaveLength(0);
  });
});
