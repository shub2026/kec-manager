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
const { querySemester, invalidateQueryFilterCache } = await import('../query.controller.js');
const { getSemesterInfoFromRequest } = await import('../../services/settings.service.js');
const { getActiveClassFilter } = await import('../../services/class.service.js');
const { buildClassWithPlanFilter, findBestMatchPlan } = await import(
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
    it('page=2, page_size=10 → skip=10, take=10', async () => {
      const req = mockReq({ semester: '2025-2026-2', page: '2', page_size: '10' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      // 第二次 findMany 是分页查询
      const paginatedCall = mockPrisma.classes.findMany.mock.calls[1][0];
      expect(paginatedCall.skip).toBe(10);
      expect(paginatedCall.take).toBe(10);
    });

    it('page_size 超过 100 应被限制为 100', async () => {
      const req = mockReq({ semester: '2025-2026-2', page_size: '999' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const paginatedCall = mockPrisma.classes.findMany.mock.calls[1][0];
      expect(paginatedCall.take).toBeLessThanOrEqual(100);
    });

    it('默认 page=1, page_size=50', async () => {
      const req = mockReq({ semester: '2025-2026-2' });
      const res = mockRes();
      await querySemester(req, res, vi.fn());

      const paginatedCall = mockPrisma.classes.findMany.mock.calls[1][0];
      expect(paginatedCall.skip).toBe(0);
      expect(paginatedCall.take).toBe(50);
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
        // 全量取数：按预筛结果的 id in 条件裁剪返回顺序与主查询一致（入学年份降序）
        const idCond = Array.isArray(args.where?.AND)
          ? args.where.AND.find((c) => c?.id?.in)
          : null;
        const ids = idCond?.id?.in || [];
        return Promise.resolve(
          CANDIDATES.filter((c) => ids.includes(c.id)).map((c) => ({
            ...c,
            name: `班级${c.id}`,
            student_count: 30,
            majors: null,
            colleges: null,
            training_levels: null,
            training_plans: null,
          }))
        );
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
  // 8. 命名转换回归（模拟前端发 camelCase 被中间件转换后的效果）
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

      const paginatedCall = mockPrisma.classes.findMany.mock.calls[1][0];
      expect(paginatedCall.take).toBe(25);
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
