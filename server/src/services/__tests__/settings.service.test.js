/**
 * settings.service.js 单元测试
 *
 * 覆盖纯函数：
 * - parseSemesterString（学期参数校验，修过 S-04）
 * - formatSemesterLabel（学期显示格式化）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock prisma + logger（模块加载时依赖；路径相对测试文件，须 ../../ 才能命中 src/lib 与 src/utils）
const mockSystemSettings = { findUnique: vi.fn() };
vi.mock('../../lib/prisma.js', () => ({ prisma: { system_settings: mockSystemSettings } }));
vi.mock('../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { parseSemesterString, formatSemesterLabel, getSettingValue, isRegisterEnabled } =
  await import('../settings.service.js');

// ──────────────────────────────────────────────
// parseSemesterString
// ──────────────────────────────────────────────
describe('parseSemesterString', () => {
  it('合法秋季学期应解析成功', () => {
    const r = parseSemesterString('2025-2026-1');
    expect(r.success).toBe(true);
    expect(r.data.startYear).toBe(2025);
    expect(r.data.endYear).toBe(2026);
    expect(r.data.semesterIndex).toBe(1);
    expect(r.data.raw).toBe('2025-2026-1');
    expect(r.data.label).toBe('2025年秋季(第1学期)');
  });

  it('合法春季学期应解析成功', () => {
    const r = parseSemesterString('2024-2025-2');
    expect(r.success).toBe(true);
    expect(r.data.semesterIndex).toBe(2);
    expect(r.data.label).toBe('2025年春季(第2学期)');
  });

  it('空值应返回失败', () => {
    expect(parseSemesterString('').success).toBe(false);
    expect(parseSemesterString(null).success).toBe(false);
    expect(parseSemesterString(undefined).success).toBe(false);
  });

  it('非字符串类型应返回失败', () => {
    expect(parseSemesterString(123).success).toBe(false);
    expect(parseSemesterString({}).success).toBe(false);
  });

  it('格式不对（非 3 段）应返回失败', () => {
    expect(parseSemesterString('2025-2026').success).toBe(false);
    expect(parseSemesterString('2025').success).toBe(false);
    expect(parseSemesterString('2025-2026-1-extra').success).toBe(false);
  });

  it('学期索引超出范围应返回失败（S-04 修复验证）', () => {
    expect(parseSemesterString('2025-2026-0').success).toBe(false);
    expect(parseSemesterString('2025-2026-3').success).toBe(false);
  });

  it('年份不连续应返回失败（S-04 修复验证）', () => {
    expect(parseSemesterString('2025-2027-1').success).toBe(false);
    expect(parseSemesterString('2025-2024-1').success).toBe(false);
  });

  it('年份超范围应返回失败', () => {
    expect(parseSemesterString('1999-2000-1').success).toBe(false);
    expect(parseSemesterString('2100-2101-1').success).toBe(false);
  });

  it('非数字应返回失败', () => {
    expect(parseSemesterString('abcd-2026-1').success).toBe(false);
    expect(parseSemesterString('2025-2026-x').success).toBe(false);
  });
});

// ──────────────────────────────────────────────
// formatSemesterLabel
// ──────────────────────────────────────────────
describe('formatSemesterLabel', () => {
  it('秋季应显示起始年', () => {
    expect(formatSemesterLabel(2025, 2026, 1)).toBe('2025年秋季(第1学期)');
  });

  it('春季应显示结束年', () => {
    expect(formatSemesterLabel(2024, 2025, 2)).toBe('2025年春季(第2学期)');
  });
});

// ──────────────────────────────────────────────
// getSettingValue
// ──────────────────────────────────────────────
describe('getSettingValue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('键存在时应返回存储值', async () => {
    mockSystemSettings.findUnique.mockResolvedValue({ key: 'register_enabled', value: 'true' });
    await expect(getSettingValue('register_enabled')).resolves.toBe('true');
  });

  it('键缺失时应返回默认值', async () => {
    mockSystemSettings.findUnique.mockResolvedValue(null);
    await expect(getSettingValue('register_enabled', 'false')).resolves.toBe('false');
    await expect(getSettingValue('missing_key')).resolves.toBeNull();
  });
});

// ──────────────────────────────────────────────
// isRegisterEnabled（注册开放开关）
// ──────────────────────────────────────────────
describe('isRegisterEnabled', () => {
  beforeEach(() => vi.clearAllMocks());

  it("值为 'true' 时应返回 true", async () => {
    mockSystemSettings.findUnique.mockResolvedValue({ key: 'register_enabled', value: 'true' });
    await expect(isRegisterEnabled()).resolves.toBe(true);
  });

  it("值为 'false' 时应返回 false", async () => {
    mockSystemSettings.findUnique.mockResolvedValue({ key: 'register_enabled', value: 'false' });
    await expect(isRegisterEnabled()).resolves.toBe(false);
  });

  it('键未配置时应视为关闭（默认关闭）', async () => {
    mockSystemSettings.findUnique.mockResolvedValue(null);
    await expect(isRegisterEnabled()).resolves.toBe(false);
  });

  it('DB 异常时应 fail-close（视为关闭）且不抛出', async () => {
    mockSystemSettings.findUnique.mockRejectedValue(new Error('database is locked'));
    await expect(isRegisterEnabled()).resolves.toBe(false);
  });
});
