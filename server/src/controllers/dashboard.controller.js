import { prisma } from '../lib/prisma.js';
import { success, fail } from '../utils/response.js';
import { getActiveClassFilter } from '../services/class.service.js';
import { getSemesterInfoFromRequest, calcClassSemester } from '../services/semester.service.js';
import { findBestMatchPlan } from '../services/plan.service.js';
import { dedupeTeachingUnits } from '../services/teaching-statistics.service.js';

/**
 * 计算本学期开设课程与计划周课时（来自培养方案）
 *
 * 与 query.controller.js 的开课查询逻辑一致：
 * 对每个在读班级，根据其入学年份计算 currentSemesterNum，
 * 查找对应方案中 start/end_semester 覆盖当前学期、且 weekly_hours > 0 的课程。
 * 供 getDashboardStats（指标条）与 getDashboardInsights（完成度/未排课提醒口径）共用。
 *
 * @param {object} semesterInfo 已解析的查询学期信息
 * @returns {Promise<{activeClasses: Array, offeredCourseIds: Set<number>, totalWeeklyHours: number, totalStudents: number}>}
 */
async function computeOfferedCourses(semesterInfo) {
  const activeFilter = await getActiveClassFilter(semesterInfo);

  const [activeClasses, allPlans] = await Promise.all([
    prisma.classes.findMany({
      where: activeFilter,
      select: {
        id: true,
        student_count: true,
        enrollment_year: true,
        duration_years: true,
        major_id: true,
        training_level_id: true,
        college_id: true,
        custom_plan_id: true,
        combination_id: true,
      },
    }),
    // 加载所有培养方案及其课程结构（用于计算开设课程和周课时）
    prisma.training_plans.findMany({
      include: {
        plan_courses: {
          // 禁用课程不计入开设课程数/总周课时
          where: { is_active: true },
          include: {
            plan_course_semesters: true,
            courses: { select: { id: true } },
          },
        },
        majors: true,
        colleges: true,
        training_levels: true,
      },
    }),
  ]);

  const offeredCourseIds = new Set();
  let totalWeeklyHours = 0;
  let totalStudents = 0;

  // B-5修复：合班课时去重集合，同一 (combination_id, course_id) 只计一次
  const combinationCourseDedup = new Set();

  // 构建自定义方案映射表，与 queries.js / assignTeacher 口径一致，
  // 供 findBestMatchPlan 优先匹配 custom_plan_id（allPlans 已含 created_at，排序确定性有保障）
  const classPlanMap = new Map();
  for (const cls of activeClasses) {
    if (cls.custom_plan_id) {
      const customPlan = allPlans.find((p) => p.id === cls.custom_plan_id);
      if (customPlan) classPlanMap.set(cls.id, customPlan);
    }
  }

  for (const cls of activeClasses) {
    totalStudents += cls.student_count || 0;

    const calc = calcClassSemester(cls, semesterInfo);
    if (!calc) continue;

    // 确定班级关联的方案：优先 custom_plan_id，否则回退 findBestMatchPlan
    // 保留显式 custom_plan 短路以避免对已有自定义方案的班级调用 findBestMatchPlan
    let plan;
    if (cls.custom_plan_id) {
      plan = allPlans.find((p) => p.id === cls.custom_plan_id);
    }
    if (!plan) {
      plan = findBestMatchPlan(cls, allPlans, classPlanMap);
    }
    if (!plan) continue;

    // 遍历方案课程，筛选本学期开设的课程
    for (const pc of plan.plan_courses) {
      if (
        pc.start_semester > calc.currentSemesterNum ||
        pc.end_semester < calc.currentSemesterNum
      ) {
        continue;
      }

      // 周课时：优先取学期覆盖值，回退到方案课程默认值
      const semRecord = pc.plan_course_semesters.find(
        (s) => s.semester === calc.currentSemesterNum
      );
      const weeklyHours = semRecord?.weekly_hours ?? pc.weekly_hours;
      if (weeklyHours > 0) {
        offeredCourseIds.add(pc.course_id);

        // B-5修复：合班班级同一课程只计一次课时
        if (cls.combination_id != null) {
          const dedupKey = `${cls.combination_id}_${pc.course_id}`;
          if (combinationCourseDedup.has(dedupKey)) continue;
          combinationCourseDedup.add(dedupKey);
        }
        totalWeeklyHours += weeklyHours;
      }
    }
  }

  return { activeClasses, offeredCourseIds, totalWeeklyHours, totalStudents };
}

/**
 * GET /api/dashboard/stats?semester=YYYY-YYYY-N
 * 返回基于当前学期的数据概览统计
 *
 * 统计项：
 * - majors: 专业总数（基础数据）
 * - courses: 本学期开设课程数（来自培养方案 plan_courses）
 * - classes: 在读班级数（基于学期推算的在读条件）
 * - textbooks: 活跃教材数
 * - plans: 培养方案总数
 * - totalStudents: 在读学生数
 * - teachingTeachers: 本学期参与教师数（来自排课记录，已排才计数）
 * - totalWeeklyHours: 本学期开设课程总周课时（来自培养方案 plan_course_semesters，计划值）
 *
 * BIZ-M3修复：拆分课时语义，明确区分"计划课时"与"已排课时"
 * - plannedWeeklyHours: 培养方案计划总周课时（未排也计数，与 totalWeeklyHours 同源）
 * - assignedWeeklyHours: 实际已排课的总周课时（来自 teaching_assignments，合班去重）
 * 保留 totalWeeklyHours 字段向后兼容（= plannedWeeklyHours）
 */
export async function getDashboardStats(req, res, next) {
  try {
    const { semester } = req.query;
    if (!semester) return fail(res, '请选择学期');

    // 显式解析查询学期信息，避免 getActiveClassFilter 回退全局学期导致的巧合性正确
    const semesterInfo = await getSemesterInfoFromRequest(req);
    // 校验学期格式，避免 semesterInfo=null 时 getActiveClassFilter 退化为 { is_left_school: false }
    // 导致已毕业班级被计入 totalStudents/classes 统计虚高
    if (!semesterInfo) return fail(res, '学期格式错误，应为 YYYY-YYYY-N', 400);

    // 并行查询基础统计数据 + 教师排课统计 + 已排课记录（含合班信息，供去重求和）
    const [majorsCount, plansCount, textbooksCount, teacherStats, assignedRows] = await Promise.all(
      [
        // 基础数据计数
        prisma.majors.count(),
        prisma.training_plans.count(),
        prisma.textbooks.count({ where: { is_active: true } }),
        // 本学期教师课时聚合（仅统计在职教师的排课，用于"参与教师"指标）
        prisma.teaching_assignments.groupBy({
          by: ['teacher_id'],
          where: { semester, weekly_hours: { gt: 0 }, teacher: { status: 'active' } },
          _sum: { weekly_hours: true },
        }),
        // BIZ-M3: 已排课记录明细（含合班信息，经 dedupeTeachingUnits 去重后求和，避免合班成员班重复计课时）
        prisma.teaching_assignments.findMany({
          where: { semester, weekly_hours: { gt: 0 }, teacher: { status: 'active' } },
          select: {
            weekly_hours: true,
            course_id: true,
            teacher_id: true,
            class_id: true,
            class: { select: { combination_id: true } },
          },
        }),
      ]
    );

    // 从培养方案计算本学期开设课程数、总周课时、在读班级/学生数（与 insights 共用同一口径）
    const { activeClasses, offeredCourseIds, totalWeeklyHours, totalStudents } =
      await computeOfferedCourses(semesterInfo);

    // BIZ-M3: 已排课总周课时（实际值，合班去重后求和）
    const assignedUnits = dedupeTeachingUnits(assignedRows);
    const assignedWeeklyHours =
      Math.round(assignedUnits.reduce((sum, u) => sum + u.weeklyHours, 0) * 10) / 10;

    success(res, {
      semester,
      majors: majorsCount,
      courses: offeredCourseIds.size,
      classes: activeClasses.length,
      textbooks: textbooksCount,
      plans: plansCount,
      totalStudents,
      teachingTeachers: teacherStats.length,
      // BIZ-M3: 课时语义拆分，明确区分计划与实际
      totalWeeklyHours: Math.round(totalWeeklyHours * 10) / 10, // 向后兼容（= plannedWeeklyHours）
      plannedWeeklyHours: Math.round(totalWeeklyHours * 10) / 10, // 计划课时（来自培养方案）
      assignedWeeklyHours, // 已排课时（来自 teaching_assignments）
    });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/dashboard/insights?semester=YYYY-YYYY-N
 * 返回首页洞察数据：排课完成度 + 异常提醒 + 课时分布
 *
 * 完成度与未排课提醒均按"本学期应开课程"口径（来自培养方案），
 * 避免课程库中本学期不开设的课程拉低完成度、被误报为未排课。
 */
export async function getDashboardInsights(req, res, next) {
  try {
    const { semester } = req.query;
    if (!semester) return fail(res, '请选择学期');
    // 校验学期格式，避免畸形字符串进入 where 条件后静默返回空结果
    const semesterInfo = await getSemesterInfoFromRequest(req);
    if (!semesterInfo) return fail(res, '学期格式错误，应为 YYYY-YYYY-N', 400);

    const [{ offeredCourseIds }, assignedCourses, allAssignments, colleges] = await Promise.all([
      // 本学期应开课程（培养方案口径，与 stats 的"课程数量"同源）
      computeOfferedCourses(semesterInfo),
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
          class_id: true,
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
              combination_id: true,
              colleges: { select: { id: true, name: true } },
            },
          },
          course: { select: { id: true, name: true, type: true } },
        },
      }),
      // 所有学院（用于分布图标签）
      prisma.colleges.findMany({ select: { id: true, name: true } }),
    ]);

    // 合班去重：将成员班行归并为逻辑教学单元，避免课时/班级数虚高
    const allUnits = dedupeTeachingUnits(allAssignments);

    // —— 排课完成度（分母=本学期应开课程，分子=已排∩应开，防方案外排课致 rate 超 100%）——
    const assignedIds = new Set(assignedCourses.map((c) => c.course_id));
    const assignedOfferedCount = [...assignedIds].filter((id) => offeredCourseIds.has(id)).length;
    const totalCourses = offeredCourseIds.size;
    const completion = {
      totalCourses,
      assignedCourses: assignedOfferedCount,
      rate: totalCourses > 0 ? Math.round((assignedOfferedCount / totalCourses) * 100) : 0,
    };

    // —— 异常提醒 ——
    // 1) 未排课课程：本学期应开但未被排课的（课程库中本学期不开的不提醒）
    const allCourses = await prisma.courses.findMany({ select: { id: true, name: true } });
    const unassignedCourses = allCourses
      .filter((c) => offeredCourseIds.has(c.id) && !assignedIds.has(c.id))
      .slice(0, 10);

    // 2) 课时超限教师：总周课时 > default_weekly_hours（按合班去重单元计）
    const teacherHours = {};
    for (const u of allUnits) {
      const t = u.representative.teacher;
      const tid = t.id;
      if (!teacherHours[tid]) {
        teacherHours[tid] = {
          id: tid,
          name: t.name,
          limit: t.default_weekly_hours || 0,
          hours: 0,
        };
      }
      teacherHours[tid].hours += u.weeklyHours;
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
    for (const u of allUnits) {
      const collegeName = u.representative.class?.colleges?.name;
      if (collegeName && collegeHours[collegeName] !== undefined) {
        collegeHours[collegeName] += u.weeklyHours;
      }
    }
    // 过滤掉 0 课时的学院，转为数组
    const distribution = Object.entries(collegeHours)
      .filter(([, hours]) => hours > 0)
      .map(([name, hours]) => ({ name, hours: Math.round(hours * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours);

    // —— 课程课时统计（按课程聚合：总课时、逻辑教学班数、教师数） ——
    // 合班去重：同一组合的多个成员班合并为 1 个逻辑教学班
    const courseMap = {};
    for (const u of allUnits) {
      const c = u.representative.course;
      const cid = c.id;
      if (!courseMap[cid]) {
        courseMap[cid] = {
          id: cid,
          name: c.name,
          totalHours: 0,
          classCount: 0,
          teacherIds: new Set(),
        };
      }
      courseMap[cid].totalHours += u.weeklyHours;
      courseMap[cid].classCount += 1; // 合班=1 个逻辑教学班
      courseMap[cid].teacherIds.add(u.representative.teacher.id);
    }
    const courseStats = Object.values(courseMap)
      .map((c) => ({
        id: c.id,
        name: c.name,
        totalHours: Math.round(c.totalHours * 10) / 10,
        classCount: c.classCount,
        teacherCount: c.teacherIds.size,
      }))
      .sort((a, b) => b.totalHours - a.totalHours);

    success(res, { semester, completion, alerts, distribution, courseStats });
  } catch (e) {
    next(e);
  }
}
