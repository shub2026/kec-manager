// 班级状态常量
export const CLASS_STATUS = {
  ACTIVE: 'active',
  GRADUATED: 'graduated',
  LEFT_SCHOOL: 'left_school'
};

// 用户角色常量
export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  VIEWER: 'viewer'
};

// 分页常量
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  MIN_PAGE: 1
};

// 导入配置
export const IMPORT = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_FILE_TYPES: ['xlsx', 'xls']
};

// 密码策略
export const PASSWORD_POLICY = {
  MIN_LENGTH: 8,
  MAX_LENGTH: 128,
  REGEX: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[a-zA-Z\d@$!%*?&]{8,}$/
};

// 审计模块
export const AUDIT_MODULES = {
  AUTH: 'auth',
  USER: 'user',
  MAJOR: 'major',
  COLLEGE: 'college',
  COURSE: 'course',
  TEXTBOOK: 'textbook',
  CLASS: 'class',
  PLAN: 'trainingPlan',
  TRAINING_LEVEL: 'training_level',
  SYSTEM: 'system',
  TEACHER: 'teacher',
  TEACHING_ARRANGE: 'teachingArrange'
};

// 人员类别
export const PERSONNEL_TYPE = {
  FULL_TIME: 'full_time',
  PART_TIME: 'part_time',
  EXTERNAL: 'external'
};

// 默认课时要求设置
export const DEFAULT_HOUR_SETTINGS = {
  full_time: { standard: 16, max: 20 },
  part_time: { standard: 12, max: 16 },
  external: { standard: 12, max: 16 },
};

// 课时设置存储键前缀
export const HOUR_SETTINGS_PREFIX = 'teaching_hour_settings';

// 排课模式
export const ARRANGE_MODE = {
  FULL: 'full',
  STANDARD: 'standard',
};

// 工作量平衡阈值
export const WORKLOAD_BALANCE = {
  SCORE_THRESHOLD: 1,
  LOAD_RATE_THRESHOLD: 0.2,
};

// 审计操作
export const AUDIT_ACTIONS = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  IMPORT: 'import',
  EXPORT: 'export'
};

// 审计结果
export const AUDIT_RESULTS = {
  SUCCESS: 'success',
  FAILED: 'failed'
};
