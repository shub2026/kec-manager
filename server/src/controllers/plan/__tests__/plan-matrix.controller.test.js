/**
 * plan-matrix.controller.js 单元测试
 *
 * 重点覆盖：
 * - addCourseToPlan：start<=end 校验、必填字段校验、学期记录批量创建
 * - updatePlanCourse：范围变更 + 课时变更时 weekly_hours 同步逻辑（保留区间内教材关联）
 * - upsertSemester：学期范围校验
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma（$transaction 直接执行回调并注入 mockTx）
// 注意：变量名以 mock 开头，vitest 允许在 vi.mock 工厂中引用
// ──────────────────────────────────────────────
const mockTx = {
  plan_courses: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  plan_course_semesters: { create: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
  plan_textbooks: { create: vi.fn(), deleteMany: vi.fn() },
};

const mockPrisma = {
  // 支持两种调用模式：回调函数（fn(mockTx)）和 promise 数组（Promise.all）
  $transaction: vi.fn((arg) => (typeof arg === 'function' ? arg(mockTx) : Promise.all(arg))),
  plan_courses: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  plan_course_semesters: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  textbooks: {
    findUnique: vi.fn(),
  },
};

vi.mock('../../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock audit.service
// ──────────────────────────────────────────────
const mockCreateAuditLog = vi.fn();
vi.mock('../../../services/audit.service.js', () => ({
  createAuditLog: mockCreateAuditLog,
}));

// 注意：utils/response.js 不 mock，使用真实实现
// success(res, data, message) -> res.json({ success: true, message, data })
// fail(res, message, status) -> res.status(status).json({ success: false, message })

// ──────────────────────────────────────────────
// 动态 import（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const {
  addCourseToPlan,
  updatePlanCourse,
  upsertSemester,
  listPlanSemesters,
  deletePlanCourse,
  assignTextbookToSemester,
  batchUpdateSemesterWeeks,
  batchUpdateCourseSortOrder,
} = await import('../plan-matrix.controller.js');

// ──────────────────────────────────────────────
// 工具函数：构造 mock req / res / next
// ──────────────────────────────────────────────
function mockReq(body = {}, params = {}, query = {}) {
  return { body, params, query, user: { id: 1 }, ip: '127.0.0.1' };
}

function mockRes() {
  const res = {};
  // fail 会调用 res.status(status).json(...)，故 status 需返回 res 以支持链式调用
  res.status = vi.fn(() => res);
  // success 直接调用 res.json(...)
  res.json = vi.fn();
  return res;
}

// ──────────────────────────────────────────────
// 测试
// ──────────────────────────────────────────────
describe('plan-matrix.controller', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // resetAllMocks 清掉了 $transaction 的实现，需重新建立（支持回调和数组两种模式）
    mockPrisma.$transaction.mockImplementation((arg) =>
      typeof arg === 'function' ? arg(mockTx) : Promise.all(arg)
    );
    // 默认返回值
    mockTx.plan_courses.create.mockResolvedValue({ id: 100, course_id: 1 });
    mockTx.plan_courses.update.mockResolvedValue({ id: 1 });
    mockTx.plan_course_semesters.create.mockResolvedValue({});
    mockTx.plan_course_semesters.deleteMany.mockResolvedValue({ count: 0 });
    mockTx.plan_course_semesters.updateMany.mockResolvedValue({ count: 0 });
    mockTx.plan_textbooks.create.mockResolvedValue({ id: 200 });
    mockTx.plan_textbooks.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.plan_courses.findUnique.mockResolvedValue(null);
    mockPrisma.plan_courses.findFirst.mockResolvedValue(null);
    mockPrisma.plan_courses.delete.mockResolvedValue({});
    mockPrisma.plan_courses.update.mockResolvedValue({});
    mockPrisma.plan_course_semesters.upsert.mockResolvedValue({});
    mockPrisma.plan_course_semesters.findMany.mockResolvedValue([]);
    mockPrisma.plan_course_semesters.update.mockResolvedValue({});
    mockPrisma.textbooks.findUnique.mockResolvedValue(null);
    mockCreateAuditLog.mockResolvedValue({});
  });

  // ════════════════════════════════════════════
  // addCourseToPlan
  // ════════════════════════════════════════════
  describe('addCourseToPlan', () => {
    it('正常流程：start=1, end=3 应创建 1 条 plan_courses 和 3 条学期记录', async () => {
      const req = mockReq(
        { course_id: 1, start_semester: 1, end_semester: 3, weekly_hours: 4 },
        { id: '1' }
      );
      const res = mockRes();
      const next = vi.fn();

      await addCourseToPlan(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: '添加成功' })
      );
      expect(mockTx.plan_courses.create).toHaveBeenCalledTimes(1);
      expect(mockTx.plan_course_semesters.create).toHaveBeenCalledTimes(3);
      // 三次 create 的 semester 分别为 1, 2, 3
      const semesters = mockTx.plan_course_semesters.create.mock.calls.map(
        (c) => c[0].data.semester
      );
      expect(semesters).toEqual([1, 2, 3]);
      expect(next).not.toHaveBeenCalled();
    });

    it('start > end 应返回 400 错误：开始学期不能大于结束学期', async () => {
      const req = mockReq(
        { course_id: 1, start_semester: 3, end_semester: 1, weekly_hours: 4 },
        { id: '1' }
      );
      const res = mockRes();
      const next = vi.fn();

      await addCourseToPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '开始学期不能大于结束学期',
      });
      expect(mockTx.plan_courses.create).not.toHaveBeenCalled();
      expect(mockTx.plan_course_semesters.create).not.toHaveBeenCalled();
    });

    it('缺 course_id 应返回必填项错误', async () => {
      const req = mockReq({ start_semester: 1, end_semester: 3, weekly_hours: 4 }, { id: '1' });
      const res = mockRes();
      const next = vi.fn();

      await addCourseToPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '课程、开课学期、周课时为必填项',
      });
    });

    it('缺 weekly_hours 应返回必填项错误', async () => {
      const req = mockReq({ course_id: 1, start_semester: 1, end_semester: 3 }, { id: '1' });
      const res = mockRes();
      const next = vi.fn();

      await addCourseToPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '课程、开课学期、周课时为必填项',
      });
    });

    it('start == end 应成功并只创建 1 条学期记录', async () => {
      const req = mockReq(
        { course_id: 1, start_semester: 2, end_semester: 2, weekly_hours: 4 },
        { id: '1' }
      );
      const res = mockRes();
      const next = vi.fn();

      await addCourseToPlan(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: '添加成功' })
      );
      expect(mockTx.plan_course_semesters.create).toHaveBeenCalledTimes(1);
      expect(mockTx.plan_course_semesters.create.mock.calls[0][0].data.semester).toBe(2);
    });
  });

  // ════════════════════════════════════════════
  // updatePlanCourse
  // ════════════════════════════════════════════
  describe('updatePlanCourse', () => {
    it('范围未变 + 课时变更：应调用 updateMany 同步区间内所有学期记录', async () => {
      mockPrisma.plan_courses.findUnique.mockResolvedValue({
        id: 1,
        start_semester: 1,
        end_semester: 3,
        weekly_hours: 4,
        weeks_per_semester: 18,
        sort_order: 1,
        plan_course_semesters: [],
      });

      const req = mockReq({ weekly_hours: 6 }, { id: '1' });
      const res = mockRes();
      const next = vi.fn();

      await updatePlanCourse(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: '更新成功' })
      );
      expect(mockTx.plan_course_semesters.updateMany).toHaveBeenCalledTimes(1);
      const call = mockTx.plan_course_semesters.updateMany.mock.calls[0][0];
      // 仅同步仍等于旧默认值 4 的记录 -> 新值 6
      expect(call.where.weekly_hours).toBe(4);
      expect(call.data.weekly_hours).toBe(6);
    });

    it('范围未变 + 课时未变：仅传 sort_order，updateMany 不应被调用', async () => {
      mockPrisma.plan_courses.findUnique.mockResolvedValue({
        id: 1,
        start_semester: 1,
        end_semester: 3,
        weekly_hours: 4,
        weeks_per_semester: 18,
        sort_order: 1,
        plan_course_semesters: [],
      });

      const req = mockReq({ sort_order: 2 }, { id: '1' });
      const res = mockRes();
      const next = vi.fn();

      await updatePlanCourse(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: '更新成功' })
      );
      expect(mockTx.plan_course_semesters.updateMany).not.toHaveBeenCalled();
    });

    it('范围扩大 + 课时变更：应新增 semester=3，并同步保留的 1,2 学期记录', async () => {
      mockPrisma.plan_courses.findUnique.mockResolvedValue({
        id: 1,
        start_semester: 1,
        end_semester: 2,
        weekly_hours: 4,
        weeks_per_semester: 18,
        sort_order: 1,
        plan_course_semesters: [{ semester: 1 }, { semester: 2 }],
      });

      const req = mockReq({ start_semester: 1, end_semester: 3, weekly_hours: 6 }, { id: '1' });
      const res = mockRes();
      const next = vi.fn();

      await updatePlanCourse(req, res, next);

      // 新增 semester=3（用新 weekly_hours 初始化）
      expect(mockTx.plan_course_semesters.create).toHaveBeenCalledTimes(1);
      expect(mockTx.plan_course_semesters.create.mock.calls[0][0].data.semester).toBe(3);
      expect(mockTx.plan_course_semesters.create.mock.calls[0][0].data.weekly_hours).toBe(6);
      // 同步保留的 1,2（旧值 4 → 新值 6）
      expect(mockTx.plan_course_semesters.updateMany).toHaveBeenCalledTimes(1);
      const upd = mockTx.plan_course_semesters.updateMany.mock.calls[0][0];
      expect(upd.where.semester.in).toEqual([1, 2]);
      expect(upd.where.weekly_hours).toBe(4);
      expect(upd.data.weekly_hours).toBe(6);
      // 范围扩大不删除任何记录
      expect(mockTx.plan_course_semesters.deleteMany).not.toHaveBeenCalled();
    });

    it('范围缩小：应删除超出的 semester=3，并同步保留的 1,2 学期记录', async () => {
      mockPrisma.plan_courses.findUnique.mockResolvedValue({
        id: 1,
        start_semester: 1,
        end_semester: 3,
        weekly_hours: 4,
        weeks_per_semester: 18,
        sort_order: 1,
        plan_course_semesters: [{ semester: 1 }, { semester: 2 }, { semester: 3 }],
      });

      const req = mockReq({ end_semester: 2, weekly_hours: 6 }, { id: '1' });
      const res = mockRes();
      const next = vi.fn();

      await updatePlanCourse(req, res, next);

      // 删除 semester=3
      expect(mockTx.plan_course_semesters.deleteMany).toHaveBeenCalledTimes(1);
      const del = mockTx.plan_course_semesters.deleteMany.mock.calls[0][0];
      expect(del.where.semester.in).toEqual([3]);
      // 同步保留的 1,2（旧值 4 → 新值 6）
      expect(mockTx.plan_course_semesters.updateMany).toHaveBeenCalledTimes(1);
      const upd = mockTx.plan_course_semesters.updateMany.mock.calls[0][0];
      expect(upd.where.semester.in).toEqual([1, 2]);
      expect(upd.where.weekly_hours).toBe(4);
      expect(upd.data.weekly_hours).toBe(6);
      // 范围缩小不新增记录
      expect(mockTx.plan_course_semesters.create).not.toHaveBeenCalled();
    });

    it('方案课程不存在：findUnique 返回 null 应返回 404', async () => {
      mockPrisma.plan_courses.findUnique.mockResolvedValue(null);

      const req = mockReq({ weekly_hours: 6 }, { id: '999' });
      const res = mockRes();
      const next = vi.fn();

      await updatePlanCourse(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '方案课程不存在',
      });
      expect(mockTx.plan_courses.update).not.toHaveBeenCalled();
    });

    it('start > end 应返回 400 错误', async () => {
      mockPrisma.plan_courses.findUnique.mockResolvedValue({
        id: 1,
        start_semester: 1,
        end_semester: 3,
        weekly_hours: 4,
        weeks_per_semester: 18,
        sort_order: 1,
        plan_course_semesters: [],
      });

      const req = mockReq({ start_semester: 3, end_semester: 1 }, { id: '1' });
      const res = mockRes();
      const next = vi.fn();

      await updatePlanCourse(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '开始学期不能大于结束学期',
      });
      expect(mockTx.plan_courses.update).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════
  // upsertSemester
  // ════════════════════════════════════════════
  describe('upsertSemester', () => {
    it('学期在范围内：应调用 upsert 并成功', async () => {
      mockPrisma.plan_courses.findFirst.mockResolvedValue({
        id: 2,
        plan_id: 1,
        start_semester: 1,
        end_semester: 4,
        weeks_per_semester: 18,
      });
      mockPrisma.plan_course_semesters.upsert.mockResolvedValue({
        id: 50,
        plan_course_id: 2,
        semester: 2,
        weekly_hours: 4,
      });

      const req = mockReq({ semester: 2, weekly_hours: 4 }, { planId: '1', courseId: '2' });
      const res = mockRes();
      const next = vi.fn();

      await upsertSemester(req, res, next);

      expect(mockPrisma.plan_course_semesters.upsert).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: '创建成功' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('学期超出范围（上界）：semester=5 应返回 400', async () => {
      mockPrisma.plan_courses.findFirst.mockResolvedValue({
        id: 2,
        plan_id: 1,
        start_semester: 1,
        end_semester: 4,
        weeks_per_semester: 18,
      });

      const req = mockReq({ semester: 5, weekly_hours: 4 }, { planId: '1', courseId: '2' });
      const res = mockRes();
      const next = vi.fn();

      await upsertSemester(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '学期必须在 1~4 范围内',
      });
      expect(mockPrisma.plan_course_semesters.upsert).not.toHaveBeenCalled();
    });

    it('学期超出范围（下界）：semester=0 应返回 400', async () => {
      // 注意：0 是 falsy，会被必填校验（!semester）拦截，同样返回 400
      mockPrisma.plan_courses.findFirst.mockResolvedValue({
        id: 2,
        plan_id: 1,
        start_semester: 1,
        end_semester: 4,
        weeks_per_semester: 18,
      });

      const req = mockReq({ semester: 0, weekly_hours: 4 }, { planId: '1', courseId: '2' });
      const res = mockRes();
      const next = vi.fn();

      await upsertSemester(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(mockPrisma.plan_course_semesters.upsert).not.toHaveBeenCalled();
    });

    it('方案课程不存在：findFirst 返回 null 应返回 404', async () => {
      mockPrisma.plan_courses.findFirst.mockResolvedValue(null);

      const req = mockReq({ semester: 2, weekly_hours: 4 }, { planId: '1', courseId: '999' });
      const res = mockRes();
      const next = vi.fn();

      await upsertSemester(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '方案课程不存在',
      });
      expect(mockPrisma.plan_course_semesters.upsert).not.toHaveBeenCalled();
    });

    it('缺必填字段（无 semester）应返回必填项错误', async () => {
      const req = mockReq({ weekly_hours: 4 }, { planId: '1', courseId: '2' });
      const res = mockRes();
      const next = vi.fn();

      await upsertSemester(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '学期和周课时为必填项',
      });
      // 必填校验在 findFirst 之前，不应查库
      expect(mockPrisma.plan_courses.findFirst).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════
  // listPlanSemesters（H-5 修复：移除 distinct，JS 层聚合取最大 weeks_count）
  // ════════════════════════════════════════════
  describe('listPlanSemesters', () => {
    it('同一学期不同 weeks_count 应取最大值', async () => {
      mockPrisma.plan_course_semesters.findMany.mockResolvedValue([
        { semester: 1, weeks_count: 16 },
        { semester: 1, weeks_count: 18 },
        { semester: 2, weeks_count: 18 },
        { semester: 2, weeks_count: 14 },
      ]);

      const req = mockReq({}, { id: '1' });
      const res = mockRes();
      const next = vi.fn();

      await listPlanSemesters(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.arrayContaining([
            { semester: 1, weeks_count: 18 },
            { semester: 2, weeks_count: 18 },
          ]),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('无学期记录应返回空数组', async () => {
      mockPrisma.plan_course_semesters.findMany.mockResolvedValue([]);

      const req = mockReq({}, { id: '1' });
      const res = mockRes();
      const next = vi.fn();

      await listPlanSemesters(req, res, next);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: [] }));
    });

    it('单一学期单一 weeks_count 应原样返回', async () => {
      mockPrisma.plan_course_semesters.findMany.mockResolvedValue([
        { semester: 3, weeks_count: 20 },
      ]);

      const req = mockReq({}, { id: '1' });
      const res = mockRes();
      const next = vi.fn();

      await listPlanSemesters(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: [{ semester: 3, weeks_count: 20 }],
        })
      );
    });
  });

  // ════════════════════════════════════════════
  // deletePlanCourse
  // ════════════════════════════════════════════
  describe('deletePlanCourse', () => {
    it('正常删除应成功并记录审计日志', async () => {
      mockPrisma.plan_courses.delete.mockResolvedValue({ id: 5 });

      const req = mockReq({}, { id: '5' });
      const res = mockRes();
      const next = vi.fn();

      await deletePlanCourse(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: '删除成功' })
      );
      expect(mockPrisma.plan_courses.delete).toHaveBeenCalledWith({
        where: { id: 5 },
      });
      expect(mockCreateAuditLog).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
    });

    it('方案课程不存在（P2025）应返回 404', async () => {
      mockPrisma.plan_courses.delete.mockRejectedValue({ code: 'P2025' });

      const req = mockReq({}, { id: '999' });
      const res = mockRes();
      const next = vi.fn();

      await deletePlanCourse(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '方案课程不存在',
      });
    });
  });

  // ════════════════════════════════════════════
  // assignTextbookToSemester
  // ════════════════════════════════════════════
  describe('assignTextbookToSemester', () => {
    it('正常流程：应先删除旧关联再创建新关联', async () => {
      mockPrisma.textbooks.findUnique.mockResolvedValue({
        id: 10,
        title: '高等数学',
        is_active: true,
      });
      mockTx.plan_textbooks.create.mockResolvedValue({
        id: 50,
        semester_id: 5,
        textbook_id: 10,
        textbooks: { id: 10, title: '高等数学' },
      });

      const req = mockReq({ textbook_id: 10 }, { id: '5' });
      const res = mockRes();
      const next = vi.fn();

      await assignTextbookToSemester(req, res, next);

      // 替换语义：先 deleteMany 再 create
      expect(mockTx.plan_textbooks.deleteMany).toHaveBeenCalledWith({
        where: { semester_id: 5 },
      });
      expect(mockTx.plan_textbooks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            semester_id: 5,
            textbook_id: 10,
            is_required: true,
          }),
        })
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: '关联成功' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('缺 textbook_id 应返回 400', async () => {
      const req = mockReq({}, { id: '5' });
      const res = mockRes();
      const next = vi.fn();

      await assignTextbookToSemester(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '教材为必填项',
      });
      expect(mockPrisma.textbooks.findUnique).not.toHaveBeenCalled();
    });

    it('教材不存在应返回 400', async () => {
      mockPrisma.textbooks.findUnique.mockResolvedValue(null);

      const req = mockReq({ textbook_id: 999 }, { id: '5' });
      const res = mockRes();
      const next = vi.fn();

      await assignTextbookToSemester(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '教材不存在',
      });
    });

    it('教材已停用应返回 400', async () => {
      mockPrisma.textbooks.findUnique.mockResolvedValue({
        id: 10,
        title: '旧版教材',
        is_active: false,
      });

      const req = mockReq({ textbook_id: 10 }, { id: '5' });
      const res = mockRes();
      const next = vi.fn();

      await assignTextbookToSemester(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '教材"旧版教材"已停用，无法关联',
      });
      expect(mockTx.plan_textbooks.create).not.toHaveBeenCalled();
    });

    it('is_required=false 应正确传递', async () => {
      mockPrisma.textbooks.findUnique.mockResolvedValue({
        id: 10,
        title: '参考书',
        is_active: true,
      });
      mockTx.plan_textbooks.create.mockResolvedValue({});

      const req = mockReq({ textbook_id: 10, is_required: false }, { id: '5' });
      const res = mockRes();
      const next = vi.fn();

      await assignTextbookToSemester(req, res, next);

      expect(mockTx.plan_textbooks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ is_required: false }),
        })
      );
    });
  });

  // ════════════════════════════════════════════
  // batchUpdateSemesterWeeks（H-3 修复：批量更新学期周数）
  // ════════════════════════════════════════════
  describe('batchUpdateSemesterWeeks', () => {
    it('正常流程：应在单事务中更新所有学期记录', async () => {
      const req = mockReq({ ids: [1, 2, 3], weeks_count: 16 });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateSemesterWeeks(req, res, next);

      // $transaction 应收到 3 个 update promise
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const txArg = mockPrisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(txArg)).toBe(true);
      expect(txArg).toHaveLength(3);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: { updated: 3 },
          message: '批量更新成功',
        })
      );
      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'success',
          message: '批量更新学期周数：3条记录',
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('ids 为空数组应返回 400', async () => {
      const req = mockReq({ ids: [], weeks_count: 16 });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateSemesterWeeks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'ids 必须为非空数组',
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('ids 不是数组应返回 400', async () => {
      const req = mockReq({ ids: 'not-array', weeks_count: 16 });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateSemesterWeeks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('weeks_count 为 0 应返回 400', async () => {
      const req = mockReq({ ids: [1], weeks_count: 0 });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateSemesterWeeks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'weeks_count 必须在 1-52 之间',
      });
    });

    it('weeks_count 为 null 应返回 400', async () => {
      const req = mockReq({ ids: [1], weeks_count: null });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateSemesterWeeks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('weeks_count 超过 52 应返回 400', async () => {
      const req = mockReq({ ids: [1], weeks_count: 53 });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateSemesterWeeks(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ════════════════════════════════════════════
  // batchUpdateCourseSortOrder（H-7 修复：批量更新课程排序）
  // ════════════════════════════════════════════
  describe('batchUpdateCourseSortOrder', () => {
    it('正常流程：应在单事务中更新所有排序', async () => {
      const items = [
        { id: 1, sort_order: 0 },
        { id: 2, sort_order: 1 },
        { id: 3, sort_order: 2 },
      ];
      const req = mockReq({ items });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateCourseSortOrder(req, res, next);

      // $transaction 应收到 3 个 update promise
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const txArg = mockPrisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(txArg)).toBe(true);
      expect(txArg).toHaveLength(3);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: { updated: 3 },
          message: '排序更新成功',
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('items 为空数组应返回 400', async () => {
      const req = mockReq({ items: [] });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateCourseSortOrder(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'items 必须为非空数组',
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('items 不是数组应返回 400', async () => {
      const req = mockReq({ items: null });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateCourseSortOrder(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('单条排序也应成功', async () => {
      const req = mockReq({ items: [{ id: 5, sort_order: 0 }] });
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateCourseSortOrder(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: { updated: 1 },
        })
      );
    });
  });
});
