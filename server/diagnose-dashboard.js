/**
 * 首页概览数据核对脚本（临时诊断用）
 *
 * 做法：
 * 1. 直接调用 getDashboardStats / getDashboardInsights（mock req/res），拿到接口实际返回值
 * 2. 用独立口径（逐班级 JS 判定 + 原始查询）重新核算各项指标
 * 3. 逐项比对并输出差异
 */
import { prisma } from './src/lib/prisma.js';
import {
  getDashboardStats,
  getDashboardInsights,
} from './src/controllers/dashboard.controller.js';

function mockRes() {
  const res = { payload: null, statusCode: 200 };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (body) => ((res.payload = body), res);
  return res;
}

async function callController(fn, semester) {
  const req = { query: { semester } };
  const res = mockRes();
  await fn(req, res, (e) => {
    throw e;
  });
  return res.payload?.data ?? res.payload;
}

function fmt(label, apiVal, indepVal) {
  const ok = apiVal === indepVal;
  console.log(
    `${ok ? '  ✅' : '  ❌'} ${label}: 接口=${apiVal}  独立核算=${indepVal}${ok ? '' : '  <-- 不一致'}`
  );
}

async function main() {
  const setting = await prisma.system_settings.findUnique({
    where: { key: 'current_semester' },
  });
  const semester = setting?.value;
  if (!semester) {
    console.log('未配置 current_semester，退出');
    return;
  }
  const [sy, ey, si] = semester.split('-').map(Number);
  console.log(`当前学期: ${semester}\n`);

  // ── 1. 接口实际返回 ──
  const stats = await callController(getDashboardStats, semester);
  const insights = await callController(getDashboardInsights, semester);

  // ── 2. 独立核算 ──
  // majors / plans / textbooks
  const majorsIndep = await prisma.majors.count();
  const plansIndep = await prisma.training_plans.count();
  const textbooksIndep = await prisma.textbooks.count({ where: { is_active: true } });

  // 在读班级：逐班 JS 判定（is_left_school=false 且 1<=grade<=duration_years）
  const allClasses = await prisma.classes.findMany({
    select: {
      id: true,
      name: true,
      student_count: true,
      enrollment_year: true,
      duration_years: true,
      is_left_school: true,
      combination_id: true,
    },
  });
  const activeIndep = allClasses.filter((c) => {
    if (c.is_left_school) return false;
    if (!c.duration_years || c.duration_years <= 0) return false;
    const grade = sy - c.enrollment_year + 1;
    return grade >= 1 && grade <= c.duration_years;
  });
  const totalStudentsIndep = activeIndep.reduce((s, c) => s + (c.student_count || 0), 0);

  // 参与教师：本学期有排课(weekly_hours>0)的在职教师去重
  const assignments = await prisma.teaching_assignments.findMany({
    where: { semester, weekly_hours: { gt: 0 } },
    select: {
      teacher_id: true,
      course_id: true,
      class_id: true,
      weekly_hours: true,
      teacher: { select: { status: true } },
      class: { select: { combination_id: true } },
    },
  });
  const activeAssignments = assignments.filter((a) => a.teacher?.status === 'active');
  const teachersIndep = new Set(activeAssignments.map((a) => a.teacher_id)).size;
  const inactiveTeacherRows = assignments.length - activeAssignments.length;

  // 已排课时：合班去重（同 组合+课程+教师 只计一次） vs 接口的直接 aggregate
  const unitMap = new Map();
  for (const a of activeAssignments) {
    const combId = a.class?.combination_id ?? null;
    const key = `${combId != null ? 'comb:' + combId : 'cls:' + a.class_id}|${a.course_id}|${a.teacher_id}`;
    if (!unitMap.has(key)) unitMap.set(key, a.weekly_hours);
  }
  const assignedHoursDedup =
    Math.round([...unitMap.values()].reduce((s, h) => s + h, 0) * 10) / 10;
  const assignedHoursRaw =
    Math.round(activeAssignments.reduce((s, a) => s + a.weekly_hours, 0) * 10) / 10;

  // 已排课程去重数
  const assignedCourseIdsIndep = new Set(activeAssignments.map((a) => a.course_id)).size;
  const totalCoursesLib = await prisma.courses.count();

  // ── 3. 输出比对 ──
  console.log('══ 指标条（/dashboard/stats）══');
  fmt('专业总数 majors', stats.majors, majorsIndep);
  fmt('培养方案 plans', stats.plans, plansIndep);
  fmt('活跃教材 textbooks', stats.textbooks, textbooksIndep);
  fmt('班级数量 classes', stats.classes, activeIndep.length);
  fmt('在读学生 totalStudents', stats.totalStudents, totalStudentsIndep);
  fmt('参与教师 teachingTeachers', stats.teachingTeachers, teachersIndep);
  console.log(`  ℹ️ 开设课程 courses（方案推导）: 接口=${stats.courses}`);
  console.log(`  ℹ️ 总周课时 totalWeeklyHours（方案计划值）: 接口=${stats.totalWeeklyHours}`);
  console.log(
    `  ℹ️ 已排课时 assignedWeeklyHours: 接口=${stats.assignedWeeklyHours}  合班去重后=${assignedHoursDedup}  不去重=${assignedHoursRaw}`
  );
  if (inactiveTeacherRows > 0) {
    console.log(`  ⚠️ 存在 ${inactiveTeacherRows} 条非在职教师的排课记录（已被接口排除）`);
  }

  console.log('\n══ 洞察区（/dashboard/insights）══');
  fmt('已排课时 assignedWeeklyHours（合班去重）', stats.assignedWeeklyHours, assignedHoursDedup);
  console.log(
    `  ℹ️ 完成度 rate=${insights.completion.rate}%（分母=${insights.completion.totalCourses}，课程库全部=${totalCoursesLib}，应开口径验证见末尾）`
  );
  console.log(`  ℹ️ 已排课程 assignedCourses=${insights.completion.assignedCourses}（已排∩应开）`);
  const distSum =
    Math.round(insights.distribution.reduce((s, d) => s + d.hours, 0) * 10) / 10;
  console.log(
    `  ℹ️ 课时分布合计=${distSum}（合班去重口径应=${assignedHoursDedup}，差额=${Math.round((assignedHoursDedup - distSum) * 10) / 10} 为班级无学院归属的部分）`
  );
  const csSum =
    Math.round(insights.courseStats.reduce((s, c) => s + c.totalHours, 0) * 10) / 10;
  fmt('课程统计课时合计', csSum, assignedHoursDedup);
  console.log(
    `  ℹ️ 未排课提醒数=${insights.alerts.unassignedCourses.length}（上限10），超限教师=${insights.alerts.overloadedTeachers.length}`
  );

  // ── 4. 未排课提醒逐门核对：是否为本学期应开课程 ──
  const { getActiveClassFilter, calcClassSemester, parseSemester } = await import(
    './src/services/semester.service.js'
  );
  const { findBestMatchPlan } = await import('./src/services/plan.service.js');
  const semInfo = parseSemester(semester);
  const filter = await getActiveClassFilter(semInfo);
  const activeCls = await prisma.classes.findMany({ where: filter });
  const plans = await prisma.training_plans.findMany({
    include: {
      plan_courses: { include: { plan_course_semesters: true } },
      majors: true,
      colleges: true,
      training_levels: true,
    },
  });
  const cpm = new Map();
  for (const c of activeCls) {
    if (c.custom_plan_id) {
      const p = plans.find((x) => x.id === c.custom_plan_id);
      if (p) cpm.set(c.id, p);
    }
  }
  const offered = new Set();
  for (const c of activeCls) {
    const calc = calcClassSemester(c, semInfo);
    if (!calc) continue;
    let p = c.custom_plan_id ? plans.find((x) => x.id === c.custom_plan_id) : null;
    if (!p) p = findBestMatchPlan(c, plans, cpm);
    if (!p) continue;
    for (const pc of p.plan_courses) {
      if (pc.start_semester > calc.currentSemesterNum || pc.end_semester < calc.currentSemesterNum)
        continue;
      const sr = pc.plan_course_semesters.find((s) => s.semester === calc.currentSemesterNum);
      const wh = sr?.weekly_hours ?? pc.weekly_hours;
      if (wh > 0) offered.add(pc.course_id);
    }
  }
  console.log('\n══ 未排课提醒逐门核对 ══');
  for (const c of insights.alerts.unassignedCourses) {
    console.log(
      `  ${offered.has(c.id) ? '✅ 真未排（本学期应开）' : '⚠️ 误报（本学期不开设）'}: ${c.name}`
    );
  }

  // 应开口径交叉验证（修复后 completion 应与独立核算的应开集合一致）
  console.log('\n══ 应开口径交叉验证 ══');
  fmt('完成度分母 totalCourses=应开课程数', insights.completion.totalCourses, offered.size);
  const assignedOfferedIndep = [...offered].filter((id) =>
    activeAssignments.some((a) => a.course_id === id)
  ).length;
  fmt('完成度分子 assignedCourses=已排∩应开', insights.completion.assignedCourses, assignedOfferedIndep);

  // 前端"排课进度"卡片展示的课时估算逻辑复现
  const t = insights.completion.totalCourses;
  const a = insights.completion.assignedCourses;
  const estAssigned = t > 0 ? Math.round(stats.totalWeeklyHours * (a / t)) : 0;
  const estRemaining = t > 0 ? Math.round(stats.totalWeeklyHours * ((t - a) / t)) : 0;
  console.log(
    `\n══ 前端"排课进度"卡片课时估算 ══\n  页面显示: 已排 ${estAssigned} / 剩余 ${estRemaining} 课时（按课程数比例折算计划课时）\n  实际已排课时（合班去重）: ${assignedHoursDedup}`
  );

  // ── 5. "课时分布"（distribution）与"课时概览"（courseStats）明细核对 ──
  // 独立实现合班去重（同 组合|课程|教师 为一个逻辑单元，代表行取首行），
  // 与接口的 dedupeTeachingUnits 口径一致但代码独立，用于交叉验证
  const detailRows = await prisma.teaching_assignments.findMany({
    where: { semester, weekly_hours: { gt: 0 }, teacher: { status: 'active' } },
    select: {
      weekly_hours: true,
      course_id: true,
      class_id: true,
      teacher_id: true,
      teacher: { select: { id: true, name: true } },
      class: {
        select: { combination_id: true, colleges: { select: { name: true } } },
      },
      course: { select: { id: true, name: true } },
    },
  });
  const detailUnits = new Map();
  for (const r of detailRows) {
    const combId = r.class?.combination_id ?? null;
    const key = `${combId != null ? 'comb:' + combId : 'cls:' + r.class_id}|${r.course_id}|${r.teacher_id}`;
    let u = detailUnits.get(key);
    if (!u) {
      u = { rep: r, hours: r.weekly_hours, collegeNames: new Set() };
      detailUnits.set(key, u);
    }
    if (r.class?.colleges?.name) u.collegeNames.add(r.class.colleges.name);
  }

  console.log('\n══ "课时分布"卡片（按学院）明细核对 ══');
  const collegeIndep = {};
  let crossCollegeUnits = 0;
  let noCollegeHours = 0;
  for (const u of detailUnits.values()) {
    if (u.collegeNames.size > 1) crossCollegeUnits++;
    const name = u.rep.class?.colleges?.name;
    if (!name) {
      noCollegeHours += u.hours;
      continue;
    }
    collegeIndep[name] = (collegeIndep[name] || 0) + u.hours;
  }
  const distIndep = Object.entries(collegeIndep)
    .filter(([, h]) => h > 0)
    .map(([name, h]) => ({ name, hours: Math.round(h * 10) / 10 }))
    .sort((x, y) => y.hours - x.hours);
  const apiDist = insights.distribution;
  fmt('学院条目数', apiDist.length, distIndep.length);
  const distIndepMap = new Map(distIndep.map((d) => [d.name, d.hours]));
  for (const d of apiDist) {
    fmt(`  ${d.name}`, d.hours, distIndepMap.get(d.name) ?? 0);
    distIndepMap.delete(d.name);
  }
  for (const [name, h] of distIndepMap) {
    console.log(`  ❌ 独立核算存在但接口缺失: ${name}=${h}`);
  }
  if (crossCollegeUnits > 0) {
    console.log(
      `  ⚠️ 存在 ${crossCollegeUnits} 个跨学院合班单元（课时归入代表行班级的学院，存在归属口径歧义）`
    );
  }
  if (noCollegeHours > 0) {
    console.log(
      `  ℹ️ 有 ${Math.round(noCollegeHours * 10) / 10} 课时因班级无学院归属未计入分布图（页面合计会少于总已排课时）`
    );
  }

  console.log('\n══ "课时概览"卡片（按课程）明细核对 ══');
  const courseIndep = {};
  for (const u of detailUnits.values()) {
    const cid = u.rep.course_id;
    if (!courseIndep[cid]) {
      courseIndep[cid] = {
        name: u.rep.course?.name,
        totalHours: 0,
        classCount: 0,
        teacherIds: new Set(),
      };
    }
    courseIndep[cid].totalHours += u.hours;
    courseIndep[cid].classCount += 1;
    courseIndep[cid].teacherIds.add(u.rep.teacher_id);
  }
  const apiCS = insights.courseStats;
  fmt('课程条目数', apiCS.length, Object.keys(courseIndep).length);
  for (const c of apiCS) {
    const ind = courseIndep[c.id];
    if (!ind) {
      console.log(`  ❌ 接口存在但独立核算缺失: ${c.name}`);
      continue;
    }
    const hoursOk = c.totalHours === Math.round(ind.totalHours * 10) / 10;
    const classOk = c.classCount === ind.classCount;
    const teacherOk = c.teacherCount === ind.teacherIds.size;
    const ok = hoursOk && classOk && teacherOk;
    console.log(
      `${ok ? '  ✅' : '  ❌'} ${c.name}: 课时 ${c.totalHours}/${Math.round(ind.totalHours * 10) / 10}  教学班 ${c.classCount}/${ind.classCount}  教师 ${c.teacherCount}/${ind.teacherIds.size}${ok ? '' : '  <-- 不一致'}`
    );
    delete courseIndep[c.id];
  }
  for (const cid of Object.keys(courseIndep)) {
    console.log(`  ❌ 独立核算存在但接口缺失: ${courseIndep[cid].name}`);
  }
  console.log(
    `  ℹ️ 前端仅展示课时降序前 8 门，底部"共 N 门课程 / 合计课时"按全量 courseStats 计算`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
