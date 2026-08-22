import { prisma } from '../lib/prisma.js';
import { findBestMatchPlan } from './plan.service.js';
import { calcClassSemester } from './semester.service.js';

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

/**
 * 应排班级维度合班去重工具（课程级课时聚合用）
 *
 * 背景：getClassesWithCourse 返回的应排班级逐班展开，合班的成员班各带一份 weeklyHours；
 * 直接逐班求和会把合班单元课时按成员班数量放大（与 dedupeTeachingUnits 同一问题的班级侧）。
 *
 * 归并规则：合班（combinationId 非空）成员班按 combinationId 合并为 1 个逻辑单元，
 * 课时取代表班（首个成员班）值，与算法侧 mergeCombinedClasses 口径一致；
 * 非合班班级各自独立成单元。
 *
 * @param {Array<Object>} classes 班级行数组，每项需含 classId、weeklyHours、combinationId
 * @returns {{units: Array<Object>, classUnitMap: Map}}
 *   units: 逻辑教学单元列表，每项 { key, combinationId, weeklyHours, memberClassIds }；
 *   classUnitMap: classId → unitKey 映射，供安排行归属单元使用。
 */
export function dedupeClassUnits(classes) {
  const unitMap = new Map();
  const classUnitMap = new Map();
  for (const c of classes) {
    const unitKey = c.combinationId != null ? `comb:${c.combinationId}` : `cls:${c.classId}`;
    let unit = unitMap.get(unitKey);
    if (!unit) {
      unit = {
        key: unitKey,
        combinationId: c.combinationId ?? null,
        weeklyHours: c.weeklyHours,
        memberClassIds: [],
      };
      unitMap.set(unitKey, unit);
    }
    unit.memberClassIds.push(c.classId);
    classUnitMap.set(c.classId, unitKey);
  }
  return { units: [...unitMap.values()], classUnitMap };
}

/**
 * 批量解析“班级 × 课程”当前学期使用的教材（培养方案 → 学期匹配 → plan_textbooks）
 *
 * 自 getStatistics 内联逻辑提取，供课时统计接口与课时统计导出共用，
 * 避免两处各自维护同一套“最佳方案匹配 + 学期换算”链路。
 *
 * @param {Array<Object>} rawAssignments 教学安排行，每行需含 class_id、course_id 及
 *   class 对象（含方案匹配字段 major_id / training_level_id / custom_plan_id /
 *   enrollment_year / duration_years 等，供 findBestMatchPlan 与 calcClassSemester 使用）
 * @param {Object} semesterInfo 调用方 parseSemester(semester) 的解析结果
 * @returns {Promise<{idsMap: Map<string, number[]>, titleMap: Map<number, string>}>}
 *   idsMap 键为 `${classId}:${courseId}`，值为教材 ID 数组；titleMap 为教材 ID → 标题
 */
export async function resolveClassCourseTextbooks(rawAssignments, semesterInfo) {
  const idsMap = new Map();
  const titleMap = new Map();

  const uniqueCourseIds = [...new Set(rawAssignments.map((a) => a.course_id))];
  if (uniqueCourseIds.length === 0 || !semesterInfo) {
    return { idsMap, titleMap };
  }

  // 一次查询：所有相关 plan_courses + 方案 + 学期 + 教材（避免 N+1）
  // is_active：禁用课程不参与教材推导
  // 注意：training_plans 为一对一关联，Prisma 的 include 不支持 where（仅一对多可用），
  // 归档方案过滤在代码层完成（见下方 filter）
  const allPlanCourses = await prisma.plan_courses.findMany({
    where: { course_id: { in: uniqueCourseIds }, is_active: true },
    include: {
      training_plans: {
        select: {
          id: true,
          major_id: true,
          training_level_id: true,
          status: true,
          // 供 findBestMatchPlan 按班级入学年份过滤同维度多版本方案
          apply_from_year: true,
          apply_to_year: true,
        },
      },
      plan_course_semesters: {
        include: {
          plan_textbooks: { select: { textbook_id: true } },
        },
      },
    },
    orderBy: [{ training_plans: { sort_order: 'asc' } }, { id: 'asc' }],
  });

  const planCoursesByCourse = new Map();
  for (const pc of allPlanCourses) {
    // 归档方案不参与教材推导匹配（一对一 include 无法在查询层过滤）
    if (pc.training_plans?.status === 'archived') continue;
    if (!planCoursesByCourse.has(pc.course_id)) {
      planCoursesByCourse.set(pc.course_id, []);
    }
    planCoursesByCourse.get(pc.course_id).push(pc);
  }

  // 按 (class_id, course_id) 对匹配教材（覆盖所有成员班行）
  const classInfoMap = new Map(rawAssignments.map((a) => [a.class.id, a.class]));
  const allTextbookIds = new Set();

  for (const a of rawAssignments) {
    const key = `${a.class_id}:${a.course_id}`;
    if (idsMap.has(key)) continue;

    const cls = classInfoMap.get(a.class_id);
    if (!cls) {
      idsMap.set(key, []);
      continue;
    }

    const pcs = planCoursesByCourse.get(a.course_id) || [];
    if (!pcs.length) {
      idsMap.set(key, []);
      continue;
    }

    const candidatePlans = pcs.map((pc) => pc.training_plans).filter(Boolean);
    const bestPlan = findBestMatchPlan(cls, candidatePlans);
    if (!bestPlan) {
      idsMap.set(key, []);
      continue;
    }

    const semCalc = calcClassSemester(cls, semesterInfo);
    if (!semCalc) {
      idsMap.set(key, []);
      continue;
    }

    const textbookIds = new Set();
    for (const pc of pcs) {
      if (pc.training_plans.id !== bestPlan.id) continue;
      for (const sem of pc.plan_course_semesters) {
        if (sem.semester !== semCalc.currentSemesterNum) continue;
        for (const pt of sem.plan_textbooks) {
          textbookIds.add(pt.textbook_id);
        }
      }
    }

    const ids = [...textbookIds];
    ids.forEach((id) => allTextbookIds.add(id));
    idsMap.set(key, ids);
  }

  // 批量查教材标题
  if (allTextbookIds.size > 0) {
    const textbookRows = await prisma.textbooks.findMany({
      where: { id: { in: [...allTextbookIds] } },
      select: { id: true, title: true },
    });
    for (const t of textbookRows) {
      titleMap.set(t.id, t.title);
    }
  }

  return { idsMap, titleMap };
}
