/**
 * validateHourSettings 单元测试
 *
 * 覆盖所有校验路径：
 * - 合法设置 → 无异常
 * - 缺少必要类型（full_time / part_time / external）
 * - 无效数字（NaN / Infinity / undefined / string）
 * - 范围校验（standard < 1, max > 40, max < 1, standard > max）
 * - 边界值（standard = max, standard = 1, max = 40）
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

const { validateHourSettings } = await import('../validate.js');

// ──────────────────────────────────────────────
// 辅助构造器
// ──────────────────────────────────────────────
function validSettings() {
  return {
    full_time: { standard: 16, max: 20 },
    part_time: { standard: 12, max: 16 },
    external: { standard: 12, max: 16 },
  };
}

// ══════════════════════════════════════════════
// 合法输入
// ══════════════════════════════════════════════
describe('validateHourSettings', () => {
  describe('合法设置', () => {
    it('所有类型齐全且合法时不应抛异常', () => {
      expect(() => validateHourSettings(validSettings())).not.toThrow();
    });

    it('standard 和 max 都为最小值 1 时合法', () => {
      const s = validSettings();
      s.full_time = { standard: 1, max: 1 };
      expect(() => validateHourSettings(s)).not.toThrow();
    });

    it('max 为上界 40 时合法', () => {
      const s = validSettings();
      s.full_time = { standard: 16, max: 40 };
      expect(() => validateHourSettings(s)).not.toThrow();
    });

    it('standard 等于 max 时合法', () => {
      const s = validSettings();
      s.full_time = { standard: 20, max: 20 };
      expect(() => validateHourSettings(s)).not.toThrow();
    });

    it('所有类型均取极值仍合法', () => {
      const s = {
        full_time: { standard: 1, max: 1 },
        part_time: { standard: 40, max: 40 },
        external: { standard: 20, max: 30 },
      };
      expect(() => validateHourSettings(s)).not.toThrow();
    });
  });

  // ──────────────────────────────────────────────
  // 缺少必要类型
  // ──────────────────────────────────────────────
  describe('缺少必要类型', () => {
    it('缺少 full_time 应抛异常并提示 full_time', () => {
      const s = validSettings();
      delete s.full_time;
      expect(() => validateHourSettings(s)).toThrow(/full_time/);
    });

    it('缺少 part_time 应抛异常并提示 part_time', () => {
      const s = validSettings();
      delete s.part_time;
      expect(() => validateHourSettings(s)).toThrow(/part_time/);
    });

    it('缺少 external 应抛异常并提示 external', () => {
      const s = validSettings();
      delete s.external;
      expect(() => validateHourSettings(s)).toThrow(/external/);
    });

    it('全部缺少应抛异常（第一个缺失类型触发）', () => {
      expect(() => validateHourSettings({})).toThrow(/full_time/);
    });

    it('类型为 null 时应视为缺失', () => {
      const s = validSettings();
      s.full_time = null;
      expect(() => validateHourSettings(s)).toThrow(/full_time/);
    });

    it('类型为 undefined 时应视为缺失', () => {
      const s = validSettings();
      s.part_time = undefined;
      expect(() => validateHourSettings(s)).toThrow(/part_time/);
    });
  });

  // ──────────────────────────────────────────────
  // 无效数字
  // ──────────────────────────────────────────────
  describe('无效数字', () => {
    it('standard 为 NaN 应抛异常', () => {
      const s = validSettings();
      s.full_time = { standard: NaN, max: 20 };
      expect(() => validateHourSettings(s)).toThrow(/有效数字/);
    });

    it('max 为 NaN 应抛异常', () => {
      const s = validSettings();
      s.full_time = { standard: 16, max: NaN };
      expect(() => validateHourSettings(s)).toThrow(/有效数字/);
    });

    it('standard 为 Infinity 应抛异常', () => {
      const s = validSettings();
      s.full_time = { standard: Infinity, max: 20 };
      expect(() => validateHourSettings(s)).toThrow(/有效数字/);
    });

    it('max 为 Infinity 应抛异常', () => {
      const s = validSettings();
      s.full_time = { standard: 16, max: Infinity };
      expect(() => validateHourSettings(s)).toThrow(/有效数字/);
    });

    it('standard 为 -Infinity 应抛异常', () => {
      const s = validSettings();
      s.part_time = { standard: -Infinity, max: 16 };
      expect(() => validateHourSettings(s)).toThrow(/有效数字/);
    });

    it('standard 为字符串应抛异常', () => {
      const s = validSettings();
      s.external = { standard: 'abc', max: 16 };
      expect(() => validateHourSettings(s)).toThrow(/有效数字/);
    });

    it('standard 为 undefined 应抛异常', () => {
      const s = validSettings();
      s.full_time = { max: 20 };
      expect(() => validateHourSettings(s)).toThrow(/有效数字/);
    });

    it('max 为 undefined 应抛异常', () => {
      const s = validSettings();
      s.full_time = { standard: 16 };
      expect(() => validateHourSettings(s)).toThrow(/有效数字/);
    });

    it('两者都为 null 应抛异常', () => {
      const s = validSettings();
      s.full_time = { standard: null, max: null };
      expect(() => validateHourSettings(s)).toThrow(/有效数字/);
    });
  });

  // ──────────────────────────────────────────────
  // 范围校验
  // ──────────────────────────────────────────────
  describe('范围校验', () => {
    it('standard < 1 (standard = 0) 应抛异常', () => {
      const s = validSettings();
      s.full_time = { standard: 0, max: 20 };
      expect(() => validateHourSettings(s)).toThrow(/大于0/);
    });

    it('standard 为负数应抛异常', () => {
      const s = validSettings();
      s.full_time = { standard: -5, max: 20 };
      expect(() => validateHourSettings(s)).toThrow(/大于0/);
    });

    it('max > 40 应抛异常', () => {
      const s = validSettings();
      s.full_time = { standard: 16, max: 41 };
      expect(() => validateHourSettings(s)).toThrow(/1-40/);
    });

    it('max 远大于 40 应抛异常', () => {
      const s = validSettings();
      s.part_time = { standard: 12, max: 100 };
      expect(() => validateHourSettings(s)).toThrow(/1-40/);
    });

    it('max < 1 (max = 0) 应抛异常', () => {
      const s = validSettings();
      s.full_time = { standard: 0, max: 0 };
      // standard < 1 先触发，因为 standard 检查在 max 之前
      expect(() => validateHourSettings(s)).toThrow(/大于0/);
    });

    it('max 为负数应抛异常', () => {
      const s = validSettings();
      s.external = { standard: 1, max: -5 };
      expect(() => validateHourSettings(s)).toThrow(/1-40/);
    });

    it('standard > max 应抛异常', () => {
      const s = validSettings();
      s.full_time = { standard: 22, max: 20 };
      expect(() => validateHourSettings(s)).toThrow(/不能超过/);
    });

    it('standard 仅比 max 大 1 也应抛异常', () => {
      const s = validSettings();
      s.full_time = { standard: 21, max: 20 };
      expect(() => validateHourSettings(s)).toThrow(/不能超过/);
    });

    it('max = 0 且 standard = 1 应抛异常（max < 1）', () => {
      const s = validSettings();
      s.full_time = { standard: 1, max: 0 };
      expect(() => validateHourSettings(s)).toThrow(/1-40/);
    });
  });

  // ──────────────────────────────────────────────
  // 边界值精确测试
  // ──────────────────────────────────────────────
  describe('边界值', () => {
    it('standard = 1, max = 1 → 合法', () => {
      const s = validSettings();
      s.full_time = { standard: 1, max: 1 };
      expect(() => validateHourSettings(s)).not.toThrow();
    });

    it('standard = 1, max = 40 → 合法', () => {
      const s = validSettings();
      s.full_time = { standard: 1, max: 40 };
      expect(() => validateHourSettings(s)).not.toThrow();
    });

    it('standard = 40, max = 40 → 合法', () => {
      const s = validSettings();
      s.full_time = { standard: 40, max: 40 };
      expect(() => validateHourSettings(s)).not.toThrow();
    });

    it('standard = 0.999 (小于 1) → 抛异常', () => {
      const s = validSettings();
      s.full_time = { standard: 0.999, max: 20 };
      expect(() => validateHourSettings(s)).toThrow(/大于0/);
    });

    it('standard = 1.001 (大于 1) → 合法', () => {
      const s = validSettings();
      s.full_time = { standard: 1.001, max: 20 };
      expect(() => validateHourSettings(s)).not.toThrow();
    });

    it('max = 40.001 (大于 40) → 抛异常', () => {
      const s = validSettings();
      s.full_time = { standard: 16, max: 40.001 };
      expect(() => validateHourSettings(s)).toThrow(/1-40/);
    });

    it('小数课时 standard=2.5, max=3.5 → 合法', () => {
      const s = validSettings();
      s.full_time = { standard: 2.5, max: 3.5 };
      expect(() => validateHourSettings(s)).not.toThrow();
    });
  });

  // ──────────────────────────────────────────────
  // 多类型校验
  // ──────────────────────────────────────────────
  describe('多类型校验', () => {
    it('full_time 合法但 part_time 不合法应抛异常', () => {
      const s = validSettings();
      s.part_time = { standard: 0, max: 16 };
      expect(() => validateHourSettings(s)).toThrow(/part_time.*大于0/);
    });

    it('full_time 和 part_time 合法但 external 不合法应抛异常', () => {
      const s = validSettings();
      s.external = { standard: 20, max: 16 };
      expect(() => validateHourSettings(s)).toThrow(/external.*不能超过/);
    });

    it('三种类型都有问题时应抛出第一个遇到的异常 (full_time)', () => {
      const s = {
        full_time: { standard: NaN, max: 20 },
        part_time: { standard: NaN, max: 16 },
        external: { standard: NaN, max: 16 },
      };
      expect(() => validateHourSettings(s)).toThrow(/full_time/);
    });
  });
});
