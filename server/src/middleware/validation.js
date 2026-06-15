import { body, param, query, validationResult } from 'express-validator';
import { fail } from '../utils/response.js';

/**
 * 验证结果处理中间件
 */
export function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorDetails = errors.array().map(err => ({
      field: err.path,
      message: err.msg,
      location: err.location,
    }));
    
    return fail(res, {
      code: 'VALIDATION_ERROR',
      message: '请求参数验证失败',
      details: errorDetails
    }, 422);
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
  body('enrollmentYear')
    .isInt({ min: 2000, max: 2100 })
    .withMessage('入学年份必须在2000-2100之间'),
  body('durationYears')
    .isInt({ min: 1, max: 10 })
    .withMessage('学制必须在1-10年之间'),
  body('trainingLevelId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('培养层次ID必须为正整数'),
  body('majorId')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('专业ID必须为正整数'),
  body('collegeId')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('学院ID必须为正整数'),
  body('studentCount')
    .optional()
    .isInt({ min: 0, max: 999 })
    .withMessage('学生人数必须在0-999之间'),
  handleValidationErrors
];

/**
 * 用户登录验证规则
 */
export const validateLogin = [
  body('username')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('用户名不能为空且不超过50个字符'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('密码长度至少6位'),
  handleValidationErrors
];

/**
 * 修改密码验证规则
 */
export const validateChangePassword = [
  body('oldPassword')
    .notEmpty()
    .withMessage('原密码不能为空'),
  body('newPassword')
    .isLength({ min: 8, max: 128 })
    .withMessage('新密码长度必须在8-128位之间')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
    .withMessage('密码必须包含大小写字母、数字和特殊字符'),
  handleValidationErrors
];

/**
 * 分页参数验证规则
 */
export const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('页码必须为正整数'),
  query('pageSize')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('每页数量必须在1-100之间'),
  handleValidationErrors
];

/**
 * ID参数验证规则
 */
export const validateIdParam = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须为正整数'),
  handleValidationErrors
];

/**
 * 专业验证规则
 */
export const validateMajor = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('专业名称不能为空且不超过100个字符'),
  body('code')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('专业编码不超过50个字符'),
  handleValidationErrors
];

/**
 * 课程验证规则
 */
export const validateCourse = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('课程名称不能为空且不超过100个字符'),
  body('code')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('课程编码不超过50个字符'),
  body('type')
    .optional()
    .isIn(['public', 'professional', 'elective'])
    .withMessage('课程类型必须是public、professional或elective'),
  handleValidationErrors
];

/**
 * 教材验证规则
 */
export const validateTextbook = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('书名不能为空且不超过200个字符'),
  body('isbn')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('ISBN不超过50个字符'),
  body('publisher')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('出版社不超过100个字符'),
  body('author')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('作者不超过100个字符'),
  body('price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('定价必须为非负数'),
  handleValidationErrors
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
    .withMessage('密码长度必须在8-128位之间'),
  body('email')
    .optional({ nullable: true })
    .isEmail()
    .withMessage('邮箱格式不正确'),
  body('role')
    .optional()
    .isIn(['super_admin', 'admin', 'viewer'])
    .withMessage('角色必须是super_admin、admin或viewer'),
  body('real_name')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('真实姓名不超过100个字符'),
  handleValidationErrors
];

/**
 * 用户状态更新验证规则
 */
export const validateUserStatus = [
  body('is_active')
    .isBoolean()
    .withMessage('激活状态必须为布尔值'),
  handleValidationErrors
];

/**
 * 学院验证规则
 */
export const validateCollege = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('学院名称不能为空且不超过100个字符'),
  body('code')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('学院编码不超过50个字符'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('描述不超过500个字符'),
  handleValidationErrors
];

/**
 * 培养层次验证规则
 */
export const validateTrainingLevel = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('培养层次名称不能为空且不超过100个字符'),
  body('code')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('培养层次编码不超过50个字符'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('描述不超过500个字符'),
  handleValidationErrors
];

/**
 * 教材状态切换验证规则
 */
export const validateTextbookStatus = [
  body('is_active')
    .isBoolean()
    .withMessage('激活状态必须为布尔值'),
  handleValidationErrors
];

/**
 * 培养方案验证规则
 */
export const validatePlan = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('方案名称不能为空且不超过200个字符'),
  body('majorId')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('专业ID必须为正整数'),
  body('collegeId')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('学院ID必须为正整数'),
  body('trainingLevelId')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('培养层次ID必须为正整数'),
  body('version')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('版本号不超过50个字符'),
  handleValidationErrors
];

/**
 * 方案课程验证规则
 */
export const validatePlanCourse = [
  body('courseId')
    .isInt({ min: 1 })
    .withMessage('课程ID必须为正整数'),
  body('startSemester')
    .isInt({ min: 1, max: 10 })
    .withMessage('开始学期必须在1-10之间'),
  body('endSemester')
    .isInt({ min: 1, max: 10 })
    .withMessage('结束学期必须在1-10之间'),
  body('weeklyHours')
    .isInt({ min: 1, max: 20 })
    .withMessage('周课时必须在1-20之间'),
  body('weeksPerSemester')
    .isInt({ min: 1, max: 30 })
    .withMessage('每学期周数必须在1-30之间'),
  handleValidationErrors
];

/**
 * 学期信息验证规则
 */
export const validateSemester = [
  body('semester')
    .isInt({ min: 1, max: 10 })
    .withMessage('学期必须在1-10之间'),
  body('weeklyHours')
    .isInt({ min: 1, max: 20 })
    .withMessage('周课时必须在1-20之间'),
  body('weeksCount')
    .isInt({ min: 1, max: 30 })
    .withMessage('周数必须在1-30之间'),
  handleValidationErrors
];

/**
 * 教材分配验证规则
 */
export const validatePlanTextbook = [
  body('textbookId')
    .isInt({ min: 1 })
    .withMessage('教材ID必须为正整数'),
  body('isRequired')
    .optional()
    .isBoolean()
    .withMessage('是否必须必须为布尔值'),
  handleValidationErrors
];

/**
 * 系统设置重置验证规则
 */
export const validateReset = [
  body('confirm')
    .equals('DELETE')
    .withMessage('必须输入DELETE确认操作'),
  body('reason')
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage('操作原因必须在10-500个字符之间'),
  handleValidationErrors
];

/**
 * 学期参数查询验证规则
 */
export const validateSemesterQuery = [
  query('semester')
    .optional()
    .matches(/^\d{4}-\d{4}-[12]$/)
    .withMessage('学期格式错误，应为YYYY-YYYY-N'),
  handleValidationErrors
];
