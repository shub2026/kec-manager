/**
 * 课时统计合班去重工具
 *
 * 背景：合班教学时，同 combination_id 的多个班级共享同一节合班课，教师实际只上一遍，
 * 但 teaching_assignments 表中每个成员班级各存一行。若直接按行累加周课时 / 班级数，
 * 会把同一节合班课重复计数（N 个成员班 → N 倍虚高）。
 *
 * 归并规则：以 (combination_id ?? class_id, course_id, teacher_id) 为"逻辑教学单元"键。
 * - 合班（combination_id 非空）且同一教师、同一课程 → 合并为 1 个单元，周课时只计 1 次。
 * - 非合班班级 → 各自为独立单元（键回退到 class_id，天然唯一）。
 *
 * 键中包含 teacher_id 是为了避免"同组合但不同教师分别上课"的退化场景被错误合并；
 * 在正常合班（同教师同课程）下依然能正确去重。
 *
 * @param {Array<Object>} assignments 教学安排行。每行需包含字段：
 *   class_id, course_id, teacher_id, weekly_hours，以及 class 对象（至少含 combination_id）。
 * @returns {Array<Object>} 逻辑教学单元列表，每项：
 *   {
 *     key: string,
 *     combinationId: number|null,
 *     representative: Object,        // 代表行（首个成员班，透传原始字段）
 *     weeklyHours: number,           // 该单元周课时（仅计 1 次）
 *     memberClassIds: number[],
 *     memberClasses: Object[],
 *   }
 */
export function dedupeTeachingUnits(assignments) {
  const map = new Map();
  for (const a of assignments) {
    const combId = a.class?.combination_id ?? null;
    // 班级主键：优先用安排行的 class_id 外键，回退到 class.id，保证键稳定唯一
    const classId = a.class_id ?? a.class?.id ?? 'unknown';
    const unitKey = `${combId != null ? 'comb:' + combId : 'cls:' + classId}|${a.course_id}|${a.teacher_id}`;
    let unit = map.get(unitKey);
    if (!unit) {
      unit = {
        key: unitKey,
        combinationId: combId,
        representative: a,
        weeklyHours: a.weekly_hours,
        memberClassIds: [classId],
        memberClasses: a.class ? [a.class] : [],
      };
      map.set(unitKey, unit);
    } else {
      unit.memberClassIds.push(classId);
      if (a.class) unit.memberClasses.push(a.class);
    }
  }
  return [...map.values()];
}

/**
 * 根据逻辑单元判断是否为合班单元（成员班级数 > 1）。
 * @param {Object} unit dedupeTeachingUnits 返回的单元
 * @returns {boolean}
 */
export function isCombinedUnit(unit) {
  return unit.memberClassIds.length > 1;
}
