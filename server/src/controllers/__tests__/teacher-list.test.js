/**
 * teacher.controller.js — listTeachers PII 脱敏 单元测试
 *
 * 重点覆盖 birth_date 的可见性逻辑：
 * - admin 角色 → birth_date 可见（格式化为 YYYY-MM）
 * - super_admin 角色 → birth_date 可见
 * - viewer 角色 → birth_date = null
 * - 无角色用户 → birth_date = null
 * - birth_date 本身为 null 时，admin 也应返回 null
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockPrisma = {
  teachers: {
    findMany: vi.fn(),
  },
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

vi.mock('../../utils/sort.js', () => ({
  autoFixSortOrder: vi.fn().mockResolvedValue(undefined),
  invalidateSortOrderCache: vi.fn(),
  getNextSortOrder: vi.fn().mockResolvedValue(1),
  buildUpdateData: vi.fn((rest, fields) => {
    const data = {};
    for (const f of fields) {
      if (rest[f] !== undefined) data[f] = rest[f];
    }
    return data;
  }),
}));

vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { listTeachers } = await import('../teacher.controller.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(role = 'viewer') {
  return { user: { id: 1, role }, ip: '127.0.0.1' };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

// 通用教师数据
function makeTeacher(overrides = {}) {
  return {
    id: 1,
    name: '张三',
    gender: '男',
    birth_date: '1990-05-15',
    personnel_type: 'full_time',
    status: 'active',
    affiliated_college: { id: 1, name: '教育学院' },
    courses: [{ course: { id: 1, name: '数学', code: 'MATH101', type: 'required' } }],
    scheduling_colleges: [{ college: { id: 1, name: '教育学院' } }],
    scheduling_levels: [{ training_level: { id: 1, name: '本科' } }],
    _count: { assignments: 3 },
    ...overrides,
  };
}

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('listTeachers — PII 脱敏', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── admin 角色 → birth_date 可见 ──
  it('admin 角色 → birth_date 应可见（格式化为 YYYY-MM）', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([makeTeacher()]);

    const req = mockReq('admin');
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data[0].birth_date).toBe('1990-05');
  });

  // ── super_admin 角色 → birth_date 可见 ──
  it('super_admin 角色 → birth_date 应可见', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([makeTeacher()]);

    const req = mockReq('super_admin');
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data[0].birth_date).toBe('1990-05');
  });

  // ── viewer 角色 → birth_date 被脱敏 ──
  it('viewer 角色 → birth_date 应为 null', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([makeTeacher()]);

    const req = mockReq('viewer');
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data[0].birth_date).toBeNull();
  });

  // ── 无角色用户 → birth_date 被脱敏 ──
  it('无角色用户 → birth_date 应为 null', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([makeTeacher()]);

    const req = { user: { id: 1 }, ip: '127.0.0.1' };
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data[0].birth_date).toBeNull();
  });

  // ── birth_date 本身为 null，admin 也应返回 null ──
  it('birth_date 为 null 时，admin 角色也应返回 null', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([makeTeacher({ birth_date: null })]);

    const req = mockReq('admin');
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data[0].birth_date).toBeNull();
  });

  // ── 验证关联数据也被正确映射 ──
  it('应正确映射 affiliatedCollege、courseList、collegeList、trainingLevelList', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([makeTeacher()]);

    const req = mockReq('admin');
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    const t = data[0];
    expect(t.affiliatedCollege).toEqual({ id: 1, name: '教育学院' });
    expect(t.courseList).toEqual([{ id: 1, name: '数学', code: 'MATH101', type: 'required' }]);
    expect(t.collegeList).toEqual([{ id: 1, name: '教育学院' }]);
    expect(t.trainingLevelList).toEqual([{ id: 1, name: '本科' }]);
    expect(t.assignmentCount).toBe(3);
  });

  // ── 多名教师混合场景 ──
  it('多名教师，viewer 角色下所有人 birth_date 均被脱敏', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([
      makeTeacher({ id: 1, birth_date: '1990-05-15' }),
      makeTeacher({ id: 2, birth_date: '1985-12-01' }),
    ]);

    const req = mockReq('viewer');
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    expect(data[0].birth_date).toBeNull();
    expect(data[1].birth_date).toBeNull();
  });
});
