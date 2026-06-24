import { body, param, query, validationResult } from 'express-validator';
import { fail } from '../utils/response.js';
import { log } from '../utils/logger.js';

/**
 * 验证结果处理中间件
 */
export function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorDetails = errors.array().map((err) => ({
      field: err.path,
      message: err.msg,
      location: err.location,
    }));

    // 调试日志：打印验证失败的详细信息（脱敏，剔除密码等敏感字段）
    const { password, old_password, new_password, ...safeBody } = req.body || {};
    log.warn('验证参数失败', {
      method: req.method,
      path: req.path,
      body: safeBody,
      errors: errorDetails,
    });

    return fail(
      res,
      {
        code: 'VALIDATION_ERROR',
        message: '请求参数验证失败',
        details: errorDetails,
      },
      422
    );
  }
  next();
}

/**
 * 班级创建/更新验证规则
 */
export const validateClass = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('班级名称不能为空且不超过100个字符'),
  body('enrollment_year')
    .isInt({ min: 2000, max: 2100 })
    .withMessage('入学年份必须在2000-2100之间'),
  body('duration_years').isInt({ min: 1, max: 10 }).withMessage('学制必须在1-10年之间'),
  body('training_level_id').optional().isInt({ min: 1 }).withMessage('培养层次ID必须为正整数'),
  body('major_id').optional({ nullable: true }).isInt({ min: 1 }).withMessage('专业ID必须为正整数'),
  body('college_id')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('学院ID必须为正整数'),
  body('student_count')
    .optional()
    .isInt({ min: 0, max: 999 })
    .withMessage('学生人数必须在0-999之间'),
  handleValidationErrors,
];

/**
 * 班级更新验证规则（所有字段可选，用于部分更新）
 */
export const validateClassUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('班级名称不能为空且不超过100个字符'),
  body('enrollment_year')
    .optional()
    .isInt({ min: 2000, max: 2100 })
    .withMessage('入学年份必须在2000-2100之间'),
  body('duration_years').optional().isInt({ min: 1, max: 10 }).withMessage('学制必须在1-10年之间'),
  body('training_level_id')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('培养层次ID必须为正整数'),
  body('major_id').optional({ nullable: true }).isInt({ min: 1 }).withMessage('专业ID必须为正整数'),
  body('college_id')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('学院ID必须为正整数'),
  body('student_count')
    .optional()
    .isInt({ min: 0, max: 999 })
    .withMessage('学生人数必须在0-999之间'),
  handleValidationErrors,
];

/**
 * 用户登录验证规则
 */
export const validateLogin = [
  body('username')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('用户名不能为空且不超过50个字符'),
  body('password').isLength({ min: 8, max: 128 }).withMessage('密码长度必须在8-128位之间'),
  handleValidationErrors,
];

/**
 * 修改密码验证规则
 */
export const validateChangePassword = [
  body('old_password').notEmpty().withMessage('原密码不能为空'),
  body('new_password')
    .isLength({ min: 8, max: 128 })
    .withMessage('新密码长度必须在8-128位之间')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
    .withMessage('密码必须包含大小写字母、数字和特殊字符'),
  handleValidationErrors,
];

/**
 * 分页参数验证规则
 */
export const validatePagination = [
  query('page').optional().isInt({ min: 1 }).withMessage('页码必须为正整数'),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('每页数量必须在1-100之间'),
  handleValidationErrors,
];

/**
 * ID参数验证规则
 */
export const validateIdParam = [
  param('id').isInt({ min: 1 }).withMessage('ID必须为正整数'),
  handleValidationErrors,
];

/**
 * 专业验证规则
 */
export const validateMajor = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('专业名称不能为空且不超过100个字符'),
  body('code').optional().trim().isLength({ max: 50 }).withMessage('专业编码不超过50个字符'),
  handleValidationErrors,
];

/**
 * 课程验证规则
 */
export const validateCourse = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('课程名称不能为空且不超过100个字符'),
  body('code').optional().trim().isLength({ max: 50 }).withMessage('课程编码不超过50个字符'),
  body('type')
    .optional()
    .isIn(['public', 'professional', 'elective'])
    .withMessage('课程类型必须是public、professional或elective'),
  handleValidationErrors,
];

/**
 * 教材验证规则（用于更新，允许部分字段）
 */
export const validateTextbook = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('书名不能为空且不超过200个字符'),
  body('isbn').optional().trim().isLength({ max: 50 }).withMessage('ISBN不超过50个字符'),
  body('publisher').optional().trim().isLength({ max: 100 }).withMessage('出版社不超过100个字符'),
  body('author').optional().trim().isLength({ max: 100 }).withMessage('作者不超过100个字符'),
  body('price')
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage('定价必须为0-100000之间的非负数'),
  body('publish_date')
    .optional({ nullable: true })
    .trim()
    .matches(/^\d{4}(-\d{2}(-\d{2})?)?$/)
    .withMessage('出版日期格式应为YYYY-MM-DD或YYYY-MM或YYYY'),
  handleValidationErrors,
];

/**
 * 教材创建验证规则（title必填）
 */
export const validateTextbookCreate = [
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('书名不能为空且不超过200个字符'),
  body('isbn').optional().trim().isLength({ max: 50 }).withMessage('ISBN不超过50个字符'),
  body('publisher').optional().trim().isLength({ max: 100 }).withMessage('出版社不超过100个字符'),
  body('author').optional().trim().isLength({ max: 100 }).withMessage('作者不超过100个字符'),
  body('price')
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage('定价必须为0-100000之间的非负数'),
  body('publish_date')
    .optional({ nullable: true })
    .trim()
    .matches(/^\d{4}(-\d{2}(-\d{2})?)?$/)
    .withMessage('出版日期格式应为YYYY-MM-DD或YYYY-MM或YYYY'),
  handleValidationErrors,
];

/**
 * 用户创建/更新验证规则
 */
export const validateUser = [
  body('username')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('用户名不能为空且不超过50个字符'),
  body('password')
    .optional()
    .isLength({ min: 8, max: 128 })
    .withMessage('密码长度必须在8-128位之间')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,128}$/)
    .withMessage('密码必须包含大小写字母、数字和特殊字符'),
  body('email').optional({ nullable: true }).isEmail().withMessage('邮箱格式不正确'),
  body('role')
    .optional()
    .isIn(['super_admin', 'admin', 'viewer'])
    .withMessage('角色必须是super_admin、admin或viewer'),
  body('real_name').optional().trim().isLength({ max: 100 }).withMessage('真实姓名不超过100个字符'),
  handleValidationErrors,
];

/**
 * 用户状态更新验证规则
 */
export const validateUserStatus = [
  body('is_active').isBoolean().withMessage('激活状态必须为布尔值'),
  handleValidationErrors,
];

/**
 * 学院验证规则
 */
export const validateCollege = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('学院名称不能为空且不超过100个字符'),
  body('code').optional().trim().isLength({ max: 50 }).withMessage('学院编码不超过50个字符'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('描述不超过500个字符'),
  handleValidationErrors,
];

/**
 * 培养层次验证规则
 */
export const validateTrainingLevel = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('培养层次名称不能为空且不超过100个字符'),
  body('code').optional().trim().isLength({ max: 50 }).withMessage('培养层次编码不超过50个字符'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('描述不超过500个字符'),
  handleValidationErrors,
];

/**
 * 教材状态切换验证规则
 */
export const validateTextbookStatus = [
  body('is_active').optional().isBoolean().withMessage('激活状态必须为布尔值'),
  handleValidationErrors,
];

/**
 * 培养方案验证规则
 */
export const validatePlan = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('方案名称不能为空且不超过200个字符'),
  body('major_id').optional({ nullable: true }).isInt({ min: 1 }).withMessage('专业ID必须为正整数'),
  body('college_id')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('学院ID必须为正整数'),
  body('training_level_id')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('培养层次ID必须为正整数'),
  body('version').optional().trim().isLength({ max: 50 }).withMessage('版本号不超过50个字符'),
  handleValidationErrors,
];

/**
 * 方案课程验证规则
 */
export const validatePlanCourse = [
  body('course_id').optional().isInt({ min: 1 }).withMessage('课程ID必须为正整数'),
  body('start_semester')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('开始学期必须在1-10之间'),
  body('end_semester').optional().isInt({ min: 1, max: 10 }).withMessage('结束学期必须在1-10之间'),
  body('weekly_hours').optional().isInt({ min: 0, max: 20 }).withMessage('周课时必须在0-20之间'),
  body('weeks_per_semester')
    .optional()
    .isInt({ min: 1, max: 30 })
    .withMessage('每学期周数必须在1-30之间'),
  handleValidationErrors,
];

/**
 * 学期信息验证规则
 */
export const validateSemester = [
  body('weekly_hours').optional().isInt({ min: 0, max: 20 }).withMessage('周课时必须在0-20之间'),
  body('weeks_count').optional().isInt({ min: 1, max: 30 }).withMessage('周数必须在1-30之间'),
  handleValidationErrors,
];

/**
 * 教材分配验证规则
 */
export const validatePlanTextbook = [
  body('textbook_id').isInt({ min: 1 }).withMessage('教材ID必须为正整数'),
  body('is_required').optional().isBoolean().withMessage('是否必须必须为布尔值'),
  handleValidationErrors,
];

/**
 * 系统设置重置验证规则
 */
export const validateReset = [
  body('confirm')
    .notEmpty()
    .withMessage('必须提供confirm字段')
    .equals('DELETE')
    .withMessage('必须输入DELETE确认操作'),
  body('reason')
    .optional()
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage('操作原因必须在10-500个字符之间'),
  handleValidationErrors,
];

/**
 * 学期参数查询验证规则
 */
export const validateSemesterQuery = [
  query('semester')
    .optional()
    .matches(/^\d{4}-\d{4}-[12]$/)
    .withMessage('学期格式错误，应为YYYY-YYYY-N'),
  handleValidationErrors,
];

/**
 * 排序更新验证规则（轻量级，只验证sort_order字段）
 * 用于部分更新场景，不要求其他必填字段
 */
export const validateSortOrder = [
  body('sort_order').optional().isInt({ min: 0 }).withMessage('排序值必须为非负整数'),
  handleValidationErrors,
];

/**
 * 专业创建验证规则（name必填）
 */
export const validateMajorCreate = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('专业名称不能为空且不超过100个字符'),
  body('code').optional().trim().isLength({ max: 50 }).withMessage('专业编码不超过50个字符'),
  handleValidationErrors,
];

/**
 * 学院创建验证规则（name必填）
 */
export const validateCollegeCreate = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('学院名称不能为空且不超过100个字符'),
  body('code').optional().trim().isLength({ max: 50 }).withMessage('学院编码不超过50个字符'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('描述不超过500个字符'),
  handleValidationErrors,
];

/**
 * 课程创建验证规则（name必填）
 */
export const validateCourseCreate = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('课程名称不能为空且不超过100个字符'),
  body('code').optional().trim().isLength({ max: 50 }).withMessage('课程编码不超过50个字符'),
  body('type')
    .optional()
    .isIn(['public', 'professional', 'elective'])
    .withMessage('课程类型必须是public、professional或elective'),
  handleValidationErrors,
];

/**
 * 培养层次创建验证规则（name必填）
 */
export const validateTrainingLevelCreate = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('培养层次名称不能为空且不超过100个字符'),
  body('code').optional().trim().isLength({ max: 50 }).withMessage('培养层次编码不超过50个字符'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('描述不超过500个字符'),
  handleValidationErrors,
];

/**
 * 培养方案创建验证规则（name必填）
 */
export const validatePlanCreate = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('方案名称不能为空且不超过200个字符'),
  body('major_id').optional({ nullable: true }).isInt({ min: 1 }).withMessage('专业ID必须为正整数'),
  body('college_id')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('学院ID必须为正整数'),
  body('training_level_id')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('培养层次ID必须为正整数'),
  body('version').optional().trim().isLength({ max: 50 }).withMessage('版本号不超过50个字符'),
  handleValidationErrors,
];

/**
 * 教师创建验证规则（name必填）
 */
export const validateTeacherCreate = [
  body('name').trim().isLength({ min: 1, max: 50 }).withMessage('教师姓名不能为空且不超过50个字符'),
  body('gender')
    .optional({ nullable: true })
    .isIn(['male', 'female'])
    .withMessage('性别必须是male或female'),
  body('birth_date')
    .optional({ nullable: true })
    .matches(/^\d{4}-\d{2}$/)
    .withMessage('出生年月格式错误，应为YYYY-MM'),
  body('personnel_type')
    .optional()
    .isIn(['full_time', 'part_time', 'external'])
    .withMessage('人员类别必须是full_time、part_time或external'),
  body('qualification_type')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100 })
    .withMessage('教师资格类型不超过100个字符'),
  body('default_weekly_hours')
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 40 })
    .withMessage('特定周课时必须在0-40之间'),
  handleValidationErrors,
];

/**
 * 教师更新验证规则（所有字段可选）
 */
export const validateTeacherUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('教师姓名不能为空且不超过50个字符'),
  body('gender')
    .optional({ nullable: true })
    .isIn(['male', 'female'])
    .withMessage('性别必须是male或female'),
  body('birth_date')
    .optional({ nullable: true })
    .matches(/^\d{4}-\d{2}$/)
    .withMessage('出生年月格式错误，应为YYYY-MM'),
  body('personnel_type')
    .optional()
    .isIn(['full_time', 'part_time', 'external'])
    .withMessage('人员类别必须是full_time、part_time或external'),
  body('qualification_type')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100 })
    .withMessage('教师资格类型不超过100个字符'),
  body('default_weekly_hours')
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 40 })
    .withMessage('特定周课时必须在0-40之间'),
  handleValidationErrors,
];

/**
 * 教学安排 - 手动安排教师验证规则
 */
export const validateAssignTeacher = [
  body('class_id').isInt({ min: 1 }).withMessage('班级ID必须为正整数'),
  body('course_id').isInt({ min: 1 }).withMessage('课程ID必须为正整数'),
  body('teacher_id').isInt({ min: 1 }).withMessage('教师ID必须为正整数'),
  body('semester')
    .matches(/^\d{4}-\d{4}-[12]$/)
    .withMessage('学期格式错误，应为YYYY-YYYY-N'),
  body('weekly_hours').optional().isFloat({ min: 0, max: 40 }).withMessage('周课时必须在0-40之间'),
  handleValidationErrors,
];

/**
 * 教学安排 - 自动排课验证规则
 */
export const validateAutoArrange = [
  body('course_id').isInt({ min: 1 }).withMessage('课程ID必须为正整数'),
  body('semester')
    .matches(/^\d{4}-\d{4}-[12]$/)
    .withMessage('学期格式错误，应为YYYY-YYYY-N'),
  body('mode').isIn(['full', 'standard']).withMessage('排课模式必须是full或standard'),
  body('preview').optional().isBoolean().withMessage('preview必须为布尔值'),
  handleValidationErrors,
];

/**
 * 教学安排 - 批量排课验证规则
 */
export const validateBatchAutoArrange = [
  body('semester')
    .matches(/^\d{4}-\d{4}-[12]$/)
    .withMessage('学期格式错误，应为YYYY-YYYY-N'),
  body('mode').isIn(['full', 'standard']).withMessage('排课模式必须是full或standard'),
  body('preview').optional().isBoolean().withMessage('preview必须为布尔值'),
  handleValidationErrors,
];

/**
 * 教学安排 - 重置自动安排验证规则
 */
export const validateResetAuto = [
  body('course_id').isInt({ min: 1 }).withMessage('课程ID必须为正整数'),
  body('semester')
    .matches(/^\d{4}-\d{4}-[12]$/)
    .withMessage('学期格式错误，应为YYYY-YYYY-N'),
  handleValidationErrors,
];

/**
 * 教学安排 - 课时设置验证规则
 */
export const validateHourSettings = [
  body('hour_settings').isObject().withMessage('课时设置必须为对象'),
  body('course_id').optional().isInt({ min: 1 }).withMessage('课程ID必须为正整数'),
  handleValidationErrors,
];

/**
 * 教师批量修改周课时验证规则
 */
export const validateBatchUpdateHours = [
  body('teacher_ids').isArray({ min: 1, max: 500 }).withMessage('教师ID数组必须包含1-500个元素'),
  body('teacher_ids.*').isInt({ min: 1 }).withMessage('教师ID必须为正整数'),
  body('default_weekly_hours')
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 40 })
    .withMessage('特定周课时必须在0-40之间'),
  handleValidationErrors,
];
