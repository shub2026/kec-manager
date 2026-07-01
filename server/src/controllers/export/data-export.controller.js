import { prisma } from '../../lib/prisma.js';
import { success } from '../../utils/response.js';
import { createWorkbook, workbookToBuffer } from '../../utils/excel.js';
import {
  getSemesterInfoFromRequest,
  getCurrentSemesterInfo,
} from '../../services/settings.service.js';
import { createAuditLog } from '../../services/audit.service.js';
import { getActiveClassFilter } from '../../services/class.service.js';
import { calcClassSemester } from '../../services/semester.service.js';
import { isClassMatchPlan, findBestMatchPlan } from '../../services/plan.service.js';
import { buildClassFilter } from '../../services/class-filter.service.js';
import { getClassesWithCourse } from '../../services/teaching-arrange.service.js';

/**
 * 分批查询防止 OOM：每批 500 条用 skip/take 分页累积到数组
 * 不改变查询结果内容，仅拆分加载过程
 * @param {object} model - Prisma 模型（如 prisma.classes）
 * @param {object} args - findMany 参数（where/include/orderBy 等）
 * @returns {Promise<Array>}
 */
async function batchFindMany(model, args) {
  const BATCH_SIZE = 500;
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

/**
 * 导出课程数据
 */
export async function exportCourses(req, res, next) {
  try {
    const courses = await prisma.courses.findMany({
      orderBy: { sort_order: 'asc' },
    });

    const rows = courses.map((course) => ({
      课程名称: course.name,
      编码: course.code || '-',
      类型: course.type === 'public' ? '公共基础课' : '专业课',
      描述: course.description || '-',
    }));

    const headers = [
      { label: '课程名称', key: '课程名称', width: 30 },
      { label: '编码', key: '编码', width: 20 },
      { label: '类型', key: '类型', width: 15 },
      { label: '描述', key: '描述', width: 40 },
    ];

    const workbook = await createWorkbook(headers, rows);
    const buffer = await workbookToBuffer(workbook);
    const filename = `课程数据_${new Date().toISOString().split('T')[0]}.xlsx`;

    await createAuditLog({
      action: 'export',
      module: 'course',
      userId: req.user?.id,
      ip: req.ip,
      details: { rowCount: rows.length },
      result: 'success',
      message: `导出课程数据，共${rows.length}条记录`,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(buffer);
  } catch (e) {
    await createAuditLog({
      action: 'export',
      module: 'course',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: `导出课程数据失败: ${e.message}`,
    });
    next(e);
  }
}

/**
 * 导出教材数据
 */
export async function exportTextbooks(req, res, next) {
  try {
    const textbooks = await prisma.textbooks.findMany({
      orderBy: { sort_order: 'asc' },
    });

    const rows = textbooks.map((textbook) => ({
      书名: textbook.title,
      书号: textbook.isbn || '-',
      出版社: textbook.publisher || '-',
      作者: textbook.author || '-',
      版次: textbook.edition || '-',
      出版日期: textbook.publish_date || '-',
      定价: textbook.price || '-',
      类别: textbook.category || '-',
      状态: textbook.is_active ? '启用' : '停用',
    }));

    const headers = [
      { label: '书名', key: '书名', width: 30 },
      { label: '书号', key: '书号', width: 25 },
      { label: '出版社', key: '出版社', width: 25 },
      { label: '作者', key: '作者', width: 15 },
      { label: '版次', key: '版次', width: 10 },
      { label: '出版日期', key: '出版日期', width: 15 },
      { label: '定价', key: '定价', width: 10 },
      { label: '类别', key: '类别', width: 10 },
      { label: '状态', key: '状态', width: 10 },
    ];

    const workbook = await createWorkbook(headers, rows);
    const buffer = await workbookToBuffer(workbook);
    const filename = `教材数据_${new Date().toISOString().split('T')[0]}.xlsx`;

    await createAuditLog({
      action: 'export',
      module: 'textbook',
      userId: req.user?.id,
      ip: req.ip,
      details: { rowCount: rows.length },
      result: 'success',
      message: `导出教材数据，共${rows.length}条记录`,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(buffer);
  } catch (e) {
    await createAuditLog({
      action: 'export',
      module: 'textbook',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: `导出教材数据失败: ${e.message}`,
    });
    next(e);
  }
}

/**
 * 导出班级数据
 */
export async function exportClasses(req, res, next) {
  try {
    const filterResult = await buildClassFilter(req.query);
    if (filterResult.planNotFound) {
      return success(res, { items: [], total: 0 }, '导出完成：无数据');
    }
    const finalWhere = filterResult.where;

    // 获取筛选后的班级数据（分批加载防止 OOM）
    const classes = await batchFindMany(prisma.classes, {
      where: finalWhere,
      include: {
        colleges: true,
        majors: true,
        training_levels: true,
        training_plans: true,
      },
      orderBy: { enrollment_year: 'desc' },
    });

    // 预加载所有培养方案，用于自动匹配（与 listClasses 保持一致）
    const allPlans = await prisma.training_plans.findMany({
      select: { id: true, name: true, major_id: true, training_level_id: true },
    });

    // 获取学期信息用于计算年级
    const semesterInfo = await getCurrentSemesterInfo();

    const rows = classes.map((cls) => {
      // 计算匹配的培养方案名称（与前端逻辑一致）
      let matchedPlanName = null;
      if (cls.custom_plan_id && cls.training_plans) {
        // 有自定义方案
        matchedPlanName = cls.training_plans.name;
      } else {
        // C2 修复：使用 findBestMatchPlan 选定最佳方案（major > level 优先级，与排课/列表一致）
        const matchedPlan = findBestMatchPlan(cls, allPlans);
        if (matchedPlan) {
          matchedPlanName = matchedPlan.name;
        }
      }

      // 计算年级
      let grade = null;
      if (semesterInfo && cls.enrollment_year && cls.duration_years) {
        const startYear = semesterInfo.startYear;
        grade = startYear - cls.enrollment_year + 1;
        // 只有在有效范围内才显示年级
        if (grade < 1 || grade > cls.duration_years) {
          grade = null;
        }
      }

      // 确定关联类型
      let relationType = '未关联';
      if (cls.custom_plan_id) {
        relationType = '自定义';
      } else if (cls.major_id) {
        relationType = '专业';
      } else if (cls.training_level_id) {
        relationType = '层次';
      }

      // 确定状态文本
      let statusText = '已毕业';
      if (cls.is_left_school) {
        statusText = '离校';
      } else if (cls.enrollment_year && cls.duration_years) {
        const calcGrade = semesterInfo ? semesterInfo.startYear - cls.enrollment_year + 1 : null;
        statusText =
          calcGrade !== null && calcGrade >= 1 && calcGrade <= cls.duration_years
            ? '在读'
            : '已毕业';
      }

      return {
        班级名称: cls.name,
        二级学院: cls.colleges?.name || '-',
        专业类别: cls.majors?.name || '-',
        培养层次: cls.training_levels?.name || '-',
        入学年份: cls.enrollment_year,
        '学制(年)': cls.duration_years,
        班级人数: Number(cls.student_count) || 0,
        年级: grade ? `${grade}年级` : '-',
        状态: statusText,
        关联类型: relationType,
        当前方案: matchedPlanName || '-',
      };
    });

    const headers = [
      { label: '班级名称', key: '班级名称', width: 25 },
      { label: '二级学院', key: '二级学院', width: 15 },
      { label: '专业类别', key: '专业类别', width: 15 },
      { label: '培养层次', key: '培养层次', width: 12 },
      { label: '入学年份', key: '入学年份', width: 12 },
      { label: '学制(年)', key: '学制(年)', width: 10 },
      { label: '班级人数', key: '班级人数', width: 8 },
      { label: '年级', key: '年级', width: 10 },
      { label: '状态', key: '状态', width: 10 },
      { label: '关联类型', key: '关联类型', width: 10 },
      { label: '当前方案', key: '当前方案', width: 30 },
    ];

    const workbook = await createWorkbook(headers, rows);
    const buffer = await workbookToBuffer(workbook);
    const filename = `班级数据_${new Date().toISOString().split('T')[0]}.xlsx`;

    await createAuditLog({
      action: 'export',
      module: 'class',
      userId: req.user?.id,
      ip: req.ip,
      details: { rowCount: rows.length, filters: req.query },
      result: 'success',
      message: `导出班级数据，共${rows.length}条记录`,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(buffer);
  } catch (e) {
    await createAuditLog({
      action: 'export',
      module: 'class',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: `导出班级数据失败: ${e.message}`,
    });
    next(e);
  }
}

/**
 * 导出教材使用情况
 */
export async function exportTextbookUsage(req, res, next) {
  try {
    const { id } = req.params;
    let semesterInfo = await getSemesterInfoFromRequest(req);

    if (!semesterInfo) {
      const { semester } = req.query;
      if (semester) {
        return res.status(400).json({ success: false, message: '学期格式错误，应为 YYYY-YYYY-N' });
      } else {
        return res.status(400).json({ success: false, message: '请先设置当前学期' });
      }
    }

    // P1-7 修复：传入查询学期，避免学期错位（替代全局学期）
    const activeFilter = await getActiveClassFilter(semesterInfo);
    const [textbook, allClasses] = await Promise.all([
      prisma.textbooks.findUnique({
        where: { id: Number(id) },
        include: {
          plan_textbooks: {
            include: {
              plan_course_semesters: {
                include: {
                  plan_courses: {
                    include: {
                      training_plans: { include: { majors: true, training_levels: true } },
                      courses: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      batchFindMany(prisma.classes, {
        where: activeFilter,
        include: { majors: true, training_levels: true },
        orderBy: { id: 'asc' },
      }),
    ]);

    if (!textbook) return res.status(404).json({ success: false, message: '教材不存在' });

    const rows = [];

    for (const pt of textbook.plan_textbooks) {
      const sem = pt.plan_course_semesters;
      const pc = sem.plan_courses;
      const plan = pc.training_plans;

      for (const cls of allClasses) {
        // 复用统一 calcClassSemester（含越界检查），替代无边界检查的内联副本
        const calc = calcClassSemester(cls, semesterInfo);
        if (!calc) continue;
        if (calc.currentSemesterNum !== sem.semester) continue;

        if (!isClassMatchPlan(cls, plan)) continue;

        rows.push({
          教材名称: textbook.title,
          书号: textbook.isbn || '-',
          课程: pc.courses.name,
          使用班级: cls.name,
          专业: cls.majors?.name || '-',
          培养层次: cls.training_levels?.name || '-',
          年级: calc.grade,
          学生人数: Number(cls.student_count) || 0,
          使用学期: `第${sem.semester}学期`,
          是否必订: pt.is_required ? '是' : '否',
        });
      }
    }

    const totalStudents = rows.reduce((sum, r) => sum + (Number(r['学生人数']) || 0), 0);
    rows.push({
      教材名称: '合计',
      书号: '',
      课程: '',
      使用班级: `${rows.length}个班级`,
      专业: '',
      培养层次: '',
      年级: '',
      学生人数: totalStudents,
      使用学期: '',
      是否必订: '',
    });

    const headers = [
      { label: '教材名称', key: '教材名称', width: 30 },
      { label: '书号', key: '书号', width: 25 },
      { label: '课程', key: '课程', width: 20 },
      { label: '使用班级', key: '使用班级', width: 25 },
      { label: '专业', key: '专业', width: 15 },
      { label: '培养层次', key: '培养层次', width: 15 },
      { label: '年级', key: '年级', width: 8 },
      { label: '学生人数', key: '学生人数', width: 10 },
      { label: '使用学期', key: '使用学期', width: 12 },
      { label: '是否必订', key: '是否必订', width: 10 },
    ];

    const workbook = await createWorkbook(headers, rows);
    const buffer = await workbookToBuffer(workbook);
    const filename = `教材使用_${textbook.title}.xlsx`;

    await createAuditLog({
      action: 'export',
      module: 'textbook',
      userId: req.user?.id,
      ip: req.ip,
      details: { textbook_id: Number(id), textbookTitle: textbook.title, rowCount: rows.length },
      result: 'success',
      message: `导出教材"${textbook.title}"使用情况，共${rows.length}条记录`,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(buffer);
  } catch (e) {
    await createAuditLog({
      action: 'export',
      module: 'textbook',
      userId: req.user?.id,
      ip: req.ip,
      details: { textbook_id: Number(req.params.id) },
      result: 'failed',
      message: `导出教材使用情况失败: ${e.message}`,
    });
    next(e);
  }
}

/**
 * 导出教师数据
 */
export async function exportTeachers(req, res, next) {
  try {
    const teachers = await batchFindMany(prisma.teachers, {
      include: {
        affiliated_college: { select: { name: true } },
        courses: { include: { course: { select: { name: true } } } },
        scheduling_colleges: { include: { college: { select: { name: true } } } },
        scheduling_levels: { include: { training_level: { select: { name: true } } } },
      },
      orderBy: { sort_order: 'asc' },
    });

    const personnelMap = { full_time: '专职', part_time: '兼职', external: '外聘' };
    const genderMap = { male: '男', female: '女' };
    const statusMap = { active: '启用', disabled: '禁用' };

    const rows = teachers.map((t) => ({
      姓名: t.name,
      性别: genderMap[t.gender] || '-',
      出生年月: t.birth_date ? String(t.birth_date).substring(0, 7) : '-',
      教师资格类型: t.qualification_type || '-',
      归属学院: t.affiliated_college?.name || '-',
      人员类别: personnelMap[t.personnel_type] || t.personnel_type,
      学科: t.courses.map((tc) => tc.course.name).join('、') || '-',
      意向学院: t.scheduling_colleges.map((sc) => sc.college.name).join('、') || '-',
      意向层次: t.scheduling_levels.map((sl) => sl.training_level.name).join('、') || '-',
      特定周课时: t.default_weekly_hours != null ? t.default_weekly_hours : '-',
      状态: statusMap[t.status] || '启用',
    }));

    const headers = [
      { label: '姓名', key: '姓名', width: 15 },
      { label: '性别', key: '性别', width: 8 },
      { label: '出生年月', key: '出生年月', width: 12 },
      { label: '教师资格类型', key: '教师资格类型', width: 15 },
      { label: '归属学院', key: '归属学院', width: 15 },
      { label: '人员类别', key: '人员类别', width: 12 },
      { label: '学科', key: '学科', width: 30 },
      { label: '意向学院', key: '意向学院', width: 30 },
      { label: '意向层次', key: '意向层次', width: 20 },
      { label: '特定周课时', key: '特定周课时', width: 12 },
      { label: '状态', key: '状态', width: 8 },
    ];

    const workbook = await createWorkbook(headers, rows);
    const buffer = await workbookToBuffer(workbook);
    const filename = `教师数据_${new Date().toISOString().split('T')[0]}.xlsx`;

    await createAuditLog({
      action: 'export',
      module: 'teacher',
      userId: req.user?.id,
      ip: req.ip,
      details: { rowCount: rows.length },
      result: 'success',
      message: `导出教师数据，共${rows.length}条记录`,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(buffer);
  } catch (e) {
    await createAuditLog({
      action: 'export',
      module: 'teacher',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: `导出教师数据失败: ${e.message}`,
    });
    next(e);
  }
}

/**
 * 导出课时统计
 */
export async function exportStatistics(req, res, next) {
  try {
    const { semester, name, type, subject, college, level, affiliated_college } = req.query;
    if (!semester) {
      return res.status(400).json({ success: false, message: '请选择学期' });
    }

    const personnelMap = { full_time: '专职', part_time: '兼职', external: '外聘' };

    // M-20: 构建教师筛选条件
    const teacherWhere = {};
    if (name) teacherWhere.name = { contains: name };
    if (type) teacherWhere.personnel_type = type;
    if (affiliated_college) teacherWhere.affiliated_college_id = Number(affiliated_college);
    if (subject) {
      teacherWhere.courses = {
        some: { course: { name: { contains: subject } } },
      };
    }
    if (level) {
      teacherWhere.scheduling_levels = {
        some: { training_level_id: Number(level) },
      };
    }

    // 按教师聚合统计（M-20: 支持筛选条件）
    const assignmentWhere = { semester };
    if (college) {
      assignmentWhere.class = { college_id: Number(college) };
    }
    if (Object.keys(teacherWhere).length > 0) {
      assignmentWhere.teacher = teacherWhere;
    }

    const stats = await prisma.teaching_assignments.groupBy({
      by: ['teacher_id'],
      where: assignmentWhere,
      _sum: { weekly_hours: true },
      _count: { id: true },
    });

    const teacherIds = stats.map((s) => s.teacher_id);
    const teachers = await batchFindMany(prisma.teachers, {
      where: { id: { in: teacherIds } },
      include: {
        courses: { include: { course: { select: { name: true } } } },
        scheduling_colleges: { include: { college: { select: { name: true } } } },
        affiliated_college: { select: { name: true } },
      },
      orderBy: { id: 'asc' },
    });
    const teacherMap = new Map(teachers.map((t) => [t.id, t]));

    // 获取每个教师的安排明细（含班级学院信息，用于推导任课学院；分批加载防止 OOM）
    const allAssignments = await batchFindMany(prisma.teaching_assignments, {
      where: { semester, teacher_id: { in: teacherIds } },
      include: {
        class: {
          select: {
            name: true,
            colleges: { select: { id: true, name: true } },
            training_levels: { select: { name: true } },
          },
        },
        course: { select: { name: true } },
      },
      orderBy: [{ teacher_id: 'asc' }, { course_id: 'asc' }],
    });

    const assignmentsByTeacher = new Map();
    for (const a of allAssignments) {
      if (!assignmentsByTeacher.has(a.teacher_id)) {
        assignmentsByTeacher.set(a.teacher_id, []);
      }
      assignmentsByTeacher.get(a.teacher_id).push(a);
    }

    const rows = [];
    for (const s of stats) {
      const teacher = teacherMap.get(s.teacher_id);
      const assignments = assignmentsByTeacher.get(s.teacher_id) || [];
      const totalHours = s._sum.weekly_hours || 0;
      const classCount = s._count.id || 0;

      // 按课程分组
      const byCourse = new Map();
      for (const a of assignments) {
        if (!byCourse.has(a.course_id)) {
          byCourse.set(a.course_id, { course: a.course.name, classes: [], hours: 0 });
        }
        const g = byCourse.get(a.course_id);
        g.classes.push(a.class.name);
        g.hours += a.weekly_hours;
      }

      const courseDetail = Array.from(byCourse.values())
        .map((g) => `${g.course}(${g.hours}课时/${g.classes.length}班)`)
        .join('、');

      // 从实际授课班级中提取任课学院（与前端 getStatistics 逻辑一致）
      const collegeMap = new Map();
      const levelSet = new Set();
      for (const a of assignments) {
        if (a.class.colleges && !collegeMap.has(a.class.colleges.id)) {
          collegeMap.set(a.class.colleges.id, a.class.colleges);
        }
        if (a.class.training_levels?.name) {
          levelSet.add(a.class.training_levels.name);
        }
      }
      const teachingColleges = [...collegeMap.values()].map((c) => c.name).join('、') || '-';
      const trainingLevels = [...levelSet].join('、') || '-';

      rows.push({
        姓名: teacher?.name || '未知',
        人员类别: personnelMap[teacher?.personnel_type] || '-',
        任教科目: teacher?.courses.map((tc) => tc.course.name).join('、') || '-',
        归属学院: teacher?.affiliated_college?.name || '-',
        任课层次: trainingLevels,
        任课学院: teachingColleges,
        班级数: classCount,
        总周课时: totalHours,
        课程明细: courseDetail || '-',
      });
    }

    // 按总课时降序
    rows.sort((a, b) => b['总周课时'] - a['总周课时']);

    // 合计行
    const totalTeachers = rows.length;
    const totalWeeklyHours = rows.reduce((sum, r) => sum + r['总周课时'], 0);
    const totalClasses = rows.reduce((sum, r) => sum + r['班级数'], 0);
    rows.push({
      姓名: '合计',
      人员类别: '',
      任教科目: '',
      归属学院: '',
      任课层次: '',
      任课学院: '',
      班级数: totalClasses,
      总周课时: totalWeeklyHours,
      课程明细: `${totalTeachers}位教师`,
    });

    const headers = [
      { label: '姓名', key: '姓名', width: 12 },
      { label: '人员类别', key: '人员类别', width: 10 },
      { label: '任教科目', key: '任教科目', width: 25 },
      { label: '归属学院', key: '归属学院', width: 18 },
      { label: '任课层次', key: '任课层次', width: 15 },
      { label: '任课学院', key: '任课学院', width: 25 },
      { label: '班级数', key: '班级数', width: 10 },
      { label: '总周课时', key: '总周课时', width: 10 },
      { label: '课程明细', key: '课程明细', width: 50 },
    ];

    const workbook = await createWorkbook(headers, rows);
    const buffer = await workbookToBuffer(workbook);
    const filename = `课时统计_${semester}.xlsx`;

    await createAuditLog({
      action: 'export',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: { semester, rowCount: rows.length },
      result: 'success',
      message: `导出课时统计(${semester})，共${rows.length}条记录`,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(buffer);
  } catch (e) {
    await createAuditLog({
      action: 'export',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: `导出课时统计失败: ${e.message}`,
    });
    next(e);
  }
}

/**
 * 导出教学安排数据（某课程某学期的班级-教师安排表）
 */
export async function exportTeachingArrange(req, res, next) {
  try {
    const { course_id, semester, college, major, training_level, grade, textbook } = req.query;
    if (!course_id || !semester) {
      return res.status(400).json({ success: false, message: '缺少课程或学期参数' });
    }

    const personnelMap = { full_time: '专职', part_time: '兼职', external: '外聘' };

    // 获取课程信息
    const course = await prisma.courses.findUnique({ where: { id: Number(course_id) } });
    if (!course) return res.status(404).json({ success: false, message: '课程不存在' });

    // 构建筛选条件
    const filters = {};
    if (college) filters.college = college;
    if (major) filters.major = major;
    if (training_level) filters.training_level = training_level;
    if (grade) filters.grade = grade;

    // 获取班级列表（含课时、学院等信息）
    const classes = await getClassesWithCourse(course_id, semester, filters);

    // 获取教学安排
    const assignments = await prisma.teaching_assignments.findMany({
      where: { course_id: Number(course_id), semester },
      include: {
        teacher: { select: { id: true, name: true, personnel_type: true } },
      },
    });
    const assignmentMap = new Map(assignments.map((a) => [a.class_id, a]));

    // 过滤班级数据（包括教材筛选）
    let filteredClasses = classes;
    if (textbook) {
      filteredClasses = classes.filter((c) => c.textbooks?.some((tb) => tb.title === textbook));
    }

    const rows = filteredClasses.map((c) => {
      const a = assignmentMap.get(c.classId);
      const textbookNames = c.textbooks?.map((tb) => tb.title).join('、') || '-';
      return {
        班级名称: c.className,
        学院: c.collegeName || '-',
        专业: c.majorName || '-',
        培养层次: c.trainingLevelName || '-',
        入学年份: c.enrollmentYear,
        年级: c.grade,
        在读学期: `第${c.currentSemester}学期`,
        人数: Number(c.studentCount) || 0,
        周课时: c.weeklyHours,
        教材: textbookNames,
        任课教师: a?.teacher?.name || '未安排',
        安排方式: a ? (a.is_auto ? '自动' : '手动') : '-',
      };
    });

    // 合计行
    const totalHours = rows.reduce((sum, r) => sum + r['周课时'], 0);
    const totalStudents = rows.reduce((sum, r) => sum + r['人数'], 0);
    const assignedCount = rows.filter((r) => r['任课教师'] !== '未安排').length;

    const headers = [
      { label: '班级名称', key: '班级名称', width: 25 },
      { label: '学院', key: '学院', width: 15 },
      { label: '专业', key: '专业', width: 15 },
      { label: '培养层次', key: '培养层次', width: 12 },
      { label: '入学年份', key: '入学年份', width: 10 },
      { label: '年级', key: '年级', width: 8 },
      { label: '在读学期', key: '在读学期', width: 10 },
      { label: '人数', key: '人数', width: 8 },
      { label: '周课时', key: '周课时', width: 8 },
      { label: '教材', key: '教材', width: 30 },
      { label: '任课教师', key: '任课教师', width: 12 },
      { label: '安排方式', key: '安排方式', width: 10 },
    ];

    const workbook = await createWorkbook(headers, rows);
    const buffer = await workbookToBuffer(workbook);
    const filename = `教学安排_${course.name}_${semester}.xlsx`;

    await createAuditLog({
      action: 'export',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: {
        course_id: Number(course_id),
        course_name: course.name,
        semester,
        rowCount: rows.length,
      },
      result: 'success',
      message: `导出教学安排(${course.name}, ${semester})，共${rows.length}条记录`,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(buffer);
  } catch (e) {
    await createAuditLog({
      action: 'export',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: `导出教学安排失败: ${e.message}`,
    });
    next(e);
  }
}
