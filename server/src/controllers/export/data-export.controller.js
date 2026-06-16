import { prisma } from '../../lib/prisma.js';
import { createWorkbook, workbookToBuffer } from '../../utils/excel.js';
import { getSemesterInfoFromRequest, getCurrentSemesterInfo } from '../../services/settings.service.js';
import { createAuditLog } from '../../services/audit.service.js';
import { getActiveClassFilter } from '../../services/class.service.js';
import { isClassMatchPlan } from '../../services/plan.service.js';

/**
 * 导出课程数据
 */
export async function exportCourses(req, res, next) {
  try {
    const courses = await prisma.courses.findMany({
      orderBy: { sort_order: 'asc' },
    });

    const rows = courses.map((course) => ({
      '课程名称': course.name,
      '编码': course.code || '-',
      '类型': course.type === 'public' ? '公共基础课' : '专业课',
      '描述': course.description || '-',
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
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
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
      '书名': textbook.title,
      '书号': textbook.isbn || '-',
      '出版社': textbook.publisher || '-',
      '作者': textbook.author || '-',
      '版次': textbook.edition || '-',
      '出版日期': textbook.publish_date || '-',
      '定价': textbook.price || '-',
      '类别': textbook.category || '-',
      '状态': textbook.is_active ? '启用' : '停用',
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
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
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
    const { name, majorId, collegeId, status, trainingLevelId, planId, enrollmentYear } = req.query;
    
    // 构建筛选条件（与 listClasses 保持一致的逻辑）
    const where = {};
    if (name) where.name = { contains: name };
    
    if (majorId === 'null') {
      where.major_id = null;
    } else if (majorId) {
      where.major_id = Number(majorId);
    }
    
    if (collegeId === 'null') {
      where.college_id = null;
    } else if (collegeId) {
      where.college_id = Number(collegeId);
    }
    
    let dynamicStatusFilter = null;
    if (status === 'null') {
      dynamicStatusFilter = [
        { enrollment_year: null, is_left_school: false },
        { duration_years: null, is_left_school: false },
      ];
    } else if (status === 'left_school') {
      dynamicStatusFilter = [{ is_left_school: true }];
    } else if (status === 'active' || status === 'graduated') {
      const semesterInfo = await getCurrentSemesterInfo();
      if (semesterInfo) {
        const startYear = semesterInfo.startYear;
        const durations = await prisma.classes.findMany({
          select: { duration_years: true },
          distinct: ['duration_years'],
        });
        const durationValues = durations.map(d => d.duration_years).filter(d => d != null);
        
        dynamicStatusFilter = durationValues.map(d => ({
          duration_years: d,
          is_left_school: false,
          enrollment_year: status === 'active'
            ? { gte: startYear - d + 1 }
            : { lt: startYear - d + 1 },
        }));
      }
    }
    
    if (trainingLevelId === 'null') {
      where.training_level_id = null;
    } else if (trainingLevelId) {
      where.training_level_id = Number(trainingLevelId);
    }
    
    if (enrollmentYear === 'null') {
      where.enrollment_year = null;
    } else if (enrollmentYear) {
      where.enrollment_year = Number(enrollmentYear);
    }
    
    if (planId) {
      if (planId === 'none') {
        const allPlans = await prisma.training_plans.findMany({
          select: { id: true, major_id: true, training_level_id: true },
        });
        
        where.custom_plan_id = null;
        
        const notConditions = [];
        const majorIdsWithPlans = [...new Set(allPlans.filter(p => p.major_id).map(p => p.major_id))];
        if (majorIdsWithPlans.length > 0) {
          notConditions.push({ major_id: { in: majorIdsWithPlans } });
        }
        
        const levelIdsWithPlans = [...new Set(allPlans.filter(p => p.training_level_id).map(p => p.training_level_id))];
        if (levelIdsWithPlans.length > 0) {
          notConditions.push({ training_level_id: { in: levelIdsWithPlans } });
        }
        
        if (notConditions.length > 0) {
          where.NOT = { OR: notConditions };
        }
      } else {
        const planIdNum = Number(planId);
        const plan = await prisma.training_plans.findUnique({
          where: { id: planIdNum },
          select: { major_id: true, training_level_id: true },
        });
        
        if (plan) {
          const conditions = [{ custom_plan_id: planIdNum }];
          
          if (plan.major_id) {
            conditions.push({ major_id: plan.major_id, custom_plan_id: null });
          }
          
          if (plan.training_level_id) {
            conditions.push({ training_level_id: plan.training_level_id, custom_plan_id: null });
          }
          
          where.OR = conditions;
        } else {
          // 如果没有找到方案，返回空结果
          return success(res, { items: [], total: 0 }, '导出完成：无数据');
        }
      }
    }
    
    let finalWhere = where;
    if (dynamicStatusFilter) {
      finalWhere = {
        AND: [where, { OR: dynamicStatusFilter }],
      };
    }

    // 获取筛选后的班级数据
    const classes = await prisma.classes.findMany({
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
        // 尝试根据专业或培养层次匹配方案
        let matchedPlan = null;
        if (cls.major_id) {
          matchedPlan = allPlans.find(p => p.major_id === cls.major_id);
        }
        if (!matchedPlan && cls.training_level_id) {
          matchedPlan = allPlans.find(p => p.training_level_id === cls.training_level_id);
        }
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
        const calcGrade = semesterInfo ? (semesterInfo.startYear - cls.enrollment_year + 1) : null;
        statusText = (calcGrade !== null && calcGrade >= 1 && calcGrade <= cls.duration_years) ? '在读' : '已毕业';
      }

      return {
        '班级名称': cls.name,
        '二级学院': cls.colleges?.name || '-',
        '专业': cls.majors?.name || '-',
        '培养层次': cls.training_levels?.name || '-',
        '入学年份': cls.enrollment_year,
        '学制(年)': cls.duration_years,
        '人数': Number(cls.student_count) || 0,
        '年级': grade ? `${grade}年级` : '-',
        '状态': statusText,
        '关联类型': relationType,
        '当前方案': matchedPlanName || '-',
      };
    });

    const headers = [
      { label: '班级名称', key: '班级名称', width: 25 },
      { label: '二级学院', key: '二级学院', width: 15 },
      { label: '专业', key: '专业', width: 15 },
      { label: '培养层次', key: '培养层次', width: 12 },
      { label: '入学年份', key: '入学年份', width: 12 },
      { label: '学制(年)', key: '学制(年)', width: 10 },
      { label: '人数', key: '人数', width: 8 },
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
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
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
    const { semester } = req.query;
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
                      courses: true 
                    } 
                  },
                },
              },
            },
          },
        },
      }),
      prisma.classes.findMany({
        where: activeFilter,
        include: { majors: true, training_levels: true },
      }),
    ]);

    if (!textbook) return res.status(404).json({ success: false, message: '教材不存在' });

    const rows = [];

    for (const pt of textbook.plan_textbooks) {
      const sem = pt.plan_course_semesters;
      const pc = sem.plan_courses;
      const plan = pc.training_plans;

      for (const cls of allClasses) {
        const grade = semesterInfo.startYear - cls.enrollment_year + 1;
        const currentSemesterNum = (grade - 1) * 2 + semesterInfo.semesterIndex;
        if (currentSemesterNum !== sem.semester) continue;

        if (!isClassMatchPlan(cls, plan)) continue;

        rows.push({
          '教材名称': textbook.title, '书号': textbook.isbn || '-',
          '课程': pc.courses.name, '使用班级': cls.name,
          '专业': cls.majors?.name || '-', '培养层次': cls.training_levels?.name || '-',
          '年级': grade, '学生人数': Number(cls.student_count) || 0,
          '使用学期': `第${sem.semester}学期`,
          '是否必订': pt.is_required ? '是' : '否',
        });
      }
    }

    const totalStudents = rows.reduce((sum, r) => sum + (Number(r['学生人数']) || 0), 0);
    rows.push({
      '教材名称': '合计', '书号': '', '课程': '',
      '使用班级': `${rows.length}个班级`, '专业': '', '培养层次': '',
      '年级': '', '学生人数': totalStudents, '使用学期': '', '是否必订': '',
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
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
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
