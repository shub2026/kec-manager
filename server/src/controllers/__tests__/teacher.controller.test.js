/**
 * teacher.controller.js 单元测试
 *
 * 覆盖函数：
 * - updateTeacher：基本字段更新、关联表重建（courses/colleges/training_levels）、
 *   affiliated_college_id 空值处理、default_weekly_hours 处理、事务回滚、P2025 错误
 * - toggleTeacherStatus：active↔disabled 切换、禁用前置校验（当前学期有安排时阻止）、审计日志
 * - batchUpdateDefaultHours：批量修改自定义课时、空值/数字处理
 *
 * Mock 策略：mock prisma 和依赖服务，直接调用控制器函数验证行为。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockTx = {
  teachers: {
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  teacher_courses: {
    findMany: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  teaching_assignments: {
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
  },
  teacher_scheduling_colleges: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  teacher_training_levels: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
};

const mockPrisma = {
  teachers: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  teaching_assignments: {
    count: vi.fn().mockResolvedValue(0),
  },
  $transaction: vi.fn(async (fn) => fn(mockTx)),
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖服务
// ──────────────────────────────────────────────
vi.mock('../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// 学期服务：禁用前置校验依赖 getCurrentSemesterInfo 获取当前学期串
vi.mock('../../services/semester.service.js', () => ({
  getCurrentSemesterInfo: vi.fn(),
}));

// sort.js 中 invalidateSortOrderCache 是同步函数，直接 mock 避免副作用
vi.mock('../../utils/sort.js', () => ({
  autoFixSortOrder: vi.fn().mockResolvedValue(false),
  invalidateSortOrderCache: vi.fn(),
  getNextSortOrder: vi.fn().mockResolvedValue(1),
  buildUpdateData: vi.fn((data, allowedFields) => {
    const updateData = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = field === 'sort_order' ? Number(data[field]) : data[field];
      }
    }
    return updateData;
  }),
}));

// ──────────────────────────────────────────────
// 导入被测模块（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const { updateTeacher, toggleTeacherStatus, batchUpdateDefaultHours, createTeacher } =
  await import('../teacher.controller.js');
const { createAuditLog } = await import('../../services/audit.service.js');
const { invalidateSortOrderCache } = await import('../../utils/sort.js');
const { getCurrentSemesterInfo } = await import('../../services/semester.service.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(params, body) {
  return {
    params: { id: String(params.id) },
    body,
    user: { id: 1 },
    ip: '127.0.0.1',
  };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

// ──────────────────────────────────────────────
// 共享测试数据
// ──────────────────────────────────────────────
const TEACHER_ID = 42;

const BASE_TEACHER = {
  id: TEACHER_ID,
  name: '张三',
  gender: '男',
  birth_date: '1985-03-15',
  personnel_type: 'full_time',
  remark: 'master',
  default_weekly_hours: null,
  affiliated_college_id: null,
  status: 'active',
  sort_order: 1,
};

const TEACHER_WITH_ASSOCIATIONS = {
  ...BASE_TEACHER,
  affiliated_college: { id: 10, name: '教育学院' },
  courses: [{ course: { id: 1, name: '心理学' } }, { course: { id: 2, name: '教育学' } }],
  scheduling_colleges: [{ college: { id: 10, name: '教育学院' } }],
  scheduling_levels: [{ training_level: { id: 2, name: '本科' } }],
  _count: { assignments: 3 },
};

// ════════════════════════════════════════════════
// updateTeacher 测试
// ════════════════════════════════════════════════
describe('updateTeacher', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 默认：事务内 teachers.update 返回基础数据
    mockTx.teachers.update.mockResolvedValue({ ...BASE_TEACHER });
    // 默认：事务内 teachers.findUnique 返回含关联的完整数据
    mockTx.teachers.findUnique.mockResolvedValue({ ...TEACHER_WITH_ASSOCIATIONS });
    // 默认：没有已存在的课程关联
    mockTx.teacher_courses.findMany.mockResolvedValue([]);
  });

  // ──────────────────────────────────────────────
  // 1. 基本字段更新（不涉及关联表）
  // ──────────────────────────────────────────────
  describe('基本字段更新', () => {
    it('只更新 name 应调用 tx.teachers.update 且不触碰关联表', async () => {
      const req = mockReq({ id: TEACHER_ID }, { name: '李四' });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(next).not.toHaveBeenCalled();
      // 注意：控制器对 default_weekly_hours=undefined 也会显式赋 null
      expect(mockTx.teachers.update).toHaveBeenCalledWith({
        where: { id: TEACHER_ID },
        data: { name: '李四', default_weekly_hours: null },
      });
      // 没有传 course_ids / college_ids / training_level_ids → 不重建关联
      expect(mockTx.teacher_courses.deleteMany).not.toHaveBeenCalled();
      expect(mockTx.teacher_scheduling_colleges.deleteMany).not.toHaveBeenCalled();
      expect(mockTx.teacher_training_levels.deleteMany).not.toHaveBeenCalled();
    });

    it('更新多个基本字段（name, gender, personnel_type）', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        {
          name: '王五',
          gender: '女',
          personnel_type: 'part_time',
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(next).not.toHaveBeenCalled();
      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      // 注意：控制器对 default_weekly_hours=undefined 也会显式赋 null
      expect(updateCall.data).toEqual({
        name: '王五',
        gender: '女',
        personnel_type: 'part_time',
        default_weekly_hours: null,
      });
    });

    it('旧字段 qualification_type 应兼容映射为 remark', async () => {
      const req = mockReq({ id: TEACHER_ID }, { qualification_type: '高中语文' });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(next).not.toHaveBeenCalled();
      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data.remark).toBe('高中语文');
      expect(updateCall.data).not.toHaveProperty('qualification_type');
    });

    it('同时传 remark 与 qualification_type 时 remark 优先', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        { remark: '新备注', qualification_type: '旧字段' }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data.remark).toBe('新备注');
    });

    // ── 只带一本教材开关字段写入与归一化 ──
    it('single_textbook_only=true 应写入布尔 true', async () => {
      const req = mockReq({ id: TEACHER_ID }, { single_textbook_only: true });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data.single_textbook_only).toBe(true);
    });

    it("single_textbook_only='true'（字符串）应归一为布尔 true", async () => {
      const req = mockReq({ id: TEACHER_ID }, { single_textbook_only: 'true' });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data.single_textbook_only).toBe(true);
    });

    it("single_textbook_only='false'（字符串）应归一为布尔 false", async () => {
      const req = mockReq({ id: TEACHER_ID }, { single_textbook_only: 'false' });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data.single_textbook_only).toBe(false);
    });

    it('未传 single_textbook_only 时不应写入该字段', async () => {
      const req = mockReq({ id: TEACHER_ID }, { name: '李四' });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('single_textbook_only');
    });

    it('更新成功后应返回 success 响应并调用审计日志', async () => {
      const req = mockReq({ id: TEACHER_ID }, { name: '赵六' });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          module: 'teacher',
          result: 'success',
        })
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: '更新成功',
        })
      );
    });

    it('更新成功后应调用 invalidateSortOrderCache', async () => {
      const req = mockReq({ id: TEACHER_ID }, { name: '测试' });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(invalidateSortOrderCache).toHaveBeenCalledWith('teachers');
    });
  });

  // ──────────────────────────────────────────────
  // 2. course_ids 变更：级联删除 teaching_assignments
  // ──────────────────────────────────────────────
  describe('course_ids 变更', () => {
    it('移除课程时应级联删除对应的 teaching_assignments', async () => {
      // 模拟已存在的课程关联：[1, 2, 3]
      mockTx.teacher_courses.findMany.mockResolvedValue([
        { course_id: 1 },
        { course_id: 2 },
        { course_id: 3 },
      ]);

      const req = mockReq(
        { id: TEACHER_ID },
        {
          course_ids: [1], // 移除 2、3
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(next).not.toHaveBeenCalled();
      // 应级联删除被移除课程对应的 teaching_assignments
      expect(mockTx.teaching_assignments.deleteMany).toHaveBeenCalledWith({
        where: {
          teacher_id: TEACHER_ID,
          course_id: { in: [2, 3] },
        },
      });
    });

    it('移除课程且有受影响排课时，响应应携带 removed_assignments 明细（P3-1）', async () => {
      mockTx.teacher_courses.findMany.mockResolvedValue([
        { course_id: 1 },
        { course_id: 2 },
      ]);
      mockTx.teaching_assignments.findMany.mockResolvedValue([
        {
          semester: '2025-2026-2',
          course: { name: '教育学' },
          class: { name: '护理1班' },
        },
      ]);

      const req = mockReq({ id: TEACHER_ID }, { course_ids: [1] }); // 移除课程 2
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(next).not.toHaveBeenCalled();
      const payload = res.json.mock.calls[0][0];
      expect(payload.data.removed_assignments).toEqual([
        { semester: '2025-2026-2', course_name: '教育学', class_name: '护理1班' },
      ]);
    });

    it('移除课程但无受影响排课时，removed_assignments 应为空数组（P3-1）', async () => {
      mockTx.teacher_courses.findMany.mockResolvedValue([
        { course_id: 1 },
        { course_id: 2 },
      ]);
      // clearAllMocks 不清除上一用例的 mockResolvedValue 实现，显式重置为空
      mockTx.teaching_assignments.findMany.mockResolvedValue([]);

      const req = mockReq({ id: TEACHER_ID }, { course_ids: [1] });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(next).not.toHaveBeenCalled();
      const payload = res.json.mock.calls[0][0];
      expect(payload.data.removed_assignments).toEqual([]);
    });

    it('course_ids 变更时应重建 teacher_courses 关联', async () => {
      mockTx.teacher_courses.findMany.mockResolvedValue([{ course_id: 1 }]);

      const req = mockReq(
        { id: TEACHER_ID },
        {
          course_ids: [2, 3],
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      // 先清空
      expect(mockTx.teacher_courses.deleteMany).toHaveBeenCalledWith({
        where: { teacher_id: TEACHER_ID },
      });
      // 再创建
      expect(mockTx.teacher_courses.createMany).toHaveBeenCalledWith({
        data: [
          { teacher_id: TEACHER_ID, course_id: 2 },
          { teacher_id: TEACHER_ID, course_id: 3 },
        ],
      });
    });

    it('course_ids 为空数组时应清空所有关联且不创建新关联', async () => {
      mockTx.teacher_courses.findMany.mockResolvedValue([{ course_id: 1 }, { course_id: 2 }]);

      const req = mockReq(
        { id: TEACHER_ID },
        {
          course_ids: [],
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      // 级联删除所有已存在的课程对应的 assignments
      expect(mockTx.teaching_assignments.deleteMany).toHaveBeenCalledWith({
        where: {
          teacher_id: TEACHER_ID,
          course_id: { in: [1, 2] },
        },
      });
      // 清空 teacher_courses
      expect(mockTx.teacher_courses.deleteMany).toHaveBeenCalledWith({
        where: { teacher_id: TEACHER_ID },
      });
      // 空数组不应调用 createMany
      expect(mockTx.teacher_courses.createMany).not.toHaveBeenCalled();
    });

    it('新增课程（无移除）时不应触发 teaching_assignments.deleteMany', async () => {
      // 已存在 course_id = 1
      mockTx.teacher_courses.findMany.mockResolvedValue([{ course_id: 1 }]);

      const req = mockReq(
        { id: TEACHER_ID },
        {
          course_ids: [1, 2, 3], // 新增 2、3，保留 1
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      // 没有移除的课程 → 不级联删除 assignments
      expect(mockTx.teaching_assignments.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // 3. college_ids 变更：重建 teacher_scheduling_colleges
  // ──────────────────────────────────────────────
  describe('college_ids 变更', () => {
    it('应清空并重建 teacher_scheduling_colleges 关联', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        {
          college_ids: [10, 20],
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(mockTx.teacher_scheduling_colleges.deleteMany).toHaveBeenCalledWith({
        where: { teacher_id: TEACHER_ID },
      });
      expect(mockTx.teacher_scheduling_colleges.createMany).toHaveBeenCalledWith({
        data: [
          { teacher_id: TEACHER_ID, college_id: 10 },
          { teacher_id: TEACHER_ID, college_id: 20 },
        ],
      });
    });

    it('college_ids 为空数组时应清空且不创建', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        {
          college_ids: [],
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(mockTx.teacher_scheduling_colleges.deleteMany).toHaveBeenCalledWith({
        where: { teacher_id: TEACHER_ID },
      });
      expect(mockTx.teacher_scheduling_colleges.createMany).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // 4. training_level_ids 变更：重建 teacher_training_levels
  // ──────────────────────────────────────────────
  describe('training_level_ids 变更', () => {
    it('应清空并重建 teacher_training_levels 关联', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        {
          training_level_ids: [2, 3],
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(mockTx.teacher_training_levels.deleteMany).toHaveBeenCalledWith({
        where: { teacher_id: TEACHER_ID },
      });
      expect(mockTx.teacher_training_levels.createMany).toHaveBeenCalledWith({
        data: [
          { teacher_id: TEACHER_ID, training_level_id: 2 },
          { teacher_id: TEACHER_ID, training_level_id: 3 },
        ],
      });
    });

    it('training_level_ids 为空数组时应清空且不创建', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        {
          training_level_ids: [],
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(mockTx.teacher_training_levels.deleteMany).toHaveBeenCalledWith({
        where: { teacher_id: TEACHER_ID },
      });
      expect(mockTx.teacher_training_levels.createMany).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // 5. affiliated_college_id 处理
  // ──────────────────────────────────────────────
  describe('affiliated_college_id 处理', () => {
    it('传入 null → data.affiliated_college_id = null', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        {
          affiliated_college_id: null,
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data.affiliated_college_id).toBeNull();
    });

    it('传入空字符串 "" → data.affiliated_college_id = null', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        {
          affiliated_college_id: '',
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data.affiliated_college_id).toBeNull();
    });

    it('传入有效数字 10 → data.affiliated_college_id = 10', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        {
          affiliated_college_id: 10,
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data.affiliated_college_id).toBe(10);
    });

    it('传入字符串 "10" → data.affiliated_college_id = 10 (Number)', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        {
          affiliated_college_id: '10',
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data.affiliated_college_id).toBe(10);
    });

    it('不传 affiliated_college_id（undefined）→ data 中不包含该字段', async () => {
      const req = mockReq({ id: TEACHER_ID }, { name: '张三' });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('affiliated_college_id');
    });
  });

  // ──────────────────────────────────────────────
  // 6. default_weekly_hours 处理
  // ──────────────────────────────────────────────
  describe('default_weekly_hours 处理', () => {
    it('传入空字符串 "" → data.default_weekly_hours = null', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        {
          default_weekly_hours: '',
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data.default_weekly_hours).toBeNull();
    });

    it('传入 null → data.default_weekly_hours = null', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        {
          default_weekly_hours: null,
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data.default_weekly_hours).toBeNull();
    });

    it('传入 undefined → data.default_weekly_hours = null', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        {
          default_weekly_hours: undefined,
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data.default_weekly_hours).toBeNull();
    });

    it('传入有效数字 12 → data.default_weekly_hours = 12', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        {
          default_weekly_hours: 12,
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data.default_weekly_hours).toBe(12);
    });

    it('传入字符串 "12" → data.default_weekly_hours = 12 (Number)', async () => {
      const req = mockReq(
        { id: TEACHER_ID },
        {
          default_weekly_hours: '12',
        }
      );
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const updateCall = mockTx.teachers.update.mock.calls[0][0];
      expect(updateCall.data.default_weekly_hours).toBe(12);
    });
  });

  // ──────────────────────────────────────────────
  // 7. 事务错误处理
  // ──────────────────────────────────────────────
  describe('事务错误处理', () => {
    it('P2025 错误（教师不存在）应返回 404 fail 响应', async () => {
      const error = new Error('Record not found');
      error.code = 'P2025';
      mockTx.teachers.update.mockRejectedValue(error);

      const req = mockReq({ id: TEACHER_ID }, { name: '测试' });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      // P2025 应返回 fail 而非 next(e)
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '教师不存在',
        })
      );
    });

    it('P2025 错误应记录失败审计日志', async () => {
      const error = new Error('Record not found');
      error.code = 'P2025';
      mockTx.teachers.update.mockRejectedValue(error);

      const req = mockReq({ id: TEACHER_ID }, { name: '测试' });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          module: 'teacher',
          result: 'failed',
        })
      );
    });

    it('非 P2025 错误应通过 next(e) 传递', async () => {
      const error = new Error('Database connection failed');
      mockTx.teachers.update.mockRejectedValue(error);

      const req = mockReq({ id: TEACHER_ID }, { name: '测试' });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('事务内抛出错误时应记录失败审计日志后抛出', async () => {
      const error = new Error('Unexpected error');
      mockTx.teachers.update.mockRejectedValue(error);

      const req = mockReq({ id: TEACHER_ID }, { name: '张三' });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'failed',
          details: expect.objectContaining({ error: 'Unexpected error' }),
        })
      );
    });
  });

  // ──────────────────────────────────────────────
  // 8. 响应数据格式
  // ──────────────────────────────────────────────
  describe('响应数据格式', () => {
    it('返回数据应包含关联字段的重命名映射', async () => {
      const req = mockReq({ id: TEACHER_ID }, { name: '张三' });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const responseCall = res.json.mock.calls[0][0];
      expect(responseCall.data).toHaveProperty('affiliatedCollege');
      expect(responseCall.data).toHaveProperty('courseList');
      expect(responseCall.data).toHaveProperty('collegeList');
      expect(responseCall.data).toHaveProperty('trainingLevelList');
      expect(responseCall.data).toHaveProperty('assignmentCount');
    });

    it('assignmentCount 应取 _count.assignments', async () => {
      const req = mockReq({ id: TEACHER_ID }, { name: '张三' });
      const res = mockRes();
      const next = vi.fn();

      await updateTeacher(req, res, next);

      const responseCall = res.json.mock.calls[0][0];
      expect(responseCall.data.assignmentCount).toBe(3);
    });
  });
});

// ════════════════════════════════════════════════
// toggleTeacherStatus 测试
// M-2修复后：禁用教师不再级联删除排课，直接 prisma.teachers.update
// ════════════════════════════════════════════════
describe('toggleTeacherStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 默认：教师存在且为 active
    mockPrisma.teachers.findUnique.mockResolvedValue({
      id: TEACHER_ID,
      name: '张三',
      status: 'active',
    });
    mockPrisma.teachers.update.mockResolvedValue({ ...BASE_TEACHER, status: 'disabled' });
    // 默认：已配置当前学期，且该教师当前学期无有效安排（不阻止禁用）
    getCurrentSemesterInfo.mockResolvedValue({
      raw: '2026-2027-1',
      label: '2026年秋季(第1学期)',
    });
    mockPrisma.teaching_assignments.count.mockResolvedValue(0);
  });

  // ──────────────────────────────────────────────
  // 1. active → disabled（不再级联删除）
  // ──────────────────────────────────────────────
  describe('active → disabled 切换', () => {
    it('应更新教师状态为 disabled 且不删除 teaching_assignments', async () => {
      const req = mockReq({ id: TEACHER_ID }, { status: 'disabled' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      expect(next).not.toHaveBeenCalled();
      // M-2：直接调用 prisma.teachers.update，不使用 $transaction
      expect(mockPrisma.teachers.update).toHaveBeenCalledWith({
        where: { id: TEACHER_ID },
        data: { status: 'disabled' },
      });
      // M-2：不再级联删除排课
      expect(mockTx.teaching_assignments.deleteMany).not.toHaveBeenCalled();
      expect(mockTx.teaching_assignments.findMany).not.toHaveBeenCalled();
    });

    it('响应中不应包含 cascadedDeletedAssignments', async () => {
      const req = mockReq({ id: TEACHER_ID }, { status: 'disabled' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      const responseCall = res.json.mock.calls[0][0];
      expect(responseCall.data).toHaveProperty('id', TEACHER_ID);
      expect(responseCall.data).toHaveProperty('status', 'disabled');
      expect(responseCall.data).not.toHaveProperty('cascadedDeletedAssignments');
      expect(responseCall.message).toBe('禁用成功');
    });

    it('审计日志不应包含级联删除详情', async () => {
      const req = mockReq({ id: TEACHER_ID }, { status: 'disabled' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          module: 'teacher',
          result: 'success',
          details: expect.objectContaining({
            id: TEACHER_ID,
            name: '张三',
            status: 'disabled',
            willDisable: true,
          }),
        })
      );
    });
  });

  // ──────────────────────────────────────────────
  // 2. disabled → active（启用）
  // ──────────────────────────────────────────────
  describe('disabled → active 切换', () => {
    it('应更新教师状态为 active 且不触碰排课', async () => {
      mockPrisma.teachers.findUnique.mockResolvedValue({
        id: TEACHER_ID,
        name: '张三',
        status: 'disabled',
      });

      const req = mockReq({ id: TEACHER_ID }, { status: 'active' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockPrisma.teachers.update).toHaveBeenCalledWith({
        where: { id: TEACHER_ID },
        data: { status: 'active' },
      });
      expect(mockTx.teaching_assignments.deleteMany).not.toHaveBeenCalled();
    });

    it('响应 message 应为"启用成功"', async () => {
      mockPrisma.teachers.findUnique.mockResolvedValue({
        id: TEACHER_ID,
        name: '张三',
        status: 'disabled',
      });

      const req = mockReq({ id: TEACHER_ID }, { status: 'active' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      const responseCall = res.json.mock.calls[0][0];
      expect(responseCall.message).toBe('启用成功');
    });
  });

  // ──────────────────────────────────────────────
  // 3. disabled → disabled（无状态变化）
  // ──────────────────────────────────────────────
  describe('disabled → disabled（状态不变）', () => {
    it('应正常更新但不触发 willDisable', async () => {
      mockPrisma.teachers.findUnique.mockResolvedValue({
        id: TEACHER_ID,
        name: '张三',
        status: 'disabled',
      });

      const req = mockReq({ id: TEACHER_ID }, { status: 'disabled' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      expect(mockPrisma.teachers.update).toHaveBeenCalled();
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ willDisable: false }),
        })
      );
    });
  });

  // ──────────────────────────────────────────────
  // 4. 错误处理
  // ──────────────────────────────────────────────
  describe('错误处理', () => {
    it('无效状态值应返回 fail 响应', async () => {
      const req = mockReq({ id: TEACHER_ID }, { status: 'invalid' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '状态值无效，应为 active 或 disabled',
        })
      );
    });

    it('教师不存在应返回 404 fail 响应', async () => {
      mockPrisma.teachers.findUnique.mockResolvedValue(null);

      const req = mockReq({ id: TEACHER_ID }, { status: 'active' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '教师不存在',
        })
      );
    });

    it('教师不存在时不应调用 update', async () => {
      mockPrisma.teachers.findUnique.mockResolvedValue(null);

      const req = mockReq({ id: TEACHER_ID }, { status: 'disabled' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      expect(mockPrisma.teachers.update).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // 5. 审计日志
  // ──────────────────────────────────────────────
  describe('审计日志', () => {
    it('禁用成功时审计日志 message 应包含"禁用教师"', async () => {
      const req = mockReq({ id: TEACHER_ID }, { status: 'disabled' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '禁用教师：张三',
        })
      );
    });

    it('启用成功时审计日志 message 应包含"启用教师"', async () => {
      mockPrisma.teachers.findUnique.mockResolvedValue({
        id: TEACHER_ID,
        name: '张三',
        status: 'disabled',
      });

      const req = mockReq({ id: TEACHER_ID }, { status: 'active' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '启用教师：张三',
        })
      );
    });
  });
  // ──────────────────────────────────────────────
  // 6. 禁用前置校验（当前学期有有效安排时阻止）
  // ──────────────────────────────────────────────
  describe('禁用前置校验', () => {
    it('当前学期存在有效安排时应返回 409 且不调用 update', async () => {
      mockPrisma.teaching_assignments.count.mockResolvedValue(3);

      const req = mockReq({ id: TEACHER_ID }, { status: 'disabled' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      // 按当前学期串 + weekly_hours>0 统计
      expect(mockPrisma.teaching_assignments.count).toHaveBeenCalledWith({
        where: {
          teacher_id: TEACHER_ID,
          semester: '2026-2027-1',
          weekly_hours: { gt: 0 },
        },
      });
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining('无法禁用'),
        })
      );
      expect(mockPrisma.teachers.update).not.toHaveBeenCalled();
    });

    it('当前学期无有效安排（count=0）时应正常禁用', async () => {
      mockPrisma.teaching_assignments.count.mockResolvedValue(0);

      const req = mockReq({ id: TEACHER_ID }, { status: 'disabled' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      expect(mockPrisma.teachers.update).toHaveBeenCalledWith({
        where: { id: TEACHER_ID },
        data: { status: 'disabled' },
      });
    });

    it('未配置当前学期时应跳过校验并正常禁用', async () => {
      getCurrentSemesterInfo.mockResolvedValue(null);

      const req = mockReq({ id: TEACHER_ID }, { status: 'disabled' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      expect(mockPrisma.teaching_assignments.count).not.toHaveBeenCalled();
      expect(mockPrisma.teachers.update).toHaveBeenCalled();
    });

    it('启用操作不应触发安排数校验', async () => {
      mockPrisma.teachers.findUnique.mockResolvedValue({
        id: TEACHER_ID,
        name: '张三',
        status: 'disabled',
      });

      const req = mockReq({ id: TEACHER_ID }, { status: 'active' });
      const res = mockRes();
      const next = vi.fn();

      await toggleTeacherStatus(req, res, next);

      expect(mockPrisma.teaching_assignments.count).not.toHaveBeenCalled();
      expect(mockPrisma.teachers.update).toHaveBeenCalled();
    });
  });
});

// ════════════════════════════════════════════════
// batchUpdateDefaultHours 测试
// ════════════════════════════════════════════════
describe('batchUpdateDefaultHours', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teachers.updateMany.mockResolvedValue({ count: 3 });
  });

  // ──────────────────────────────────────────────
  // 1. 批量更新多个教师
  // ──────────────────────────────────────────────
  describe('批量更新', () => {
    it('应对多个教师执行 updateMany', async () => {
      const req = {
        body: { teacher_ids: [1, 2, 3], default_weekly_hours: 16 },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateDefaultHours(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockPrisma.teachers.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2, 3] } },
        data: { default_weekly_hours: 16 },
      });
    });

    it('成功后应返回 success 响应并调用审计日志', async () => {
      const req = {
        body: { teacher_ids: [1, 2], default_weekly_hours: 10 },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateDefaultHours(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining('已修改2名教师的自定义课时'),
        })
      );
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          module: 'teacher',
          result: 'success',
        })
      );
    });

    it('成功后应调用 invalidateSortOrderCache', async () => {
      const req = {
        body: { teacher_ids: [1], default_weekly_hours: 8 },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateDefaultHours(req, res, next);

      expect(invalidateSortOrderCache).toHaveBeenCalledWith('teachers');
    });
  });

  // ──────────────────────────────────────────────
  // 2. 空值/null 处理 → null
  // ──────────────────────────────────────────────
  describe('空值处理', () => {
    it('default_weekly_hours 为 null → hours = null', async () => {
      const req = {
        body: { teacher_ids: [1, 2], default_weekly_hours: null },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateDefaultHours(req, res, next);

      expect(mockPrisma.teachers.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2] } },
        data: { default_weekly_hours: null },
      });
    });

    it('default_weekly_hours 为空字符串 "" → hours = null', async () => {
      const req = {
        body: { teacher_ids: [1], default_weekly_hours: '' },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateDefaultHours(req, res, next);

      expect(mockPrisma.teachers.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1] } },
        data: { default_weekly_hours: null },
      });
    });

    it('default_weekly_hours 为 undefined → hours = null', async () => {
      const req = {
        body: { teacher_ids: [1] },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateDefaultHours(req, res, next);

      expect(mockPrisma.teachers.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1] } },
        data: { default_weekly_hours: null },
      });
    });
  });

  // ──────────────────────────────────────────────
  // 3. 有效数字处理 → Number()
  // ──────────────────────────────────────────────
  describe('有效数字处理', () => {
    it('default_weekly_hours 为数字 12 → hours = 12', async () => {
      const req = {
        body: { teacher_ids: [1], default_weekly_hours: 12 },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateDefaultHours(req, res, next);

      const updateCall = mockPrisma.teachers.updateMany.mock.calls[0][0];
      expect(updateCall.data.default_weekly_hours).toBe(12);
    });

    it('default_weekly_hours 为字符串 "12" → hours = 12 (Number)', async () => {
      const req = {
        body: { teacher_ids: [1], default_weekly_hours: '12' },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateDefaultHours(req, res, next);

      const updateCall = mockPrisma.teachers.updateMany.mock.calls[0][0];
      expect(updateCall.data.default_weekly_hours).toBe(12);
    });

    it('default_weekly_hours 为 0 → hours = 0（不视为空值）', async () => {
      const req = {
        body: { teacher_ids: [1], default_weekly_hours: 0 },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateDefaultHours(req, res, next);

      const updateCall = mockPrisma.teachers.updateMany.mock.calls[0][0];
      expect(updateCall.data.default_weekly_hours).toBe(0);
    });
  });

  // ──────────────────────────────────────────────
  // 4. 错误处理
  // ──────────────────────────────────────────────
  describe('错误处理', () => {
    it('teacher_ids 为空数组应返回 fail 响应', async () => {
      const req = {
        body: { teacher_ids: [], default_weekly_hours: 10 },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateDefaultHours(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '请选择要修改的教师',
        })
      );
      expect(mockPrisma.teachers.updateMany).not.toHaveBeenCalled();
    });

    it('teacher_ids 为 undefined 应返回 fail 响应', async () => {
      const req = {
        body: { default_weekly_hours: 10 },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateDefaultHours(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: '请选择要修改的教师',
        })
      );
    });

    it('数据库错误应通过 next(e) 传递', async () => {
      const error = new Error('Database error');
      mockPrisma.teachers.updateMany.mockRejectedValue(error);

      const req = {
        body: { teacher_ids: [1, 2], default_weekly_hours: 10 },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateDefaultHours(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ──────────────────────────────────────────────
  // 5. 审计日志内容
  // ──────────────────────────────────────────────
  describe('审计日志', () => {
    it('hours 为 null 时审计日志 message 应包含"空"', async () => {
      const req = {
        body: { teacher_ids: [1, 2], default_weekly_hours: null },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateDefaultHours(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('空'),
        })
      );
    });

    it('hours 为有效数字时审计日志 message 应包含该数字', async () => {
      const req = {
        body: { teacher_ids: [1, 2, 3], default_weekly_hours: 16 },
        user: { id: 1 },
        ip: '127.0.0.1',
      };
      const res = mockRes();
      const next = vi.fn();

      await batchUpdateDefaultHours(req, res, next);

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('16'),
        })
      );
    });
  });
});

// ════════════════════════════════════════════════
// createTeacher — 只带一本教材开关字段写入与归一化
// ════════════════════════════════════════════════
describe('createTeacher — single_textbook_only', () => {
  const CREATED_TEACHER = {
    id: 99,
    name: '新教师',
    affiliated_college: null,
    courses: [],
    scheduling_colleges: [],
    scheduling_levels: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.teachers.create.mockResolvedValue({ ...CREATED_TEACHER });
  });

  function reqWith(body) {
    return { body: { name: '新教师', ...body }, user: { id: 1 }, ip: '127.0.0.1' };
  }

  it('传入 single_textbook_only=true 应写入布尔 true', async () => {
    await createTeacher(reqWith({ single_textbook_only: true }), mockRes(), vi.fn());

    const createCall = mockPrisma.teachers.create.mock.calls[0][0];
    expect(createCall.data.single_textbook_only).toBe(true);
  });

  it("传入字符串 'true' 应归一为布尔 true", async () => {
    await createTeacher(reqWith({ single_textbook_only: 'true' }), mockRes(), vi.fn());

    const createCall = mockPrisma.teachers.create.mock.calls[0][0];
    expect(createCall.data.single_textbook_only).toBe(true);
  });

  it('未传字段时默认写入 false', async () => {
    await createTeacher(reqWith({}), mockRes(), vi.fn());

    const createCall = mockPrisma.teachers.create.mock.calls[0][0];
    expect(createCall.data.single_textbook_only).toBe(false);
  });

  it("传入字符串 'false' 应归一为布尔 false", async () => {
    await createTeacher(reqWith({ single_textbook_only: 'false' }), mockRes(), vi.fn());

    const createCall = mockPrisma.teachers.create.mock.calls[0][0];
    expect(createCall.data.single_textbook_only).toBe(false);
  });
});
