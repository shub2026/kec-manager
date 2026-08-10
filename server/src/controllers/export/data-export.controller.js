import { prisma } from '../../lib/prisma.js';
import { success } from '../../utils/response.js';
import { createWorkbook, workbookToBuffer } from '../../utils/excel.js';
import {
  getSemesterInfoFromRequest,
  getCurrentSemesterInfo,
} from '../../services/settings.service.js';
import { createAuditLog } from '../../services/audit.service.js';
import { getActiveClassFilter } from '../../services/class.service.js';
import {
  calcClassSemester,
  buildConsecutiveTextbookMap,
  parseSemester,
} from '../../services/semester.service.js';
import { isClassMatchPlan, findBestMatchPlan } from '../../services/plan.service.js';
import { buildClassFilter } from '../../services/class-filter.service.js';
import { getClassesWithCourse } from '../../services/teaching-arrange.service.js';
import {
  buildCombinationMemberMap,
  formatPartnerNames,
} from '../../services/class-combination.service.js';
import {
  dedupeTeachingUnits,
  isCombinedUnit,
  resolveClassCourseTextbooks,
} from '../../services/teaching-statistics.service.js';

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
      课程编码: course.code || '',
      课程类型: course.type === 'public' ? '公共课' : '专业课',
      描述: course.description || '',
    }));

    const headers = [
      { label: '课程名称', key: '课程名称', width: 30 },
      { label: '课程编码', key: '课程编码', width: 20 },
      { label: '课程类型', key: '课程类型', width: 15 },
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
      书号: textbook.isbn || '',
      出版社: textbook.publisher || '',
      作者: textbook.author || '',
      版次: textbook.edition || '',
      出版日期: textbook.publish_date || '',
      定价: textbook.price || '',
      类别: textbook.category || '',
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
    // 注意：必须 select created_at，findBestMatchPlan 按 created_at 降序排序以保证多匹配时取最新方案的确定性
    const allPlans = await prisma.training_plans.findMany({
      select: {
        id: true,
        name: true,
        major_id: true,
        training_level_id: true,
        created_at: true,
      },
    });

    // 获取学期信息用于计算年级
    const semesterInfo = await getCurrentSemesterInfo();

    // 构建自定义方案映射表（与 queries.js / assignTeacher 口径一致），
    // 供 findBestMatchPlan 优先匹配 custom_plan_id
    const classPlanMap = new Map();
    for (const cls of classes) {
      if (cls.custom_plan_id) {
        const customPlan = allPlans.find((p) => p.id === cls.custom_plan_id);
        if (customPlan) classPlanMap.set(cls.id, customPlan);
      }
    }

    // 预加载合班成员映射，用于导出合班伙伴名称
    const combinationIds = classes.map((c) => c.combination_id).filter((id) => id != null);
    const combinationMemberMap = await buildCombinationMemberMap(combinationIds);

    const rows = classes.map((cls) => {
      // 计算匹配的培养方案名称（与前端逻辑一致）
      let matchedPlanName = null;
      if (cls.custom_plan_id && cls.training_plans) {
        // 有自定义方案
        matchedPlanName = cls.training_plans.name;
      } else {
        // C2 修复：使用 findBestMatchPlan 选定最佳方案（major > level 优先级，与排课/列表一致）
        const matchedPlan = findBestMatchPlan(cls, allPlans, classPlanMap);
        if (matchedPlan) {
          matchedPlanName = matchedPlan.name;
        }
      }

      // 统一使用 calcClassSemester 计算年级（含越界检查与 duration_years<=0 防御）
      // 替代内联公式，与排课/查询口径一致
      const calc = semesterInfo ? calcClassSemester(cls, semesterInfo) : null;
      const grade = calc ? calc.grade : null;

      // 确定关联类型
      let relationType = '未关联';
      if (cls.custom_plan_id) {
        relationType = '自定义';
      } else if (cls.major_id) {
        relationType = '专业';
      } else if (cls.training_level_id) {
        relationType = '层次';
      }

      // 确定状态文本：基于 calcClassSemester 结果判断在读/已毕业
      let statusText;
      if (cls.is_left_school) {
        statusText = '离校';
      } else if (calc) {
        // calc 非 null 表示班级在当前学期处于在读年级范围内
        statusText = '在读';
      } else if (cls.enrollment_year && cls.duration_years) {
        // calc 为 null 但字段完整：可能是已毕业或未入学
        // P2 修复：通过入学年份和当前学期起始年判断年级，区分两种状态
        const estimatedGrade = semesterInfo
          ? semesterInfo.startYear - cls.enrollment_year + 1
          : null;
        if (estimatedGrade !== null && estimatedGrade < 1) {
          statusText = '未入学';
        } else {
          statusText = '已毕业';
        }
      } else {
        // 数据不完整，无法判断
        statusText = '未知';
      }

      // 合班伙伴名称（不含自身）
      const members = combinationMemberMap.get(cls.combination_id) || [];
      const partnerClasses = members.filter((m) => m.id !== cls.id);
      const combinationText =
        cls.combination_id != null ? formatPartnerNames(partnerClasses) || '是' : '';

      return {
        班级名称: cls.name,
        二级学院: cls.colleges?.name || '',
        专业类别: cls.majors?.name || '',
        培养层次: cls.training_levels?.name || '',
        入学年份: cls.enrollment_year,
        '学制(年)': cls.duration_years,
        班级人数: Number(cls.student_count) || 0,
        年级: grade ? `${grade}年级` : '-',
        状态: statusText,
        关联类型: relationType,
        当前方案: matchedPlanName || '-',
        合班教学: combinationText,
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
      { label: '合班教学', key: '合班教学', width: 25 },
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

// 教材使用导出表头（11 列，顺序须与前端教材查询表格列展示顺序严格一致）
const TEXTBOOK_USAGE_HEADERS = [
  { label: '教材名称', key: '教材名称', width: 30 },
  { label: '书号', key: '书号', width: 25 },
  { label: '使用班级', key: '使用班级', width: 25 },
  { label: '学院', key: '学院', width: 15 },
  { label: '专业', key: '专业', width: 15 },
  { label: '培养层次', key: '培养层次', width: 15 },
  { label: '年级', key: '年级', width: 8 },
  { label: '课程', key: '课程', width: 20 },
  { label: '学生人数', key: '学生人数', width: 10 },
  { label: '使用学期', key: '使用学期', width: 12 },
  { label: '是否必订', key: '是否必订', width: 10 },
];

// 教材 → 培养方案课程学期 关联 include（单教材与全部教材模式共用）
const TEXTBOOK_PLAN_INCLUDE = {
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
};

/**
 * 拼装单本教材的使用情况数据行（不含合计行，单教材与全部教材模式复用）
 * 统计口径与查询接口 queryTextbookUsage 保持一致：
 * - 授课范围边界：教材学期必须落在方案课程 start/end_semester 内
 * - 去重键：(class_id, course_id)，同一班级同一课程仅计一次（B-14 同源）
 * @param {object} textbook - 教材记录（含 plan_textbooks 关联）
 * @param {Array<object>} allClasses - 在读班级列表
 * @param {object} semesterInfo - 查询学期信息
 * @param {Map} consecutiveMap - 选定（连续使用）教材映射
 * @returns {Array<object>} 11 列导出行
 */
function buildTextbookUsageRows(textbook, allClasses, semesterInfo, consecutiveMap) {
  const rows = [];
  // 审计修复：去重集合，防止同一班级因匹配多个方案而被重复计数
  const addedClassCoursePairs = new Set();

  for (const pt of textbook.plan_textbooks) {
    const sem = pt.plan_course_semesters;
    const pc = sem.plan_courses;
    const plan = pc.training_plans;
    // 与查询接口一致：教材学期超出方案课程授课范围时跳过
    if (sem.semester < pc.start_semester || sem.semester > pc.end_semester) continue;
    const isConsecutive =
      consecutiveMap.get(`${pc.id}_${pt.textbook_id}`)?.has(sem.semester) ?? false;

    for (const cls of allClasses) {
      // 复用统一 calcClassSemester（含越界检查），替代无边界检查的内联副本
      const calc = calcClassSemester(cls, semesterInfo);
      if (!calc) continue;
      if (calc.currentSemesterNum !== sem.semester) continue;

      if (!isClassMatchPlan(cls, plan)) continue;

      // 与查询接口 B-14 同口径：按 (class_id, course_id) 去重，
      // 防止同一班级匹配多个方案时同一课程重复计行（pc.id 跨方案不同，不能作去重键）
      const pairKey = `${cls.id}_${pc.course_id}`;
      if (addedClassCoursePairs.has(pairKey)) continue;
      addedClassCoursePairs.add(pairKey);

      rows.push({
        教材名称: textbook.title,
        书号: textbook.isbn || '-',
        使用班级: cls.name,
        学院: cls.colleges?.name || '-',
        专业: cls.majors?.name || '-',
        培养层次: cls.training_levels?.name || '-',
        年级: calc.grade,
        课程: pc.courses.name,
        学生人数: Number(cls.student_count) || 0,
        使用学期: `第${sem.semester}学期`,
        是否必订: isConsecutive ? '否' : pt.is_required ? '是' : '否',
      });
    }
  }

  return rows;
}

/**
 * 拼装合计行（B-15 注意：必须在数据行全部就绪后调用，避免合计包含自身）
 * @param {Array<object>} rows - 已拼装完成的数据行
 * @param {string} classesText - 使用班级列的合计文案
 * @returns {object} 合计行
 */
function buildTextbookUsageSummaryRow(rows, classesText) {
  const totalStudents = rows.reduce((sum, r) => sum + (Number(r['学生人数']) || 0), 0);
  return {
    教材名称: '合计',
    书号: '',
    使用班级: classesText,
    学院: '',
    专业: '',
    培养层次: '',
    年级: '',
    课程: '',
    学生人数: totalStudents,
    使用学期: '',
    是否必订: '',
  };
}

/**
 * 导出教材使用情况
 * req.params.id 传入时导出单本教材（/export/textbook/:id），
 * 缺省时导出全部启用教材（/export/textbook-usage，与教材查询页下拉口径一致）
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

    let rows;
    let filename;
    let auditDetails;
    let auditMessage;

    if (id) {
      // ── 单教材模式 ──
      const [textbook, allClasses] = await Promise.all([
        prisma.textbooks.findUnique({
          where: { id: Number(id) },
          include: TEXTBOOK_PLAN_INCLUDE,
        }),
        batchFindMany(prisma.classes, {
          where: activeFilter,
          include: { colleges: true, majors: true, training_levels: true },
          orderBy: { id: 'asc' },
        }),
      ]);

      if (!textbook) return res.status(404).json({ success: false, message: '教材不存在' });

      const consecutiveMap = await buildConsecutiveTextbookMap(
        textbook.plan_textbooks.map((pt) => ({
          plan_course_id: pt.plan_course_semesters.plan_course_id,
          textbook_id: pt.textbook_id,
          semester: pt.plan_course_semesters.semester,
        }))
      );

      rows = buildTextbookUsageRows(textbook, allClasses, semesterInfo, consecutiveMap);
      rows.push(buildTextbookUsageSummaryRow(rows, `${rows.length}个班级`));

      filename = `教材使用_${textbook.title}.xlsx`;
      auditDetails = {
        textbook_id: Number(id),
        textbookTitle: textbook.title,
        rowCount: rows.length,
      };
      auditMessage = `导出教材"${textbook.title}"使用情况，共${rows.length}条记录`;
    } else {
      // ── 全部教材模式：仅导出启用教材（与教材查询页下拉口径一致） ──
      const [textbooks, allClasses] = await Promise.all([
        prisma.textbooks.findMany({
          where: { is_active: true },
          include: TEXTBOOK_PLAN_INCLUDE,
          orderBy: { sort_order: 'asc' },
        }),
        batchFindMany(prisma.classes, {
          where: activeFilter,
          include: { colleges: true, majors: true, training_levels: true },
          orderBy: { id: 'asc' },
        }),
      ]);

      // 一次性构建全部教材的选定映射（key 含 textbook_id，跨教材合并无冲突）
      const consecutiveMap = await buildConsecutiveTextbookMap(
        textbooks.flatMap((tb) =>
          tb.plan_textbooks.map((pt) => ({
            plan_course_id: pt.plan_course_semesters.plan_course_id,
            textbook_id: pt.textbook_id,
            semester: pt.plan_course_semesters.semester,
          }))
        )
      );

      rows = [];
      for (const textbook of textbooks) {
        rows.push(...buildTextbookUsageRows(textbook, allClasses, semesterInfo, consecutiveMap));
      }
      // 全部教材模式下同一班级可能出现在多本教材中，合计文案按记录数口径
      rows.push(buildTextbookUsageSummaryRow(rows, `${rows.length}条记录`));

      filename = `教材使用_全部教材_${semesterInfo.raw}.xlsx`;
      auditDetails = {
        scope: 'all',
        semester: semesterInfo.raw,
        textbookCount: textbooks.length,
        rowCount: rows.length,
      };
      auditMessage = `导出教材使用(全部教材, ${semesterInfo.raw})，共${rows.length}条记录`;
    }

    const workbook = await createWorkbook(TEXTBOOK_USAGE_HEADERS, rows);
    const buffer = await workbookToBuffer(workbook);

    await createAuditLog({
      action: 'export',
      module: 'textbook',
      userId: req.user?.id,
      ip: req.ip,
      details: auditDetails,
      result: 'success',
      message: auditMessage,
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
      details: req.params.id ? { textbook_id: Number(req.params.id) } : { scope: 'all' },
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
      教师姓名: t.name,
      性别: genderMap[t.gender] || '-',
      出生年月: t.birth_date ? String(t.birth_date).substring(0, 7) : '-',
      教师资格类型: t.qualification_type || '-',
      归属学院: t.affiliated_college?.name || '-',
      人员类别: personnelMap[t.personnel_type] || t.personnel_type,
      学科: t.courses.map((tc) => tc.course.name).join('、') || '-',
      任课学院: t.scheduling_colleges.map((sc) => sc.college.name).join('、') || '-',
      任课层次: t.scheduling_levels.map((sl) => sl.training_level.name).join('、') || '-',
      自定义课时: t.default_weekly_hours != null ? t.default_weekly_hours : '-',
      状态: statusMap[t.status] || '启用',
    }));

    const headers = [
      { label: '教师姓名', key: '教师姓名', width: 15 },
      { label: '性别', key: '性别', width: 8 },
      { label: '出生年月', key: '出生年月', width: 12 },
      { label: '教师资格类型', key: '教师资格类型', width: 15 },
      { label: '归属学院', key: '归属学院', width: 15 },
      { label: '人员类别', key: '人员类别', width: 12 },
      { label: '学科', key: '学科', width: 30 },
      { label: '任课学院', key: '任课学院', width: 30 },
      { label: '任课层次', key: '任课层次', width: 20 },
      { label: '自定义课时', key: '自定义课时', width: 12 },
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

    // 与统计页 getStatistics 完全同口径取数：仅在职教师、排除 0 课时安排
    // （筛选不下推 DB：前端筛选器传的是名称文本，改为下方内存中按名称过滤，语义与页面 filteredTeachers 一致）
    const allAssignments = await batchFindMany(prisma.teaching_assignments, {
      where: { semester, teacher: { status: 'active' }, weekly_hours: { gt: 0 } },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            combination_id: true,
            college_id: true,
            major_id: true,
            training_level_id: true,
            custom_plan_id: true,
            enrollment_year: true,
            duration_years: true,
            colleges: { select: { id: true, name: true } },
            training_levels: { select: { name: true } },
          },
        },
        course: { select: { name: true } },
      },
      orderBy: [{ teacher_id: 'asc' }, { course_id: 'asc' }],
    });

    // 合班去重：将成员班行归并为逻辑教学单元，避免课时/班级数虚高
    const allUnits = dedupeTeachingUnits(allAssignments);

    // 涉及的教师（按单元代表行去重，与页面一致）
    const teacherIds = [...new Set(allUnits.map((u) => u.representative.teacher_id))];
    const teachers = await batchFindMany(prisma.teachers, {
      where: { id: { in: teacherIds }, status: 'active' },
      include: {
        courses: { include: { course: { select: { name: true } } } },
        scheduling_levels: { include: { training_level: { select: { name: true } } } },
        affiliated_college: { select: { name: true } },
      },
      orderBy: { id: 'asc' },
    });
    const teacherMap = new Map(teachers.map((t) => [t.id, t]));

    // 教材解析：与课时统计页 getStatistics 同一共享链路，用于"教材数"列
    const semesterInfo = parseSemester(semester);
    const { idsMap: classCourseTextbookMap } = await resolveClassCourseTextbooks(
      allAssignments,
      semesterInfo
    );

    const unitsByTeacher = new Map();
    for (const u of allUnits) {
      const tid = u.representative.teacher_id;
      if (!unitsByTeacher.has(tid)) unitsByTeacher.set(tid, []);
      unitsByTeacher.get(tid).push(u);
    }

    const rows = [];
    for (const teacherId of teacherIds) {
      const teacher = teacherMap.get(teacherId);
      const units = unitsByTeacher.get(teacherId) || [];
      let totalHours = 0;
      let classCount = 0;

      // 按课程分组（合班单元课时仅计 1 次）
      const byCourse = new Map();
      // 教材去重统计：合班取代表班，与前端"教材数"列口径一致
      const textbookIdSet = new Set();
      for (const u of units) {
        totalHours += u.weeklyHours;
        classCount += 1; // 合班=1 个逻辑教学班；非合班=1 个班级

        const unitTextbookIds =
          classCourseTextbookMap.get(
            `${u.representative.class_id}:${u.representative.course_id}`
          ) || [];
        for (const tid of unitTextbookIds) textbookIdSet.add(tid);

        const courseName = u.representative.course.name;
        if (!byCourse.has(u.representative.course_id)) {
          byCourse.set(u.representative.course_id, { course: courseName, classes: [], hours: 0 });
        }
        const g = byCourse.get(u.representative.course_id);
        const combined = isCombinedUnit(u);
        g.classes.push(
          combined
            ? u.memberClasses
                .map((c) => c?.name)
                .filter(Boolean)
                .join('、')
            : u.representative.class.name
        );
        g.hours += u.weeklyHours;
      }

      const courseDetail = Array.from(byCourse.values())
        .map((g) => `${g.course}(${g.hours}课时/${g.classes.length}班)`)
        .join('、');

      // 从实际授课班级中提取任课学院/层次（与页面 getStatistics 逻辑一致）
      const collegeMap = new Map();
      const levelSet = new Set();
      for (const u of units) {
        const c = u.representative.class;
        if (c.colleges && !collegeMap.has(c.colleges.id)) {
          collegeMap.set(c.colleges.id, c.colleges);
        }
        if (c.training_levels?.name) {
          levelSet.add(c.training_levels.name);
        }
      }
      const collegeNames = [...collegeMap.values()].map((c) => c.name);
      // 与页面一致：实际授课层次优先，为空时回退教师意向层次设置
      const levelNames =
        levelSet.size > 0
          ? [...levelSet]
          : (teacher?.scheduling_levels ?? []).map((sl) => sl.training_level?.name).filter(Boolean);
      // 实际授课课程名集合（科目筛选与前端按 details 精确匹配同语义）
      const taughtCourseNames = new Set(Array.from(byCourse.values(), (g) => g.course));

      // M-20 筛选：与前端 filteredTeachers 同语义的名称筛选（筛选器值均为名称文本，不能 Number 转 ID）
      const teacherName = teacher?.name || '未知';
      if (name && !teacherName.includes(name)) continue;
      if (type && teacher?.personnel_type !== type) continue;
      if (subject && !taughtCourseNames.has(subject)) continue;
      if (college && !collegeNames.includes(college)) continue;
      if (level && !levelNames.includes(level)) continue;
      if (affiliated_college && teacher?.affiliated_college?.name !== affiliated_college) continue;

      rows.push({
        姓名: teacherName,
        归属学院: teacher?.affiliated_college?.name || '-',
        人员类别: personnelMap[teacher?.personnel_type] || '-',
        任教科目: teacher?.courses.map((tc) => tc.course.name).join('、') || '-',
        任课层次: levelNames.join('、') || '-',
        任课学院: collegeNames.join('、') || '-',
        教材数: textbookIdSet.size,
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
      教材数: '',
      班级数: totalClasses,
      总周课时: totalWeeklyHours,
      课程明细: `${totalTeachers}位教师`,
    });

    const headers = [
      { label: '姓名', key: '姓名', width: 12 },
      { label: '归属学院', key: '归属学院', width: 18 },
      { label: '人员类别', key: '人员类别', width: 10 },
      { label: '任教科目', key: '任教科目', width: 25 },
      { label: '任课层次', key: '任课层次', width: 15 },
      { label: '任课学院', key: '任课学院', width: 25 },
      { label: '教材数', key: '教材数', width: 10 },
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

// 教学安排导出基础表头（13 列，顺序须与前端表格列展示顺序严格一致）
const ARRANGE_EXPORT_HEADERS = [
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
  { label: '合班教学', key: '合班教学', width: 25 },
];

/**
 * 拼装某课程的教学安排导出行（单科目与全部科目模式复用）
 * @param {object} course - 课程记录
 * @param {string} semester - 学期
 * @param {object} filters - 班级筛选条件（college/major/training_level/grade）
 * @param {string|undefined} textbook - 教材名称筛选
 * @param {Map} assignmentMap - 该课程 class_id → assignment 映射
 * @returns {Promise<Array<object>>} 13 列导出行
 */
async function buildArrangeRows(course, semester, filters, textbook, assignmentMap) {
  // 获取班级列表（含课时、学院等信息）
  const classes = await getClassesWithCourse(course.id, semester, filters);

  // 过滤班级数据（包括教材筛选）
  let filteredClasses = classes;
  if (textbook) {
    filteredClasses = classes.filter((c) => c.textbooks?.some((tb) => tb.title === textbook));
  }

  // 预加载合班成员映射，用于导出合班伙伴名称
  const combinationIds = filteredClasses.map((c) => c.combinationId).filter((id) => id != null);
  const combinationMemberMap = await buildCombinationMemberMap(combinationIds);

  return filteredClasses.map((c) => {
    const a = assignmentMap.get(c.classId);
    const textbookNames = c.textbooks?.map((tb) => tb.title).join('、') || '-';
    // 合班伙伴名称（不含自身）
    const members = combinationMemberMap.get(c.combinationId) || [];
    const partnerClasses = members.filter((m) => m.id !== c.classId);
    const combinationText =
      c.combinationId != null ? formatPartnerNames(partnerClasses) || '是' : '';
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
      合班教学: combinationText,
    };
  });
}

/**
 * 导出教学安排数据（某学期的班级-教师安排表）
 * course_id 传入时导出单科目（13 列），缺省时导出全部科目（行首增加"科目"列，14 列）
 */
export async function exportTeachingArrange(req, res, next) {
  try {
    const { course_id, semester, college, major, training_level, grade, textbook } = req.query;
    if (!semester) {
      return res.status(400).json({ success: false, message: '缺少学期参数' });
    }

    let headers;
    let rows;
    let filename;
    let auditDetails;
    let auditMessage;

    if (course_id) {
      // ── 单科目模式 ──
      const course = await prisma.courses.findUnique({ where: { id: Number(course_id) } });
      if (!course) return res.status(404).json({ success: false, message: '课程不存在' });

      // 构建筛选条件
      const filters = {};
      if (college) filters.college = college;
      if (major) filters.major = major;
      if (training_level) filters.training_level = training_level;
      if (grade) filters.grade = grade;

      // 获取教学安排
      const assignments = await prisma.teaching_assignments.findMany({
        where: { course_id: Number(course_id), semester },
        include: {
          teacher: { select: { id: true, name: true, personnel_type: true } },
        },
      });
      const assignmentMap = new Map(assignments.map((a) => [a.class_id, a]));

      rows = await buildArrangeRows(course, semester, filters, textbook, assignmentMap);
      headers = ARRANGE_EXPORT_HEADERS;
      filename = `教学安排_${course.name}_${semester}.xlsx`;
      auditDetails = {
        course_id: Number(course_id),
        course_name: course.name,
        semester,
        rowCount: rows.length,
      };
      auditMessage = `导出教学安排(${course.name}, ${semester})，共${rows.length}条记录`;
    } else {
      // ── 全部科目模式：不应用筛选条件，导出该学期全量数据 ──
      const courses = await prisma.courses.findMany({ orderBy: { id: 'asc' } });

      // 一次性查询该学期全部教学安排，按课程分组建映射，避免逐课程查询
      const assignments = await prisma.teaching_assignments.findMany({
        where: { semester },
        include: {
          teacher: { select: { id: true, name: true, personnel_type: true } },
        },
      });
      const courseAssignmentMaps = new Map();
      for (const a of assignments) {
        if (!courseAssignmentMaps.has(a.course_id)) {
          courseAssignmentMaps.set(a.course_id, new Map());
        }
        courseAssignmentMaps.get(a.course_id).set(a.class_id, a);
      }

      rows = [];
      for (const course of courses) {
        const courseRows = await buildArrangeRows(
          course,
          semester,
          {},
          undefined,
          courseAssignmentMaps.get(course.id) || new Map()
        );
        for (const row of courseRows) {
          rows.push({ 科目: course.name, ...row });
        }
      }

      headers = [{ label: '科目', key: '科目', width: 20 }, ...ARRANGE_EXPORT_HEADERS];
      filename = `教学安排_全部科目_${semester}.xlsx`;
      auditDetails = {
        scope: 'all',
        semester,
        courseCount: courses.length,
        rowCount: rows.length,
      };
      auditMessage = `导出教学安排(全部科目, ${semester})，共${rows.length}条记录`;
    }

    const workbook = await createWorkbook(headers, rows);
    const buffer = await workbookToBuffer(workbook);

    await createAuditLog({
      action: 'export',
      module: 'teachingArrange',
      userId: req.user?.id,
      ip: req.ip,
      details: auditDetails,
      result: 'success',
      message: auditMessage,
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
