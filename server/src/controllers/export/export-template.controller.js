import { createTemplateWorkbook, workbookToBuffer } from '../../utils/excel.js';
import { createAuditLog } from '../../services/audit.service.js';

/**
 * 下载导入模板
 */
export async function downloadTemplate(req, res, next) {
  try {
    const { type } = req.params;
    let headers = [];
    let sample = [];
    let filename = '';

    switch (type) {
      case 'classes':
        // 列顺序与前端班级管理列表保持一致：名称→学院→专业→层次→年份→学制→人数→状态
        headers = [
          { label: '班级名称', key: 'name', width: 25, required: true },
          { label: '二级学院', key: 'college', width: 20 },
          { label: '专业类别', key: 'major', width: 20 },
          { label: '培养层次', key: 'trainingLevel', width: 15, required: true },
          { label: '入学年份', key: 'year', width: 12, required: true },
          { label: '学制(年)', key: 'duration', width: 10, required: true },
          { label: '班级人数', key: 'count', width: 10 },
          { label: '状态', key: 'status', width: 10 },
        ];
        sample = {
          班级名称: '2024级学前1班',
          二级学院: '教育学院',
          专业类别: '学前教育',
          培养层次: '大专',
          入学年份: 2024,
          '学制(年)': 3,
          班级人数: 45,
          状态: '在读',
        };
        filename = '班级导入模板.xlsx';
        break;
      case 'courses':
        headers = [
          { label: '课程名称', key: 'name', width: 20, required: true },
          { label: '课程编码', key: 'code', width: 15 },
          { label: '课程类型', key: 'type', width: 15 },
          { label: '描述', key: 'description', width: 30 },
        ];
        sample = {
          课程名称: '语文',
          课程编码: 'CHN001',
          课程类型: '公共基础课',
          描述: '基础语文课程',
        };
        filename = '课程导入模板.xlsx';
        break;
      case 'textbooks':
        headers = [
          { label: '书名', key: 'title', width: 30, required: true },
          { label: '书号', key: 'isbn', width: 20 },
          { label: '出版社', key: 'publisher', width: 20 },
          { label: '作者', key: 'author', width: 15 },
          { label: '版次', key: 'edition', width: 10 },
          { label: '出版日期', key: 'publish_date', width: 15 },
          { label: '定价', key: 'price', width: 10 },
          { label: '类别', key: 'category', width: 10 },
          { label: '状态', key: 'status', width: 10 },
        ];
        sample = {
          书名: '大学语文',
          书号: '978-7-04-012345-6',
          出版社: '高等教育出版社',
          作者: '张三',
          版次: '第3版',
          出版日期: '2024-01',
          定价: 45.0,
          类别: '技工',
          状态: '启用',
        };
        filename = '教材导入模板.xlsx';
        break;
      case 'teachers':
        // 列顺序与前端教师信息列表保持一致：姓名→性别→出生年月→资格→归属学院→人员类别→学科→任课学院→任课层次→自定义课时→状态
        headers = [
          { label: '教师姓名', key: 'name', width: 15, required: true },
          { label: '性别', key: 'gender', width: 8 },
          { label: '出生年月', key: 'birth_date', width: 12 },
          { label: '教师资格类型', key: 'qualification_type', width: 15 },
          { label: '归属学院', key: 'affiliated_college', width: 15 },
          { label: '人员类别', key: 'personnel_type', width: 12, required: true },
          { label: '学科', key: 'courses', width: 25 },
          { label: '任课学院', key: 'colleges', width: 25 },
          { label: '任课层次', key: 'levels', width: 20 },
          { label: '自定义课时', key: 'default_weekly_hours', width: 12 },
          { label: '状态', key: 'status', width: 8 },
        ];
        sample = {
          教师姓名: '张三',
          性别: '男',
          出生年月: '1990-01',
          教师资格类型: '高中语文',
          归属学院: '教育学院',
          人员类别: '专职',
          学科: '语文,数学',
          任课学院: '教育学院,艺术学院',
          任课层次: '大专,中专',
          自定义课时: 16,
          状态: '启用',
        };
        filename = '教师导入模板.xlsx';
        break;
      default:
        return res.status(400).json({ success: false, message: '不支持的模板类型' });
    }

    const workbook = createTemplateWorkbook(headers, [sample]);
    const buffer = await workbookToBuffer(workbook);

    await createAuditLog({
      action: 'export',
      module: 'system',
      userId: req.user?.id,
      ip: req.ip,
      details: { type },
      result: 'success',
      message: `下载${type}导入模板`,
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
      module: 'system',
      userId: req.user?.id,
      ip: req.ip,
      details: { type: req.params.type },
      result: 'failed',
      message: `下载模板失败: ${e.message}`,
    });
    next(e);
  }
}
