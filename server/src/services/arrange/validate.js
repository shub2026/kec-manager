/**
 * 验证课时设置参数
 */
export function validateHourSettings(hourSettings) {
  const requiredTypes = ['full_time', 'part_time', 'external'];
  for (const type of requiredTypes) {
    if (!hourSettings[type]) {
      throw new Error(`缺少 ${type} 的课时设置`);
    }
    const { standard, max } = hourSettings[type];
    if (!Number.isFinite(standard) || !Number.isFinite(max)) {
      throw new Error(`${type} 的课时设置必须是有效数字`);
    }
    if (standard < 1) {
      throw new Error(`${type} 的标准课时必须大于0`);
    }
    if (max < 1 || max > 40) {
      throw new Error(`${type} 的最大课时必须在1-40之间`);
    }
    if (standard > max) {
      throw new Error(`${type} 的标准课时不能超过最大课时`);
    }
  }
}
