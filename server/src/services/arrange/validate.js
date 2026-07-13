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

/**
 * 校验合班一致性：同一 combinationId 的成员班必须分配同一教师。
 *
 * @param {Array<{classId:number, teacherId:number|null, combinationId:number|null}>} assignments
 * @returns {Array<{combinationId:number, classTeachers: Array<[number, number|null]>}>}
 *   返回存在冲突（同一组合出现 ≥2 个不同 teacherId）的组合列表
 */
export function validateCombinedClassConsistency(assignments) {
  const byComb = new Map();
  for (const a of assignments) {
    if (a.combinationId == null) continue;
    if (!byComb.has(a.combinationId)) byComb.set(a.combinationId, new Map());
    byComb.get(a.combinationId).set(a.classId, a.teacherId);
  }
  const violations = [];
  for (const [combinationId, classTeacherMap] of byComb) {
    const teachers = new Set([...classTeacherMap.values()].filter((t) => t != null));
    if (teachers.size > 1) {
      violations.push({
        combinationId,
        classTeachers: [...classTeacherMap.entries()],
      });
    }
  }
  return violations;
}
