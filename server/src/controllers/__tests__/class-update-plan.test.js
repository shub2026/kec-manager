/**
 * class.controller.js — updateClass 单元测试
 *
 * 重点覆盖 custom_plan_id（自定义方案）的三种分支：
 * 1. 设置自定义方案：传入有效 id → updateData.custom_plan_id = Number(id)
 * 2. 清空自定义方案：传入 null → updateData.custom_plan_id = null（退回默认关联）
 * 3. 不传 custom_plan_id（undefined）→ updateData 中不包含该字段，保持原值
 * 4. 边界：传入 0 / "" 等 falsy 值 → custom_plan_id = null
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockTx = {
  classes: {
    update: vi.fn(),
  },
  teaching_assignments: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
};

const mockPrisma = {
  classes: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(async (fn) => fn(mockTx)),
};

vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖服务
// ──────────────────────────────────────────────
vi.mock('../../services/settings.service.js', () => ({
  getCurrentSemesterInfo: vi.fn(),
}));

vi.mock('../../services/class.service.js', () => ({
  getActiveClassFilter: vi.fn(),
  invalidateDurationCache: vi.fn(),
}));

vi.mock('../../services/class-filter.service.js', () => ({
  buildClassFilter: vi.fn(),
}));

vi.mock('../../services/plan.service.js', () => ({
  findBestMatchPlan: vi.fn(),
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
const { updateClass } = await import('../class.controller.js');
const { getCurrentSemesterInfo } = await import('../../services/settings.service.js');
const { createAuditLog } = await import('../../services/audit.service.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(id, body) {
  return {
    params: { id: String(id) },
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

const EXISTING_CLASS = {
  id: 1,
  name: '2024级学前1班',
  enrollment_year: 2024,
  duration_years: 3,
  major_id: 1,
  college_id: 1,
  training_level_id: 2,
  student_count: 40,
  custom_plan_id: null,
  is_left_school: false,
  status: 'active',
};

const SEMESTER_INFO = {
  startYear: 2025,
  endYear: 2026,
  semesterIndex: 2,
  raw: '2025-2026-2',
};

const UPDATED_CLASS = {
  ...EXISTING_CLASS,
  majors: {},
  colleges: {},
  training_levels: {},
  training_plans: null,
};

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('updateClass — custom_plan_id 处理', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.classes.findUnique.mockResolvedValue({ ...EXISTING_CLASS });
    getCurrentSemesterInfo.mockResolvedValue(SEMESTER_INFO);
    mockTx.classes.update.mockResolvedValue({ ...UPDATED_CLASS });
  });

  // ── 分支 1：设置自定义方案 ──────────────────
  it('传入 custom_plan_id=5 → updateData.custom_plan_id = 5', async () => {
    const req = mockReq(1, {
      name: '2024级学前1班',
      training_level_id: 2,
      custom_plan_id: 5,
    });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.classes.update).toHaveBeenCalledOnce();

    const updateCall = mockTx.classes.update.mock.calls[0][0];
    expect(updateCall.data.custom_plan_id).toBe(5);
  });

  // ── 分支 2：清空自定义方案（退回默认关联）─────
  it('传入 custom_plan_id=null → updateData.custom_plan_id = null', async () => {
    // 模拟班级原本已关联自定义方案
    mockPrisma.classes.findUnique.mockResolvedValue({
      ...EXISTING_CLASS,
      custom_plan_id: 5,
    });

    const req = mockReq(1, {
      name: '2024级学前1班',
      training_level_id: 2,
      custom_plan_id: null,
    });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.classes.update).toHaveBeenCalledOnce();

    const updateCall = mockTx.classes.update.mock.calls[0][0];
    // 关键断言：null 必须被传递，而非丢弃字段
    expect(updateCall.data).toHaveProperty('custom_plan_id');
    expect(updateCall.data.custom_plan_id).toBeNull();
  });

  // ── 分支 3：不传 custom_plan_id → 保持原值 ────
  it('不传 custom_plan_id → updateData 中不包含该字段', async () => {
    mockPrisma.classes.findUnique.mockResolvedValue({
      ...EXISTING_CLASS,
      custom_plan_id: 5,
    });

    const req = mockReq(1, {
      name: '2024级学前1班',
      training_level_id: 2,
      // 不传 custom_plan_id
    });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.classes.update).toHaveBeenCalledOnce();

    const updateCall = mockTx.classes.update.mock.calls[0][0];
    // 不传时不应触碰该字段
    expect(updateCall.data).not.toHaveProperty('custom_plan_id');
  });

  // ── 分支 4：falsy 边界值 ──────────────────
  it('传入 custom_plan_id=0 → updateData.custom_plan_id = null', async () => {
    const req = mockReq(1, {
      name: '2024级学前1班',
      training_level_id: 2,
      custom_plan_id: 0,
    });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const updateCall = mockTx.classes.update.mock.calls[0][0];
    expect(updateCall.data.custom_plan_id).toBeNull();
  });

  it('传入 custom_plan_id="" → updateData.custom_plan_id = null', async () => {
    const req = mockReq(1, {
      name: '2024级学前1班',
      training_level_id: 2,
      custom_plan_id: '',
    });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const updateCall = mockTx.classes.update.mock.calls[0][0];
    expect(updateCall.data.custom_plan_id).toBeNull();
  });

  // ── 回归：字符串形式的数字 id ─────────────
  it('传入 custom_plan_id="3"（字符串）→ updateData.custom_plan_id = 3', async () => {
    const req = mockReq(1, {
      name: '2024级学前1班',
      training_level_id: 2,
      custom_plan_id: '3',
    });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const updateCall = mockTx.classes.update.mock.calls[0][0];
    expect(updateCall.data.custom_plan_id).toBe(3);
  });

  // ── 成功响应 & 审计日志 ───────────────────
  it('更新成功后调用审计日志并返回 success 响应', async () => {
    const req = mockReq(1, {
      name: '2024级学前1班',
      training_level_id: 2,
      custom_plan_id: null,
    });
    const res = mockRes();
    const next = vi.fn();

    await updateClass(req, res, next);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        module: 'class',
        result: 'success',
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: '更新成功' })
    );
  });
});
