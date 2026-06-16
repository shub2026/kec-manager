import { prisma } from '../../lib/prisma.js';
import { createWorkbook, workbookToBuffer } from '../../utils/excel.js';
import { getCurrentSemesterInfo, getSemesterInfoFromRequest } from '../../services/settings.service.js';
import { createAuditLog } from '../../services/audit.service.js';
import { getActiveClassFilter } from '../../services/class.service.js';
import { findBestMatchPlan } from '../../services/plan.service.js';

/**
 * 导出当前学期开课情况（GET - 支持URL参数筛选）
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

    const activeFilter = await getActiveClassFilter();
    
    const { collegeId, majorId, trainingLevelId, enrollmentYear, grade } = req.query;
    const whereConditions = [activeFilter];
    
    if (collegeId) whereConditions.push({ college_id: Number(collegeId) });
    if (majorId) whereConditions.push({ major_id: Number(majorId) });
    if (trainingLevelId) whereConditions.push({ training_level_id: Number(trainingLevelId) });
    if (enrollmentYear) whereConditions.push({ enrollment_year: Number(enrollmentYear) });
    
    const classes = await prisma.classes.findMany({
      where: { AND: whereConditions },
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
                    plan_textbooks: {
                      include: { textbooks: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { enrollment_year: 'desc' },
    });

    const majorPlanIds = new Set();
    const levelPlanIds = new Set();
    for (const cls of classes) {
      if (!cls.custom_plan_id) {
        if (cls.major_id) majorPlanIds.add(cls.major_id);
        if (cls.training_level_id) levelPlanIds.add(cls.training_level_id);
      }
    }

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

    const rows = [];

    for (const cls of classes) {
      const gradeCalc = semesterInfo.startYear - cls.enrollment_year + 1;
      
      if (grade && gradeCalc !== Number(grade)) continue;
      if (gradeCalc < 1 || gradeCalc > cls.duration_years) continue;
      const currentSemesterNum = (gradeCalc - 1) * 2 + semesterInfo.semesterIndex;

      const plan = findBestMatchPlan(cls, matchingPlans);
      if (!plan) continue;

      const planCourses = plan.plan_courses.filter(
        (pc) => pc.start_semester <= currentSemesterNum && pc.end_semester >= currentSemesterNum
      );

      if (planCourses.length === 0) {
        rows.push({
          '班级名称': cls.name, 
          '二级学院': cls.colleges?.name || '-',
          '专业': cls.majors?.name || '-', 
          '培养层次': cls.training_levels?.name || '-',
          '入学年份': cls.enrollment_year,
          '年级': gradeCalc,
          '学生人数': Number(cls.student_count) || 0, 
          '培养方案': plan?.name || '-',
          '课程': '-', 
          '课程类型': '-',
          '周课时': '-', 
          '学期总课时': '-', 
          '使用教材': '-', 
          '书号': '-',
        });
      } else {
        for (const pc of planCourses) {
          const semRecord = pc.plan_course_semesters?.find(s => s.semester === currentSemesterNum);
          const textbooks = semRecord?.plan_textbooks || [];
          
          const weeklyHours = semRecord?.weekly_hours || pc.weekly_hours;
          const weeksCount = semRecord?.weeks_count || pc.weeks_per_semester;
          
          rows.push({
            '班级名称': cls.name, 
            '二级学院': cls.colleges?.name || '-',
            '专业': cls.majors?.name || '-', 
            '培养层次': cls.training_levels?.name || '-',
            '入学年份': cls.enrollment_year,
            '年级': gradeCalc,
            '学生人数': Number(cls.student_count) || 0, 
            '培养方案': plan?.name || '-',
            '课程': pc.courses.name,
            '课程类型': pc.courses.type === 'public' ? '公共基础课' : '专业课',
            '周课时': weeklyHours,
            '学期总课时': weeklyHours * weeksCount,
            '使用教材': textbooks.map((pt) => pt.textbooks.title).join('、') || '未指定',
            '书号': textbooks.map((pt) => pt.textbooks.isbn || '-').join('、') || '-',
          });
        }
      }
    }

    const headers = [
      { label: '班级名称', key: '班级名称', width: 25 },
      { label: '二级学院', key: '二级学院', width: 15 },
      { label: '专业', key: '专业', width: 15 },
      { label: '培养层次', key: '培养层次', width: 12 },
      { label: '入学年份', key: '入学年份', width: 12 },
      { label: '年级', key: '年级', width: 8 },
      { label: '学生人数', key: '学生人数', width: 10 },
      { label: '培养方案', key: '培养方案', width: 30 },
      { label: '课程', key: '课程', width: 20 },
      { label: '课程类型', key: '课程类型', width: 12 },
      { label: '周课时', key: '周课时', width: 8 },
      { label: '学期总课时', key: '学期总课时', width: 12 },
      { label: '使用教材', key: '使用教材', width: 30 },
      { label: '书号', key: '书号', width: 25 },
    ];

    const workbook = await createWorkbook(headers, rows);
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
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
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
 * 导出当前学期开课情况（POST - 避免token暴露在URL中）
 */
export async function exportSemesterSchedulePost(req, res, next) {
  try {
    const { collegeId, majorId, trainingLevelId, enrollmentYear, grade } = req.body;
    
    let semesterInfo = await getCurrentSemesterInfo();
    
    if (!semesterInfo) {
      return res.status(400).json({ success: false, message: '请先设置当前学期' });
    }

    const activeFilter = await getActiveClassFilter();
    
    const whereConditions = [activeFilter];
    
    if (collegeId) whereConditions.push({ college_id: Number(collegeId) });
    if (majorId) whereConditions.push({ major_id: Number(majorId) });
    if (trainingLevelId) whereConditions.push({ training_level_id: Number(trainingLevelId) });
    if (enrollmentYear) whereConditions.push({ enrollment_year: Number(enrollmentYear) });
    
    const classes = await prisma.classes.findMany({
      where: { AND: whereConditions },
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
                    plan_textbooks: {
                      include: { textbooks: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { enrollment_year: 'desc' },
    });

    const majorPlanIds = new Set();
    const levelPlanIds = new Set();
    for (const cls of classes) {
      if (!cls.custom_plan_id) {
        if (cls.major_id) majorPlanIds.add(cls.major_id);
        if (cls.training_level_id) levelPlanIds.add(cls.training_level_id);
      }
    }

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

    const rows = [];

    for (const cls of classes) {
      const gradeCalc = semesterInfo.startYear - cls.enrollment_year + 1;
      
      if (grade && gradeCalc !== Number(grade)) continue;
      if (gradeCalc < 1 || gradeCalc > cls.duration_years) continue;
      
      const currentSemesterNum = (gradeCalc - 1) * 2 + semesterInfo.semesterIndex;

      const plan = findBestMatchPlan(cls, matchingPlans);
      if (!plan) continue;

      const planCourses = plan.plan_courses.filter(
        (pc) => pc.start_semester <= currentSemesterNum && pc.end_semester >= currentSemesterNum
      );

      if (planCourses.length === 0) {
        rows.push({
          '班级名称': cls.name, 
          '二级学院': cls.colleges?.name || '-',
          '专业': cls.majors?.name || '-', 
          '培养层次': cls.training_levels?.name || '-',
          '入学年份': cls.enrollment_year,
          '年级': gradeCalc,
          '学生人数': Number(cls.student_count) || 0, 
          '课程': '-', 
          '课程类型': '-',
          '周课时': '-', 
          '学期总课时': '-', 
          '使用教材': '-', 
          '书号': '-',
        });
      } else {
        for (const pc of planCourses) {
          const semRecord = pc.plan_course_semesters?.find(s => s.semester === currentSemesterNum);
          const textbooks = semRecord?.plan_textbooks || [];
          
          const weeklyHours = semRecord?.weekly_hours || pc.weekly_hours;
          const weeksCount = semRecord?.weeks_count || pc.weeks_per_semester;
          
          rows.push({
            '班级名称': cls.name, 
            '二级学院': cls.colleges?.name || '-',
            '专业': cls.majors?.name || '-', 
            '培养层次': cls.training_levels?.name || '-',
            '入学年份': cls.enrollment_year,
            '年级': gradeCalc,
            '学生人数': Number(cls.student_count) || 0, 
            '课程': pc.courses.name,
            '课程类型': pc.courses.type === 'public' ? '公共基础课' : '专业课',
            '周课时': weeklyHours,
            '学期总课时': weeklyHours * weeksCount,
            '使用教材': textbooks.map((pt) => pt.textbooks.title).join('、') || '未指定',
            '书号': textbooks.map((pt) => pt.textbooks.isbn || '-').join('、') || '-',
          });
        }
      }
    }

    const headers = [
      { label: '班级名称', key: '班级名称', width: 25 },
      { label: '二级学院', key: '二级学院', width: 15 },
      { label: '专业', key: '专业', width: 15 },
      { label: '培养层次', key: '培养层次', width: 12 },
      { label: '入学年份', key: '入学年份', width: 12 },
      { label: '年级', key: '年级', width: 8 },
      { label: '学生人数', key: '学生人数', width: 10 },
      { label: '培养方案', key: '培养方案', width: 30 },
      { label: '课程', key: '课程', width: 20 },
      { label: '课程类型', key: '课程类型', width: 12 },
      { label: '周课时', key: '周课时', width: 8 },
      { label: '学期总课时', key: '学期总课时', width: 12 },
      { label: '使用教材', key: '使用教材', width: 30 },
      { label: '书号', key: '书号', width: 25 },
    ];

    const workbook = await createWorkbook(headers, rows);
    const buffer = await workbookToBuffer(workbook);
    const filename = `开课情况_${semesterInfo.label}.xlsx`;
    
    await createAuditLog({
      action: 'export',
      module: 'system',
      userId: req.user?.id,
      ip: req.ip,
      details: { semester: semesterInfo.label, rowCount: rows.length, method: 'POST' },
      result: 'success',
      message: `导出${semesterInfo.label}开课情况（POST），共${rows.length}条记录`,
    });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
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
