import { prisma } from '../../lib/prisma.js';
import { DEFAULT_HOUR_SETTINGS } from '../../constants/index.js';
import { validateHourSettings } from './validate.js';
import { autoArrange } from './auto-arrange.js';

/**
 * 批量自动排课：为指定学期下所有课程依次执行自动排课
 * 优先处理"可选教师少"的课程，避免这些课程因容量耗尽而无法分配
 */
export async function batchAutoArrange(
  semesterStr,
  mode,
  hourSettings,
  scheduleConditions,
  options = {}
) {
  validateHourSettings(hourSettings);

  const courses = await prisma.courses.findMany({
    where: {
      plan_courses: {
        some: {
          plan_course_semesters: { some: {} },
        },
      },
    },
    select: { id: true, name: true, code: true },
  });

  // 使用轻量级聚合查询计算优先级，避免为每门课程调用完整的 getTeachersForCourse/getClassesWithCourse
  // 仅统计启用状态教师的关联，与实际可用教师一致（H-5 修复）
  const teacherCounts = await prisma.teacher_courses.groupBy({
    by: ['course_id'],
    where: { teacher: { status: 'active' } },
    _count: { teacher_id: true },
  });
  const teacherCountMap = new Map(teacherCounts.map((r) => [r.course_id, r._count.teacher_id]));

  // P1-B 修复：优先级改用"供需比"（班级总课时需求 / 可用教师剩余容量）
  // 比值大的课程资源更紧张，应优先处理，避免因靠后排队而容量耗尽
  // 班级总课时：聚合该课程所有 plan_course_semesters 的 weekly_hours（粗略估算，作相对优先级足够）
  const courseHourDemands = await prisma.plan_course_semesters.groupBy({
    by: ['plan_course_id'],
    where: { plan_courses: { course_id: { in: courses.map((c) => c.id) } } },
    _sum: { weekly_hours: true },
  });
  // plan_course_id → course_id 映射
  const planCourseToCourse = await prisma.plan_courses.findMany({
    where: { course_id: { in: courses.map((c) => c.id) } },
    select: { id: true, course_id: true },
  });
  const courseDemandMap = new Map(); // course_id → 总课时需求
  for (const pc of planCourseToCourse) {
    const demand = courseHourDemands.find((d) => d.plan_course_id === pc.id);
    if (demand) {
      courseDemandMap.set(
        pc.course_id,
        (courseDemandMap.get(pc.course_id) || 0) + (demand._sum.weekly_hours || 0)
      );
    }
  }

  // 默认标准课时（full_time=16），用于估算剩余容量
  const defaultStandard =
    hourSettings.full_time?.standard || DEFAULT_HOUR_SETTINGS.full_time.standard;

  const coursePriorities = courses.map((course) => {
    const teacherCount = teacherCountMap.get(course.id) || 0;
    const demand = courseDemandMap.get(course.id) || 0;
    // 可用教师剩余容量估算 = 教师数 × 标准课时
    const supplyCapacity = teacherCount * defaultStandard;
    // 供需比：需求/容量。教师数为0时供需比无穷大（最优先）；否则比值越大越紧张
    const supplyDemandRatio =
      teacherCount === 0
        ? Number.MAX_SAFE_INTEGER
        : supplyCapacity > 0
          ? demand / supplyCapacity
          : demand > 0
            ? Number.MAX_SAFE_INTEGER
            : 0;
    return { courseId: course.id, courseName: course.name, priority: supplyDemandRatio };
  });

  coursePriorities.sort((a, b) => b.priority - a.priority);

  const results = [];
  let totalAssigned = 0;
  let totalUnassigned = 0;
  let totalWarnings = 0;

  // 预览模式下维护跨课程教师工作量累积快照，保证容量计算顺序依赖（H-11 修复）
  const virtualTeacherHours = options.preview ? new Map() : null;

  for (const { courseId, courseName } of coursePriorities) {
    try {
      const result = await autoArrange(
        courseId,
        semesterStr,
        mode,
        hourSettings,
        scheduleConditions,
        { ...options, extraTeacherHours: virtualTeacherHours }
      );
      // 预览模式下，将本课程虚拟分配的课时累积到快照，供后续课程容量计算
      if (options.preview && virtualTeacherHours) {
        for (const a of result.assigned) {
          virtualTeacherHours.set(
            a.teacher_id,
            (virtualTeacherHours.get(a.teacher_id) || 0) + a.weekly_hours
          );
        }
      }
      results.push({ courseId, courseName, ...result });
      totalAssigned += result.autoCount;
      totalUnassigned += result.unassignedCount;
      if (result.warnings?.length) totalWarnings += result.warnings.length;
    } catch (e) {
      results.push({
        courseId,
        courseName,
        error: e.message,
        autoCount: 0,
        unassignedCount: 0,
      });
    }
  }

  return {
    semester: semesterStr,
    mode,
    preview: !!options.preview,
    courseResults: results,
    summary: {
      totalCourses: courses.length,
      successCount: results.filter((r) => !r.error).length,
      errorCount: results.filter((r) => r.error).length,
      totalAssigned,
      totalUnassigned,
      totalWarnings,
    },
  };
}
