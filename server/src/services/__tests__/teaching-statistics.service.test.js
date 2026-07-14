/**
 * teaching-statistics.service.js 单元测试
 *
 * 覆盖合班去重纯函数：
 * - dedupeTeachingUnits：将同一 (combination_id ?? class_id, course_id, teacher_id)
 *   的多个成员班行归并为 1 个"逻辑教学单元"，周课时只计 1 次。
 * - isCombinedUnit：成员班级数 > 1 即视为合班单元。
 *
 * 重点关注易回归的边界：
 * 1. 合班正常合并，课时只计一次（防虚高）
 * 2. 合班但不同教师分上 → 不被误合并
 * 3. 缺 class_id 但有 combination_id → 仍能按组合去重（修复回归测试 mock 坑后锁定）
 * 4. 缺 combination_id 且缺 class_id → 退化回退键，每行被合并（记录当前行为）
 */
import { describe, it, expect } from 'vitest';
import { dedupeTeachingUnits, isCombinedUnit } from '../teaching-statistics.service.js';

// 构造一条 teaching_assignments 行
function row(overrides = {}) {
  return {
    class_id: 1,
    course_id: 10,
    teacher_id: 1,
    weekly_hours: 4,
    is_auto: false,
    class: { id: 1, name: 'A班', combination_id: null },
    course: { id: 10, name: '数学' },
    ...overrides,
  };
}

describe('dedupeTeachingUnits', () => {
  it('非合班：不同班级各为独立单元', () => {
    const rows = [
      row({ class_id: 1, class: { id: 1, name: 'A班', combination_id: null } }),
      row({ class_id: 2, class: { id: 2, name: 'B班', combination_id: null } }),
    ];
    const units = dedupeTeachingUnits(rows);
    expect(units).toHaveLength(2);
    expect(units.every((u) => !isCombinedUnit(u))).toBe(true);
    // 课时各自保留
    expect(units.reduce((s, u) => s + u.weeklyHours, 0)).toBe(8);
  });

  it('合班：同组合+同课程+同教师 → 合并为 1 单元，课时仅计 1 次', () => {
    const rows = [
      row({ class_id: 1, weekly_hours: 4, class: { id: 1, name: 'A班', combination_id: 99 } }),
      row({ class_id: 2, weekly_hours: 4, class: { id: 2, name: 'B班', combination_id: 99 } }),
    ];
    const units = dedupeTeachingUnits(rows);
    expect(units).toHaveLength(1);
    // 关键：周课时只计一次（4），而非 8（防虚高）
    expect(units[0].weeklyHours).toBe(4);
    expect(units[0].memberClassIds).toEqual([1, 2]);
    expect(units[0].combinationId).toBe(99);
    expect(isCombinedUnit(units[0])).toBe(true);
  });

  it('合班但不同教师 → 不被误合并（各自为单元）', () => {
    const rows = [
      row({ class_id: 1, teacher_id: 1, class: { id: 1, name: 'A班', combination_id: 99 } }),
      row({ class_id: 2, teacher_id: 2, class: { id: 2, name: 'B班', combination_id: 99 } }),
    ];
    const units = dedupeTeachingUnits(rows);
    expect(units).toHaveLength(2);
    expect(units.every((u) => !isCombinedUnit(u))).toBe(true);
  });

  it('缺 class_id 但有 combination_id → 仍能按组合去重（防回归测试坑）', () => {
    // 复现 export 测试 mock 场景：teaching_assignments 行缺 class_id 外键
    const rows = [
      {
        course_id: 10,
        teacher_id: 1,
        weekly_hours: 4,
        class: { id: 1, name: 'A班', combination_id: 99 },
      },
      {
        course_id: 10,
        teacher_id: 1,
        weekly_hours: 4,
        class: { id: 2, name: 'B班', combination_id: 99 },
      },
    ];
    const units = dedupeTeachingUnits(rows);
    expect(units).toHaveLength(1);
    expect(units[0].weeklyHours).toBe(4);
    expect(isCombinedUnit(units[0])).toBe(true);
  });

  it('缺 combination_id 又缺 class_id → 退化为回退键，两行被合并', () => {
    // 真实数据外键恒在，此条仅记录退化行为：键都回退 'unknown' 而合并
    const rows = [
      { course_id: 10, teacher_id: 1, weekly_hours: 4, class: { combination_id: null } },
      { course_id: 10, teacher_id: 1, weekly_hours: 4, class: { combination_id: null } },
    ];
    const units = dedupeTeachingUnits(rows);
    expect(units).toHaveLength(1);
  });

  it('混合场景：1 个合班单元 + 1 个独立单元 → 共 2 单元，课时正确', () => {
    const rows = [
      row({ class_id: 1, weekly_hours: 4, class: { id: 1, name: 'A班', combination_id: 99 } }),
      row({ class_id: 2, weekly_hours: 4, class: { id: 2, name: 'B班', combination_id: 99 } }),
      row({
        class_id: 3,
        weekly_hours: 2,
        course_id: 20,
        class: { id: 3, name: 'C班', combination_id: null },
      }),
    ];
    const units = dedupeTeachingUnits(rows);
    expect(units).toHaveLength(2);
    expect(units.reduce((s, u) => s + u.weeklyHours, 0)).toBe(6); // 4 + 2，而非 10
    expect(units.filter(isCombinedUnit)).toHaveLength(1);
  });

  it('representative 透传原始行字段（is_auto 等）', () => {
    const r = row({
      class_id: 1,
      weekly_hours: 4,
      is_auto: true,
      class: { id: 1, name: 'A班', combination_id: 99 },
    });
    const units = dedupeTeachingUnits([r]);
    expect(units[0].representative.is_auto).toBe(true);
    expect(units[0].representative.class_id).toBe(1);
  });
});

describe('isCombinedUnit', () => {
  it('成员班级数 > 1 → true', () => {
    expect(isCombinedUnit({ memberClassIds: [1, 2] })).toBe(true);
  });
  it('成员班级数 = 1 → false', () => {
    expect(isCombinedUnit({ memberClassIds: [1] })).toBe(false);
  });
});
