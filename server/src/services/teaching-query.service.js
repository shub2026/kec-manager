import { prisma } from '../lib/prisma.js';
import { parseSemester } from './semester.service.js';
import { buildCombinationNoMap } from './class-combination.service.js';
import {
  dedupeTeachingUnits,
  isCombinedUnit,
  resolveClassCourseTextbooks,
} from './teaching-statistics.service.js';

/**
 * 任课查询聚合服务
 *
 * 为「任课查询」页的两个视图（按教师 / 按教材）提供同一份数据快照的正反向聚合，
 * 并供对应 Excel 导出复用，确保页面与导出、两个视图之间口径完全一致。
 *
 * ── 两个视图的合班口径刻意不同 ──
 * 教师视图统计"任课工作量"：合班时多个成员班共用一位教师上同一门课，教师实际只上一遍，
 * 故用 dedupeTeachingUnits 归并为逻辑教学单元（与课时统计页一致）。
 * 教材视图统计"教材覆盖面"：教材按学生人手一本征订，合班不减少用书量，
 * 故按自然班（class_id）计数，学生人数按成员班 student_count 真实求和。
 * 二者是不同指标各自正确的定义，不是口径分歧。
 */

const BATCH_SIZE = 500;

/**
 * 分批查询防止 OOM：每批 500 条用 skip/take 分页累积到数组
 * 不改变查询结果内容，仅拆分加载过程
 * @param {object} model - Prisma 模型（如 prisma.classes）
 * @param {object} args - findMany 参数（where/include/orderBy 等）
 * @returns {Promise<Array>}
 */
export async function batchFindMany(model, args) {
  const results = [];
  let skip = 0;
  let batch;
  do {
    batch = await model.findMany({ ...args, skip, take: BATCH_SIZE });
    results.push(...batch);
    skip += BATCH_SIZE;
  } while (batch.length === BATCH_SIZE);
  return results;
}

// 班级字段比课时统计多取 student_count / majors / training_levels：
// 教材视图需要自然班的学生人数与层次专业分组，直接 include 可省去层次名的额外查询
const ASSIGNMENT_INCLUDE = {
  class: {
    select: {
      id: true,
      name: true,
      student_count: true,
      combination_id: true,
      college_id: true,
      major_id: true,
      training_level_id: true,
      custom_plan_id: true,
      enrollment_year: true,
      duration_years: true,
      colleges: { select: { id: true, name: true } },
      majors: { select: { id: true, name: true } },
      training_levels: { select: { id: true, name: true } },
    },
  },
  course: { select: { id: true, name: true } },
};

/**
 * 取本学期全部有效任课安排（与课时统计 getStatistics 完全同口径）
 * @param {string} semester - YYYY-YYYY-N
 * @returns {Promise<Array<Object>>}
 */
export async function fetchSemesterAssignments(semester) {
  return batchFindMany(prisma.teaching_assignments, {
    where: {
      semester,
      teacher: { status: 'active' },
      weekly_hours: { gt: 0 }, // 排除历史遗留的 0 课时安排
    },
    include: ASSIGNMENT_INCLUDE,
    orderBy: [{ teacher_id: 'asc' }, { course_id: 'asc' }],
  });
}

/**
 * 构建任课查询数据快照：一次取数，教师视图与教材视图共用
 * @param {string} semester - YYYY-YYYY-N
 * @returns {Promise<Object|null>} 学期格式非法时返回 null
 */
export async function buildTeachingLoadSnapshot(semester) {
  const semesterInfo = parseSemester(semester);
  if (!semesterInfo) return null;

  const rawAssignments = await fetchSemesterAssignments(semester);
  const units = dedupeTeachingUnits(rawAssignments);
  const { idsMap } = await resolveClassCourseTextbooks(rawAssignments, semesterInfo);

  const teacherIds = [...new Set(rawAssignments.map((a) => a.teacher_id))];
  const teachers = teacherIds.length
    ? await prisma.teachers.findMany({
        where: { id: { in: teacherIds } },
        include: {
          affiliated_college: { select: { id: true, name: true } },
          // 层次回退用：教师所授班级全部未设层次时改用排课意向层次
          scheduling_levels: { include: { training_level: { select: { id: true, name: true } } } },
        },
      })
    : [];
  const teacherMap = new Map(teachers.map((t) => [t.id, t]));

  const textbookIds = new Set();
  for (const ids of idsMap.values()) ids.forEach((id) => textbookIds.add(id));
  let textbookInfoMap = new Map();
  if (textbookIds.size > 0) {
    const rows = await prisma.textbooks.findMany({
      where: { id: { in: [...textbookIds] } },
      select: { id: true, title: true, isbn: true, publisher: true },
    });
    textbookInfoMap = new Map(rows.map((t) => [t.id, t]));
  }

  // 全局合班组号（跨页面一致）；本学期无合班安排时跳过查询
  const hasCombined = rawAssignments.some((a) => a.class?.combination_id != null);
  const combinationNoMap = hasCombined ? await buildCombinationNoMap() : new Map();

  return {
    semester,
    semesterInfo,
    rawAssignments,
    units,
    idsMap,
    teacherMap,
    textbookInfoMap,
    combinationNoMap,
  };
}

const byNameZh = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'zh-Hans-CN');

/**
 * 教师视图聚合：按教师汇总实际任教学科、任课学院/层次、教材数量与任课班级明细
 * @param {Object} snapshot buildTeachingLoadSnapshot 的返回值
 * @returns {Array<Object>}
 */
export function aggregateByTeacher(snapshot) {
  const { units, idsMap, teacherMap, textbookInfoMap, combinationNoMap } = snapshot;

  const unitsByTeacher = new Map();
  for (const u of units) {
    const tid = u.representative.teacher_id;
    if (!unitsByTeacher.has(tid)) unitsByTeacher.set(tid, []);
    unitsByTeacher.get(tid).push(u);
  }

  const result = [];
  for (const [tid, teacherUnits] of unitsByTeacher) {
    const teacher = teacherMap.get(tid);
    const collegeMap = new Map();
    const courseMap = new Map();
    const levelMap = new Map();
    const textbookIdSet = new Set();
    const details = [];

    for (const u of teacherUnits) {
      const cls = u.representative.class;
      const course = u.representative.course;

      if (cls?.colleges && !collegeMap.has(cls.colleges.id)) {
        collegeMap.set(cls.colleges.id, cls.colleges);
      }
      // 学科口径 = 本学期实际任教课程（非教师档案的可授课程意向）
      if (course && !courseMap.has(course.id)) courseMap.set(course.id, course);
      if (cls?.training_level_id != null && !levelMap.has(cls.training_level_id)) {
        levelMap.set(cls.training_level_id, cls.training_levels ?? { id: cls.training_level_id });
      }

      const tbIds = idsMap.get(`${u.representative.class_id}:${u.representative.course_id}`) || [];
      for (const id of tbIds) textbookIdSet.add(id);

      const combined = isCombinedUnit(u);
      details.push({
        unitKey: u.key,
        courseId: course?.id ?? null,
        courseName: course?.name ?? '-',
        classId: u.representative.class_id,
        className: combined
          ? u.memberClasses.map((c) => c?.name).filter(Boolean).join('、')
          : (cls?.name ?? '-'),
        isCombined: combined,
        combinationNo: combined ? (combinationNoMap.get(cls?.combination_id) ?? null) : null,
        collegeName: cls?.colleges?.name || null,
        trainingLevelName: cls?.training_levels?.name || null,
        textbookName:
          tbIds.map((id) => textbookInfoMap.get(id)?.title).filter(Boolean).join('、') || null,
      });
    }

    // 优先实际授课层次，全为空时回退教师排课意向层次
    const trainingLevelList =
      levelMap.size > 0
        ? [...levelMap.values()]
        : (teacher?.scheduling_levels?.map((sl) => sl.training_level).filter(Boolean) ?? []);

    details.sort((a, b) => byNameZh(a.courseName, b.courseName) || byNameZh(a.className, b.className));

    result.push({
      teacherId: tid,
      teacherName: teacher?.name || '未知',
      personnelType: teacher?.personnel_type || null,
      affiliatedCollege: teacher?.affiliated_college || null,
      collegeList: [...collegeMap.values()],
      trainingLevelList,
      courseList: [...courseMap.values()],
      textbookCount: textbookIdSet.size,
      textbookNames: [...textbookIdSet]
        .map((id) => textbookInfoMap.get(id)?.title)
        .filter(Boolean),
      classCount: details.length,
      details,
    });
  }

  result.sort(
    (a, b) =>
      b.courseList.length - a.courseList.length ||
      byNameZh(a.teacherName, b.teacherName)
  );
  return result;
}

/**
 * 教材视图聚合：按教材汇总使用它的层次专业、自然班数、学生人数与任课教师
 *
 * 不使用 dedupeTeachingUnits——教材按自然班征订，合班成员班各自计数。
 *
 * @param {Object} snapshot buildTeachingLoadSnapshot 的返回值
 * @returns {Array<Object>}
 */
export function aggregateByTextbook(snapshot) {
  const { rawAssignments, idsMap, teacherMap, textbookInfoMap } = snapshot;

  const entries = new Map();
  for (const a of rawAssignments) {
    const cls = a.class;
    if (!cls) continue;
    const tbIds = idsMap.get(`${a.class_id}:${a.course_id}`) || [];
    if (!tbIds.length) continue;

    for (const tbId of tbIds) {
      let entry = entries.get(tbId);
      if (!entry) {
        entry = {
          classes: new Map(), // classId → 班级信息（自然班去重）
          classTeachers: new Map(), // classId → Set<teacherId>
          courseStat: new Map(), // courseId → { course, classIds:Set }
          teacherIds: new Set(),
        };
        entries.set(tbId, entry);
      }

      entry.teacherIds.add(a.teacher_id);
      if (!entry.classTeachers.has(a.class_id)) entry.classTeachers.set(a.class_id, new Set());
      entry.classTeachers.get(a.class_id).add(a.teacher_id);

      let cs = entry.courseStat.get(a.course_id);
      if (!cs) {
        cs = { course: a.course, classIds: new Set() };
        entry.courseStat.set(a.course_id, cs);
      }
      cs.classIds.add(a.class_id);

      // 同一班级多门课命中同一教材只计 1 个班、学生数只累加 1 次
      if (!entry.classes.has(a.class_id)) {
        entry.classes.set(a.class_id, {
          classId: a.class_id,
          className: cls.name,
          levelId: cls.training_level_id ?? null,
          levelName: cls.training_levels?.name ?? null,
          majorId: cls.major_id ?? null,
          majorName: cls.majors?.name ?? null,
          studentCount: cls.student_count ?? 0,
        });
      }
    }
  }

  const result = [];
  for (const [tbId, entry] of entries) {
    const info = textbookInfoMap.get(tbId);
    if (!info?.title) continue; // 教材记录缺失时不产出空行

    // 按 层次|专业 二次分组；缺失维度归入 'null' 组而非丢弃
    const groupMap = new Map();
    let studentCount = 0;
    for (const c of entry.classes.values()) {
      studentCount += c.studentCount;
      const key = `${c.levelId ?? 'null'}|${c.majorId ?? 'null'}`;
      let g = groupMap.get(key);
      if (!g) {
        g = {
          levelId: c.levelId,
          levelName: c.levelName,
          majorId: c.majorId,
          majorName: c.majorName,
          classIds: [],
          studentCount: 0,
          teacherIds: new Set(),
        };
        groupMap.set(key, g);
      }
      g.classIds.push(c.classId);
      g.studentCount += c.studentCount;
      for (const tid of entry.classTeachers.get(c.classId) || []) g.teacherIds.add(tid);
    }

    // 学科归属：一本教材可能经多个课程使用，主学科取覆盖班级数最多者（并列按名称字典序保证稳定）
    const courseStats = [...entry.courseStat.values()].sort(
      (x, y) => y.classIds.size - x.classIds.size || byNameZh(x.course?.name, y.course?.name)
    );
    const [primary, ...extras] = courseStats;

    const teacherName = (id) => teacherMap.get(id)?.name || '未知';
    const groups = [...groupMap.values()]
      .map((g) => ({
        levelId: g.levelId,
        levelName: g.levelName,
        majorId: g.majorId,
        majorName: g.majorName,
        classCount: g.classIds.length,
        studentCount: g.studentCount,
        teachers: [...g.teacherIds]
          .map((id) => ({ id, name: teacherName(id) }))
          .sort((x, y) => byNameZh(x.name, y.name)),
      }))
      .sort((x, y) => byNameZh(x.levelName, y.levelName) || byNameZh(x.majorName, y.majorName));

    result.push({
      textbookId: tbId,
      title: info.title,
      isbn: info.isbn || null,
      publisher: info.publisher || null,
      primaryCourse: primary?.course ? { id: primary.course.id, name: primary.course.name } : null,
      extraCourses: extras
        .filter((cs) => cs.course)
        .map((cs) => ({ id: cs.course.id, name: cs.course.name })),
      classCount: entry.classes.size,
      studentCount,
      teacherCount: entry.teacherIds.size,
      teachers: [...entry.teacherIds]
        .map((id) => ({ id, name: teacherName(id) }))
        .sort((x, y) => byNameZh(x.name, y.name)),
      groups,
    });
  }

  result.sort(
    (a, b) =>
      byNameZh(a.primaryCourse?.name, b.primaryCourse?.name) ||
      b.classCount - a.classCount ||
      byNameZh(a.title, b.title)
  );
  return result;
}

/**
 * 汇总本学期任课总览（按自然班口径）
 * @param {Object} snapshot
 * @param {Array} teachers aggregateByTeacher 结果
 * @param {Array} textbooks aggregateByTextbook 结果
 */
export function buildLoadSummary(snapshot, teachers, textbooks) {
  const classMap = new Map();
  for (const a of snapshot.rawAssignments) {
    if (a.class && !classMap.has(a.class.id)) classMap.set(a.class.id, a.class);
  }
  return {
    totalTeachers: teachers.length,
    totalTextbooks: textbooks.length,
    totalClasses: classMap.size,
    totalStudents: [...classMap.values()].reduce((sum, c) => sum + (c.student_count ?? 0), 0),
  };
}
