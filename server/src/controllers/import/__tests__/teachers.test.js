/**
 * import/teachers.js — importTeachers 单元测试
 *
 * 覆盖：
 * 1. 有效行 → 创建教师含关联
 * 2. 出生日期解析：YYYY-MM-DD, YYYY-MM, YYYYMM
 * 3. 出生日期：Excel 序列号
 * 4. 中文性别映射（男/女 → male/female）
 * 5. 中文状态映射（禁用 → disabled）
 * 6. 逗号分隔多值字段（学科、学院、层次）
 * 7. S-07 列存在守卫：缺失可选列不应清除已有关联
 * 8. 事务内自动创建未知实体
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma
// ──────────────────────────────────────────────
const mockTx = {
  courses: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 500 }),
  },
  colleges: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 600 }),
  },
  training_levels: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 700 }),
  },
  teachers: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 800 }),
    update: vi.fn().mockResolvedValue({ id: 800 }),
  },
  teacher_courses: {
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  teaching_assignments: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  teacher_scheduling_colleges: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  teacher_training_levels: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
};

const mockPrisma = {
  courses: { findMany: vi.fn().mockResolvedValue([]) },
  colleges: { findMany: vi.fn().mockResolvedValue([]) },
  training_levels: { findMany: vi.fn().mockResolvedValue([]) },
  teachers: { findMany: vi.fn().mockResolvedValue([]) },
  $transaction: vi.fn(async (fn) => fn(mockTx)),
};

vi.mock('../../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ──────────────────────────────────────────────
// Mock 依赖服务
// ──────────────────────────────────────────────
vi.mock('../../../services/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../utils/excel.js', () => ({
  readWorkbook: vi.fn(),
}));

vi.mock('../../import-shared.js', () => ({
  cleanupFile: vi.fn(),
  sanitizeInput: vi.fn((v) => {
    if (v === null || v === undefined) return null;
    // Preserve numbers for Excel serial date handling
    if (typeof v === 'number') return v;
    const s = String(v).trim();
    return s || null;
  }),
  verifyExcelMagicNumber: vi.fn().mockResolvedValue(undefined),
}));

// ──────────────────────────────────────────────
// 导入被测模块
// ──────────────────────────────────────────────
const { importTeachers } = await import('../teachers.js');
const { readWorkbook } = await import('../../../utils/excel.js');
const { createAuditLog } = await import('../../../services/audit.service.js');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function mockReq(file, user) {
  return { file, user: user || { id: 1 } };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

function teacherRow(overrides = {}) {
  return {
    教师姓名: '张三',
    性别: '男',
    出生年月: '1990-01',
    人员类别: '专职',
    教师资格类型: '高校教师资格',
    自定义课时: '12',
    学科: '高等数学',
    任课学院: '理学院',
    任课层次: '本科',
    归属学院: '理学院',
    状态: '启用',
    ...overrides,
  };
}

// ════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════
describe('importTeachers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.courses.findMany.mockResolvedValue([]);
    mockPrisma.colleges.findMany.mockResolvedValue([]);
    mockPrisma.training_levels.findMany.mockResolvedValue([]);
    mockPrisma.teachers.findMany.mockResolvedValue([]);
    mockTx.teachers.findMany.mockResolvedValue([]);
    mockTx.teachers.create.mockResolvedValue({ id: 800 });
    mockTx.teachers.update.mockResolvedValue({ id: 800 });
    mockTx.courses.findFirst.mockResolvedValue(null);
    mockTx.courses.create.mockResolvedValue({ id: 500 });
    mockTx.colleges.findUnique.mockResolvedValue(null);
    mockTx.colleges.create.mockResolvedValue({ id: 600 });
    mockTx.training_levels.findFirst.mockResolvedValue(null);
    mockTx.training_levels.create.mockResolvedValue({ id: 700 });
    mockTx.teacher_courses.findMany.mockResolvedValue([]);
    mockTx.teacher_courses.deleteMany.mockResolvedValue({ count: 0 });
    mockTx.teacher_courses.createMany.mockResolvedValue({ count: 1 });
    mockTx.teaching_assignments.deleteMany.mockResolvedValue({ count: 0 });
    mockTx.teacher_scheduling_colleges.deleteMany.mockResolvedValue({ count: 0 });
    mockTx.teacher_scheduling_colleges.createMany.mockResolvedValue({ count: 1 });
    mockTx.teacher_training_levels.deleteMany.mockResolvedValue({ count: 0 });
    mockTx.teacher_training_levels.createMany.mockResolvedValue({ count: 1 });
  });

  // ── 1. 有效行 → 创建教师 ──────────────────
  it('有效行应创建教师并返回 imported=1', async () => {
    readWorkbook.mockResolvedValue([teacherRow()]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTeachers(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTx.teachers.create).toHaveBeenCalledOnce();
    const createData = mockTx.teachers.create.mock.calls[0][0].data;
    expect(createData.name).toBe('张三');
    expect(createData.gender).toBe('male');
    expect(createData.personnel_type).toBe('full_time');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ imported: 1, overwritten: 0 }),
      })
    );
  });

  // ── 2. 出生日期解析：YYYY-MM-DD ────────────
  it('出生日期 YYYY-MM-DD 应截取为 YYYY-MM', async () => {
    readWorkbook.mockResolvedValue([teacherRow({ 出生年月: '1990-06-15' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTeachers(req, res, next);

    const createData = mockTx.teachers.create.mock.calls[0][0].data;
    expect(createData.birth_date).toBe('1990-06');
  });

  // ── 2b. 出生日期解析：YYYY-MM ─────────────
  it('出生日期 YYYY-MM 应原样保留', async () => {
    readWorkbook.mockResolvedValue([teacherRow({ 出生年月: '1985-12' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTeachers(req, res, next);

    const createData = mockTx.teachers.create.mock.calls[0][0].data;
    expect(createData.birth_date).toBe('1985-12');
  });

  // ── 2c. 出生日期解析：YYYYMM ──────────────
  it('出生日期 YYYYMM 纯数字格式应转为 YYYY-MM', async () => {
    readWorkbook.mockResolvedValue([teacherRow({ 出生年月: '199203' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTeachers(req, res, next);

    const createData = mockTx.teachers.create.mock.calls[0][0].data;
    expect(createData.birth_date).toBe('1992-03');
  });

  // ── 3. 出生日期：Excel 序列号 ──────────────
  it('Excel 日期序列号应正确转为 YYYY-MM', async () => {
    // 32874 = 1990-01-01 (Excel epoch = 1899-12-30)
    readWorkbook.mockResolvedValue([teacherRow({ 出生年月: 32874 })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTeachers(req, res, next);

    const createData = mockTx.teachers.create.mock.calls[0][0].data;
    expect(createData.birth_date).toBe('1990-01');
  });

  // ── 4. 中文性别映射 ──────────────────────
  it('性别"女"应映射为 female', async () => {
    readWorkbook.mockResolvedValue([teacherRow({ 性别: '女' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTeachers(req, res, next);

    const createData = mockTx.teachers.create.mock.calls[0][0].data;
    expect(createData.gender).toBe('female');
  });

  // ── 5. 中文状态映射 ──────────────────────
  it('状态"禁用"应映射为 disabled', async () => {
    readWorkbook.mockResolvedValue([teacherRow({ 状态: '禁用' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTeachers(req, res, next);

    const createData = mockTx.teachers.create.mock.calls[0][0].data;
    expect(createData.status).toBe('disabled');
  });

  // ── 6. 逗号分隔多值字段 ──────────────────
  it('逗号分隔的学科应创建多个课程关联', async () => {
    readWorkbook.mockResolvedValue([teacherRow({ 学科: '高等数学,线性代数' })]);
    // 事务内 create 返回不同 ID
    let courseId = 500;
    mockTx.courses.create.mockImplementation(async ({ data }) => ({ id: courseId++ }));
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTeachers(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // 两个未知课程都应被创建
    expect(mockTx.courses.create).toHaveBeenCalledTimes(2);
  });

  // ── 7. S-07 列存在守卫 ──────────────────
  it('任课学院列为空时不应删除已有关联（S-07 守卫）', async () => {
    // 模拟已存在的教师
    mockPrisma.teachers.findMany.mockResolvedValue([{ id: 10, name: '张三' }]);
    mockTx.teachers.findMany.mockResolvedValue([{ id: 10, name: '张三' }]);
    // 任课学院列为空
    readWorkbook.mockResolvedValue([teacherRow({ 任课学院: '', 任课层次: '' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTeachers(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // S-07: hasCollegeCol = false → 不应调用 deleteMany
    expect(mockTx.teacher_scheduling_colleges.deleteMany).not.toHaveBeenCalled();
    // S-07: hasLevelCol = false → 不应调用 deleteMany
    expect(mockTx.teacher_training_levels.deleteMany).not.toHaveBeenCalled();
  });

  // ── 8. 事务内自动创建未知实体 ────────────
  it('未知课程/学院/层次应在事务内自动创建', async () => {
    readWorkbook.mockResolvedValue([teacherRow()]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTeachers(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // 未知课程应被创建
    expect(mockTx.courses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: '高等数学' }),
      })
    );
    // 未知学院应被创建
    expect(mockTx.colleges.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: '理学院' }),
      })
    );
    // 未知培养层次应被创建
    expect(mockTx.training_levels.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: '本科' }),
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoCreated: expect.objectContaining({
            courses: 1,
            colleges: 1,
            levels: 1,
          }),
        }),
      })
    );
  });

  // ── 无文件 → ValidationError ─────────────
  it('无文件应抛出 ValidationError', async () => {
    const req = mockReq(null);
    const res = mockRes();
    const next = vi.fn();

    await expect(importTeachers(req, res, next)).rejects.toThrow('请上传文件');
  });

  // ── 缺少教师姓名 → 行错误 ───────────────
  it('缺少教师姓名应返回行错误', async () => {
    readWorkbook.mockResolvedValue([teacherRow({ 教师姓名: '' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTeachers(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          imported: 0,
          errors: expect.arrayContaining([expect.stringContaining('缺少教师姓名')]),
        }),
      })
    );
  });

  // ── 人员类别映射 ─────────────────────────
  it('人员类别"兼职"应映射为 part_time', async () => {
    readWorkbook.mockResolvedValue([teacherRow({ 人员类别: '兼职' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTeachers(req, res, next);

    const createData = mockTx.teachers.create.mock.calls[0][0].data;
    expect(createData.personnel_type).toBe('part_time');
  });

  // ── 更新已有教师时 S-07 有列才重建 ──────
  it('已有教师更新时，学科列有内容应重建课程关联', async () => {
    mockPrisma.teachers.findMany.mockResolvedValue([{ id: 10, name: '张三' }]);
    mockTx.teachers.findMany.mockResolvedValue([{ id: 10, name: '张三' }]);
    readWorkbook.mockResolvedValue([teacherRow({ 学科: '高等数学' })]);
    const req = mockReq({ path: '/tmp/test.xlsx' });
    const res = mockRes();
    const next = vi.fn();

    await importTeachers(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // hasCourseCol = true → 应先删除旧关联再创建新关联
    expect(mockTx.teacher_courses.deleteMany).toHaveBeenCalled();
    expect(mockTx.teacher_courses.createMany).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ overwritten: 1 }),
      })
    );
  });
});
