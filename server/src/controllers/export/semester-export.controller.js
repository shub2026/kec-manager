import { prisma } from '../../lib/prisma.js';
import { createWorkbook, workbookToBuffer } from '../../utils/excel.js';
import {
  getCurrentSemesterInfo,
  getSemesterInfoFromRequest,
} from '../../services/settings.service.js';
import { createAuditLog } from '../../services/audit.service.js';
import { getActiveClassFilter } from '../../services/class.service.js';
import {
  calcClassSemester,
  buildConsecutiveTextbookMap,
  parseSemester,
} from '../../services/semester.service.js';
import { findBestMatchPlan, buildClassWithPlanFilter } from '../../services/plan.service.js';
import {
  buildCombinationMemberMap,
  formatPartnerNames,
} from '../../services/class-combination.service.js';

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
 * 开课导出核心逻辑：查询班级 + 构建导出行数据
 * @param {object} semesterInfo - 学期信息
 * @param {object} filters - 筛选条件 { college_id, major_id, training_level_id, enrollment_year, grade }
 * @returns {Promise<{rows: Array, totalClasses: number}>}
 */
async function buildSemesterExportData(semesterInfo, filters) {
  const planFilter = await buildClassWithPlanFilter();
  // 传入查询学期，避免学期错位（替代全局学期）
  const activeFilter = await getActiveClassFilter(semesterInfo);

  const baseWhere = {
    AND: [activeFilter, planFilter],
  };

  const userFilters = {};
  if (filters.college_id) userFilters.college_id = Number(filters.college_id);
  if (filters.major_id) userFilters.major_id = Number(filters.major_id);
  if (filters.training_level_id) userFilters.training_level_id = Number(filters.training_level_id);
  if (filters.enrollment_year) userFilters.enrollment_year = Number(filters.enrollment_year);

  const whereCondition =
    Object.keys(userFilters).length > 0 ? { AND: [baseWhere, userFilters] } : baseWhere;

  // 分批加载班级数据（含培养方案深嵌套，数据量大时防止 OOM）
  const classes = await batchFindMany(prisma.classes, {
    where: whereCondition,
    include: {
      majors: true,
      colleges: true,
      training_levels: true,
      training_plans: {
        include: {
          plan_courses: {
            include: {
              courses: true,
              plan_course_semesters: {
                include: {
                  plan_textbooks: { include: { textbooks: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { enrollment_year: 'desc' },
  });

  // 预加载方案映射
  const majorPlanIds = new Set();
  const levelPlanIds = new Set();
  const classPlanMap = new Map();

  for (const cls of classes) {
    const gradeCalc = semesterInfo.startYear - cls.enrollment_year + 1;
    if (gradeCalc < 1 || gradeCalc > cls.duration_years) continue;
    if (cls.custom_plan_id) {
      classPlanMap.set(cls.id, cls.training_plans);
    } else {
      if (cls.major_id) majorPlanIds.add(cls.major_id);
      if (cls.training_level_id) levelPlanIds.add(cls.training_level_id);
    }
  }

  // B-16 设计说明：matchingPlans 的 OR 条件未包含 customPlanIds，
  // 因为自定义方案已通过班级 include（training_plans）加载到 classPlanMap 中，
  // findBestMatchPlan 会优先从 classPlanMap 查找自定义方案，无需重复查询。
  const matchingPlans = await prisma.training_plans.findMany({
    where: {
      OR: [
        { major_id: { in: [...majorPlanIds] } },
        { training_level_id: { in: [...levelPlanIds] } },
      ],
    },
    include: {
      plan_courses: {
        include: {
          courses: true,
          plan_course_semesters: {
            include: {
              plan_textbooks: { include: { textbooks: true } },
            },
          },
        },
      },
    },
  });

  // 构建连续使用教材检测集合
  const textbookRecords = [];
  const seenPlanIds = new Set();
  const collectTextbooks = (plans) => {
    for (const plan of plans) {
      if (seenPlanIds.has(plan.id)) continue;
      seenPlanIds.add(plan.id);
      for (const pc of plan.plan_courses || []) {
        for (const pcs of pc.plan_course_semesters || []) {
          for (const pt of pcs.plan_textbooks || []) {
            textbookRecords.push({
              plan_course_id: pcs.plan_course_id,
              textbook_id: pt.textbook_id,
              semester: pcs.semester,
            });
          }
        }
      }
    }
  };
  collectTextbooks(matchingPlans);
  for (const cls of classes) {
    if (cls.training_plans) collectTextbooks([cls.training_plans]);
  }
  const consecutiveMap = await buildConsecutiveTextbookMap(textbookRecords);

  // 预加载合班成员映射，用于导出合班伙伴名称
  const combinationIds = classes.map((c) => c.combination_id).filter((id) => id != null);
  const combinationMemberMap = await buildCombinationMemberMap(combinationIds);

  // 构建导出行
  const rows = [];
  const grade = filters.grade;

  for (const cls of classes) {
    const calc = calcClassSemester(cls, semesterInfo);
    if (!calc) continue;
    if (grade && calc.grade !== Number(grade)) continue;

    const currentSemesterNum = calc.currentSemesterNum;
    const plan = findBestMatchPlan(cls, matchingPlans, classPlanMap);
    if (!plan) continue;

    const allPlanCourses = plan.plan_courses.filter(
      (pc) => pc.start_semester <= currentSemesterNum && pc.end_semester >= currentSemesterNum
    );

    // 过滤掉周课时为 0 的课程（本学期暂不开课）
    const planCourses = allPlanCourses.filter((pc) => {
      const semRecord = pc.plan_course_semesters?.find((s) => s.semester === currentSemesterNum);
      const wh = semRecord?.weekly_hours ?? pc.weekly_hours;
      return wh > 0;
    });

    // 计算班级级别的聚合数据（开课数、周课时合计）
    const courseCount = planCourses.length;
    let totalWeeklyHours = 0;
    for (const pc of planCourses) {
      const semRecord = pc.plan_course_semesters?.find((s) => s.semester === currentSemesterNum);
      totalWeeklyHours += semRecord?.weekly_hours ?? pc.weekly_hours;
    }

    // 合班伙伴名称（不含自身）
    const members = combinationMemberMap.get(cls.combination_id) || [];
    const partnerClasses = members.filter((m) => m.id !== cls.id);
    const combinationText =
      cls.combination_id != null ? formatPartnerNames(partnerClasses) || '是' : '';

    const baseRow = {
      班级名称: cls.name,
      二级学院: cls.colleges?.name || '-',
      专业: cls.majors?.name || '-',
      培养层次: cls.training_levels?.name || '-',
      入学年份: cls.enrollment_year,
      年级: calc.grade,
      在读学期: `第${currentSemesterNum}学期`,
      学生人数: Number(cls.student_count) || 0,
      开课数: courseCount,
      周课时合计: totalWeeklyHours,
      培养方案: plan.name || '-',
      合班教学: combinationText,
    };

    if (planCourses.length === 0) {
      // 修复B：本学期无有效课程的班级也输出一行（课程明细为空），
      // 与开课查询口径保持一致，使导出包含全部在读+有方案班级
      rows.push({
        ...baseRow,
        课程: '无',
        课程类型: '-',
        周课时: 0,
        学期总课时: 0,
        教材名称: '未指定',
        书号: '-',
        征订情况: '-',
      });
    } else {
      for (const pc of planCourses) {
        const semRecord = pc.plan_course_semesters?.find((s) => s.semester === currentSemesterNum);
        const textbooks = semRecord?.plan_textbooks || [];
        const weeklyHours = semRecord?.weekly_hours ?? pc.weekly_hours;
        const weeksCount = semRecord?.weeks_count ?? pc.weeks_per_semester;

        // 拆分教材名称和征订情况为独立列
        const textbookNames = textbooks.map((pt) => pt.textbooks.title);
        const textbookStatuses = textbooks.map((pt) => {
          const isConsecutive =
            consecutiveMap.get(`${pc.id}_${pt.textbook_id}`)?.has(semRecord?.semester) ?? false;
          return isConsecutive ? '选定' : pt.is_required ? '必订' : '选修';
        });

        rows.push({
          ...baseRow,
          课程: pc.courses.name,
          课程类型: pc.courses.type === 'public' ? '公共基础课' : '专业课',
          周课时: weeklyHours,
          学期总课时: weeklyHours * weeksCount,
          教材名称: textbookNames.join('、') || '未指定',
          书号: textbooks.map((pt) => pt.textbooks.isbn || '-').join('、') || '-',
          征订情况: textbookStatuses.join('、') || '-',
        });
      }
    }
  }

  return { rows, totalClasses: rows.length };
}

const EXPORT_HEADERS = [
  { label: '班级名称', key: '班级名称', width: 25 },
  { label: '二级学院', key: '二级学院', width: 15 },
  { label: '专业', key: '专业', width: 15 },
  { label: '培养层次', key: '培养层次', width: 12 },
  { label: '入学年份', key: '入学年份', width: 12 },
  { label: '年级', key: '年级', width: 8 },
  { label: '在读学期', key: '在读学期', width: 10 },
  { label: '学生人数', key: '学生人数', width: 10 },
  { label: '开课数', key: '开课数', width: 8 },
  { label: '周课时合计', key: '周课时合计', width: 10 },
  { label: '培养方案', key: '培养方案', width: 30 },
  { label: '课程', key: '课程', width: 20 },
  { label: '课程类型', key: '课程类型', width: 12 },
  { label: '周课时', key: '周课时', width: 8 },
  { label: '学期总课时', key: '学期总课时', width: 12 },
  { label: '教材名称', key: '教材名称', width: 30 },
  { label: '书号', key: '书号', width: 25 },
  { label: '征订情况', key: '征订情况', width: 15 },
  { label: '合班教学', key: '合班教学', width: 25 },
];

/**
 * 发送导出响应
 */
async function sendExportResponse(res, req, semesterInfo, rows) {
  const workbook = await createWorkbook(EXPORT_HEADERS, rows);
  const buffer = await workbookToBuffer(workbook);
  const filename = `开课情况_${semesterInfo.label}.xlsx`;

  await createAuditLog({
    action: 'export',
    module: 'system',
    userId: req.user?.id,
    ip: req.ip,
    details: { semester: semesterInfo.label, rowCount: rows.length },
    result: 'success',
    message: `导出${semesterInfo.label}开课情况，共${rows.length}条记录`,
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
}

/**
 * GET /api/export/semester - 导出当前学期开课情况
 */
export async function exportSemesterSchedule(req, res, next) {
  try {
    let semesterInfo = await getSemesterInfoFromRequest(req);

    if (!semesterInfo) {
      const { semester } = req.query;
      if (semester) {
        return res.status(400).json({ success: false, message: '学期格式错误，应为 YYYY-YYYY-N' });
      } else {
        return res.status(400).json({ success: false, message: '请先设置当前学期' });
      }
    }

    // 中间件已将 camelCase query 转为 snake_case
    const { college_id, major_id, training_level_id, enrollment_year, grade } = req.query;
    const filters = {
      college_id,
      major_id,
      training_level_id,
      enrollment_year,
      grade,
    };

    const { rows } = await buildSemesterExportData(semesterInfo, filters);
    await sendExportResponse(res, req, semesterInfo, rows);
  } catch (e) {
    await createAuditLog({
      action: 'export',
      module: 'system',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: `导出开课情况失败: ${e.message}`,
    });
    next(e);
  }
}

/**
 * POST /api/export/semester - 导出开课情况（避免token暴露在URL中）
 */
export async function exportSemesterSchedulePost(req, res, next) {
  try {
    // req.body 已被命名中间件转为 snake_case，semester 单词不变
    const { college_id, major_id, training_level_id, enrollment_year, grade, semester } = req.body;

    // 支持历史学期导出：优先使用传入的 semester，否则使用全局当前学期
    let semesterInfo;
    if (semester) {
      // 统一使用 semester.service.js#parseSemester（替代 deprecated 的 parseSemesterString）
      semesterInfo = parseSemester(semester);
      if (!semesterInfo) {
        return res.status(400).json({ success: false, message: '学期格式错误，应为 YYYY-YYYY-N' });
      }
    } else {
      semesterInfo = await getCurrentSemesterInfo();
      if (!semesterInfo) {
        return res.status(400).json({ success: false, message: '请先设置当前学期' });
      }
    }

    const filters = { college_id, major_id, training_level_id, enrollment_year, grade };
    const { rows } = await buildSemesterExportData(semesterInfo, filters);
    await sendExportResponse(res, req, semesterInfo, rows);
  } catch (e) {
    await createAuditLog({
      action: 'export',
      module: 'system',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      message: `导出开课情况失败(POST): ${e.message}`,
    });
    next(e);
  }
}
