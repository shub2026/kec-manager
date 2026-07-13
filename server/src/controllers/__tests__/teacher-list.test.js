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
    count: vi.fn().mockResolvedValue(0),
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
  return { user: { id: 1, role }, ip: '127.0.0.1', query: {} };
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
    mockPrisma.teachers.count.mockResolvedValue(1);

    const req = mockReq('admin');
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.items[0].birth_date).toBe('1990-05');
    expect(data.total).toBe(1);
  });

  // ── super_admin 角色 → birth_date 可见 ──
  it('super_admin 角色 → birth_date 应可见', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([makeTeacher()]);
    mockPrisma.teachers.count.mockResolvedValue(1);

    const req = mockReq('super_admin');
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.items[0].birth_date).toBe('1990-05');
  });

  // ── viewer 角色 → birth_date 被脱敏 ──
  it('viewer 角色 → birth_date 应为 null', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([makeTeacher()]);
    mockPrisma.teachers.count.mockResolvedValue(1);

    const req = mockReq('viewer');
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.items[0].birth_date).toBeNull();
  });

  // ── 无角色用户 → birth_date 被脱敏 ──
  it('无角色用户 → birth_date 应为 null', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([makeTeacher()]);
    mockPrisma.teachers.count.mockResolvedValue(1);

    const req = { user: { id: 1 }, ip: '127.0.0.1', query: {} };
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.items[0].birth_date).toBeNull();
  });

  // ── birth_date 本身为 null，admin 也应返回 null ──
  it('birth_date 为 null 时，admin 角色也应返回 null', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([makeTeacher({ birth_date: null })]);
    mockPrisma.teachers.count.mockResolvedValue(1);

    const req = mockReq('admin');
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.items[0].birth_date).toBeNull();
  });

  // ── 验证关联数据也被正确映射 ──
  it('应正确映射 affiliatedCollege、courseList、collegeList、trainingLevelList', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([makeTeacher()]);
    mockPrisma.teachers.count.mockResolvedValue(1);

    const req = mockReq('admin');
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    const t = data.items[0];
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
    mockPrisma.teachers.count.mockResolvedValue(2);

    const req = mockReq('viewer');
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.items).toHaveLength(2);
    expect(data.items[0].birth_date).toBeNull();
    expect(data.items[1].birth_date).toBeNull();
  });
});

// ════════════════════════════════════════════════
// 筛选 / 排序 / 分页
// ════════════════════════════════════════════════
describe('listTeachers — 筛选/排序/分页', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应返回 {items,total} 并应用分页 skip/take', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([makeTeacher({ id: 9 })]);
    mockPrisma.teachers.count.mockResolvedValue(99);

    const req = mockReq('admin');
    req.query = { page: '2', page_size: '20' };
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    expect(mockPrisma.teachers.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 })
    );
    const data = res.json.mock.calls[0][0].data;
    expect(data.items).toHaveLength(1);
    expect(data.total).toBe(99);
  });

  it('筛选参数应构建 where（name 模糊 / personnel_type / status / 关联表 some）', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([]);
    mockPrisma.teachers.count.mockResolvedValue(0);

    const req = mockReq('admin');
    req.query = {
      name: '张',
      personnel_type: 'full_time',
      status: 'active',
      course_id: '3',
      college_id: '2',
      training_level_id: '5',
      affiliated_college_id: '1',
    };
    const res = mockRes();
    await listTeachers(req, res, vi.fn());

    expect(mockPrisma.teachers.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          name: { contains: '张' },
          personnel_type: 'full_time',
          status: 'active',
          affiliated_college_id: 1,
          courses: { some: { course_id: 3 } },
          scheduling_colleges: { some: { college_id: 2 } },
          scheduling_levels: { some: { training_level_id: 5 } },
        },
      })
    );
  });

  it('排序参数应在白名单内才生效，否则回退默认 sort_order', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([]);
    mockPrisma.teachers.count.mockResolvedValue(0);

    const req1 = mockReq('admin');
    req1.query = { sort_by: 'name', sort_dir: 'desc' };
    const res1 = mockRes();
    await listTeachers(req1, res1, vi.fn());
    expect(mockPrisma.teachers.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: 'desc' } })
    );

    const req2 = mockReq('admin');
    req2.query = { sort_by: 'injection', sort_dir: 'desc' };
    const res2 = mockRes();
    await listTeachers(req2, res2, vi.fn());
    expect(mockPrisma.teachers.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { sort_order: 'asc' } })
    );
  });
});
