import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { getActiveClassFilter } from '../services/class.service.js';
import { getSemesterInfoFromRequest } from '../services/semester.service.js';

/**
 * GET /api/dashboard/stats?semester=YYYY-YYYY-N
 * 返回基于当前学期的数据概览统计
 *
 * 统计项：
 * - majors: 专业总数（基础数据）
 * - courses: 本学期授课课程数（来自排课记录）
 * - classes: 在读班级数（基于学期推算的在读条件）
 * - textbooks: 活跃教材数
 * - plans: 培养方案总数
 * - totalStudents: 在读学生数
 * - teachingTeachers: 本学期参与教师数
 * - totalWeeklyHours: 本学期总周课时
 */
export async function getDashboardStats(req, res, next) {
  try {
    const { semester } = req.query;
    if (!semester) return fail(res, '请选择学期');

    // 显式解析查询学期信息，避免 getActiveClassFilter 回退全局学期导致的巧合性正确
    const semesterInfo = await getSemesterInfoFromRequest(req);

    // 并行查询所有统计数据
    const [majorsCount, plansCount, textbooksCount, activeFilter, courseStats, teacherStats] =
      await Promise.all([
        // 基础数据计数
        prisma.majors.count(),
        prisma.training_plans.count(),
        prisma.textbooks.count({ where: { is_active: true } }),
        // 在读班级筛选条件
        getActiveClassFilter(semesterInfo),
        // 本学期授课课程（去重，P1-4：仅统计在职教师的排课）
        // B-13修复：过滤 0 课时记录，避免虚增课程数和教师数
        prisma.teaching_assignments.findMany({
          where: { semester, weekly_hours: { gt: 0 }, teacher: { status: 'active' } },
          select: { course_id: true },
          distinct: ['course_id'],
        }),
        // 本学期教师+课时聚合（P1-4：仅统计在职教师，避免禁用教师历史排课污染）
        // B-13修复：过滤 0 课时记录
        prisma.teaching_assignments.groupBy({
          by: ['teacher_id'],
          where: { semester, weekly_hours: { gt: 0 }, teacher: { status: 'active' } },
          _sum: { weekly_hours: true },
        }),
      ]);

    // 在读班级和学生数
    const activeClasses = await prisma.classes.findMany({
      where: activeFilter,
      select: { student_count: true },
    });

    const totalStudents = activeClasses.reduce((sum, c) => sum + (c.student_count || 0), 0);

    // 教师课时汇总
    const totalWeeklyHours = teacherStats.reduce((sum, t) => sum + (t._sum.weekly_hours || 0), 0);

    success(res, {
      semester,
      majors: majorsCount,
      courses: courseStats.length,
      classes: activeClasses.length,
      textbooks: textbooksCount,
      plans: plansCount,
      totalStudents,
      teachingTeachers: teacherStats.length,
      totalWeeklyHours: Math.round(totalWeeklyHours * 10) / 10,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/dashboard/insights?semester=YYYY-YYYY-N
 * 返回首页洞察数据：排课完成度 + 异常提醒 + 课时分布
 */
export async function getDashboardInsights(req, res, next) {
  try {
    const { semester } = req.query;
    if (!semester) return fail(res, '请选择学期');

    const [totalCourses, assignedCourses, allAssignments, colleges] = await Promise.all([
      // 总课程数
      prisma.courses.count(),
      // 已排课课程（去重）
      prisma.teaching_assignments.findMany({
        where: { semester, weekly_hours: { gt: 0 }, teacher: { status: 'active' } },
        select: { course_id: true },
        distinct: ['course_id'],
      }),
      // 本学期所有排课记录（含教师和班级关联）
      prisma.teaching_assignments.findMany({
        where: { semester, weekly_hours: { gt: 0 }, teacher: { status: 'active' } },
        select: {
          weekly_hours: true,
          course_id: true,
          teacher: {
            select: {
              id: true,
              name: true,
              default_weekly_hours: true,
              affiliated_college: { select: { id: true, name: true } },
            },
          },
          class: {
            select: {
              college_id: true,
              colleges: { select: { id: true, name: true } },
            },
          },
          course: { select: { id: true, name: true, type: true } },
        },
      }),
      // 所有学院（用于分布图标签）
      prisma.colleges.findMany({ select: { id: true, name: true } }),
    ]);

    // —— 排课完成度 ——
    const assignedIds = new Set(assignedCourses.map((c) => c.course_id));
    const completion = {
      totalCourses,
      assignedCourses: assignedIds.size,
      rate: totalCourses > 0 ? Math.round((assignedIds.size / totalCourses) * 100) : 0,
    };

    // —— 异常提醒 ——
    // 1) 未排课课程：总课程中未被排课的
    const allCourses = await prisma.courses.findMany({ select: { id: true, name: true } });
    const unassignedCourses = allCourses
      .filter((c) => !assignedIds.has(c.id))
      .slice(0, 10);

    // 2) 课时超限教师：总周课时 > default_weekly_hours
    const teacherHours = {};
    for (const a of allAssignments) {
      const tid = a.teacher.id;
      if (!teacherHours[tid]) {
        teacherHours[tid] = {
          id: tid,
          name: a.teacher.name,
          limit: a.teacher.default_weekly_hours || 0,
          hours: 0,
        };
      }
      teacherHours[tid].hours += a.weekly_hours;
    }
    const overloadedTeachers = Object.values(teacherHours)
      .filter((t) => t.limit > 0 && t.hours > t.limit)
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 10);

    const alerts = {
      unassignedCourses,
      overloadedTeachers,
    };

    // —— 课时分布（按任课班级所属学院汇总） ——
    const collegeHours = {};
    for (const c of colleges) {
      collegeHours[c.name] = 0;
    }
    for (const a of allAssignments) {
      const collegeName = a.class?.colleges?.name;
      if (collegeName && collegeHours[collegeName] !== undefined) {
        collegeHours[collegeName] += a.weekly_hours;
      }
    }
    // 过滤掉 0 课时的学院，转为数组
    const distribution = Object.entries(collegeHours)
      .filter(([, hours]) => hours > 0)
      .map(([name, hours]) => ({ name, hours: Math.round(hours * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours);

    success(res, { semester, completion, alerts, distribution });
  } catch (e) {
    next(e);
  }
}
